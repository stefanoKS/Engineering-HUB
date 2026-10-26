'use strict';

/**
 * V1.4.1 pre-trial stabilization.
 *
 * Covers the simplified role policy (ADMIN/MANAGER manage the whole department), the
 * responsibility reorder contract, the coordinated project edit, hierarchy safety on
 * malformed data, ancestor-aware eligibility for active work and reminders, the V6
 * installation record, and the task selector beyond the sidebar window.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');
const { createMenu } = require('./support/menu-harness');

const ADMIN = 'admin@example.test';
const MANAGER = 'manager@example.test';
const MEMBER = 'engineer@example.test';
const VIEWER = 'viewer@example.test';

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function index(rows, key) {
  const result = Object.create(null);
  rows.forEach(row => { result[row[key]] = row; });
  return result;
}

/* ================================================================ *
 * A. Authorization
 * ================================================================ */

test('ADMIN and MANAGER both manage every project, subproject and task', () => {
  for (const actor of [ADMIN, MANAGER]) {
    const app = fixtures.base({ actor });
    const created = app.context.Ui.createProject({ name: '新案件', ownerId: 'M-ADMIN' });
    assert.equal(created.ok, true, actor + ': ' + created.error);
    const projectId = created.data.Project_ID;

    const edited = app.context.Ui.updateProject({ projectId, name: '新案件（改）' });
    assert.equal(edited.ok, true, actor + ': ' + edited.error);

    const subproject = app.context.Ui.createSubproject({ projectId, name: '試作' });
    assert.equal(subproject.ok, true, actor + ': ' + subproject.error);
    const archived = app.context.Ui.archiveSubproject({ subprojectId: subproject.data.Subproject_ID });
    assert.equal(archived.ok, true, actor + ': ' + archived.error);

    const task = app.context.Ui.assignTask({
      projectId, taskName: '作業', ownerId: 'M-ENG', deadline: '2026-12-20',
      durationValue: 3, durationUnit: 'DAY', durationBasis: 'WORKING_DAYS'
    });
    assert.equal(task.ok, true, actor + ': ' + task.error);
    assert.equal(app.context.Ui.updateProgress({ taskId: task.data.task.Task_ID, progress: 20 }).ok, true);

    // A project owned by somebody else is inside the same department scope.
    assert.equal(app.context.Ui.updateProject({ projectId: 'P1', summary: '共有案件' }).ok, true);
    assert.equal(app.context.Database.find('PROJECTS', 'P1').Project_Owner_ID, 'M-MGR');
  }
});

test('MEMBER and VIEWER cannot change the project structure', () => {
  for (const actor of [MEMBER, VIEWER]) {
    const app = fixtures.base({ actor, properties: { ALLOW_MEMBER_SELF_SERVICE: 'true' } });
    for (const attempt of [
      () => app.context.Ui.createProject({ name: '不可' }),
      () => app.context.Ui.updateProject({ projectId: 'P1', name: '不可' }),
      () => app.context.Ui.createSubproject({ projectId: 'P1', name: '不可' }),
      () => app.context.Ui.saveSubproject({ subprojectId: 'S1', name: '不可' }),
      () => app.context.Ui.archiveSubproject({ subprojectId: 'S1' }),
      () => app.context.Ui.assignTask({ projectId: 'P1', taskName: '不可', ownerId: 'M-ENG' }),
      () => app.context.Ui.saveResponsibility({ name: '不可' }),
      () => app.context.Ui.transferProject({ projectId: 'P1' })
    ]) {
      const result = attempt();
      assert.equal(result.ok, false, actor + ' must be refused');
    }
    assert.equal(app.context.Database.find('PROJECTS', 'P1').Project_Name, '検査装置');
    assert.equal(app.context.Database.find('SUBPROJECTS', 'S1').Status, 'Active');
  }
});

