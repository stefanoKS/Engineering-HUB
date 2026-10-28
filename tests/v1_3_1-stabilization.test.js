'use strict';

/**
 * V1.3.1 stabilization: project visibility, project/task editing with partial patches,
 * manager ownership defaults, unusual-but-refused inputs and automatic request import.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');
const dashboard = require('./dashboard-fixtures');
const { MockSpreadsheet } = require('./helpers');

const SNAPSHOT_ID = dashboard.SNAPSHOT_ID;
const INBOX_ID = 'inbox-stabilization';
const INBOX_FIELDS = [
  'Request_ID', 'Request_Type', 'Task_ID', 'Project_ID', 'Requester_Name', 'Submitted_At',
  'Current_Due_Date', 'Requested_Due_Date', 'Reason', 'Explanation', 'Completion_Note',
  'Task_Revision', 'Snapshot_Version', 'Client_Token', 'Inbox_State'
];

function rows(book, name) {
  const sheet = book.getSheetByName(name);
  return sheet ? sheet.getDataRange().getValues() : [];
}

function activeSlot(book) {
  const values = rows(book, 'PUBLISHED_META');
  const row = values.slice(1).filter(item => item[0] === 'ACTIVE_SLOT')[0];
  return row ? String(row[1]) : 'A';
}

/** Reads the committed (active) slot of the published snapshot. */
function publishedRows(book, table) {
  const values = rows(book, 'PUBLISHED_' + table + '_' + activeSlot(book));
  return values;
}

function dayString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value === undefined || value === null ? '' : value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

/** An administrator workbook with an initialized snapshot and publication enabled. */
function publisher() {
  const app = fixtures.base();
  const snapshot = dashboard.attachSnapshot(app);
  app.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  dashboard.enablePublication(app);
  return {app, snapshot};
}

function column(header, name) {
  return header.indexOf(name);
}

function projectIds(book) {
  const values = publishedRows(book, 'PROJECTS');
  const index = column(values[0], 'projectId');
  return values.slice(1).map(row => String(row[index])).filter(Boolean);
}

function taskIds(book) {
  const values = publishedRows(book, 'TASKS');
  const index = column(values[0], 'taskId');
  return values.slice(1).map(row => String(row[index])).filter(Boolean);
}

function everythingIn(book) {
  return book.getSheets().map(sheet => JSON.stringify(sheet.getDataRange().getValues())).join('\n');
}

function managerWithInbox(actor) {
  const app = fixtures.base({actor: actor || 'manager@example.test'});
  const inbox = new MockSpreadsheet(INBOX_ID, {REQUESTS: [INBOX_FIELDS]});
  app.spreadsheets.set(INBOX_ID, inbox);
  app.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', INBOX_ID);
  const sheet = inbox.getSheetByName('REQUESTS');
  sheet.getRange(2, 1, 1, INBOX_FIELDS.length).setValues([[
    'REQ-1', 'DEADLINE_CHANGE', 'T1', 'P1', '設計 次郎', new Date().toISOString(),
    '2026-12-15', '2026-12-22', '技術的問題', '再評価が必要です。', '', '', '1', 'token-1', 'RECEIVED'
  ]]);
  return {app, inbox, sheet};
}

/* ---------------------------------------------------------------- *
 * Gate 1: creation, ownership and visibility
 * ---------------------------------------------------------------- */

test('a new project stays hidden until a manager publishes it deliberately', () => {
  const {app, snapshot} = publisher();
  const created = app.context.Ui.createProject({name: '新規案件'});
  assert.equal(created.ok, true, created.error);
  assert.equal(created.data.Dashboard_Visibility, 'RESTRICTED', 'the safe default is hidden');

  app.context.publishSharedDashboard();
  assert.equal(projectIds(snapshot).indexOf(created.data.Project_ID), -1, 'a hidden project is never published');

  const shown = app.context.Ui.updateProject({projectId: created.data.Project_ID, visibility: 'INTERNAL'});
  assert.equal(shown.ok, true, shown.error);
  app.context.publishSharedDashboard();
  assert.ok(projectIds(snapshot).indexOf(created.data.Project_ID) >= 0, 'the published project is visible');

  const hidden = app.context.Ui.updateProject({projectId: created.data.Project_ID, visibility: 'RESTRICTED'});
  assert.equal(hidden.ok, true, hidden.error);
  app.context.publishSharedDashboard();
  assert.equal(projectIds(snapshot).indexOf(created.data.Project_ID), -1, 'republishing removes it again');
});

