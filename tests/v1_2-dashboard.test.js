'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('./helpers');
const fixtures = require('./fixtures');
const dashboard = require('./dashboard-fixtures');

const plain = value => JSON.parse(JSON.stringify(value));
const SNAPSHOT_ID = dashboard.SNAPSHOT_ID;

/** Asia/Tokyo calendar date offset from today. */
function jstDate(offsetDays) {
  const now = new Date(Date.now() + 9 * 3600000);
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight + offsetDays * 86400000).toISOString().slice(0, 10);
}

/**
 * Portfolio used across the viewer tests:
 * P1 検査装置 (INTERNAL, overdue + due-today tasks), P2 組立ライン (INTERNAL, done task),
 * P3 秘匿案件 (RESTRICTED) which must never be visible.
 */
function portfolio() {
  const manager = fixtures.base();
  const db = manager.context.Database;
  db.update('PROJECTS', 'P1', {
    Dashboard_Visibility: 'INTERNAL', Dashboard_Summary: '検査装置の公開概要', Committed_Deadline: jstDate(20)
  });
  db.insert('PROJECTS', {
    Project_ID: 'PC', Project_Name: '組立ライン', Status: 'Active', Project_Owner_ID: 'M-MGR',
    Category: '製造', Dashboard_Visibility: 'INTERNAL', Dashboard_Summary: '組立ラインの公開概要',
    Committed_Deadline: jstDate(5)
  });
  db.insert('PROJECTS', {
    Project_ID: 'PR', Project_Name: '秘匿案件', Status: 'Active', Project_Owner_ID: 'M-MGR',
    Committed_Deadline: jstDate(3)
  });
  db.insert('SUBPROJECTS', {
    Subproject_ID: 'SC', Project_ID: 'PC', Subproject_Name: '組立工程', Owner_ID: 'M-ENG',
    Status: 'Active', Deadline: jstDate(10)
  });
  db.insert('TASKS', {
    Task_ID: 'T4', Project_ID: 'P1', Subproject_ID: 'S1', Task_Name: '検査治具',
    Owner_Member_ID: 'M-ENG', Status: 'In Progress', Progress_Percent: 40,
    Due_Date: jstDate(-2), Estimated_Hours: 10, Public_Note: '公開メモ: 治具を調整中'
  });
  db.insert('TASKS', {
    Task_ID: 'T5', Project_ID: 'P1', Task_Name: '本日締切の確認',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: jstDate(0)
  });
  db.insert('TASKS', {
    Task_ID: 'T6', Project_ID: 'P1', Task_Name: '期限未設定の作業',
    Owner_Member_ID: 'M-ENG', Status: 'Not Started'
  });
  db.insert('TASKS', {
    Task_ID: 'T7', Project_ID: 'PC', Subproject_ID: 'SC', Task_Name: '組立手順書',
    Owner_Member_ID: 'M-ENG', Status: 'Done', Progress_Percent: 100, Due_Date: jstDate(-1),
    Completed_At: new Date().toISOString()
  });
  db.insert('TASKS', {
    Task_ID: 'T8', Project_ID: 'PC', Task_Name: '秘匿タスク名',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: jstDate(4)
  });
  db.insert('TASKS', {
    Task_ID: 'T9', Project_ID: 'PR', Task_Name: '社外秘の作業',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Due_Date: jstDate(2)
  });
  db.update('TASKS', 'T8', {Project_ID: 'PC'});
  db.insert('MILESTONES', {
    Milestone_ID: 'MS1', Project_ID: 'P1', Subproject_ID: 'S1', Milestone_Name: '設計審査',
    Target_Date: jstDate(6)
  });
  const snapshot = dashboard.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  manager.context.publishSharedDashboard();
  return {manager, snapshot, viewer: dashboard.dashboardFor(snapshot)};
}

