'use strict';

/**
 * V1.7 regression tests: additional assignees, additional responsibility members, the published
 * contract 1.6, the worker query and the schema 7 → 8 migration.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');

function app() {
  return fixtures.base({ properties: { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' } });
}

/** The mocked Apps Script context has its own Array prototype, so compare plain copies. */
function plain(value) { return JSON.parse(JSON.stringify(value === undefined ? null : value)); }
function ids(list) { return plain(list.map(entry => entry.memberId)); }
function names(list) { return plain(list.map(entry => entry.name)); }

test('a task without an additional assignee has exactly one effective assignee', () => {
  const a = app(), c = a.context;
  const task = c.Database.find('TASKS', 'T1');
  assert.deepEqual(ids(c.Assignees.effective('TASK', task)), ['M-ENG']);
  assert.deepEqual(plain(c.Assignees.additionalIds('TASK', task)), []);
  assert.deepEqual(plain(c.Assignees.names('TASK', task)), ['設計 次郎']);
  assert.equal(c.Database.read('TASK_ASSIGNEES').length, 0, 'no relationship row is invented');
});

test('additional assignees are relationship rows, never a stored column', () => {
  const a = app(), c = a.context;
  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR', 'M-VIEW'] });
  const task = c.Database.find('TASKS', 'T1');
  assert.equal(task.Owner_Member_ID, 'M-ENG', 'the primary owner is unchanged');
  assert.deepEqual(plain(c.Assignees.additionalIds('TASK', task)), ['M-MGR', 'M-VIEW']);
  assert.deepEqual(names(c.Assignees.effective('TASK', task)), ['設計 次郎', '管理 花子', '閲覧 三郎']);
  assert.equal(c.Database.read('TASK_ASSIGNEES').length, 2);
  assert.equal(c.Schema.tables.TASKS.fields.some(field => /Assignee_IDs/.test(field.name)), false,
    'no comma separated identifier column exists');
});