test('a MEMBER still updates progress on their own assigned task only', () => {
  const app = fixtures.base({ actor: MEMBER, properties: { ALLOW_MEMBER_SELF_SERVICE: 'true' } });
  app.context.Database.insert('TASKS', {
    Task_ID: 'T-FOREIGN', Project_ID: 'P1', Task_Name: '他の人の作業', Owner_Member_ID: 'M-MGR',
    Status: 'Assigned', Due_Date: '2026-12-20', Estimated_Hours: 4
  });
  assert.equal(app.context.Ui.updateProgress({ taskId: 'T1', progress: 45 }).ok, true);
  const foreign = app.context.Ui.updateProgress({ taskId: 'T-FOREIGN', progress: 45 });
  assert.equal(foreign.ok, false);
  assert.equal(app.context.Database.find('TASKS', 'T-FOREIGN').Progress_Percent, 0);
});

test('an unverified identity and browser-supplied roles cannot authorize a write', () => {
  const anonymous = fixtures.base({ actor: '' });
  assert.throws(() => anonymous.context.createProject({ Project_Name: '匿名' }), /verified/i);
  assert.throws(() => anonymous.context.createResponsibility({ Name: '匿名' }), /verified/i);
  const forged = anonymous.context.Ui.createProject({ name: '匿名', actor: ADMIN, role: 'ADMIN' });
  assert.equal(forged.ok, false);
  assert.equal(anonymous.context.Database.read('PROJECTS').length, 2);

  const member = fixtures.base({ actor: MEMBER, properties: { ALLOW_MEMBER_SELF_SERVICE: 'true' } });
  const escalated = member.context.Ui.saveMember({
    memberId: 'M-ENG', name: '設計 次郎', email: 'engineer@example.test', role: 'ADMIN'
  });
  assert.equal(escalated.ok, false);
  assert.equal(member.context.Database.find('MEMBERS', 'M-ENG').Role, 'MEMBER');
});

test('direct RPC entrypoints re-check the role instead of trusting the caller', () => {
  const app = fixtures.base({ actor: VIEWER });
  const attempts = [
    () => app.context.createProject({ Project_Name: '直書き' }),
    () => app.context.updateProject('P1', { Project_Name: '直書き' }),
    () => app.context.archiveProject('P1'),
    () => app.context.createSubproject({ Project_ID: 'P1', Subproject_Name: '直書き' }),
    () => app.context.reparentSubproject('S1', '', { confirmed: true }),
    () => app.context.archiveSubproject('S1'),
    () => app.context.createResponsibility({ Name: '直書き' }),
    () => app.context.reorderResponsibilities(['RESP_X']),
    () => app.context.createTask({ Project_ID: 'P1', Task_Name: '直書き', Owner_Member_ID: 'M-ENG' }),
    () => app.context.updateTask('T1', { Task_Name: '直書き' }),
    () => app.context.createMember({ Name: '不可', Email: 'x@example.test' }),
    () => app.context.listMembers(),
    () => app.context.createIssue({ Project_ID: 'P1', Description: '直書き' }),
    () => app.context.createMilestone({ Project_ID: 'P1', Milestone_Name: '直書き', Target_Date: '2026-12-01' }),
    () => app.context.setMemberSkill('M-ENG', 'SK-MISSING', 1),
    () => app.context.healthCheck(),
    () => app.context.validateSystem(),
    () => app.context.pendingRequests()
  ];
  attempts.forEach((attempt, position) => {
    assert.throws(attempt, /role|権限|required/i, 'entrypoint ' + position + ' must be refused');
  });
  assert.equal(app.context.Database.find('PROJECTS', 'P1').Project_Name, '検査装置');
  assert.equal(app.context.Database.read('RESPONSIBILITIES').length, 0);
});

