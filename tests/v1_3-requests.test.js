'use strict';

/**
 * V1.3 worker requests: submission, import, decision, staleness, completion reporting.
 *
 * The dashboard project and the manager project are loaded in separate mocked contexts so
 * the tests prove that the dashboard never reaches the private workbook.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');
const { loadDashboard, MockSpreadsheet } = require('./helpers');

const INBOX_ID = 'inbox-db';
const SNAPSHOT_ID = 'snapshot-db';
const INBOX_FIELDS = [
  'Request_ID', 'Request_Type', 'Task_ID', 'Project_ID', 'Requester_Name', 'Submitted_At',
  'Current_Due_Date', 'Requested_Due_Date', 'Reason', 'Explanation', 'Completion_Note',
  'Task_Revision', 'Snapshot_Version', 'Client_Token', 'Inbox_State'
].slice();

function scenario() {
  const manager = fixtures.base();
  manager.context.Database.update('PROJECTS', 'P1', { Dashboard_Visibility: 'INTERNAL' });
  const snapshot = dashboardFixtures.attachSnapshot(manager);
  manager.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + SNAPSHOT_ID);
  dashboardFixtures.enablePublication(manager);
  manager.context.publishSharedDashboard();

  const inbox = new MockSpreadsheet(INBOX_ID, { REQUESTS: [INBOX_FIELDS] });
  manager.spreadsheets.set(INBOX_ID, inbox);
  manager.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', INBOX_ID);

  const viewer = loadDashboard({
    spreadsheet: snapshot,
    properties: {
      SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: SNAPSHOT_ID,
      REQUEST_INBOX_SPREADSHEET_ID: INBOX_ID
    }
  });
  viewer.spreadsheets.set(INBOX_ID, inbox);
  return { manager, snapshot, inbox, viewer };
}

function submitDeadline(context, overrides) {
  return context.submitDeadlineRequest(Object.assign({
    projectId: 'P1',
    taskId: 'T1',
    requestedDate: '2026-12-22',
    reason: '技術的問題',
    explanation: '光学系の再評価が必要です。',
    requesterName: '設計 次郎',
    clientToken: 'token-' + Math.random().toString(36).slice(2)
  }, overrides || {}));
}

function submitCompletion(context, overrides) {
  return context.submitCompletionReport(Object.assign({
    projectId: 'P1',
    taskId: 'T1',
    note: '検査工程の立ち上げが完了しました。',
    reporterName: '設計 次郎',
    clientToken: 'token-' + Math.random().toString(36).slice(2)
  }, overrides || {}));
}

function importAll(manager) {
  return manager.context.Requests.importInbox('admin@example.test');
}

test('any internal viewer can request a change for a task they do not own', () => {
  const { manager, viewer } = scenario();
  assert.equal(viewer.context.DashboardRequests.enabled(), true);
  viewer.setActor('viewer@example.test');
  const result = submitDeadline(viewer.context);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.match(result.data.requestId, /^REQ-/);
  assert.equal(result.data.status, 'RECEIVED');

  const imported = importAll(manager);
  assert.equal(imported.imported, 1);
  const request = manager.context.Database.read('TASK_REQUESTS')[0];
  assert.equal(request.Task_ID, 'T1');
  assert.equal(request.Request_Type, 'DEADLINE_CHANGE');
  assert.equal(request.Status, 'PENDING');
  assert.equal(request.Requester_Name, '設計 次郎');
  assert.equal(request.Original_Due_Date, '2026-12-15');
  assert.equal(request.Requested_Due_Date, '2026-12-22');
  // The verified owner is still the task owner; the requester is only self-reported text.
  assert.equal(manager.context.Database.find('TASKS', 'T1').Owner_Member_ID, 'M-ENG');
});

test('restricted and unknown tasks cannot receive a request', () => {
  const { viewer } = scenario();
  const restricted = submitDeadline(viewer.context, { taskId: 'T3', projectId: 'P2' });
  assert.equal(restricted.ok, false);
  assert.equal(restricted.error.code, 'REQUEST_UNKNOWN_TASK');
  const unknown = submitDeadline(viewer.context, { taskId: 'T-NOPE' });
  assert.equal(unknown.error.code, 'REQUEST_UNKNOWN_TASK');
});

test('invalid input is refused before anything is written', () => {
  const { inbox, viewer } = scenario();
  const context = viewer.context;
  assert.equal(submitDeadline(context, { requestedDate: '2026-12-15' }).error.code, 'REQUEST_DATE_UNCHANGED');
  assert.equal(submitDeadline(context, { requestedDate: '15/12/2026' }).error.code, 'REQUEST_INVALID_DATE');
  assert.equal(submitDeadline(context, { reason: '自由記述' }).error.code, 'REQUEST_REASON_INVALID');
  assert.equal(submitDeadline(context, { requesterName: '' }).error.code, 'REQUEST_REQUESTER_REQUIRED');
  assert.equal(submitDeadline(context, { extra: 'x' }).error.code, 'REQUEST_UNEXPECTED_FIELDS');
  assert.equal(submitDeadline(context, { explanation: 'あ'.repeat(1200) }).error.code, 'REQUEST_TOO_LONG');
  const rows = inbox.getSheetByName('REQUESTS').getDataRange().getValues();
  assert.equal(rows.length, 1, 'only the header row may exist');
});

test('duplicate submissions are bounded and a retry returns the original request ID', () => {
  const { viewer } = scenario();
  const first = submitDeadline(viewer.context, { clientToken: 'token-dup' });
  assert.equal(first.ok, true);
  const retry = submitDeadline(viewer.context, { clientToken: 'token-dup' });
  assert.equal(retry.ok, true);
  assert.equal(retry.data.requestId, first.data.requestId);
  assert.equal(retry.data.duplicate, true);
  const other = submitDeadline(viewer.context, { clientToken: 'token-other' });
  assert.equal(other.ok, false);
  assert.equal(other.error.code, 'REQUEST_DUPLICATE');
});

test('submissions are rate limited per browser token', () => {
  const { viewer } = scenario();
  for (let index = 0; index < 5; index++) {
    const result = submitDeadline(viewer.context, {
      clientToken: 'token-rate', requestedDate: '2026-12-' + (20 + index)
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
  }
  const limited = submitDeadline(viewer.context, { clientToken: 'token-rate', requestedDate: '2026-12-28' });
  assert.equal(limited.ok, false);
  assert.equal(limited.error.code, 'REQUEST_RATE_LIMITED');
});

test('an approved request moves the deadline once and records its history', () => {
  const { manager, viewer, inbox } = scenario();
  const submitted = submitDeadline(viewer.context);
  importAll(manager);
  const result = manager.context.Requests.decide(submitted.data.requestId, 'APPROVE', '確認済み', 'DECIDE REQUEST');
  assert.equal(result.status, 'APPROVED');

  const task = manager.context.Database.find('TASKS', 'T1');
  assert.equal(task.Due_Date, '2026-12-22');
  assert.ok(Number(task.Assignment_Version) > 1, 'the assignment version is bumped');
  assert.equal(task.Assignment_Approved_At, '');
  assert.equal(manager.context.Database.find('PROJECTS', 'P1').Committed_Deadline, '2026-12-31');

  const history = manager.context.Requests.history('T1');
  assert.equal(history.length, 1);
  assert.equal(history[0].previousDeadline, '2026-12-15');
  assert.equal(history[0].newDeadline, '2026-12-22');
  assert.equal(history[0].changedBy, 'admin@example.test');
  assert.equal(manager.context.Database.read('TASK_DEADLINE_HISTORY').length, 1);

  const audit = manager.context.Database.read('AUDIT_LOG').filter(row => row.Action === 'REQUEST_DECIDED');
  assert.equal(audit.length, 1);

  // The worker receipt follows the decision.
  const rows = inbox.getSheetByName('REQUESTS').getDataRange().getValues();
  const header = rows[0];
  assert.equal(rows[1][header.indexOf('Inbox_State')], 'APPROVED');

  assert.throws(() => manager.context.Requests.decide(submitted.data.requestId, 'APPROVE', '', 'DECIDE REQUEST'),
    /already decided/);
  assert.equal(manager.context.Database.find('TASKS', 'T1').Due_Date, '2026-12-22');
  assert.equal(manager.context.Database.read('TASK_DEADLINE_HISTORY').length, 1);
});

test('a decision requires the explicit confirmation and a manager role', () => {
  const { manager, viewer } = scenario();
  const submitted = submitDeadline(viewer.context);
  importAll(manager);
  assert.throws(() => manager.context.Requests.decide(submitted.data.requestId, 'APPROVE', '', ''),
    /confirmation/);
  manager.setActor('viewer@example.test');
  assert.throws(() => manager.context.Requests.decide(submitted.data.requestId, 'APPROVE', '', 'DECIDE REQUEST'),
    /Insufficient role/);
  assert.equal(manager.context.Database.find('TASKS', 'T1').Due_Date, '2026-12-15');
});

test('rejection and return never change the deadline', () => {
  const { manager, viewer } = scenario();
  const rejected = submitDeadline(viewer.context, { requestedDate: '2026-12-30' });
  importAll(manager);
  assert.equal(manager.context.Requests.decide(rejected.data.requestId, 'REJECT', '根拠不足', 'DECIDE REQUEST').status,
    'REJECTED');
  assert.equal(manager.context.Database.find('TASKS', 'T1').Due_Date, '2026-12-15');

  const returned = submitDeadline(viewer.context, { requestedDate: '2026-12-28' });
  importAll(manager);
  assert.equal(manager.context.Requests.decide(returned.data.requestId, 'RETURN', '再提出してください', 'DECIDE REQUEST').status,
    'RETURNED');
  assert.equal(manager.context.Database.find('TASKS', 'T1').Due_Date, '2026-12-15');
  assert.equal(manager.context.Database.read('TASK_DEADLINE_HISTORY').length, 0);
});

test('a request submitted before a newer change becomes STALE and cannot overwrite it', () => {
  const { manager, viewer } = scenario();
  const submitted = submitDeadline(viewer.context, { requestedDate: '2026-12-22' });
  // The manager changes the deadline after the submission but before the decision.
  manager.context.Tasks.update('T1', { Due_Date: '2026-12-19' });
  importAll(manager);
  const result = manager.context.Requests.decide(submitted.data.requestId, 'APPROVE', '', 'DECIDE REQUEST');
  assert.equal(result.status, 'STALE');
  assert.equal(manager.context.Database.find('TASKS', 'T1').Due_Date, '2026-12-19');
  assert.equal(manager.context.Database.read('TASK_DEADLINE_HISTORY').length, 0);
  assert.equal(manager.context.Database.find('TASK_REQUESTS', submitted.data.requestId).Status, 'STALE');
});

test('an interrupted decision is finalised without applying the change twice', () => {
  const { manager, viewer } = scenario();
  const submitted = submitDeadline(viewer.context, { requestedDate: '2026-12-22' });
  importAll(manager);
  // Simulate a crash after the task update but before the request status write.
  manager.context.Database.update('TASK_REQUESTS', submitted.data.requestId, { Status: 'PROCESSING' });
  manager.context.Tasks.update('T1', { Due_Date: '2026-12-22' });
  const result = manager.context.Requests.decide(submitted.data.requestId, 'APPROVE', '', 'DECIDE REQUEST');
  assert.equal(result.status, 'APPROVED');
  assert.equal(manager.context.Database.read('TASK_DEADLINE_HISTORY').length, 1);
  assert.equal(manager.context.Database.read('TASK_DEADLINE_HISTORY')[0].Previous_Due_Date, '2026-12-15');
});

test('a completion report only completes the task after manager approval', () => {
  const { manager, viewer } = scenario();
  const submitted = submitCompletion(viewer.context);
  assert.equal(submitted.ok, true, JSON.stringify(submitted.error));
  assert.equal(manager.context.Database.find('TASKS', 'T1').Status, 'In Progress');

  importAll(manager);
  const stored = manager.context.Database.find('TASK_REQUESTS', submitted.data.requestId);
  assert.equal(stored.Request_Type, 'COMPLETION_REPORT');
  assert.ok(stored.Reported_Completion_At, 'the worker-reported time is stored');
  assert.equal(manager.context.Database.find('TASKS', 'T1').Status, 'In Progress');

  const result = manager.context.Requests.decide(submitted.data.requestId, 'APPROVE', '確認しました', 'DECIDE REQUEST');
  assert.equal(result.status, 'APPROVED');
  const task = manager.context.Database.find('TASKS', 'T1');
  assert.equal(task.Status, 'Done');
  assert.equal(Number(task.Progress_Percent), 100);
  const accepted = manager.context.Database.find('TASK_REQUESTS', submitted.data.requestId);
  assert.ok(accepted.Accepted_Completion_At);
  assert.notEqual(String(accepted.Accepted_Completion_At), String(accepted.Reported_Completion_At));
  assert.equal(manager.context.Database.read('TASK_DEADLINE_HISTORY').length, 0);
});

test('a rejected completion report leaves the task open', () => {
  const { manager, viewer } = scenario();
  const submitted = submitCompletion(viewer.context);
  importAll(manager);
  manager.context.Requests.decide(submitted.data.requestId, 'REJECT', '未完了の作業があります', 'DECIDE REQUEST');
  assert.equal(manager.context.Database.find('TASKS', 'T1').Status, 'In Progress');
  assert.notEqual(Number(manager.context.Database.find('TASKS', 'T1').Progress_Percent), 100);
});

test('importing twice never duplicates a request and mail stays off by default', () => {
  const { manager, viewer } = scenario();
  submitDeadline(viewer.context);
  assert.equal(importAll(manager).imported, 1);
  const second = importAll(manager);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 1);
  assert.equal(manager.context.Database.read('TASK_REQUESTS').length, 1);
  assert.equal(manager.sentEmails.length, 0, 'request notifications are OFF by default');
});

test('the request inbox can be initialised only once and never with existing content', () => {
  const { manager, inbox } = scenario();
  inbox.sheets = [];
  const result = manager.context.initializeRequestInbox('INITIALIZE REQUEST INBOX');
  assert.equal(result.initialized, true);
  assert.deepEqual(Array.from(inbox.getSheetByName('REQUESTS').rows[0]), INBOX_FIELDS);
  assert.throws(() => manager.context.initializeRequestInbox('INITIALIZE REQUEST INBOX'), /already contains/);
  assert.throws(() => manager.context.initializeRequestInbox('wrong'), /confirmation/);
});

test('the dashboard project only appends to the inbox it is configured with', () => {
  const { manager, viewer } = scenario();
  // Point the dashboard at the private workbook: it must refuse to write there.
  viewer.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', INBOX_ID);
  manager.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', '');
  assert.throws(() => manager.context.Requests.initializeInbox('INITIALIZE REQUEST INBOX'),
    /not configured/);
  const submitted = submitDeadline(viewer.context);
  assert.equal(submitted.ok, true);
  assert.equal(manager.book.getSheetByName('REQUESTS'), null, 'the private workbook has no request sheet');
});

test('a pending request never changes the published or authoritative deadline', () => {
  const { manager, viewer } = scenario();
  submitDeadline(viewer.context, { requestedDate: '2026-12-29' });
  importAll(manager);
  assert.equal(manager.context.Database.find('TASKS', 'T1').Due_Date, '2026-12-15');
  const published = viewer.context.dashboardTask('P1', 'T1');
  assert.equal(published.ok, true);
  assert.equal(published.data.task.dueDate, '2026-12-15');
});