test('subprojects and tasks disappear with their project', () => {
  const {app, snapshot} = publisher();
  const created = app.context.Ui.createProject({name: '子要素つき案件', visibility: 'INTERNAL'});
  const projectId = created.data.Project_ID;
  const sub = app.context.Ui.createSubproject({projectId: projectId, name: '試作'});
  const task = app.context.Ui.assignTask({
    projectId: projectId, subprojectId: sub.data.Subproject_ID, taskName: '試作評価', ownerId: 'M-ENG'
  });
  assert.equal(task.ok, true, task.error);

  app.context.publishSharedDashboard();
  assert.ok(taskIds(snapshot).indexOf(task.data.task.Task_ID) >= 0);

  app.context.Ui.updateProject({projectId: projectId, visibility: 'RESTRICTED'});
  app.context.publishSharedDashboard();
  assert.equal(projectIds(snapshot).indexOf(projectId), -1);
  assert.equal(taskIds(snapshot).indexOf(task.data.task.Task_ID), -1, 'the task follows its project');
  const subprojects = publishedRows(snapshot, 'SUBPROJECTS');
  const subProjectColumn = column(subprojects[0], 'projectId');
  assert.equal(subprojects.slice(1).some(row => row[subProjectColumn] === projectId), false, 'the subproject follows its project');
});

test('the dashboard summary is published while private text never leaves the workbook', () => {
  const {app, snapshot} = publisher();
  const created = app.context.Ui.createProject({
    name: '公開範囲の確認', visibility: 'INTERNAL',
    summary: '公開してよい概要です',
    description: '社外秘の説明文です'
  });
  app.context.Ui.assignTask({
    projectId: created.data.Project_ID, taskName: '確認タスク', ownerId: 'M-ENG',
    acceptanceCriteria: '社外秘の完了条件です'
  });
  app.context.publishSharedDashboard();

  const values = publishedRows(snapshot, 'PROJECTS');
  const header = values[0];
  const row = values.slice(1).filter(item => item[column(header, 'projectId')] === created.data.Project_ID)[0];
  assert.ok(row, 'the project is published');
  assert.equal(row[column(header, 'summary')], '公開してよい概要です');

  const all = everythingIn(snapshot);
  assert.equal(all.indexOf('社外秘の説明文です'), -1, 'the private description is never published');
  assert.equal(all.indexOf('社外秘の完了条件です'), -1, 'acceptance criteria are never published');
});

test('a manager owns a new project by default and can then edit it', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const created = app.context.Ui.createProject({name: '担当未指定の案件'});
  assert.equal(created.ok, true, created.error);
  assert.equal(created.data.Project_Owner_ID, 'M-MGR', 'the verified manager becomes the owner');

  const edited = app.context.Ui.updateProject({projectId: created.data.Project_ID, category: '設計'});
  assert.equal(edited.ok, true, edited.error);
  assert.equal(app.context.Database.find('PROJECTS', created.data.Project_ID).Category, '設計');
});

