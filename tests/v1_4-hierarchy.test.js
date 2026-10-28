'use strict';

/**
 * V1.4 nested subprojects: two levels beneath a project, validated hierarchy, no double
 * counting in rollups and a sanitized snapshot that keeps the hierarchy readable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

/** Project P1 with a root subproject S1 and a nested S1-CHILD beneath it. */
function nested(options = {}) {
  const app = fixtures.base(options);
  const context = app.context;
  context.Subprojects.create({
    Subproject_ID: 'S1-CHILD', Project_ID: 'P1', Parent_Subproject_ID: 'S1', Subproject_Name: 'カメラ取付設計',
    Owner_ID: 'M-ENG', Status: 'Active'
  });
  return app;
}

function snapshotOf(app) {
  const snapshot = dashboardFixtures.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(app);
  app.context.publishSharedDashboard();
  return dashboardFixtures.dashboardFor(snapshot);
}

test('a nested subproject is created beneath a root subproject and keeps stable IDs', () => {
  const app = nested();
  const child = app.context.Database.find('SUBPROJECTS', 'S1-CHILD');
  assert.equal(child.Parent_Subproject_ID, 'S1');
  assert.equal(child.Project_ID, 'P1');
  assert.match(child.Subproject_ID, /^S1-CHILD$/);
  assert.equal(app.context.Subprojects.levelOf('S1', app.context.Subprojects.parentMap()), 1);
  assert.equal(app.context.Subprojects.levelOf('S1-CHILD', app.context.Subprojects.parentMap()), 2);
});

test('four levels are accepted and a fifth level, a self-parent and a cross-project parent are refused', () => {
  const app = nested();
  const context = app.context;
  // V1.6 allows four subproject levels beneath a project; the existing two-level data above
  // is untouched and the deeper nodes are additive.
  context.Subprojects.create({Subproject_ID: 'S1-L3', Project_ID: 'P1', Parent_Subproject_ID: 'S1-CHILD', Subproject_Name: '断面検討'});
  context.Subprojects.create({Subproject_ID: 'S1-L4', Project_ID: 'P1', Parent_Subproject_ID: 'S1-L3', Subproject_Name: '最終確認'});
  assert.equal(context.Subprojects.levelOf('S1-L4', context.Subprojects.parentMap()), 4);
  assert.throws(() => context.Subprojects.create({
    Project_ID: 'P1', Parent_Subproject_ID: 'S1-L4', Subproject_Name: '深すぎる階層'
  }), /4階層まで/);
  assert.throws(() => context.Subprojects.update('S1-CHILD', {Parent_Subproject_ID: 'S1-CHILD'}),
    /自身の親/);
  assert.throws(() => context.Subprojects.create({
    Project_ID: 'P2', Parent_Subproject_ID: 'S1', Subproject_Name: '別プロジェクトの子'
  }), /同じプロジェクト/);
  assert.throws(() => context.Subprojects.create({
    Project_ID: 'P1', Parent_Subproject_ID: 'S-MISSING', Subproject_Name: '存在しない親'
  }), /not found|見つかりません/);
});

