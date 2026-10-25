'use strict';

/**
 * V1.3 manager UI adapter: the sidebar only calls validated domain services with
 * server-side role checks, and the planning preview performs no write.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');
const { MockSpreadsheet } = require('./helpers');

const INBOX_ID = 'inbox-ui';
const INBOX_FIELDS = [
  'Request_ID', 'Request_Type', 'Task_ID', 'Project_ID', 'Requester_Name', 'Submitted_At',
  'Current_Due_Date', 'Requested_Due_Date', 'Reason', 'Explanation', 'Completion_Note',
  'Task_Revision', 'Snapshot_Version', 'Client_Token', 'Inbox_State'
].slice();

function managerWithInbox(actor) {
  const app = fixtures.base({ actor: actor || 'manager@example.test' });
  const inbox = new MockSpreadsheet(INBOX_ID, { REQUESTS: [INBOX_FIELDS] });
  app.spreadsheets.set(INBOX_ID, inbox);
  app.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', INBOX_ID);
  return { app, inbox };
}

test('the planning preview calculates a start and writes nothing', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const tasksBefore = JSON.stringify(app.context.Database.read('TASKS'));
  const preview = app.context.Ui.planPreview({
    projectId: 'P1', deadline: '2026-11-20', durationValue: '3',
    durationUnit: 'DAY', durationBasis: 'WORKING_DAYS'
  });
  assert.equal(preview.ok, true, preview.error);
  assert.equal(preview.data.startDate, '2026-11-18');
  assert.equal(preview.data.endDate, '2026-11-20');
  assert.deepEqual(Array.from(preview.data.warnings), []);
  assert.equal(JSON.stringify(app.context.Database.read('TASKS')), tasksBefore, 'the preview must not write');
});

test('the preview reports the warnings the manager has to read', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const weekend = app.context.Ui.planPreview({
    projectId: 'P1', deadline: '2026-11-21', durationValue: '2',
    durationUnit: 'DAY', durationBasis: 'WORKING_DAYS'
  });
  assert.equal(weekend.ok, true, weekend.error);
  assert.ok(Array.from(weekend.data.warnings).some(item => item.code === 'NON_WORKING_DEADLINE'));
  const missing = app.context.Ui.planPreview({ projectId: 'P1', deadline: '2026-11-21' });
  assert.ok(Array.from(missing.data.warnings).some(item => item.code === 'MISSING_DURATION'));
});

test('a manager can assign a task with a duration and the planned start is derived', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const assigned = app.context.Ui.assignTask({
    projectId: 'P1', taskName: '検査工程の立ち上げ', ownerId: 'M-ENG',
    deadline: '2026-11-20', durationValue: '1', durationUnit: 'WEEK', durationBasis: 'WORKING_DAYS'
  });
  assert.equal(assigned.ok, true, assigned.error);
  assert.equal(assigned.data.task.Planned_Start, '2026-11-16');
  assert.equal(assigned.data.task.Planned_Start_Source, 'DERIVED');
  assert.equal(assigned.data.task.Planned_Duration_Unit, 'WEEK');
  assert.equal(assigned.data.task.Estimated_Hours, '', 'duration never becomes an estimate');
  const audit = app.context.Database.read('AUDIT_LOG').filter(row => row.Action === 'UI_TASK_ASSIGNED');
  assert.equal(audit.length, 1);
  assert.match(audit[0].New_Value, /DERIVED/);
});

test('an invalid duration is refused before anything is written', () => {
  const app = fixtures.base({ actor: 'manager@example.test' });
  const count = app.context.Database.read('TASKS').length;
  const invalid = app.context.Ui.assignTask({
    projectId: 'P1', taskName: '不正な期間', ownerId: 'M-ENG',
    deadline: '2026-11-20', durationValue: '0', durationUnit: 'DAY', durationBasis: 'WORKING_DAYS'
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /必要期間/);
  assert.equal(app.context.Database.read('TASKS').length, count);
});

test('the request queue and decisions require a manager role', () => {
  const member = fixtures.base({ actor: 'engineer@example.test' });
  assert.equal(member.context.Ui.requests({}).ok, false);
  assert.equal(member.context.Ui.importRequests().ok, false);
  assert.equal(member.context.Ui.decideRequest({ requestId: 'REQ-X', action: 'APPROVE', confirmation: 'DECIDE REQUEST' }).ok, false);
  assert.match(member.context.Ui.requests({}).error, /Insufficient role: MANAGER/);
});

test('the manager sidebar imports, lists and decides a request through validated functions', () => {
  const { app, inbox } = managerWithInbox();
  const context = app.context;
  const sheet = inbox.getSheetByName('REQUESTS');
  sheet.getRange(2, 1, 1, INBOX_FIELDS.length).setValues([[
    'REQ-UI-1', 'DEADLINE_CHANGE', 'T1', 'P1', '設計 次郎', new Date().toISOString(),
    '2026-12-15', '2026-12-22', '技術的問題', '再評価が必要です。', '', '', '1', 'token-ui', 'RECEIVED'
  ]]);

  const imported = context.Ui.importRequests();
  assert.equal(imported.ok, true, imported.error);
  assert.equal(imported.data.imported, 1);

  const queue = context.Ui.requests({});
  assert.equal(queue.ok, true, queue.error);
  assert.equal(queue.data.configured, true);
  assert.equal(queue.data.requests.length, 1);
  assert.equal(queue.data.requests[0].requestId, 'REQ-UI-1');
  assert.equal(queue.data.requests[0].projectName, '検査装置');
  assert.equal(queue.data.requests[0].requesterName, '設計 次郎');

  const decided = context.Ui.decideRequest({
    requestId: 'REQ-UI-1', action: 'APPROVE', note: '確認しました', confirmation: 'DECIDE REQUEST'
  });
  assert.equal(decided.ok, true, decided.error);
  assert.equal(decided.data.status, 'APPROVED');
  assert.equal(context.Database.find('TASKS', 'T1').Due_Date, '2026-12-22');

  const after = context.Ui.requests({ includeDecided: true });
  assert.equal(after.data.requests[0].status, 'APPROVED');
  assert.equal(after.data.history.length, 1);
  assert.equal(app.sentEmails.length, 0, 'no mail is sent from the UI path');
});

test('sidebars never expose configuration secrets', () => {
  const html = ['src/UiMenu.html', 'src/UiRequests.html', 'src/UiSettings.html', 'src/UiSystem.html']
    .map(file => require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', file), 'utf8'))
    .join('\n');
  ['SPREADSHEET_ID', 'REQUEST_INBOX_SPREADSHEET_ID', 'SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID', 'CALENDAR_ID']
    .forEach(secret => {
      assert.equal(html.indexOf(secret) < 0, true, 'the sidebars must not reference ' + secret);
    });
});