test('granting or revoking ADMIN and MANAGER stays an ADMIN decision', () => {
  const manager = fixtures.base({ actor: MANAGER });
  assert.throws(() => manager.context.updateMember('M-ENG', { Role: 'ADMIN' }), /ADMIN/);
  assert.throws(() => manager.context.createMember({ Name: 'X', Email: 'x@example.test', Role: 'MANAGER' }), /ADMIN/);
  assert.throws(() => manager.context.updateMember('M-MGR', { Role: 'ADMIN' }), /cannot be changed/);
  assert.equal(manager.context.Database.find('MEMBERS', 'M-ENG').Role, 'MEMBER');

  const admin = fixtures.base({ actor: ADMIN });
  assert.equal(admin.context.updateMember('M-ENG', { Role: 'MANAGER' }).Role, 'MANAGER');
  assert.equal(admin.context.updateMember('M-ENG', { Role: 'MEMBER' }).Role, 'MEMBER');
});

/* ================================================================ *
 * B. Responsibilities
 * ================================================================ */

test('reordering validates every id and preserves identity, owners and status', () => {
  const app = fixtures.base();
  const context = app.context;
  const first = context.Responsibilities.create({ Name: '製品設計', Owner_Member_ID: 'M-MGR' });
  const second = context.Responsibilities.create({ Name: '品質改善', Owner_Member_ID: 'M-ADMIN' });
  const retired = context.Responsibilities.create({ Name: '旧領域', Owner_Member_ID: 'M-MGR' });
  context.Responsibilities.retire(retired.Responsibility_ID, { confirmed: true });

  const before = plain(context.Database.read('RESPONSIBILITIES'));
  const snapshot = () => plain(context.Database.read('RESPONSIBILITIES'));

  // Duplicates and unknown ids are refused before any write.
  assert.throws(() => context.Responsibilities.reorder([first.Responsibility_ID, first.Responsibility_ID]), /重複/);
  assert.throws(() => context.Responsibilities.reorder([first.Responsibility_ID, 'RESP_UNKNOWN']), /見つかりません/);
  assert.deepEqual(snapshot().map(row => row.Sort_Order), before.map(row => row.Sort_Order),
    'a refused reorder changes nothing');

  // A manager reorders the complete list without an ownership barrier.
  app.setActor(MANAGER);
  const result = context.Responsibilities.reorder([retired.Responsibility_ID, second.Responsibility_ID]);
  assert.equal(result.reordered, 2);
  assert.ok(result.updated >= 2);

  const after = index(snapshot(), 'Responsibility_ID');
  before.forEach(row => {
    assert.equal(after[row.Responsibility_ID].Name, row.Name);
    assert.equal(after[row.Responsibility_ID].Owner_Member_ID, row.Owner_Member_ID);
    assert.equal(after[row.Responsibility_ID].Status, row.Status);
    assert.equal(after[row.Responsibility_ID].Retired_At, row.Retired_At);
    assert.equal(after[row.Responsibility_ID].Description, row.Description);
  });
  assert.equal(context.Responsibilities.all()[0].Responsibility_ID, retired.Responsibility_ID,
    'the submitted block leads the list');
  assert.equal(context.Responsibilities.all()[1].Responsibility_ID, second.Responsibility_ID);

  // A repeated identical reorder is deterministic and writes nothing.
  const stabilized = JSON.stringify(snapshot().map(row => [row.Responsibility_ID, row.Sort_Order]));
  const again = context.Responsibilities.reorder([retired.Responsibility_ID, second.Responsibility_ID]);
  assert.equal(again.updated, 0);
  assert.equal(JSON.stringify(snapshot().map(row => [row.Responsibility_ID, row.Sort_Order])), stabilized);

  const audit = context.Database.read('AUDIT_LOG').filter(row => row.Action === 'RESPONSIBILITY_REORDERED');
  assert.equal(audit.length, 2, 'every accepted reorder is audited');
});