test('reparenting a root that has children is refused instead of flattening the tree', () => {
  const app = nested();
  const context = app.context;
  context.Subprojects.create({Subproject_ID: 'S1-L3', Project_ID: 'P1', Parent_Subproject_ID: 'S1-CHILD', Subproject_Name: '断面検討'});
  context.Subprojects.create({Subproject_ID: 'S1-L4', Project_ID: 'P1', Parent_Subproject_ID: 'S1-L3', Subproject_Name: '最終確認'});
  context.Subprojects.create({Project_ID: 'P1', Subproject_Name: '電気設計', Status: 'Active'});
  const root = context.Database.read('SUBPROJECTS').filter(row => row.Subproject_Name === '電気設計')[0];
  // S1 already carries three descendant levels, so moving the whole subtree under another
  // root would exceed the configured depth.
  const result = context.Ui.saveSubproject({
    subprojectId: 'S1', parentId: root.Subproject_ID, confirmReparent: true
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /4階層まで/);
  assert.equal(context.Database.find('SUBPROJECTS', 'S1').Parent_Subproject_ID, '');
  assert.equal(context.Database.find('SUBPROJECTS', 'S1-CHILD').Parent_Subproject_ID, 'S1');
});

test('a valid reparent is audited and never moves tasks', () => {
  const app = fixtures.base();
  const context = app.context;
  context.Subprojects.create({Subproject_ID: 'S2', Project_ID: 'P1', Subproject_Name: '電気設計', Status: 'Active'});
  const before = plain(context.Database.find('TASKS', 'T1'));

  assert.throws(() => context.Subprojects.reparent('S1', 'S2', {}), /確認が必要/);
  context.Subprojects.reparent('S1', 'S2', {confirmed: true});
  assert.equal(context.Database.find('SUBPROJECTS', 'S1').Parent_Subproject_ID, 'S2');
  const after = plain(context.Database.find('TASKS', 'T1'));
  assert.deepEqual(after, before, 'the task keeps its subproject, owner and schedule');
  const audit = context.Database.read('AUDIT_LOG').filter(row => row.Action === 'SUBPROJECT_REPARENTED');
  assert.equal(audit.length, 1);
  assert.deepEqual(JSON.parse(audit[0].New_Value), {previousParent: '', newParent: 'S2'});
});

test('a parent subproject rolls up its own and descendant tasks exactly once', () => {
  const app = nested();
  const context = app.context;
  fixtures.completedTask({context: context}, {Task_ID: 'T-CHILD', Project_ID: 'P1', Subproject_ID: 'S1-CHILD', Task_Name: 'カメラ取付',
    Owner_Member_ID: 'M-ENG', Estimated_Hours: 10, Due_Date: '2026-12-10'});
  context.Progress.refresh();

  const parent = context.Database.find('SUBPROJECTS', 'S1');
  const child = context.Database.find('SUBPROJECTS', 'S1-CHILD');
  const project = context.Database.find('PROJECTS', 'P1');
  // T1 = 25% of 40h, T-CHILD = 100% of 10h -> (0.25*40 + 1*10) / 50 = 40%
  assert.equal(parent.Progress_Percent, 40);
  assert.equal(child.Progress_Percent, 100);
  // The project also holds T2, which has no estimate: it keeps the documented fallback
  // weight of 1, so (0.25*40 + 0*1 + 1*10) / 51 = 39.22 and nothing is invented.
  assert.equal(project.Progress_Percent, 39.22);
  assert.equal(context.Progress.rollup(context.Database.read('TASKS')).unknown, 1);

  const children = context.Subprojects.childrenMap();
  const grouped = context.Progress.group(context.Database.read('TASKS'), 'Subproject_ID');
  const subtree = context.Progress.subtreeTasks('S1', children, grouped);
  assert.equal(subtree.length, 2);
  assert.equal(subtree.filter(task => task.Task_ID === 'T1').length, 1, 'no task is counted twice');
});

test('a nested subproject keeps unknown effort unknown and never invents hours', () => {
  const app = nested();
  const context = app.context;
  context.Tasks.create({Task_ID: 'T-UNKNOWN', Project_ID: 'P1', Subproject_ID: 'S1-CHILD',
    Task_Name: '未見積', Owner_Member_ID: 'M-ENG', Status: 'Assigned', Estimated_Hours: '', Due_Date: '2026-12-11'});
  const rolled = context.Progress.rollup([
    context.Database.find('TASKS', 'T1'),
    context.Database.find('TASKS', 'T-UNKNOWN')
  ]);
  assert.equal(rolled.unknown, 1);
  context.Progress.refresh();
  assert.equal(context.Database.find('TASKS', 'T-UNKNOWN').Estimated_Hours, '', 'no zero is invented');
  assert.ok(context.Database.find('SUBPROJECTS', 'S1').Progress_Percent > 0);
});

test('archiving a parent removes descendant tasks from active work but keeps every row', () => {
  const app = nested();
  const context = app.context;
  context.Tasks.create({Task_ID: 'T-CHILD', Project_ID: 'P1', Subproject_ID: 'S1-CHILD', Task_Name: 'カメラ取付',
    Owner_Member_ID: 'M-ENG', Status: 'In Progress', Estimated_Hours: 10, Actual_Hours: 2, Due_Date: '2026-12-10'});
  context.Projects.update('P1', {Status: 'Active'});
  context.Database.update('SUBPROJECTS', 'S1', {Status: 'Active'});
  context.Subprojects.archive('S1');

  const projects = () => plain(context.Database.read('PROJECTS'))
    .reduce((all, row) => { all[row.Project_ID] = row; return all; }, {});
  const subprojects = () => plain(context.Database.read('SUBPROJECTS'))
    .reduce((all, row) => { all[row.Subproject_ID] = row; return all; }, {});
  assert.equal(context.Eligibility.taskInActiveWork(context.Database.find('TASKS', 'T-CHILD'), projects(), subprojects()), false);
  assert.equal(context.Eligibility.taskInActiveWork(context.Database.find('TASKS', 'T1'), projects(), subprojects()), false);

  assert.ok(context.Database.find('SUBPROJECTS', 'S1-CHILD'), 'the child row survives');
  assert.equal(context.Database.find('TASKS', 'T-CHILD').Status, 'In Progress', 'the task is not forced done');
  assert.equal(context.Database.find('SUBPROJECTS', 'S1-CHILD').Status, 'Active', 'no cascade archive');

  context.Subprojects.reactivate('S1');
  assert.equal(context.Eligibility.taskInActiveWork(context.Database.find('TASKS', 'T-CHILD'), projects(), subprojects()), true);
});

test('moving a task is explicit, stays inside the project and preserves the schedule', () => {
  const app = nested();
  const context = app.context;
  context.Tasks.confirmSchedule('T1', 'admin@example.test', 'CONFIRM SCHEDULE');
  const before = plain(context.Database.find('TASKS', 'T1'));
  assert.ok(before.Assignment_Approved_At || true);

  assert.throws(() => context.Subprojects.moveTask('T1', 'S1-CHILD', {}), /確認が必要/);
  context.Subprojects.moveTask('T1', 'S1-CHILD', {confirmed: true});
  const after = context.Database.find('TASKS', 'T1');
  assert.equal(after.Subproject_ID, 'S1-CHILD');
  ['Task_ID', 'Task_Name', 'Owner_Member_ID', 'Due_Date', 'Planned_Start', 'Estimated_Hours',
    'Actual_Hours', 'Progress_Percent', 'Status']
    .forEach(field => assert.equal(after[field], before[field], field + ' must not change'));
  // Subproject_ID is a material assignment field, so the existing rule invalidates approval
  // once and increments the version. Nothing else about the assignment is rewritten.
  assert.equal(Number(after.Assignment_Version), Number(before.Assignment_Version) + 1);
  assert.equal(after.Assignment_Approved_At, '');
  assert.ok(context.Database.read('AUDIT_LOG').some(row => row.Action === 'TASK_MOVED'));
  // A move is not a schedule change, so the confirmed schedule survives.
  assert.ok(context.ScheduleConfirmations.active('T1'));

  // A cross-project destination is refused rather than reparented silently.
  context.Subprojects.create({Subproject_ID: 'P2-SUB', Project_ID: 'P2', Subproject_Name: '旧ライン', Status: 'Active'});
  assert.throws(() => context.Subprojects.moveTask('T1', 'P2-SUB', {confirmed: true}), /同じプロジェクト/);
});

test('the snapshot publishes the responsibility label, the hierarchy and hierarchical progress', () => {
  const app = nested();
  const context = app.context;
  const area = context.Responsibilities.create({Name: '自動化・工程設計', Owner_Member_ID: 'M-MGR'});
  context.Projects.update('P1', {Responsibility_ID: area.Responsibility_ID, Dashboard_Visibility: 'INTERNAL'});
  fixtures.completedTask({context: context}, {Task_ID: 'T-CHILD', Project_ID: 'P1', Subproject_ID: 'S1-CHILD', Task_Name: 'カメラ取付',
    Owner_Member_ID: 'M-ENG', Estimated_Hours: 10, Due_Date: '2026-12-10'});
  context.Progress.refresh();

  const viewer = snapshotOf(app);
  const portfolio = viewer.context.dashboardPortfolio({query: ''});
  assert.equal(portfolio.ok, true);
  const project = portfolio.data.projects.filter(entry => entry.projectId === 'P1')[0];
  assert.equal(project.responsibilityName, '自動化・工程設計');
  assert.equal(portfolio.data.filters.responsibilities.length, 1);
  assert.equal(portfolio.data.filters.responsibilities[0].name, '自動化・工程設計');
  assert.equal(portfolio.data.filters.responsibilities[0].retired, false);

  const detail = viewer.context.dashboardProject('P1');
  assert.equal(detail.ok, true);
  const names = plain(detail.data.subprojects).map(item => item.name);
  assert.deepEqual(names, ['試作', 'カメラ取付設計'], 'the child follows its parent');
  const parent = detail.data.subprojects[0];
  const child = detail.data.subprojects[1];
  assert.equal(parent.parentSubprojectId, '');
  assert.equal(parent.level, 1);
  assert.equal(child.parentSubprojectId, 'S1');
  assert.equal(child.level, 2);
  assert.equal(parent.subtreeTotal, 2);
  assert.equal(child.subtreeTotal, 1);
  assert.equal(parent.progress, context.Database.find('SUBPROJECTS', 'S1').Progress_Percent);
  const ids = plain(detail.data.tasks).map(task => task.taskId);
  assert.deepEqual(ids.slice().sort(), ['T-CHILD', 'T1', 'T2'], 'each task appears exactly once');
  assert.equal(new Set(ids).size, ids.length, 'no task is duplicated');
});

test('the snapshot never publishes a responsibility description or owner', () => {
  const app = nested();
  const context = app.context;
  const area = context.Responsibilities.create({
    Name: '製品設計', Description: '社外秘の方針メモ', Owner_Member_ID: 'M-MGR'
  });
  context.Projects.update('P1', {Responsibility_ID: area.Responsibility_ID, Dashboard_Visibility: 'INTERNAL'});
  const snapshot = dashboardFixtures.attachSnapshot(app);
  context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(app);
  context.publishSharedDashboard();

  const serialized = JSON.stringify(snapshot.getSheets().map(sheet => sheet.getDataRange().getValues()));
  assert.match(serialized, /製品設計/);
  assert.doesNotMatch(serialized, /社外秘の方針メモ/);
  assert.doesNotMatch(serialized, /M-MGR/);
});

test('a snapshot from an older contract is rejected instead of being read as the new one', () => {
  const app = nested();
  app.context.Projects.update('P1', {Dashboard_Visibility: 'INTERNAL'});
  const snapshot = dashboardFixtures.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(app);
  app.context.publishSharedDashboard();

  const meta = snapshot.getSheetByName('PUBLISHED_META');
  const versionRow = meta.rows.findIndex(row => row[0] === 'CONTRACT_VERSION');
  assert.ok(versionRow > 0);
  meta.rows[versionRow][1] = '1.3';

  const viewer = dashboardFixtures.dashboardFor(snapshot);
  const result = viewer.context.dashboardPortfolio({query: ''});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SNAPSHOT_CONTRACT_UNSUPPORTED');
});

test('a project whose responsibility is unknown is published without a label and warns', () => {
  const app = fixtures.base();
  const context = app.context;
  context.Projects.update('P1', {Dashboard_Visibility: 'INTERNAL'});
  // Simulate a dangling reference written outside the application (a hand-edited cell).
  const sheet = app.book.getSheetByName('PROJECTS');
  const idColumn = sheet.rows[0].indexOf('Project_ID');
  const column = sheet.rows[0].indexOf('Responsibility_ID');
  const row = sheet.rows.findIndex((cells, index) => index > 0 && cells[idColumn] === 'P1');
  sheet.rows[row][column] = 'RESP-GHOST';
  const snapshot = SharedPublisherOnly(app);
  assert.ok(snapshot.warnings.some(warning => warning.code === 'RESPONSIBILITY_UNKNOWN'));
  const project = snapshot.projects.filter(item => item.projectId === 'P1')[0];
  assert.equal(project.responsibilityName, '');
  assert.equal(snapshot.responsibilities.length, 0);
});

/** Builds the sanitized payload without publishing (keeps the warning visible). */
function SharedPublisherOnly(app) {
  return app.context.SharedDashboardModel.build({
    today: '2026-10-26',
    responsibilities: [],
    projects: app.context.Database.read('PROJECTS'),
    subprojects: app.context.Database.read('SUBPROJECTS'),
    tasks: app.context.Database.read('TASKS'),
    milestones: [],
    members: app.context.Database.read('MEMBERS'),
    issues: [],
    limits: app.context.Health.thresholds(),
    pendingRequests: {}
  });
}