test('any manager can edit a project owned by another manager', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const created = app.context.Ui.createProject({name: '他の責任者の案件', ownerId: 'M-ADMIN'});
  assert.equal(created.ok, true, created.error);
  assert.equal(created.data.Project_Owner_ID, 'M-ADMIN');

  // Project ownership is accountability, so a second manager collaborates without an error.
  const edited = app.context.Ui.updateProject({projectId: created.data.Project_ID, visibility: 'INTERNAL'});
  assert.equal(edited.ok, true, edited.error);
  const stored = app.context.Database.find('PROJECTS', created.data.Project_ID);
  assert.equal(stored.Dashboard_Visibility, 'INTERNAL');
  assert.equal(stored.Project_Owner_ID, 'M-ADMIN', 'the owner is not rewritten by an edit');

  // A MEMBER still cannot edit the project structure.
  const member = fixtures.base({actor: 'engineer@example.test'});
  const refused = member.context.Ui.updateProject({projectId: 'P1', visibility: 'INTERNAL'});
  assert.equal(refused.ok, false);
  assert.match(refused.error, /MANAGER/);
  assert.equal(member.context.Database.find('PROJECTS', 'P1').Dashboard_Visibility, 'RESTRICTED');
});

test('a member cannot create or publish a project', () => {
  const app = fixtures.base({actor: 'engineer@example.test'});
  assert.equal(app.context.Ui.createProject({name: '不可', visibility: 'INTERNAL'}).ok, false);
  const publication = app.context.Ui.publishPublicationNow();
  assert.equal(publication.ok, false);
  assert.match(publication.error, /MANAGER/);
});

/* ---------------------------------------------------------------- *
 * Gate 2: editing without collateral changes
 * ---------------------------------------------------------------- */

test('a project edit patches only the supplied fields and keeps the identity', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const before = app.context.Database.find('PROJECTS', 'P1');

  const edited = app.context.Ui.updateProject({projectId: 'P1', summary: '一次試作を完了'});
  assert.equal(edited.ok, true, edited.error);

  const after = app.context.Database.find('PROJECTS', 'P1');
  assert.equal(after.Project_ID, 'P1');
  assert.equal(after.Original_Deadline, before.Original_Deadline);
  assert.equal(after.Project_Owner_ID, 'M-MGR');
  assert.equal(after.Committed_Deadline, before.Committed_Deadline);
  assert.equal(after.Dashboard_Visibility, before.Dashboard_Visibility);
  assert.equal(after.Project_Name, before.Project_Name);
  assert.equal(after.Dashboard_Summary, '一次試作を完了');
  assert.ok(app.context.Database.read('AUDIT_LOG').some(row => row.Action === 'UI_PROJECT_UPDATED'));
});

test('an invalid visibility or an empty patch is refused', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const invalid = app.context.Ui.updateProject({projectId: 'P1', visibility: 'PUBLIC'});
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /INTERNAL/);
  assert.equal(app.context.Database.find('PROJECTS', 'P1').Dashboard_Visibility, 'RESTRICTED');

  const empty = app.context.Ui.updateProject({projectId: 'P1'});
  assert.equal(empty.ok, false);
  assert.match(empty.error, /変更する項目/);
});

test('a committed deadline change needs an explicit confirmation', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const originalDeadline = dayString(app.context.Database.find('PROJECTS', 'P1').Original_Deadline);
  const refused = app.context.Ui.updateProject({projectId: 'P1', deadline: '2027-01-31'});
  assert.equal(refused.ok, false);
  assert.match(refused.error, /確認/);
  assert.equal(dayString(app.context.Database.find('PROJECTS', 'P1').Committed_Deadline), '2026-12-31');

  const accepted = app.context.Ui.updateProject({projectId: 'P1', deadline: '2027-01-31', confirmDeadlineChange: true});
  assert.equal(accepted.ok, true, accepted.error);
  assert.equal(dayString(app.context.Database.find('PROJECTS', 'P1').Committed_Deadline), '2027-01-31');
  assert.equal(dayString(app.context.Database.find('PROJECTS', 'P1').Original_Deadline), originalDeadline,
    'the original deadline stays immutable');
});

