'use strict';

/**
 * V1.3.1 manager sidebar wiring: visibility and summary controls, project/task edit modes,
 * partial patches, staleness refusal, double-submission protection, language switching and
 * the automatic request import.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');
const { createMenu, template, scriptOf } = require('./support/menu-harness');
const { MockSpreadsheet } = require('./helpers');

const INBOX_ID = 'inbox-v131';
const INBOX_FIELDS = [
  'Request_ID', 'Request_Type', 'Task_ID', 'Project_ID', 'Requester_Name', 'Submitted_At',
  'Current_Due_Date', 'Requested_Due_Date', 'Reason', 'Explanation', 'Completion_Note',
  'Task_Revision', 'Snapshot_Version', 'Client_Token', 'Inbox_State'
];

function managerWithInbox() {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const inbox = new MockSpreadsheet(INBOX_ID, { REQUESTS: [INBOX_FIELDS] });
  app.spreadsheets.set(INBOX_ID, inbox);
  app.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', INBOX_ID);
  return { app, inbox };
}

function addInboxRow(inbox, row) {
  inbox.getSheetByName('REQUESTS').getRange(2, 1, 1, INBOX_FIELDS.length).setValues([row]);
}

test('the create form defaults to hidden and sends the chosen visibility and summary', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const menu = createMenu(app);

  assert.equal(menu.value('projectVisibility'), 'RESTRICTED', 'a new project is hidden by default');
  assert.equal(menu.value('projectStatus'), 'Planned');
  assert.deepEqual(menu.options('projectVisibility').map(option => option.value), ['RESTRICTED', 'INTERNAL']);
  assert.deepEqual(menu.options('projectPick').map(option => option.label)[0], '新規作成');

  menu.set('projectName', '新規検査ライン');
  menu.set('projectCategory', '検査');
  menu.set('projectVisibility', 'INTERNAL');
  menu.set('projectSummary', '外観検査装置の立ち上げ');
  menu.set('projectDescription', '社内のみの詳細');
  menu.context.saveProject();

  const project = app.context.Database.read('PROJECTS').filter(row => row.Project_Name === '新規検査ライン')[0];
  assert.ok(project, 'the project is created');
  assert.equal(project.Dashboard_Visibility, 'INTERNAL');
  assert.equal(project.Dashboard_Summary, '外観検査装置の立ち上げ');
  assert.equal(project.Description, '社内のみの詳細');
  assert.equal(project.Project_Owner_ID, 'M-MGR', 'the verified manager becomes the owner by default');
  assert.equal(menu.element('visibilityNote').hidden, false, 'the snapshot delay note is shown');
  assert.match(menu.texts('status'), /完了|完了しました|done/i);
});

test('a rejected save keeps every entered value and shows the error', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const menu = createMenu(app);
  const before = app.context.Database.read('PROJECTS').length;

  menu.set('projectName', '');
  menu.set('projectCategory', '機構');
  menu.context.saveProject();

  assert.equal(app.context.Database.read('PROJECTS').length, before, 'nothing was written');
  assert.equal(menu.value('projectCategory'), '機構', 'the form is not reset before a successful save');
  assert.equal(menu.status().className, 'error');
  assert.match(menu.texts('status'), /プロジェクト名/);
});

test('editing a project loads its values and keeps the immutable identity', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const menu = createMenu(app);

  menu.set('projectPick', 'P1');
  menu.context.loadProject();
  assert.equal(menu.value('projectName'), '検査装置');
  assert.equal(menu.value('projectOwner'), 'M-MGR');
  assert.equal(menu.value('projectVisibility'), 'RESTRICTED');
  assert.equal(menu.element('projectSubmit').textContent, '保存');

  menu.set('projectSummary', '一次試作を完了しました');
  menu.set('projectVisibility', 'INTERNAL');
  menu.context.saveProject();

  const update = menu.calls.filter(call => call.fn === 'uiUpdateProject').pop();
  assert.ok(update, 'the edit uses Projects.update through the authorized adapter');
  assert.equal(update.payload.projectId, 'P1');
  assert.equal(update.payload.ownerId, 'M-MGR', 'the loaded owner is part of the payload');
  assert.equal(update.payload.deadline, '2026-12-31');

  const project = app.context.Database.find('PROJECTS', 'P1');
  assert.equal(project.Project_ID, 'P1', 'the project identity does not change');
  assert.equal(project.Dashboard_Summary, '一次試作を完了しました');
  assert.equal(project.Dashboard_Visibility, 'INTERNAL');
  assert.equal(project.Project_Owner_ID, 'M-MGR');
  assert.equal(project.Committed_Deadline, '2026-12-31');
  assert.equal(app.context.Database.read('PROJECTS').filter(row => row.Project_Name === '検査装置').length, 1,
    'an edit never recreates the project');
  assert.ok(app.context.Database.read('AUDIT_LOG').some(row => row.Action === 'UI_PROJECT_UPDATED'));
});

test('an edit refused as stale keeps the typed text and asks for a reload', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const menu = createMenu(app);

  menu.set('projectPick', 'P1');
  menu.context.loadProject();
  // Another manager saves first.
  app.context.Projects.update('P1', {Project_Name: '検査装置（改）'});

  menu.set('projectSummary', '入力中の概要');
  menu.context.saveProject();

  assert.equal(menu.value('projectSummary'), '入力中の概要', 'typed text survives the refusal');
  assert.equal(menu.status().className, 'error');
  assert.match(menu.texts('status'), /再読み込み/);
  assert.equal(app.context.Database.find('PROJECTS', 'P1').Dashboard_Summary, '');
});

test('editing a task preserves the fields the manager did not touch', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const menu = createMenu(app);

  menu.set('taskPick', 'T1');
  menu.context.loadTask();
  assert.equal(menu.value('taskName'), '機構設計');
  assert.equal(menu.value('taskDuration'), '');
  assert.equal(menu.texts('taskProgressNote'), '現在の進捗: 25%（進行中）');
  assert.equal(menu.element('taskSubmit').textContent, '保存');

  menu.set('taskName', '機構設計（改訂）');
  menu.context.assignTask();

  const task = app.context.Database.find('TASKS', 'T1');
  assert.equal(task.Task_Name, '機構設計（改訂）');
  assert.equal(task.Owner_Member_ID, 'M-ENG');
  assert.equal(task.Due_Date, '2026-12-15');
  assert.equal(task.Planned_Start, '2026-11-01');
  assert.equal(task.Estimated_Hours, 40);
  assert.equal(task.Actual_Hours, 8);
  assert.equal(task.Progress_Percent, 25);
  assert.equal(task.Notification_Enabled, true);
});

test('changing the duration on an existing task recalculates the derived start', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const menu = createMenu(app);

  menu.set('taskPick', 'T2');
  menu.context.loadTask();
  menu.set('taskDeadline', '2026-11-20');
  menu.set('taskDuration', '1');
  menu.set('taskUnit', 'WEEK');
  menu.set('taskBasis', 'WORKING_DAYS');
  menu.context.assignTask();

  const task = app.context.Database.find('TASKS', 'T2');
  assert.equal(task.Planned_Start, '2026-11-16');
  assert.equal(task.Planned_Start_Source, 'DERIVED');
  assert.equal(task.Planned_Duration_Unit, 'WEEK');
  assert.equal(task.Estimated_Hours, '', 'the duration never becomes an effort estimate');
});

test('a double click submits one task only', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const menu = createMenu(app, { defer: true });
  menu.flush(); // initial uiContext

  const before = app.context.Database.read('TASKS').length;
  menu.set('taskProject', 'P1');
  menu.set('taskName', '二重送信の確認');
  menu.set('taskOwner', 'M-ENG');
  menu.context.assignTask();
  menu.context.assignTask();

  assert.equal(menu.answered(), 1, 'the second click is ignored while the first save is running');
  menu.flush();
  menu.flush();
  assert.equal(app.context.Database.read('TASKS').length, before + 1);
  assert.equal(menu.element('taskSubmit').disabled, false, 'the button is usable again afterwards');
});

test('editing a project without a selectable owner keeps the stored owner', () => {
  const app = fixtures.base();
  const created = app.context.Ui.createProject({name: '担当者が無効化された案件', ownerId: 'M-MGR'});
  assert.equal(created.ok, true, created.error);
  // The owner is deactivated later, so the edit form can no longer list them.
  app.context.Database.update('MEMBERS', 'M-MGR', {Active: false});

  const menu = createMenu(app);
  menu.set('projectPick', created.data.Project_ID);
  menu.context.loadProject();
  menu.set('projectOwner', '');
  menu.set('projectSummary', '責任者は保持したまま概要を更新');
  menu.context.saveProject();

  const update = menu.calls.filter(call => call.fn === 'uiUpdateProject').pop();
  assert.ok(update, 'the edit still saves');
  assert.equal(Object.prototype.hasOwnProperty.call(update.payload, 'ownerId'), false,
    'an unselectable owner is not sent as a blank value');
  const project = app.context.Database.find('PROJECTS', created.data.Project_ID);
  assert.equal(project.Project_Owner_ID, 'M-MGR', 'the stored owner is preserved');
  assert.equal(project.Dashboard_Summary, '責任者は保持したまま概要を更新');
});

test('switching language keeps typed text and translates generated labels', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const menu = createMenu(app);

  menu.set('projectName', '試作ライン');
  menu.set('projectSummary', '社内メモ');
  menu.set('projectVisibility', 'INTERNAL');
  menu.context.EHLang.set('en', function () {
    const kept = menu.context.captureForms();
    menu.context.render(menu.context.context);
    menu.context.applyForms(kept);
  });

  assert.equal(menu.value('projectName'), '試作ライン', 'stored text is never translated or rewritten');
  assert.equal(menu.value('projectSummary'), '社内メモ');
  assert.equal(menu.value('projectVisibility'), 'INTERNAL');
  assert.equal(menu.options('projectPick')[0].label, 'Create a new project');
  assert.equal(menu.options('taskPick')[0].label, 'Create a new task');
  assert.equal(menu.element('projectSubmit').textContent, 'Create');
});

test('the request queue imports automatically and reports the import', () => {
  const { app, inbox } = managerWithInbox();
  addInboxRow(inbox, [
    'REQ-AUTO-1', 'DEADLINE_CHANGE', 'T1', 'P1', '設計 次郎', new Date().toISOString(),
    '2026-12-15', '2026-12-22', '技術的問題', '再評価が必要です。', '', '', '1', 'token-auto', 'RECEIVED'
  ]);

  const page = createMenu(app, { template: 'UiRequests' });
  assert.equal(app.context.Database.read('TASK_REQUESTS').length, 1, 'opening the queue imports the inbox');
  assert.match(page.texts('importNote'), /1 件を取り込みました/);
  assert.match(page.texts('summary'), /承認待ち 1 件/);
});

test('a failing inbox import never hides the requests already imported', () => {
  const { app, inbox } = managerWithInbox();
  addInboxRow(inbox, [
    'REQ-KEEP-1', 'DEADLINE_CHANGE', 'T1', 'P1', '設計 次郎', new Date().toISOString(),
    '2026-12-15', '2026-12-22', '技術的問題', '', '', '', '1', 'token-keep', 'RECEIVED'
  ]);
  assert.equal(app.context.Requests.importInbox('manager@example.test').imported, 1);

  // Break the inbox header so the next import fails closed.
  const sheet = inbox.getSheetByName('REQUESTS');
  sheet.getRange(1, 1).setValue('BROKEN_ID');

  const page = createMenu(app, { template: 'UiRequests' });
  assert.match(page.texts('importNote'), /取り込めませんでした/);
  assert.match(page.texts('summary'), /承認待ち 1 件/, 'the stored request is still listed');
  assert.equal(app.context.Database.read('TASK_REQUESTS').length, 1);
});

test('the sidebars reference only script functions that exist on the server', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const files = ['UiMenu', 'UiRequests', 'UiSettings', 'UiSystem'];
  const referenced = new Set();
  files.forEach(name => {
    const script = scriptOf(template(name));
    Array.from(script.matchAll(/call\('([A-Za-z0-9_]+)'/g)).forEach(match => referenced.add(match[1]));
  });
  assert.ok(referenced.size > 5);
  referenced.forEach(name => {
    assert.equal(typeof app.context[name], 'function', name + ' must be a server bridge');
  });
});

test('every onclick handler in the manager sidebar is defined in the template', () => {
  const html = template('UiMenu');
  const handlers = new Set(Array.from(html.matchAll(/onclick="([A-Za-z0-9_]+)\(\)"/g)).map(match => match[1]));
  assert.ok(handlers.size >= 5);
  const script = scriptOf(html);
  handlers.forEach(handler => {
    assert.ok(new RegExp('function ' + handler + '\\(\\s*\\)').test(script), handler + ' must be defined');
  });
});

test('the manager sidebar keeps a single control per action', () => {
  const html = template('UiMenu');
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g)).map(match => match[1]);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), [], 'element ids must be unique');
  ['projectPick', 'projectVisibility', 'projectSummary', 'taskPick', 'taskSubmit', 'visibilityNote']
    .forEach(id => assert.ok(ids.indexOf(id) >= 0, id + ' must exist once'));
  assert.equal((html.match(/id="projectSubmit"/g) || []).length, 1);
});

test('the trial documentation describes the visibility and edit workflow', () => {
  const checklist = fs.readFileSync(path.resolve(__dirname, '../docs/PRE_TRIAL_CHECKLIST.md'), 'utf8');
  assert.match(checklist, /Dashboard_Visibility/);
  assert.match(checklist, /INTERNAL/);
  assert.match(checklist, /REQUEST_SUBMISSION_ENABLED/);
});