test('responsibility lifecycle stays explicit and never deletes work', () => {
  const app = fixtures.base({ actor: MANAGER });
  const context = app.context;
  const area = context.Responsibilities.create({ Name: '製品設計' });
  assert.equal(area.Owner_Member_ID, 'M-MGR', 'the creating manager owns the area');

  const renamed = context.Responsibilities.update(area.Responsibility_ID, { Name: '製品設計（改）', Description: '社内のみ' });
  assert.equal(renamed.Name, '製品設計（改）');
  assert.equal(context.Projects.update('P1', { Responsibility_ID: area.Responsibility_ID }).Responsibility_ID,
    area.Responsibility_ID);

  const retired = context.Responsibilities.retire(area.Responsibility_ID, { confirmed: true });
  assert.equal(retired.openProjects, 1);
  assert.equal(context.Database.find('PROJECTS', 'P1').Status, 'Active');
  assert.equal(context.Database.read('TASKS').filter(task => task.Project_ID === 'P1').length, 2);
  assert.equal(context.Responsibilities.reactivate(area.Responsibility_ID).Status, 'Active');
});

/* ================================================================ *
 * C. Coordinated project edit
 * ================================================================ */

test('a project edit and its responsibility transfer commit together or not at all', () => {
  const app = fixtures.base({ actor: MANAGER });
  const context = app.context;
  const area = context.Responsibilities.create({ Name: '製品設計' });
  const retired = context.Responsibilities.create({ Name: '旧領域' });
  context.Responsibilities.retire(retired.Responsibility_ID, { confirmed: true });
  context.Projects.update('P1', { Responsibility_ID: area.Responsibility_ID });
  const before = plain(context.Database.find('PROJECTS', 'P1'));

  const needsConfirmation = context.Ui.updateProject({
    projectId: 'P1', name: '名称変更', responsibilityId: retired.Responsibility_ID
  });
  assert.equal(needsConfirmation.ok, false);
  assert.match(needsConfirmation.error, /確認/);
  assert.equal(context.Database.find('PROJECTS', 'P1').Project_Name, before.Project_Name,
    'a refused transfer leaves the ordinary fields untouched');
  assert.equal(context.Database.find('PROJECTS', 'P1').Responsibility_ID, area.Responsibility_ID);

  const retiredUnconfirmed = context.Ui.updateProject({
    projectId: 'P1', name: '名称変更', responsibilityId: retired.Responsibility_ID,
    confirmResponsibilityChange: true
  });
  assert.equal(retiredUnconfirmed.ok, false);
  assert.match(retiredUnconfirmed.error, /追加の確認/);
  assert.equal(context.Database.find('PROJECTS', 'P1').Project_Name, before.Project_Name);

  const stale = context.Ui.updateProject({
    projectId: 'P1', name: '名称変更', updatedAt: '2020-01-01T00:00:00.000Z'
  });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /再読み込み/);
  assert.equal(context.Database.find('PROJECTS', 'P1').Project_Name, before.Project_Name);

  const committed = context.Ui.updateProject({
    projectId: 'P1', name: '名称変更', summary: 'まとめ',
    responsibilityId: retired.Responsibility_ID,
    confirmResponsibilityChange: true, confirmRetiredResponsibility: true,
    responsibilityReason: '再編'
  });
  assert.equal(committed.ok, true, committed.error);
  const after = context.Database.find('PROJECTS', 'P1');
  assert.equal(after.Project_Name, '名称変更');
  assert.equal(after.Dashboard_Summary, 'まとめ');
  assert.equal(after.Responsibility_ID, retired.Responsibility_ID);
  assert.equal(after.Project_Owner_ID, before.Project_Owner_ID, 'the owner is preserved');
  assert.equal(after.Original_Deadline, before.Original_Deadline);
  assert.equal(after.Committed_Deadline, before.Committed_Deadline);

  const audit = context.Database.read('AUDIT_LOG').filter(row => row.Action === 'RESPONSIBILITY_TRANSFERRED');
  assert.equal(audit.length, 1, 'one transfer record for one coordinated save');
  const details = JSON.parse(audit[0].New_Value);
  assert.equal(details.previousResponsibilityId, area.Responsibility_ID);
  assert.equal(details.newResponsibilityId, retired.Responsibility_ID);
  assert.equal(details.actor, MANAGER);
  assert.equal(details.reason, '再編');
});