test('a task edit preserves the fields it does not address', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const before = app.context.Database.find('TASKS', 'T1');

  const edited = app.context.Ui.assignTask({taskId: 'T1', notify: false});
  assert.equal(edited.ok, true, edited.error);

  const after = app.context.Database.find('TASKS', 'T1');
  assert.equal(after.Task_ID, 'T1');
  assert.equal(after.Task_Name, before.Task_Name);
  assert.equal(after.Owner_Member_ID, before.Owner_Member_ID);
  assert.equal(after.Due_Date, before.Due_Date);
  assert.equal(after.Planned_Start, before.Planned_Start);
  assert.equal(after.Estimated_Hours, before.Estimated_Hours);
  assert.equal(after.Actual_Hours, before.Actual_Hours);
  assert.equal(after.Progress_Percent, before.Progress_Percent);
  assert.equal(after.Acceptance_Criteria, before.Acceptance_Criteria);
  assert.equal(after.Notification_Enabled, false);
  assert.equal(after.Assignment_Version, before.Assignment_Version,
    'a notification preference is not a material assignment change');
});

test('renaming a task invalidates the stale assignment approval but keeps the data', () => {
  const app = fixtures.base();
  fixtures.activate(app);
  fixtures.approve(app, 'T1');
  const approved = app.context.Database.find('TASKS', 'T1');
  assert.ok(approved.Assignment_Approved_At);

  const edited = app.context.Ui.assignTask({taskId: 'T1', taskName: '機構設計（改訂）'});
  assert.equal(edited.ok, true, edited.error);

  const after = app.context.Database.find('TASKS', 'T1');
  assert.equal(after.Task_Name, '機構設計（改訂）');
  assert.equal(after.Owner_Member_ID, approved.Owner_Member_ID);
  assert.equal(after.Due_Date, approved.Due_Date);
  assert.equal(Number(after.Assignment_Version), Number(approved.Assignment_Version) + 1);
  assert.equal(after.Assignment_Approved_At, '', 'a material change invalidates the approval');
});

test('editing the deadline or duration recalculates the derived planned start', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const deadline = app.context.Ui.assignTask({
    taskId: 'T2', deadline: '2026-11-20', durationValue: 3, durationUnit: 'DAY', durationBasis: 'WORKING_DAYS'
  });
  assert.equal(deadline.ok, true, deadline.error);
  assert.equal(app.context.Database.find('TASKS', 'T2').Planned_Start, '2026-11-18');

  const duration = app.context.Ui.assignTask({taskId: 'T2', durationValue: 1, durationUnit: 'WEEK'});
  assert.equal(duration.ok, true, duration.error);
  assert.equal(app.context.Database.find('TASKS', 'T2').Planned_Start, '2026-11-16');

  const cleared = app.context.Ui.assignTask({taskId: 'T2', durationValue: ''});
  assert.equal(cleared.ok, true, cleared.error);
  assert.equal(app.context.Database.find('TASKS', 'T2').Planned_Duration_Value, '');
});

test('a task moves into any project for a manager, but never for a member', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  app.context.Database.insert('PROJECTS', {Project_ID: 'P9', Project_Name: '他部署', Project_Owner_ID: 'M-ADMIN', Status: 'Active'});
  const moved = app.context.Ui.assignTask({taskId: 'T2', projectId: 'P9'});
  assert.equal(moved.ok, true, moved.error);
  assert.equal(app.context.Database.find('TASKS', 'T2').Project_ID, 'P9');

  // A task that still points at another project's subproject is refused, never silently moved.
  const crossProject = app.context.Ui.assignTask({taskId: 'T1', projectId: 'P9'});
  assert.equal(crossProject.ok, false);
  assert.match(crossProject.error, /Subproject|サブプロジェクト/);
  assert.equal(app.context.Database.find('TASKS', 'T1').Project_ID, 'P1');

  const member = fixtures.base({actor: 'engineer@example.test', properties: {ALLOW_MEMBER_SELF_SERVICE: 'true'}});
  member.context.Database.insert('PROJECTS', {Project_ID: 'P9', Project_Name: '他部署', Project_Owner_ID: 'M-ADMIN', Status: 'Active'});
  const refused = member.context.Ui.assignTask({taskId: 'T2', projectId: 'P9'});
  assert.equal(refused.ok, false);
  assert.match(refused.error, /MANAGER/);
  assert.equal(member.context.Database.find('TASKS', 'T2').Project_ID, 'P1');
});