test('a repeated additional assignee is refused instead of silently dropped', () => {
  const a = app(), c = a.context;
  assert.throws(() => c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR', 'M-MGR'] }), /重複/);
  assert.equal(c.Database.read('TASK_ASSIGNEES').length, 0, 'a refused save writes nothing');
});

test('a new assignment refuses an unknown or inactive member', () => {
  const a = app(), c = a.context;
  assert.throws(() => c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-NOPE'] }), /メンバーが見つかりません/);
  c.Database.update('MEMBERS', 'M-VIEW', { Active: false });
  assert.throws(() => c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-VIEW'] }), /無効なメンバー/);
  assert.equal(c.Database.read('TASK_ASSIGNEES').length, 0);
});

test('a deactivated additional assignee survives an unrelated edit', () => {
  const a = app(), c = a.context;
  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-VIEW'] });
  c.Database.update('MEMBERS', 'M-VIEW', { Active: false });
  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-VIEW'], Priority: 'High' });
  assert.deepEqual(plain(c.Assignees.additionalIds('TASK', c.Database.find('TASKS', 'T1'))), ['M-VIEW']);
});

test('an assignment membership change invalidates an existing approval', () => {
  const a = app(), c = a.context;
  fixtures.activate(a);
  fixtures.approve(a, 'T1');
  const approved = c.Database.find('TASKS', 'T1');
  assert.ok(approved.Assignment_Approved_At, 'the fixture approval is recorded');
  const version = Number(approved.Assignment_Version || 0);

  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR'] });
  const updated = c.Database.find('TASKS', 'T1');
  assert.equal(updated.Assignment_Approved_At, '', 'the approval is never silently preserved');
  assert.equal(Number(updated.Assignment_Version), version + 1);
  assert.equal(c.Database.read('AUDIT_LOG').filter(row => row.Action === 'TASK_ASSIGNEES_CHANGED').length, 1);
});

test('removing an additional assignee keeps history and re-adding reactivates it', () => {
  const a = app(), c = a.context;
  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR', 'M-VIEW'] });
  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR'] });

  const rows = c.Database.read('TASK_ASSIGNEES');
  assert.equal(rows.length, 2, 'the removed row is kept');
  assert.ok(rows.filter(row => row.Member_ID === 'M-VIEW')[0].Removed_At, 'the removal is stamped');
  assert.deepEqual(plain(c.Assignees.additionalIds('TASK', c.Database.find('TASKS', 'T1'))), ['M-MGR']);
  assert.equal(c.Assignees.history('TASK', 'T1').filter(entry => entry.memberId === 'M-VIEW')[0].current, false);

  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR', 'M-VIEW'] });
  assert.equal(c.Database.read('TASK_ASSIGNEES').length, 2, 'no duplicate row is created');
  assert.deepEqual(plain(c.Assignees.additionalIds('TASK', c.Database.find('TASKS', 'T1'))), ['M-MGR', 'M-VIEW']);
});

test('changing the primary assignee never duplicates the effective membership', () => {
  const a = app(), c = a.context;
  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR'] });
  c.Tasks.update('T1', { Owner_Member_ID: 'M-MGR' });
  const task = c.Database.find('TASKS', 'T1');
  assert.deepEqual(ids(c.Assignees.effective('TASK', task)), ['M-MGR']);
  assert.deepEqual(plain(c.Assignees.additionalIds('TASK', task)), []);
});

test('the manager task index publishes assignees and the member filter matches any of them', () => {
  const a = app(), c = a.context;
  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR'] });

  const index = c.managerWebRead('taskIndex');
  assert.equal(index.ok, true, index.error);
  const rows = index.data.rows, columns = index.data.columns;
  const row = rows.filter(item => item[0] === 'T1')[0];
  assert.deepEqual(plain(row[columns.indexOf('assigneeIds')]), ['M-ENG', 'M-MGR']);
  assert.deepEqual(plain(row[columns.indexOf('assigneeNames')]), ['設計 次郎', '管理 花子']);
  assert.equal(row[columns.indexOf('sharedAssignment')], true);

  const byAdditional = c.managerWebRead('tasks', { assigneeId: 'M-MGR' });
  assert.deepEqual(plain(byAdditional.data.items.map(task => task.id)), ['T1']);
  const byPrimary = c.managerWebRead('tasks', { assigneeId: 'M-ENG' });
  assert.deepEqual(plain(byPrimary.data.items.map(task => task.id).sort()), ['T1', 'T2', 'T3']);
});

test('a member profile separates primary work from additional work', () => {
  const a = app(), c = a.context;
  c.Tasks.update('T2', { Additional_Assignee_IDs: ['M-MGR'] });
  const profile = c.managerWebRead('member', { id: 'M-MGR' });
  assert.equal(profile.ok, true, profile.error);
  assert.deepEqual(plain(profile.data.additionalCurrent.map(task => task.id)), ['T2']);
  assert.equal(profile.data.ownership.additionalCurrent, 1);
});

test('additional responsibility members are recorded; only an ADMIN may move the primary owner', () => {
  const a = app(), c = a.context;
  const created = c.Ui.saveResponsibility({ name: '光学設計', additionalMemberIds: ['M-ENG', 'M-VIEW'] });
  assert.equal(created.ok, true, created.error);
  const id = created.data.Responsibility_ID;
  const row = c.Database.find('RESPONSIBILITIES', id);
  assert.equal(row.Owner_Member_ID, 'M-ADMIN');
  assert.deepEqual(ids(c.Assignees.effective('RESPONSIBILITY', row)), ['M-ADMIN', 'M-ENG', 'M-VIEW']);

  a.setActor('manager@example.test');
  const forbidden = c.Ui.saveResponsibility({ responsibilityId: id, ownerId: 'M-ENG' });
  assert.equal(forbidden.ok, false, 'a manager may not move the primary owner');
  assert.match(forbidden.error, /ADMIN/);
  const updated = c.Ui.saveResponsibility({ responsibilityId: id, additionalMemberIds: ['M-ENG'] });
  assert.equal(updated.ok, true, updated.error);
  assert.deepEqual(plain(c.Assignees.additionalIds('RESPONSIBILITY', c.Database.find('RESPONSIBILITIES', id))), ['M-ENG']);
  assert.equal(c.Database.find('RESPONSIBILITIES', id).Owner_Member_ID, 'M-ADMIN');
});

test('retiring a responsibility keeps its membership history', () => {
  const a = app(), c = a.context;
  const created = c.Ui.saveResponsibility({ name: '光学設計', additionalMemberIds: ['M-ENG'] });
  const id = created.data.Responsibility_ID;
  c.Responsibilities.retire(id, { confirmed: true });
  assert.equal(c.Database.find('RESPONSIBILITIES', id).Status, 'Retired');
  assert.deepEqual(plain(c.Assignees.additionalIds('RESPONSIBILITY', c.Database.find('RESPONSIBILITIES', id))), ['M-ENG']);
});

test('a task with any assignee row is no longer permanently deletable', () => {
  const a = app(), c = a.context;
  c.Tasks.update('T2', { Additional_Assignee_IDs: ['M-MGR'] });
  const preflight = c.Deletion.preflight('TASKS', 'T2');
  assert.equal(preflight.deletable, false);
  assert.ok(preflight.blocking.some(item => item.table === 'TASK_ASSIGNEES'));
});

test('contract 1.6 publishes an allowlisted display-name list and never a private member field', () => {
  const a = app(), c = a.context;
  c.Database.update('PROJECTS', 'P1', { Dashboard_Visibility: 'INTERNAL' });
  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR'] });
  const snapshot = dashboardFixtures.attachSnapshot(a);
  c.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(a);
  const publication = c.publishSharedDashboard();
  assert.equal(publication.published, true, JSON.stringify(publication));

  const sheet = snapshot.getSheetByName('PUBLISHED_TASKS_A');
  const column = sheet.rows[0].indexOf('assigneeNames');
  assert.ok(column >= 0, 'the new field is appended to the published header');
  assert.equal(sheet.rows[0].indexOf('ownerName') >= 0, true, 'ownerName keeps its meaning');
  const row = sheet.rows.filter((cells, index) => index > 0 && cells[0] === 'T1')[0];
  assert.deepEqual(plain(JSON.parse(row[column])), ['設計 次郎', '管理 花子']);
  assert.doesNotMatch(JSON.stringify(sheet.rows), /@example\.test|M-ENG|M-MGR/,
    'no member identifier or address is published');
});

test('a shared task appears under every assignee and is counted once', () => {
  const a = app(), c = a.context;
  c.Database.update('PROJECTS', 'P1', { Dashboard_Visibility: 'INTERNAL' });
  c.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR'] });
  const snapshot = dashboardFixtures.attachSnapshot(a);
  c.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(a);
  c.publishSharedDashboard();

  const viewer = dashboardFixtures.dashboardFor(snapshot);
  const primary = viewer.context.dashboardWorkerTasks({ worker: '設計 次郎' });
  const additional = viewer.context.dashboardWorkerTasks({ worker: '管理 花子' });
  assert.equal(primary.ok, true, JSON.stringify(primary));
  assert.equal(additional.ok, true, JSON.stringify(additional));
  assert.ok(primary.data.tasks.some(task => task.taskId === 'T1'));
  assert.deepEqual(plain(additional.data.tasks.map(task => task.taskId)), ['T1']);
  assert.equal(additional.data.tasks[0].sharedAssignment, true);

  const everyone = viewer.context.dashboardWorkerTasks({});
  assert.equal(everyone.data.total, 2, 'the shared task is not duplicated in the aggregate count');
  assert.deepEqual(plain(everyone.data.tasks.map(task => task.taskId).sort()), ['T1', 'T2']);
});

test('the worker query honours the status group, deadline window and pagination bounds', () => {
  const a = app(), c = a.context;
  c.Database.update('PROJECTS', 'P1', { Dashboard_Visibility: 'INTERNAL' });
  const snapshot = dashboardFixtures.attachSnapshot(a);
  c.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(a);
  c.publishSharedDashboard();

  const viewer = dashboardFixtures.dashboardFor(snapshot);
  const open = viewer.context.dashboardWorkerTasks({ group: 'open' });
  assert.equal(open.ok, true, JSON.stringify(open));
  assert.equal(open.data.tasks.every(task => task.status !== 'Done'), true);
  const bounded = viewer.context.dashboardWorkerTasks({ limit: 1, offset: 0 });
  assert.equal(bounded.data.tasks.length, 1);
  assert.equal(bounded.data.total, 2);
  const none = viewer.context.dashboardWorkerTasks({ worker: '存在しない担当者' });
  assert.equal(none.data.total, 0, 'an unknown worker name never falls back to every task');
});

test('a 1.5 snapshot stays readable when only 1.6 publishes the assignee list', () => {
  const a = app(), c = a.context;
  c.Database.update('PROJECTS', 'P1', { Dashboard_Visibility: 'INTERNAL' });
  const snapshot = dashboardFixtures.attachSnapshot(a);
  c.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(a);
  c.publishSharedDashboard();

  const sheet = snapshot.getSheetByName('PUBLISHED_TASKS_A');
  const column = sheet.rows[0].indexOf('assigneeNames');
  sheet.rows[0].splice(column, 1);
  sheet.rows.slice(1).forEach(cells => cells.splice(column, 1));
  const meta = snapshot.getSheetByName('PUBLISHED_META');
  meta.rows.filter(cells => cells[0] === 'CONTRACT_VERSION').forEach(cells => { cells[1] = '1.5'; });

  const viewer = dashboardFixtures.dashboardFor(snapshot);
  const portfolio = viewer.context.dashboardPortfolio({ query: '' });
  assert.equal(portfolio.ok, true, JSON.stringify(portfolio));
  assert.equal(portfolio.data.meta.contractVersion, '1.5');
  assert.equal(portfolio.data.filters.workers.indexOf('設計 次郎') >= 0, true,
    'the primary owner is still the only known assignee of a 1.5 row');
});

test('migration 008 adds the relationship tables and assigns nobody', () => {
  const a = fixtures.app({ properties: { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' } });
  const c = a.context;
  const history = a.book.getSheetByName('SCHEMA_MIGRATIONS');
  const versionColumn = history.rows[0].indexOf('New_Version');
  history.rows.forEach((row, index) => { if (index > 0) row[versionColumn] = 7; });
  a.book.sheets = a.book.sheets.filter(sheet =>
    ['TASK_ASSIGNEES', 'RESPONSIBILITY_MEMBERS'].indexOf(sheet.getName()) < 0);
  a.properties.setProperty('APPROVED_MIGRATIONS', '008_task_and_responsibility_members');
  assert.equal(c.Migrations.currentVersion(), 7);

  assert.equal(c.Migrations.upgrade(), 8);
  assert.ok(a.book.getSheetByName('TASK_ASSIGNEES'));
  assert.ok(a.book.getSheetByName('RESPONSIBILITY_MEMBERS'));
  assert.equal(c.Database.read('TASK_ASSIGNEES').length, 0, 'no assignment is created');
  assert.equal(c.Database.read('RESPONSIBILITY_MEMBERS').length, 0);
  assert.equal(a.backups.length, 1, 'the migration takes its own verified backup');
});