test('a coordinated edit keeps subprojects, tasks and request history', () => {
  const app = fixtures.base({ actor: MANAGER });
  const context = app.context;
  const area = context.Responsibilities.create({ Name: '製品設計' });
  const tasksBefore = plain(context.Database.read('TASKS'));
  const result = context.Ui.updateProject({
    projectId: 'P1', responsibilityId: area.Responsibility_ID, confirmResponsibilityChange: true
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(plain(context.Database.read('TASKS')), tasksBefore);
  assert.equal(context.Database.read('SUBPROJECTS').filter(row => row.Project_ID === 'P1').length, 1);
});

/* ================================================================ *
 * D. Nested hierarchy safety
 * ================================================================ */

function nested(app) {
  const context = app.context;
  context.Subprojects.create({ Subproject_ID: 'S-ROOT', Project_ID: 'P1', Subproject_Name: '試作', Status: 'Active' });
  context.Subprojects.create({
    Subproject_ID: 'S-CHILD', Project_ID: 'P1', Parent_Subproject_ID: 'S-ROOT',
    Subproject_Name: 'カメラ取付設計', Status: 'Active'
  });
  return context;
}

test('the hierarchy stops at two levels and rejects self, cycle and cross-project parents', () => {
  const app = fixtures.base({ actor: MANAGER });
  const context = nested(app);

  assert.throws(() => context.Subprojects.create({
    Subproject_ID: 'S-LEVEL3', Project_ID: 'P1', Parent_Subproject_ID: 'S-CHILD', Subproject_Name: '三段目'
  }), /2階層/);
  assert.throws(() => context.Subprojects.create({
    Subproject_ID: 'S-SELF', Project_ID: 'P1', Parent_Subproject_ID: 'S-SELF', Subproject_Name: '自己'
  }), /自身/);
  // Reparenting a root beneath a nested node would push the subtree to level three.
  assert.throws(() => context.Subprojects.reparent('S1', 'S-CHILD', { confirmed: true }), /2階層/);
  // A parent that is a descendant of the moved node is a cycle, not a move.
  assert.throws(() => context.Subprojects.reparent('S-ROOT', 'S-CHILD', { confirmed: true }), /循環/);
  context.Database.insert('PROJECTS', { Project_ID: 'P9', Project_Name: '別案件', Status: 'Active' });
  context.Subprojects.create({ Subproject_ID: 'S-OTHER', Project_ID: 'P9', Subproject_Name: '別案件の親' });
  assert.throws(() => context.Subprojects.reparent('S-ROOT', 'S-OTHER', { confirmed: true }), /同じプロジェクト/);

  const ids = plain(context.Database.read('SUBPROJECTS').map(row => row.Subproject_ID)).sort();
  assert.deepEqual(ids, ['S-CHILD', 'S-OTHER', 'S-ROOT', 'S1'], 'no id is regenerated or lost');
});

test('malformed hierarchy data cannot recurse without bound', () => {
  const app = fixtures.base();
  const context = app.context;
  context.Subprojects.create({ Subproject_ID: 'S-A', Project_ID: 'P1', Subproject_Name: 'A' });
  context.Subprojects.create({ Subproject_ID: 'S-B', Project_ID: 'P1', Parent_Subproject_ID: 'S-A', Subproject_Name: 'B' });
  // A hand-edited cell can create a cycle the application never writes.
  context.Database.update('SUBPROJECTS', 'S-A', { Parent_Subproject_ID: 'S-B' });

  const children = context.Subprojects.childrenMap();
  assert.throws(() => context.Subprojects.heightOf('S-A', children), /循環/);
  assert.throws(() => context.Subprojects.levelOf('S-A', context.Subprojects.parentMap()), /循環/);
  assert.ok(context.Subprojects.descendants('S-A').length <= 2, 'the walk terminates');
  const grouped = context.Progress.group(context.Database.read('TASKS'), 'Subproject_ID');
  assert.ok(Array.isArray(context.Progress.subtreeTasks('S-A', children, grouped)));
  assert.equal(context.Subprojects.archivedChain('S-A'), true, 'a cycle is treated as unsafe');
});

test('a task is never placed inside an archived branch by accident', () => {
  const app = fixtures.base({ actor: MANAGER });
  const context = nested(app);
  // A task that already exists in the branch stays stored and finishable.
  context.Tasks.create({
    Task_ID: 'T-CHILD', Project_ID: 'P1', Subproject_ID: 'S-CHILD', Task_Name: '既存',
    Owner_Member_ID: 'M-ENG', Status: 'In Progress', Progress_Percent: 40
  });
  context.Subprojects.archive('S-ROOT');

  assert.throws(() => context.Tasks.create({
    Task_ID: 'T-BLOCKED', Project_ID: 'P1', Subproject_ID: 'S-CHILD', Task_Name: '不可',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  }), /アーカイブ/);
  const blockedMove = context.Ui.assignTask({ taskId: 'T1', subprojectId: 'S-CHILD' });
  assert.equal(blockedMove.ok, false);
  assert.match(blockedMove.error, /アーカイブ/);
  assert.throws(() => context.Subprojects.moveTask('T1', 'S-CHILD', { confirmed: true }), /アーカイブ/);
  assert.equal(context.Database.find('TASKS', 'T1').Subproject_ID, 'S1');

  // Archiving the parent never touches the child, the tasks or their progress.
  assert.equal(context.Database.find('SUBPROJECTS', 'S-CHILD').Status, 'Active');
  assert.equal(context.Database.find('TASKS', 'T-CHILD').Status, 'In Progress');
  assert.equal(context.Database.find('TASKS', 'T-CHILD').Progress_Percent, 40);
  assert.equal(context.Ui.updateProgress({ taskId: 'T-CHILD', progress: 60 }).ok, true,
    'a task in an archived branch stays finishable');
});

/* ================================================================ *
 * E. Reporting and eligibility
 * ================================================================ */

test('active work, reminders and published counts exclude an archived branch once', () => {
  const app = fixtures.base();
  const context = nested(app);
  context.Projects.update('P1', { Dashboard_Visibility: 'INTERNAL', Status: 'Active' });
  context.Tasks.create({
    Task_ID: 'T-NESTED', Project_ID: 'P1', Subproject_ID: 'S-CHILD', Task_Name: '子作業',
    Owner_Member_ID: 'M-ENG', Status: 'In Progress', Progress_Percent: 10,
    Estimated_Hours: 10, Due_Date: '2026-12-01', Notification_Enabled: true
  });

  const beforeMetrics = context.Dashboard.analyze('2026-11-02').metrics;
  const projectsBefore = plain(context.Database.read('PROJECTS'));
  context.Progress.refresh();
  const parentProgressBefore = context.Database.find('SUBPROJECTS', 'S-ROOT').Progress_Percent;

  context.Subprojects.archive('S-ROOT');
  const afterMetrics = context.Dashboard.analyze('2026-11-02').metrics;
  assert.equal(afterMetrics.openTasks, beforeMetrics.openTasks - 1, 'the nested task leaves active work once');
  assert.equal(context.Database.find('TASKS', 'T-NESTED').Status, 'In Progress', 'nothing is marked done');
  assert.equal(context.Database.find('SUBPROJECTS', 'S-CHILD').Status, 'Active', 'no cascade archive');
  assert.equal(context.Database.find('SUBPROJECTS', 'S-ROOT').Progress_Percent, parentProgressBefore,
    'historic progress is unchanged until a refresh recomputes it');

  const projects = index(plain(context.Database.read('PROJECTS')), 'Project_ID');
  const subprojects = index(plain(context.Database.read('SUBPROJECTS')), 'Subproject_ID');
  const task = context.Database.find('TASKS', 'T-NESTED');
  assert.equal(context.Eligibility.taskInActiveWork(task, projects, subprojects), false);
  assert.equal(context.Eligibility.subprojectInActiveWork('S-CHILD', 'P1', subprojects), false);
  assert.equal(context.Eligibility.taskNotifiable(task, projects.P1, subprojects), false,
    'an archived ancestor suppresses reminders');
  // The project rows themselves were not rewritten by the analysis.
  assert.deepEqual(plain(context.Database.read('PROJECTS')).map(row => row.Status), projectsBefore.map(row => row.Status));
});

test('a published snapshot counts only active work and never duplicates a nested task', () => {
  const app = fixtures.base();
  const context = nested(app);
  context.Projects.update('P1', { Dashboard_Visibility: 'INTERNAL', Status: 'Active' });
  context.Tasks.create({
    Task_ID: 'T-NESTED', Project_ID: 'P1', Subproject_ID: 'S-CHILD', Task_Name: '子作業',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: '2026-12-01', Estimated_Hours: 8
  });
  const active = dashboardFixtures.published({ manager: app });
  const activeView = dashboardFixtures.dashboardFor(active.snapshot)
    .context.dashboardPortfolio({ query: '' });
  assert.equal(activeView.ok, true);
  const activeProject = activeView.data.projects.filter(row => row.projectId === 'P1')[0];
  const openWhileActive = activeProject.openTasks;

  context.Subprojects.archive('S-ROOT');
  const archived = dashboardFixtures.published({ manager: app });
  const archivedView = dashboardFixtures.dashboardFor(archived.snapshot)
    .context.dashboardPortfolio({ query: '' });
  const archivedProject = archivedView.data.projects.filter(row => row.projectId === 'P1')[0];
  assert.equal(archivedProject.openTasks, openWhileActive - 1);
  assert.equal(archivedProject.doneTasks, 0);

  const detail = dashboardFixtures.dashboardFor(archived.snapshot).context.dashboardProject('P1');
  const ids = plain(detail.data.tasks).map(task => task.taskId);
  assert.equal(new Set(ids).size, ids.length, 'no task is published twice');
  const child = plain(detail.data.subprojects).filter(row => row.subprojectId === 'S-CHILD')[0];
  assert.equal(child.level, 2, 'the hierarchy is preserved for the viewer');
});

/* ================================================================ *
 * F. Requests
 * ================================================================ */

test('an approved request applies its deadline once and records one history row', () => {
  const { loadDashboard, MockSpreadsheet } = require('./helpers');
  const INBOX_ID = 'inbox-db';
  const INBOX_FIELDS = [
    'Request_ID', 'Request_Type', 'Task_ID', 'Project_ID', 'Requester_Name', 'Submitted_At',
    'Current_Due_Date', 'Requested_Due_Date', 'Reason', 'Explanation', 'Completion_Note',
    'Task_Revision', 'Snapshot_Version', 'Client_Token', 'Inbox_State'
  ];
  const manager = fixtures.base();
  manager.context.Database.update('PROJECTS', 'P1', { Dashboard_Visibility: 'INTERNAL' });
  const snapshot = dashboardFixtures.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(manager);
  manager.context.publishSharedDashboard();
  const inbox = new MockSpreadsheet(INBOX_ID, { REQUESTS: [INBOX_FIELDS] });
  manager.spreadsheets.set(INBOX_ID, inbox);
  manager.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', INBOX_ID);
  const viewer = loadDashboard({
    spreadsheet: snapshot,
    properties: {
      SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: dashboardFixtures.SNAPSHOT_ID,
      REQUEST_INBOX_SPREADSHEET_ID: INBOX_ID,
      REQUEST_SUBMISSION_ENABLED: 'true'
    }
  });
  viewer.spreadsheets.set(INBOX_ID, inbox);

  const submitted = viewer.context.submitDeadlineRequest({
    projectId: 'P1', taskId: 'T1', requestedDate: '2026-12-22',
    reason: '技術的問題', explanation: '光学系の再評価が必要です。', requesterName: '設計 次郎',
    clientToken: 'token-once'
  });
  assert.equal(submitted.ok, true, JSON.stringify(submitted.error));
  assert.equal(manager.context.Requests.importInbox(ADMIN).imported, 1);
  // A repeated import never duplicates the request.
  assert.equal(manager.context.Requests.importInbox(ADMIN).imported, 0);

  const approved = manager.context.Requests.decide(submitted.data.requestId, 'APPROVE', '了解', 'DECIDE REQUEST');
  assert.equal(approved.status, 'APPROVED');
  assert.equal(manager.context.Database.find('TASKS', 'T1').Due_Date, '2026-12-22');
  assert.equal(manager.context.Database.read('TASK_DEADLINE_HISTORY').length, 1);
  assert.throws(() => manager.context.Requests.decide(submitted.data.requestId, 'APPROVE', '', 'DECIDE REQUEST'),
    /already decided/);
  assert.equal(manager.context.Database.read('TASK_DEADLINE_HISTORY').length, 1, 'no duplicate history');
});

/* ================================================================ *
 * G. Installation record
 * ================================================================ */

test('a new workbook records INITIALIZE_V6 and never pretends to have migrated', () => {
  const app = fixtures.app();
  const rows = app.context.Database.read('SCHEMA_MIGRATIONS');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Migration_ID, 'INITIALIZE_V6');
  assert.equal(Number(rows[0].New_Version), 6);
  assert.equal(rows[0].Result, 'SUCCESS');
  assert.equal(app.context.Migrations.currentVersion(), 6);
  assert.ok(!rows.some(row => String(row.Migration_ID).indexOf('006_') === 0),
    'a fresh V6 workbook does not run migration 006');
  assert.equal(app.context.Database.read('RESPONSIBILITIES').length, 0, 'no example area is seeded');
});

/* ================================================================ *
 * H. Sidebar scale
 * ================================================================ */

test('a task outside the sidebar window stays reachable by searching', () => {
  const app = fixtures.app();
  const context = app.context;
  context.Database.insert('MEMBERS', {
    Member_ID: 'M-ADMIN', Name: '管理 太郎', Email: ADMIN, Active: true, Role: 'ADMIN', Weekly_Capacity_Hours: 40
  });
  context.Database.insert('PROJECTS', { Project_ID: 'P1', Project_Name: '大量案件', Status: 'Active' });
  const rows = [];
  for (let i = 0; i < 320; i += 1) {
    rows.push({
      Task_ID: 'TB-' + String(i).padStart(3, '0'), Project_ID: 'P1',
      Task_Name: '大量タスク ' + i, Owner_Member_ID: 'M-ADMIN', Status: 'Assigned', Due_Date: '2027-01-31'
    });
  }
  fixtures.bulk(app, 'TASKS', rows);

  const loaded = context.Ui.context();
  assert.equal(loaded.ok, true, loaded.error);
  assert.equal(loaded.data.taskTotal, 320);
  assert.equal(loaded.data.tasks.length, 300);
  assert.equal(loaded.data.tasksTruncated, true, 'truncation is reported, never silent');

  const page = createMenu(app, { template: 'UiMenu' });
  assert.match(page.texts('taskListNote'), /320/, 'the manager is told how many tasks exist');
  page.set('taskSearch', '大量タスク 319');
  page.context.applyTaskFilter();
  const options = page.options('taskPick').map(option => option.value);
  assert.ok(options.indexOf('TB-319') >= 0, 'a task beyond the window is selectable');
  page.set('taskPick', 'TB-319');
  page.context.loadTask(true);
  assert.equal(page.value('taskName'), '大量タスク 319');
});