test('a stale task edit is refused instead of overwriting newer data', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const loaded = app.context.Database.find('TASKS', 'T1');
  // Another manager saves the task after this form was loaded.
  app.context.Ui.updateProgress({taskId: 'T1', progress: 60});
  app.context.Database.update('TASKS', 'T1', {Last_Updated: '2031-05-05T00:00:00.000Z'});

  const refused = app.context.Ui.assignTask({taskId: 'T1', taskName: '競合した編集', updatedAt: loaded.Last_Updated});
  assert.equal(refused.ok, false);
  assert.match(refused.error, /再読み込み/);
  assert.equal(app.context.Database.find('TASKS', 'T1').Task_Name, '機構設計');
  assert.equal(app.context.Database.find('TASKS', 'T1').Progress_Percent, 60);
});

test('a manager edits any task in the department while a member stays inside their own work', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  app.context.Database.insert('PROJECTS', {Project_ID: 'P9', Project_Name: '他部署', Project_Owner_ID: 'M-ADMIN', Status: 'Active'});
  app.context.Database.insert('TASKS', {
    Task_ID: 'T9', Project_ID: 'P9', Task_Name: '他部署の作業', Owner_Member_ID: 'M-ADMIN', Status: 'Assigned'
  });
  const edited = app.context.Ui.assignTask({taskId: 'T9', taskName: '書き換え'});
  assert.equal(edited.ok, true, edited.error);
  assert.equal(app.context.Database.find('TASKS', 'T9').Task_Name, '書き換え');

  const member = fixtures.base({actor: 'engineer@example.test', properties: {ALLOW_MEMBER_SELF_SERVICE: 'true'}});
  const refused = member.context.Ui.assignTask({taskId: 'T9', taskName: '乗っ取り'});
  assert.equal(refused.ok, false);
  assert.match(refused.error, /MANAGER/);
});

test('project status changes stay explicit and consistent with the tasks', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const completedAtCreation = app.context.Ui.createProject({name: '完了で作成', status: 'Completed'});
  assert.equal(completedAtCreation.ok, false);
  assert.match(completedAtCreation.error, /完了状態で作成できません/);

  const archived = app.context.Ui.createProject({name: 'アーカイブで作成', status: 'Archived'});
  assert.equal(archived.ok, false);
  assert.match(archived.error, /選択してください/);

  const early = app.context.Ui.updateProject({projectId: 'P1', status: 'Completed'});
  assert.equal(early.ok, false);
  assert.match(early.error, /全てのタスクが完了していない/);
  assert.equal(app.context.Database.find('PROJECTS', 'P1').Status, 'Active');
});

test('project edits send no mail and never touch another project', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const otherBefore = JSON.stringify(app.context.Database.find('PROJECTS', 'P2'));
  const edited = app.context.Ui.updateProject({projectId: 'P1', summary: '概要のみ更新', visibility: 'INTERNAL'});
  assert.equal(edited.ok, true, edited.error);
  assert.equal(JSON.stringify(app.context.Database.find('PROJECTS', 'P2')), otherBefore);
  assert.equal(app.sentEmails.length, 0, 'editing never sends mail');
});

/* ---------------------------------------------------------------- *
 * Gate 3: request import
 * ---------------------------------------------------------------- */