test('the publisher and the viewer agree on the published contract', () => {
  const manager = helpers.loadApp();
  const viewer = helpers.loadDashboard();
  const model = manager.context.SharedDashboardModel;
  const tables = viewer.context.DashboardData.TABLES;
  assert.deepEqual(plain(tables.projects.fields), plain(model.PROJECT_PUBLIC_FIELDS));
  assert.deepEqual(plain(tables.subprojects.fields), plain(model.SUBPROJECT_PUBLIC_FIELDS));
  assert.deepEqual(plain(tables.tasks.fields), plain(model.TASK_PUBLIC_FIELDS));
  assert.deepEqual(plain(tables.milestones.fields), plain(model.MILESTONE_PUBLIC_FIELDS));
  assert.equal(viewer.context.DashboardData.CONTRACT_VERSION, model.CONTRACT_VERSION);
});

test('the portfolio lists only approved projects and never returns task rows', () => {
  const {viewer} = portfolio();
  const response = viewer.context.dashboardPortfolio({query: ''});
  assert.equal(response.ok, true, response.error && response.error.message);
  const data = response.data;
  assert.deepEqual(plain(data.projects.map(project => project.projectId)), ['P1', 'PC']);
  assert.equal(data.projects.some(project => project.projectId === 'PR'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'tasks'), false);
  assert.equal(data.meta.snapshotVersion, 1);
  assert.match(data.meta.publishedAtLabel, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  assert.equal(data.meta.stale, false);
  assert.deepEqual(plain(data.indicators), {activeProjects: 2, atRiskProjects: 1, dueWithin7Days: 1, overdueTasks: 1});
  assert.ok(data.filters.categories.indexOf('製造') >= 0);
  assert.ok(data.filters.owners.indexOf('管理 花子') >= 0);
  assert.doesNotMatch(JSON.stringify(data), /秘匿案件|社外秘の作業|@example\.test/);
});

test('search matches project names, project ids and approved task names only', () => {
  const {viewer} = portfolio();
  const byName = viewer.context.dashboardPortfolio({query: '検査'});
  assert.deepEqual(plain(byName.data.projects.map(project => project.projectId)), ['P1']);
  const byId = viewer.context.dashboardPortfolio({query: 'PC'});
  assert.deepEqual(plain(byId.data.projects.map(project => project.projectId)), ['PC']);
  const byTask = viewer.context.dashboardPortfolio({query: '組立手順書'});
  assert.deepEqual(plain(byTask.data.projects.map(project => project.projectId)), ['PC']);
  const restricted = viewer.context.dashboardPortfolio({query: '社外秘'});
  assert.deepEqual(plain(restricted.data.projects), []);
  assert.equal(viewer.context.dashboardPortfolio({query: '一致しない語'}).data.projects.length, 0);
});

test('project detail groups tasks by subproject and keeps direct tasks under 全体タスク', () => {
  const {viewer} = portfolio();
  const response = viewer.context.dashboardProject('P1');
  assert.equal(response.ok, true, response.error && response.error.message);
  const detail = response.data;
  assert.equal(detail.project.projectName, '検査装置');
  assert.equal(detail.project.summary, '検査装置の公開概要');
  assert.deepEqual(plain(detail.subprojects.map(item => item.subprojectId)), ['S1']);
  assert.equal(detail.subprojects[0].total, 2, 'S1 holds the fixture task and T4');
  assert.equal(detail.ungrouped.total, 3, 'the fixture task without a subproject plus T5 and T6');
  assert.deepEqual(plain(detail.counts), {total: 5, open: 5, done: 0, overdue: 1, blocked: 0});
  const ungrouped = detail.tasks.filter(task => !task.subprojectId);
  assert.deepEqual(plain(ungrouped.map(task => task.taskId)), ['T5', 'T6', 'T2']);
  assert.equal(detail.milestones.length, 1);
  assert.equal(detail.milestones[0].name, '設計審査');
  assert.equal(detail.truncated, false);
  assert.equal(detail.taskTotal, 5);
  assert.doesNotMatch(JSON.stringify(detail), /社外秘|@example\.test/);
  // Tasks are ordered by group, then by due date.
  assert.deepEqual(plain(detail.tasks.map(task => task.subprojectId ? 'S1' : 'DIRECT')),
    ['S1', 'S1', 'DIRECT', 'DIRECT', 'DIRECT']);
});

test('deadline wording follows the Asia/Tokyo calendar', () => {
  const {viewer} = portfolio();
  const data = viewer.context.DashboardData;
  const today = jstDate(0);
  assert.deepEqual(plain(data.deadline(jstDate(-3), false, today)),
    {kind: 'overdue', days: -3, label: '3日超過'});
  assert.deepEqual(plain(data.deadline(today, false, today)), {kind: 'today', days: 0, label: '本日期限'});
  assert.deepEqual(plain(data.deadline(jstDate(4), false, today)), {kind: 'future', days: 4, label: 'あと4日'});
  assert.deepEqual(plain(data.deadline('', false, today)), {kind: 'none', days: null, label: '期限未設定'});
  assert.deepEqual(plain(data.deadline(jstDate(-3), true, today)), {kind: 'done', days: null, label: '完了'});

  const overdue = viewer.context.dashboardTask('P1', 'T4');
  assert.equal(overdue.ok, true);
  assert.equal(overdue.data.task.deadlineLabel, '2日超過');
  assert.equal(overdue.data.task.dueDate, jstDate(-2));
  assert.equal(overdue.data.task.publicNote, '公開メモ: 治具を調整中');
  assert.equal(overdue.data.canEdit, false);

  const todayTask = viewer.context.dashboardTask('P1', 'T5');
  assert.equal(todayTask.data.task.deadlineLabel, '本日期限');

  const noDue = viewer.context.dashboardTask('P1', 'T6');
  assert.equal(noDue.data.task.deadlineLabel, '期限未設定');

  const done = viewer.context.dashboardTask('PC', 'T7');
  assert.equal(done.data.task.deadlineLabel, '完了');
  assert.equal(done.data.task.statusLabel, '完了');
  assert.equal(done.data.task.subprojectName, '組立工程');

  assert.equal(viewer.context.dashboardTask('P1', 'T7').error.code, 'NOT_FOUND', 'cross-project task lookup is refused');
  assert.equal(viewer.context.dashboardTask('PR', 'T9').error.code, 'NOT_FOUND', 'restricted projects never resolve');
  assert.equal(viewer.context.dashboardProject('PR').error.code, 'NOT_FOUND');
});

test('project detail responses stay bounded and report truncation', () => {
  const {manager, snapshot} = portfolio();
  const tasks = [];
  for (let index = 0; index < 40; index++) {
    tasks.push({
      Task_ID: 'BULK' + index, Project_ID: 'P1', Task_Name: '一括タスク ' + index,
      Owner_Member_ID: 'M-ENG', Status: 'In Progress', Progress_Percent: 10, Due_Date: jstDate(30 + index)
    });
  }
  fixtures.bulk(manager, 'TASKS', tasks);
  manager.context.publishSharedDashboard();
  const viewer = dashboard.dashboardFor(snapshot);

  // bulk() replaces the task table, so this workbook now holds exactly the 40 bulk tasks.
  const full = viewer.context.dashboardProject('P1');
  assert.equal(full.data.taskTotal, 40);
  assert.equal(full.data.truncated, false);

  const limited = viewer.context.dashboardProject('P1', {limit: 5});
  assert.equal(limited.data.tasks.length, 5);
  assert.equal(limited.data.taskTotal, 40);
  assert.equal(limited.data.truncated, true);
  assert.equal(limited.data.counts.total, 40, 'counts always describe every task');
});

test('stale snapshots are reported, never hidden', () => {
  const {snapshot, viewer} = portfolio();
  const meta = snapshot.getSheetByName('PUBLISHED_META');
  const rows = meta.getDataRange().getValues();
  const index = rows.findIndex(row => row[0] === 'PUBLISHED_AT');
  const publishedAt = new Date(Date.now() - 40 * 3600000).toISOString();
  rows[index][1] = publishedAt;
  meta.getRange(1, 1, rows.length, 2).setValues(rows);

  const fresh = viewer.context.dashboardPortfolio({});
  assert.equal(fresh.ok, true);
  assert.equal(fresh.data.meta.stale, true);
  assert.equal(fresh.data.meta.staleAfterHours, 24);
  assert.ok(fresh.data.meta.ageHours >= 39);

  const strict = dashboard.dashboardFor(snapshot, {SHARED_DASHBOARD_STALE_HOURS: '1'});
  assert.equal(strict.context.dashboardPortfolio({}).data.meta.staleAfterHours, 1);
});

test('viewer access is limited by configuration and never leaks the viewer address', () => {
  const {snapshot} = portfolio();
  const noConfig = dashboard.dashboardFor(snapshot, {SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: ''});
  assert.equal(noConfig.context.dashboardPortfolio({}).error.code, 'DASHBOARD_NOT_CONFIGURED');

  const domainBound = dashboard.dashboardFor(snapshot, {SHARED_DASHBOARD_ALLOWED_DOMAIN: 'example.test'});
  assert.equal(domainBound.context.dashboardPortfolio({}).ok, true, 'the fixture actor is inside the domain');
  const outsider = dashboard.dashboardFor(snapshot, {SHARED_DASHBOARD_ALLOWED_DOMAIN: 'example.test'});
  outsider.setActor('someone@outside.test');
  assert.equal(outsider.context.dashboardPortfolio({}).error.code, 'VIEWER_NOT_ALLOWED');
  assert.equal(outsider.context.dashboardProject('P1').error.code, 'VIEWER_NOT_ALLOWED');

  const anonymous = dashboard.dashboardFor(snapshot, {SHARED_DASHBOARD_ALLOWED_DOMAIN: 'example.test'});
  anonymous.setActor('');
  assert.equal(anonymous.context.dashboardPortfolio({}).ok, true, 'empty address is tolerated by default');
  const strict = dashboard.dashboardFor(snapshot, {
    SHARED_DASHBOARD_ALLOWED_DOMAIN: 'example.test', SHARED_DASHBOARD_REQUIRE_EMAIL: 'true'
  });
  strict.setActor('');
  assert.equal(strict.context.dashboardPortfolio({}).error.code, 'VIEWER_NOT_ALLOWED');
  assert.doesNotMatch(JSON.stringify(strict.context.dashboardPortfolio({})), /@example\.test/);
});

test('unreadable, unpublished, mismatched and unsafe snapshots fail closed', () => {
  const {snapshot, viewer} = portfolio();

  const empty = new helpers.MockSpreadsheet(SNAPSHOT_ID);
  const emptyViewer = dashboard.dashboardFor(empty);
  assert.equal(emptyViewer.context.dashboardPortfolio({}).error.code, 'SNAPSHOT_NOT_PUBLISHED');

  const operational = new helpers.MockSpreadsheet(SNAPSHOT_ID);
  operational.insertSheet('PROJECTS').getRange(1, 1).setValue('Project_ID');
  const guarded = dashboard.dashboardFor(operational);
  assert.equal(guarded.context.dashboardPortfolio({}).error.code, 'SNAPSHOT_UNREADABLE');

  const meta = snapshot.getSheetByName('PUBLISHED_META');
  const rows = meta.getDataRange().getValues();
  rows[rows.findIndex(row => row[0] === 'CONTRACT_VERSION')][1] = '9.9';
  meta.getRange(1, 1, rows.length, 2).setValues(rows);
  assert.equal(viewer.context.dashboardPortfolio({}).error.code, 'SNAPSHOT_CONTRACT_UNSUPPORTED');

  const tampered = portfolio();
  const header = tampered.snapshot.getSheetByName('PUBLISHED_TASKS_A');
  header.getRange(1, 1).setValue('taskId');
  header.getRange(1, 2).setValue('applicationId');
  assert.equal(tampered.viewer.context.dashboardPortfolio({}).error.code, 'SNAPSHOT_CONTRACT_UNSUPPORTED');
});

test('the viewer exposes no write path and caches only the bounded portfolio', () => {
  const {viewer} = portfolio();
  const app = viewer.context.DashboardApp;
  assert.equal(typeof app, 'object');
  const api = Object.keys(viewer.context).filter(name => /^dashboard/.test(name));
  assert.deepEqual(plain(api).sort(), ['dashboardPortfolio', 'dashboardProject', 'dashboardTask']);
  const dataKeys = Object.keys(viewer.context.DashboardData);
  ['save', 'update', 'create', 'delete', 'send', 'publish'].forEach(verb => {
    assert.equal(dataKeys.some(key => key.toLowerCase().indexOf(verb) >= 0), false, verb + ' must not exist');
  });

  assert.equal(viewer.cache.store.size, 0);
  const first = viewer.context.dashboardPortfolio({query: ''});
  assert.equal(first.ok, true);
  assert.ok(viewer.cache.store.size >= 1, 'the immutable portfolio payload is cached by version');
  const cached = viewer.context.dashboardPortfolio({query: ''});
  assert.deepEqual(plain(cached), plain(first));

  const template = viewer.context.doGet();
  const html = template.getContent();
  assert.match(html, /設計・開発課 管理/);
  assert.match(html, /閲覧のみ/);
  assert.equal(template.getTitle(), '設計・開発課 管理');
});

test('the real client script renders cards, detail groups and the task drawer without markup injection', async () => {
  const {viewer} = portfolio();
  const server = {
    dashboardPortfolio: request => viewer.context.dashboardPortfolio(request),
    dashboardProject: (id, options) => viewer.context.dashboardProject(id, options),
    dashboardTask: (projectId, taskId) => viewer.context.dashboardTask(projectId, taskId)
  };
  const {document} = dashboard.runClient(server);
  await dashboard.flush();

  const list = document.getElementById('project-list');
  assert.equal(list.hidden, false);
  assert.match(list.textContent, /検査装置/);
  assert.match(document.getElementById('sync-info').textContent, /最終同期: \d{4}\/\d{2}\/\d{2}/);
  assert.match(document.getElementById('result-count').textContent, /2 件を表示/);
  assert.match(document.getElementById('kpis').textContent, /期限超過タスク/);
  assert.equal(document.getElementById('overview-error').hidden, true);
  assert.equal(list.descendants().some(node => node.tagName === 'IMG'), false);

  // Hostile stored text stays text.
  const hostile = '<img src=x onerror="alert(1)">';
  const {viewer: hostileViewer} = (function () {
    const manager = fixtures.base();
    const db = manager.context.Database;
    db.update('PROJECTS', 'P1', {Dashboard_Visibility: 'INTERNAL', Project_Name: hostile});
    const snapshot = dashboard.attachSnapshot(manager);
    manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
    manager.context.publishSharedDashboard();
    return {viewer: dashboard.dashboardFor(snapshot)};
  })();
  const hostileClient = dashboard.runClient({
    dashboardPortfolio: request => hostileViewer.context.dashboardPortfolio(request),
    dashboardProject: (id, options) => hostileViewer.context.dashboardProject(id, options),
    dashboardTask: (projectId, taskId) => hostileViewer.context.dashboardTask(projectId, taskId)
  });
  await dashboard.flush();
  const hostileList = hostileClient.document.getElementById('project-list');
  assert.ok(hostileList.textContent.indexOf(hostile) >= 0, 'the raw text is displayed verbatim');
  assert.equal(hostileList.descendants().some(node => node.tagName === 'IMG'), false, 'no element is created from data');

  // Opening a project and a task uses the read-only endpoints.
  const card = list.descendants().find(node => node.hasAttribute('data-project-id') &&
    node.getAttribute('data-project-id') === 'P1');
  list.dispatchEvent('click', {target: card});
  await dashboard.flush();
  assert.equal(document.getElementById('overview').hidden, true);
  assert.equal(document.getElementById('detail').hidden, false);
  assert.equal(document.getElementById('detail-title').textContent, '検査装置');
  const groups = document.getElementById('detail-groups').descendants()
    .filter(node => node.className === 'group-name').map(node => node.textContent);
  assert.ok(groups.indexOf('試作') >= 0, 'subproject group rendered');
  assert.ok(groups.indexOf('全体タスク') >= 0, 'direct project tasks rendered');

  const taskButton = document.getElementById('detail-groups').descendants()
    .find(node => node.hasAttribute('data-open-task') && node.getAttribute('data-open-task') === 'T4');
  document.getElementById('detail-groups').dispatchEvent('click', {target: taskButton});
  await dashboard.flush();
  assert.equal(document.getElementById('task-drawer').hidden, false);
  assert.equal(document.getElementById('task-drawer-title').textContent, '検査治具');
  assert.match(document.getElementById('drawer-body').textContent, /公開メモ: 治具を調整中/);
  assert.match(document.getElementById('drawer-body').textContent, /2日超過/);
  assert.doesNotMatch(document.getElementById('drawer-body').textContent, /編集|保存する/, 'no fake write buttons');
});

test('the client shows a stale-data warning and a friendly error state', async () => {
  const {snapshot, viewer} = portfolio();
  const meta = snapshot.getSheetByName('PUBLISHED_META');
  const rows = meta.getDataRange().getValues();
  rows[rows.findIndex(row => row[0] === 'PUBLISHED_AT')][1] = new Date(Date.now() - 30 * 3600000).toISOString();
  meta.getRange(1, 1, rows.length, 2).setValues(rows);

  const stale = dashboard.runClient({
    dashboardPortfolio: request => viewer.context.dashboardPortfolio(request),
    dashboardProject: (id, options) => viewer.context.dashboardProject(id, options),
    dashboardTask: (projectId, taskId) => viewer.context.dashboardTask(projectId, taskId)
  });
  await dashboard.flush();
  assert.match(stale.document.getElementById('notices').textContent, /データが更新されていません/);
  assert.match(stale.document.getElementById('notices').textContent, /30 時間前/);
  assert.match(stale.document.getElementById('sync-info').textContent, /更新が遅れています/);

  const failing = dashboard.runClient({
    dashboardPortfolio: () => ({ok: false, error: {code: 'SNAPSHOT_NOT_PUBLISHED', message: '公開データがまだ作成されていません。管理者に連絡してください。'}}),
    dashboardProject: () => ({ok: false, error: {code: 'NOT_FOUND', message: 'x'}}),
    dashboardTask: () => ({ok: false, error: {code: 'NOT_FOUND', message: 'x'}})
  });
  await dashboard.flush();
  assert.equal(failing.document.getElementById('overview-error').hidden, false);
  assert.match(failing.document.getElementById('overview-error-detail').textContent, /公開データがまだ作成されていません/);
  assert.equal(failing.document.getElementById('project-list').hidden, true);
  assert.doesNotMatch(failing.document.getElementById('overview-error-detail').textContent, /at Object\.|\.js:\d+/);
});

test('an empty portfolio shows an intentional empty state', async () => {
  const manager = fixtures.app();
  manager.context.Database.insert('MEMBERS', {
    Member_ID: 'M-ADMIN', Name: '管理 太郎', Email: 'admin@example.test', Active: true, Role: 'ADMIN'
  });
  const snapshot = dashboard.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  manager.context.publishSharedDashboard();
  const viewer = dashboard.dashboardFor(snapshot);
  const client = dashboard.runClient({
    dashboardPortfolio: request => viewer.context.dashboardPortfolio(request),
    dashboardProject: (id, options) => viewer.context.dashboardProject(id, options),
    dashboardTask: (projectId, taskId) => viewer.context.dashboardTask(projectId, taskId)
  });
  await dashboard.flush();
  assert.equal(client.document.getElementById('project-list').hidden, true);
  assert.equal(client.document.getElementById('overview-empty').hidden, false);
  assert.match(client.document.getElementById('overview-empty-detail').textContent, /まだありません/);
  assert.equal(client.document.getElementById('result-count').textContent, '0 件');
});

test('the target scale stays bounded for the viewer (local mock measurement, not Workspace)', () => {
  const manager = fixtures.app();
  const members = [], projects = [], subprojects = [], tasks = [], milestones = [];
  for (let index = 0; index < 100; index++) {
    projects.push({
      Project_ID: 'PX' + index, Project_Name: 'プロジェクト ' + index, Category: index % 2 ? '設計' : '製造',
      Status: index % 10 === 9 ? 'Archived' : 'Active', Project_Owner_ID: 'MX0',
      Committed_Deadline: jstDate(index % 40), Dashboard_Visibility: index % 5 === 4 ? '' : 'INTERNAL',
      Dashboard_Summary: '概要 ' + index, Last_Updated: new Date().toISOString()
    });
  }
  for (let index = 0; index < 500; index++) {
    subprojects.push({Subproject_ID: 'SX' + index, Project_ID: 'PX' + (index % 100), Subproject_Name: 'サブ ' + index, Status: 'Active'});
  }
  for (let index = 0; index < 5000; index++) {
    tasks.push({
      Task_ID: 'TX' + index, Project_ID: 'PX' + (index % 100), Subproject_ID: index % 2 ? 'SX' + (index % 500) : '',
      Task_Name: 'タスク ' + index, Owner_Member_ID: 'MX0',
      Status: index % 7 === 0 ? 'Done' : 'In Progress', Progress_Percent: index % 7 === 0 ? 100 : index % 90,
      Due_Date: jstDate(index % 30 - 5), Estimated_Hours: 8
    });
  }
  for (let index = 0; index < 100; index++) {
    milestones.push({Milestone_ID: 'MSX' + index, Project_ID: 'PX' + (index % 100), Milestone_Name: 'マイルストーン ' + index, Target_Date: jstDate(20)});
  }
  fixtures.bulk(manager, 'MEMBERS', [{Member_ID: 'MX0', Name: '責任者 一郎', Email: 'admin@example.test', Active: true, Role: 'ADMIN'}]);
  fixtures.bulk(manager, 'PROJECTS', projects);
  fixtures.bulk(manager, 'SUBPROJECTS', subprojects);
  fixtures.bulk(manager, 'TASKS', tasks);
  fixtures.bulk(manager, 'MILESTONES', milestones);

  const snapshot = dashboard.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  const published = manager.context.publishSharedDashboard();
  assert.equal(published.counts.projects, 80, 'projects without INTERNAL visibility are excluded');
  assert.equal(published.counts.tasks, 4000);

  const viewer = dashboard.dashboardFor(snapshot);
  const started = Date.now();
  const response = viewer.context.dashboardPortfolio({});
  const elapsed = Date.now() - started;
  assert.equal(response.ok, true);
  assert.equal(response.data.projects.length, 80);
  const payload = JSON.stringify(response.data);
  assert.ok(payload.length < 200000, 'the portfolio payload stays bounded, got ' + payload.length + ' chars');
  assert.doesNotMatch(payload, /taskName|publicNote/, 'no task rows are shipped with the portfolio');

  const detailStarted = Date.now();
  const detail = viewer.context.dashboardProject('PX1');
  const detailElapsed = Date.now() - detailStarted;
  assert.equal(detail.ok, true);
  assert.ok(detail.data.tasks.length <= 500);
  console.log('V1.2 viewer timings (mock, not Workspace): ' +
    JSON.stringify({portfolioMs: elapsed, projectDetailMs: detailElapsed, portfolioChars: payload.length,
      publishedTasks: published.counts.tasks}));
});