test('opening the request queue imports new inbox rows and is idempotent', () => {
  const {app} = managerWithInbox();
  const first = app.context.Ui.requests({});
  assert.equal(first.ok, true, first.error);
  assert.equal(first.data.imported.imported, 1);
  assert.equal(first.data.requests.length, 1);

  const second = app.context.Ui.requests({});
  assert.equal(second.ok, true, second.error);
  assert.equal(second.data.imported.imported, 0);
  assert.equal(second.data.imported.skipped, 1);
  assert.equal(app.context.Database.read('TASK_REQUESTS').length, 1, 'no duplicate request row');
  assert.equal(app.context.Database.find('TASKS', 'T1').Due_Date, '2026-12-15',
    'importing never changes a deadline');
});

test('a concurrent import collision is counted as skipped, not as a failure', () => {
  const {app} = managerWithInbox();
  const insert = app.context.Database.insert;
  let raced = false;
  app.context.Database.insert = function (table, values) {
    if (table === 'TASK_REQUESTS' && !raced) {
      raced = true;
      // The competing execution writes the same permanent request ID first.
      insert(table, Object.assign({}, values));
    }
    return insert(table, values);
  };
  try {
    const imported = app.context.Requests.importInbox('manager@example.test');
    assert.equal(imported.imported, 0);
    assert.equal(imported.skipped, 1);
  } finally {
    app.context.Database.insert = insert;
  }
  assert.equal(app.context.Database.read('TASK_REQUESTS').length, 1);
});

test('an unavailable inbox is reported and the stored queue stays readable', () => {
  const {app, sheet} = managerWithInbox();
  assert.equal(app.context.Ui.requests({}).ok, true);
  sheet.getRange(1, 1).setValue('BROKEN_ID');

  const broken = app.context.Ui.requests({});
  assert.equal(broken.ok, true, 'the sidebar still renders');
  assert.ok(broken.data.importError, 'the failure is reported');
  assert.equal(broken.data.requests.length, 1, 'the imported request is still listed');

  const manual = app.context.Ui.importRequests();
  assert.equal(manual.ok, true);
  assert.ok(manual.data.error, 'the manual import reports the failure instead of claiming success');
});

test('the queue can be opened without an import attempt when asked', () => {
  const {app} = managerWithInbox();
  const skipped = app.context.Ui.requests({import: false});
  assert.equal(skipped.ok, true, skipped.error);
  assert.equal(skipped.data.imported, null);
  assert.equal(app.context.Database.read('TASK_REQUESTS').length, 0);
});

/* ---------------------------------------------------------------- *
 * Gate 4 and 7: safety invariants that must survive this change
 * ---------------------------------------------------------------- */

test('notification switches stay off by default and no edit path sends mail', () => {
  const app = fixtures.base({actor: 'manager@example.test'});
  const status = app.context.Notifications.effectiveStatus();
  assert.equal(status.mode, 'OFF');
  app.context.Ui.updateProject({projectId: 'P1', summary: '更新'});
  app.context.Ui.assignTask({taskId: 'T1', taskName: '更新'});
  assert.equal(app.sentEmails.length, 0);
});

test('no login, password or browser write path was introduced', () => {
  const root = path.resolve(__dirname, '..');
  ['UiMenu', 'UiRequests', 'UiSettings', 'UiSystem'].forEach(name => {
    const html = fs.readFileSync(path.join(root, 'src', name + '.html'), 'utf8');
    assert.doesNotMatch(html, /type="password"/, name + ' must not collect a password');
    assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
      name + ' must render stored text through textContent');
  });
  const menu = fs.readFileSync(path.join(root, 'src', 'UiMenu.html'), 'utf8');
  assert.doesNotMatch(menu, /SpreadsheetApp\.|PropertiesService\./, 'the sidebar never touches the workbook directly');
});

test('the manager manifest keeps its existing scopes only', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/appsscript.json'), 'utf8'));
  const allowed = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/script.send_mail',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/script.container.ui', // existing sidebar scope in the baseline manifest
    'https://www.googleapis.com/auth/userinfo.email'
  ];
  (manifest.oauthScopes || []).forEach(scope => {
    assert.ok(allowed.indexOf(scope) >= 0, 'unexpected OAuth scope: ' + scope);
  });
});
