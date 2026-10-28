'use strict';
/**
 * V1.6.2 gate 1 and gate 2: request-specific approval integrity, date handling and audit
 * finalization.
 *
 * A task that happens to hold the requested end state no longer proves that *this* request was
 * applied. Only the request-specific journal in `AUDIT_LOG` may attest an application, an
 * ambiguous attempt stays reviewable, and a failed finalization is repaired instead of being
 * repeated.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const {MockSpreadsheet} = require('./helpers');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};
const INBOX_ID = 'inbox-v162';

function app(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

/** Completion report for a leaf task, captured exactly like the inbox import would. */
function completionRequest(instance, taskId, id, overrides) {
  const task = instance.context.Database.find('TASKS', taskId);
  instance.context.Database.insert('TASK_REQUESTS', Object.assign({
    Request_ID: id,
    Request_Type: 'COMPLETION_REPORT',
    Task_ID: taskId,
    Project_ID: task.Project_ID,
    Requester_Name: '自己申告 太郎',
    Submitted_At: '2026-10-20T01:00:00.000Z',
    Completion_Note: '完了しました。',
    Status: 'PENDING',
    Task_Revision_At_Submission: instance.context.SharedDashboardModel.revision(task),
    Due_Date_At_Submission: instance.context.Domain.date(task.Due_Date),
    Reported_Completion_At: '2026-10-20T01:00:00.000Z'
  }, overrides || {}));
  return id;
}

/** Deadline change request for a task, captured at submission time. */
function deadlineRequest(instance, taskId, id, requested, overrides) {
  const task = instance.context.Database.find('TASKS', taskId);
  const current = instance.context.Domain.date(task.Due_Date);
  instance.context.Database.insert('TASK_REQUESTS', Object.assign({
    Request_ID: id,
    Request_Type: 'DEADLINE_CHANGE',
    Task_ID: taskId,
    Project_ID: task.Project_ID,
    Requester_Name: '設計 次郎',
    Submitted_At: '2026-10-20T01:00:00.000Z',
    Original_Due_Date: current,
    Due_Date_At_Submission: current,
    Requested_Due_Date: requested,
    Reason: '技術的問題',
    Status: 'PENDING',
    Task_Revision_At_Submission: instance.context.SharedDashboardModel.revision(task)
  }, overrides || {}));
  return id;
}

function decide(instance, requestId, action, note) {
  return instance.context.Requests.decide(requestId, action || 'APPROVE', note || '', 'DECIDE REQUEST');
}

function audits(instance, action) {
  return instance.context.Database.read('AUDIT_LOG').filter(row => String(row.Action) === action);
}

/** Builds an inbox sheet with the strict header contract plus the supplied rows. */
function inboxWith(instance, rows) {
  const fields = instance.context.Requests.INBOX_FIELDS.slice();
  const book = new MockSpreadsheet(INBOX_ID, {REQUESTS: [fields].concat(rows || [])});
  instance.spreadsheets.set(INBOX_ID, book);
  instance.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', INBOX_ID);
  return book;
}

/** Writes a raw cell, simulating what Google Sheets returns for a date-formatted cell. */
function setCell(instance, table, id, field, value) {
  const sheet = instance.book.getSheetByName(table);
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const idColumn = header.indexOf(instance.context.Schema.tables[table].id);
  const index = values.findIndex((cells, row) => row > 0 && String(cells[idColumn]) === String(id));
  assert.ok(index > 0, 'row exists: ' + table + '/' + id);
  sheet.getRange(index + 1, header.indexOf(field) + 1).setValue(value);
}

/* ================================================================ *
 * GATE 1 — request-specific approval integrity
 * ================================================================ */

test('an ADMIN completion override is never attributed to an older employee report', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = completionRequest(instance, 'T2', 'REQ-OVERRIDE');

  // The task reached Done / 100 % through a different, audited operation. The revision does
  // not change, so V1.6.1 concluded that the employee request had been applied.
  internal.Completion.override('T2', '誤って完了にした', 'OVERRIDE COMPLETION');
  assert.equal(internal.Database.find('TASKS', 'T2').Status, 'Done');

  const result = decide(instance, requestId);
  assert.equal(result.status, 'STALE', 'the report cannot claim another operation');
  const request = internal.Database.find('TASK_REQUESTS', requestId);
  assert.equal(request.Status, 'STALE');
  assert.equal(request.Accepted_Completion_At, '', 'no employee completion is accepted');
  assert.equal(audits(instance, 'REQUEST_DECIDED').length, 0, 'no approval is recorded');
  assert.equal(audits(instance, 'REQUEST_EFFECT_APPLIED').length, 0);
  const stale = audits(instance, 'REQUEST_STALE');
  assert.equal(stale.length, 1);
  assert.match(String(stale[0].New_Value), /another operation/);
});

test('a deadline reached by another operation is never attributed to the request', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = deadlineRequest(instance, 'T1', 'REQ-DEADLINE', '2026-12-22');

  // An independent authorized change produces exactly the requested deadline.
  internal.Tasks.update('T1', {Due_Date: '2026-12-22'});

  const result = decide(instance, requestId);
  assert.equal(result.status, 'STALE');
  assert.equal(internal.Database.find('TASK_REQUESTS', requestId).Status, 'STALE');
  assert.equal(internal.Database.read('TASK_DEADLINE_HISTORY').length, 0,
    'no history row is fabricated for the other change');
  assert.equal(audits(instance, 'REQUEST_DECIDED').length, 0);
});

test('a changed task revision is never bypassed because the target value matches', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = deadlineRequest(instance, 'T1', 'REQ-REVISION', '2026-12-22');
  // Ownership changes after submission: the revision moves, the deadline does not.
  internal.Tasks.update('T1', {Owner_Member_ID: 'M-MGR'});

  const result = decide(instance, requestId);
  assert.equal(result.status, 'STALE');
  assert.equal(internal.Domain.date(internal.Database.find('TASKS', 'T1').Due_Date), '2026-12-15',
    'the task is not touched');
  assert.equal(internal.Database.read('TASK_DEADLINE_HISTORY').length, 0);
});

test('a request with recorded evidence resumes without applying its effect twice', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = deadlineRequest(instance, 'T1', 'REQ-RESUME', '2026-12-22');
  const task = internal.Database.find('TASKS', 'T1');
  // Interrupted between "effect written" and "decision recorded".
  internal.AuditLog.write(internal.Requests.PREPARED_ACTION, 'TASK_REQUEST', requestId, {
    type: 'DEADLINE_CHANGE', task: 'T1', action: 'APPROVED',
    revision: internal.SharedDashboardModel.revision(task)
  });
  internal.Tasks.update('T1', {Due_Date: '2026-12-22'});
  internal.AuditLog.write(internal.Requests.APPLIED_ACTION, 'TASK_REQUEST', requestId, {
    type: 'DEADLINE_CHANGE', task: 'T1', due: '2026-12-22'
  });
  internal.Database.update('TASK_REQUESTS', requestId, {Status: 'PROCESSING'});

  const resumed = decide(instance, requestId);
  assert.equal(resumed.status, 'APPROVED');
  assert.equal(internal.Database.read('TASK_DEADLINE_HISTORY').length, 1);
  assert.equal(internal.Database.read('TASK_DEADLINE_HISTORY')[0].Previous_Due_Date, '2026-12-15');
  assert.equal(audits(instance, 'REQUEST_EFFECT_APPLIED').length, 1, 'the effect is not applied again');
  const decided = audits(instance, 'REQUEST_DECIDED');
  assert.equal(decided.length, 1);
  assert.match(String(decided[0].New_Value), /"recovered":true/);
});

test('a matching task state without request evidence is never auto-approved', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = deadlineRequest(instance, 'T1', 'REQ-AMBIGUOUS', '2026-12-22');
  // A crash left the task updated and the request claimed, but no journal row ties them.
  internal.Database.update('TASK_REQUESTS', requestId, {Status: 'PROCESSING'});
  internal.Tasks.update('T1', {Due_Date: '2026-12-22'});

  assert.throws(() => decide(instance, requestId), /二重反映/);
  const request = internal.Database.find('TASK_REQUESTS', requestId);
  assert.equal(request.Status, 'PROCESSING', 'it stays reviewable, never APPROVED');
  assert.equal(request.Decided_At, '');
  assert.equal(audits(instance, 'REQUEST_DECIDED').length, 0);
  assert.equal(audits(instance, 'REQUEST_RECONCILE_REQUIRED').length, 1, 'the ambiguity is visible');
  assert.equal(internal.Database.read('TASK_DEADLINE_HISTORY').length, 0);

  const preview = internal.Requests.previewDecisionReconciliation();
  const item = preview.items.filter(entry => entry.requestId === requestId)[0];
  assert.equal(item.state, 'REVIEW_REQUIRED');
  assert.equal(item.effectPresent, true);
  assert.equal(item.safeToConfirm, true);

  const resolved = internal.Requests.resolveDecision(requestId, 'CONFIRM_APPLIED', '確認済み', 'RECONCILE REQUESTS');
  assert.equal(resolved.status, 'APPROVED');
  assert.equal(internal.Database.read('TASK_DEADLINE_HISTORY').length, 1, 'the history is attributed once');
  assert.equal(audits(instance, 'REQUEST_EFFECT_APPLIED').length, 1, 'the task is not written twice');
  assert.match(String(audits(instance, 'REQUEST_EFFECT_APPLIED')[0].New_Value), /"reconciled":true/);
});

test('a manual reconciliation refuses an effect the task does not show', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = deadlineRequest(instance, 'T1', 'REQ-NOT-APPLIED', '2026-12-22');
  internal.Database.update('TASK_REQUESTS', requestId, {Status: 'PROCESSING'});
  assert.throws(() => internal.Requests.resolveDecision(requestId, 'CONFIRM_APPLIED', '', 'RECONCILE REQUESTS'),
    /申請どおりの状態ではありません/);
  assert.equal(internal.Database.find('TASKS', 'T1').Due_Date, '2026-12-15');

  // The manager can instead record that the effect was never applied.
  const stale = internal.Requests.resolveDecision(requestId, 'MARK_STALE', '未反映を確認', 'RECONCILE REQUESTS');
  assert.equal(stale.status, 'STALE');
  assert.equal(internal.Database.find('TASKS', 'T1').Due_Date, '2026-12-15');
  assert.equal(audits(instance, 'REQUEST_DECIDED').length, 0, 'STALE is never an approval');
});

test('a terminal request is never decided again and writes no second audit', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = completionRequest(instance, 'T2', 'REQ-ONCE');
  assert.equal(decide(instance, requestId).status, 'APPROVED');

  const before = internal.Database.read('AUDIT_LOG').length;
  assert.throws(() => decide(instance, requestId), /already decided/);
  assert.equal(internal.Database.read('AUDIT_LOG').length, before, 'a retry writes nothing');
  assert.equal(audits(instance, 'REQUEST_DECIDED').length, 1);
  assert.equal(audits(instance, 'REQUEST_EFFECT_APPLIED').length, 1);
});

test('two managers cannot both approve the same request', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = deadlineRequest(instance, 'T1', 'REQ-RACE', '2026-12-22');
  assert.equal(decide(instance, requestId).status, 'APPROVED');
  instance.setActor('manager@example.test');
  assert.throws(() => decide(instance, requestId), /already decided/);
  assert.equal(internal.Database.read('TASK_DEADLINE_HISTORY').length, 1, 'one authoritative decision');
  assert.equal(audits(instance, 'REQUEST_DECIDED').length, 1);
});

test('a reassignment after submission stops an older report from approving newer work', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = completionRequest(instance, 'T2', 'REQ-REASSIGNED');
  internal.Tasks.update('T2', {Owner_Member_ID: 'M-MGR'});

  const result = decide(instance, requestId);
  assert.equal(result.status, 'STALE');
  const task = internal.Database.find('TASKS', 'T2');
  assert.equal(task.Status, 'Assigned', 'the other assignment is never completed');
  assert.equal(task.Owner_Member_ID, 'M-MGR');
});

test('a prepare record that cannot be written aborts before the task is touched', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = deadlineRequest(instance, 'T1', 'REQ-NO-PREPARE', '2026-12-22');
  const write = internal.AuditLog.write;
  internal.AuditLog.write = function (action) {
    if (action === 'REQUEST_DECISION_PREPARED') throw new Error('synthetic prepare failure');
    return write.apply(this, arguments);
  };
  assert.throws(() => decide(instance, requestId), /記録できないため中止/);
  internal.AuditLog.write = write;
  assert.equal(internal.Domain.date(internal.Database.find('TASKS', 'T1').Due_Date), '2026-12-15');
  assert.equal(internal.Database.find('TASK_REQUESTS', requestId).Status, 'PENDING',
    'an unabortable claim is never taken');
});

/* ================================================================ *
 * GATE 2.1 — date handling
 * ================================================================ */

test('normalize accepts every supported date shape and refuses invalid calendar dates', () => {
  const instance = app();
  const internal = instance.context;
  const day = (value, requested) => {
    const result = internal.Requests.normalize({
      Request_ID: 'REQ-DAY-' + Math.random().toString(36).slice(2),
      Request_Type: 'DEADLINE_CHANGE', Task_ID: 'T1',
      Current_Due_Date: value, Requested_Due_Date: requested === undefined ? '2026-12-22' : requested,
      Submitted_At: '2026-10-20T01:00:00.000Z'
    });
    return result;
  };
  // A real Date object: the V1.6.1 conversion turned this into an empty string.
  assert.equal(day(new Date('2026-12-15T15:00:00.000Z')).row.Original_Due_Date, '2026-12-16',
    'a Date is resolved in Asia/Tokyo, never at UTC midnight');
  assert.equal(day('2026-12-15').row.Original_Due_Date, '2026-12-15');
  assert.equal(day('2026-12-15T00:00:00.000Z').row.Original_Due_Date, '2026-12-15');
  assert.equal(day('').row.Original_Due_Date, '');
  assert.equal(day(null).row.Original_Due_Date, '');
  assert.equal(day(undefined).row.Original_Due_Date, '');
  assert.equal(day(new Date('not a date')).row.Original_Due_Date, '');
  assert.equal(day('2026-13-01').row.Original_Due_Date, '');
  assert.equal(day('15/12/2026').row.Original_Due_Date, '');
  // Leap years: a real 29 February is accepted, an impossible one is refused outright.
  assert.equal(day('', '2028-02-29').row.Requested_Due_Date, '2028-02-29');
  assert.equal(day('', '2027-02-29').skipped, true);
  assert.equal(day('', '2027-02-29').reason, 'INVALID_DATE');
});

test('a Date cell in the request inbox imports as the correct calendar day', () => {
  const instance = app();
  const internal = instance.context;
  const fields = internal.Requests.INBOX_FIELDS;
  const row = fields.map(() => '');
  const put = (name, value) => { row[fields.indexOf(name)] = value; };
  put('Request_ID', 'REQ-INBOX-DATE');
  put('Request_Type', 'DEADLINE_CHANGE');
  put('Task_ID', 'T1');
  put('Project_ID', 'P1');
  put('Submitted_At', '2026-10-20T01:00:00.000Z');
  put('Current_Due_Date', new Date('2026-12-15T15:00:00.000Z'));
  put('Requested_Due_Date', '2026-12-22');
  put('Reason', '技術的問題');
  put('Inbox_State', 'RECEIVED');
  inboxWith(instance, [row]);

  const imported = internal.Requests.importInbox('admin@example.test');
  assert.equal(imported.imported, 1, JSON.stringify(imported));
  const stored = internal.Database.find('TASK_REQUESTS', 'REQ-INBOX-DATE');
  assert.equal(stored.Original_Due_Date, '2026-12-16', 'the day is not lost and not shifted');
});

test('dates read from TASK_REQUESTS and TASK_DEADLINE_HISTORY stay readable', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = deadlineRequest(instance, 'T1', 'REQ-HISTORY-DATE', '2026-12-22');
  setCell(instance, 'TASKS', 'T1', 'Due_Date', new Date('2026-12-15T15:00:00.000Z'));

  const queued = internal.Requests.queue().filter(item => item.requestId === requestId)[0];
  assert.equal(queued.currentDeadline, '2026-12-16', 'a Date in TASKS is read as a date');

  internal.Tasks.update('T1', {Due_Date: '2026-12-22'});
  internal.Database.insert('TASK_DEADLINE_HISTORY', {
    History_ID: 'HIST-RAW-DATE', Task_ID: 'T1', Request_ID: requestId,
    Previous_Due_Date: '2026-12-15', New_Due_Date: '2026-12-22',
    Changed_At: '2026-10-21T00:00:00.000Z', Changed_By: 'admin@example.test', Source: 'REQUEST_APPROVED'
  });
  setCell(instance, 'TASK_DEADLINE_HISTORY', 'HIST-RAW-DATE', 'New_Due_Date', new Date('2026-12-22T15:00:00.000Z'));
  const history = internal.Requests.history('T1').filter(row => row.historyId === 'HIST-RAW-DATE')[0];
  assert.equal(history.newDeadline, '2026-12-23', 'a Date in the history is read as a date');
});

/* ================================================================ *
 * GATE 2.2 — approval audit finalization
 * ================================================================ */

test('a decision whose audit record fails is visible, recoverable and never repeated', () => {
  const instance = app();
  const internal = instance.context;
  const requestId = completionRequest(instance, 'T2', 'REQ-AUDIT-FAIL');
  const write = internal.AuditLog.write;
  internal.AuditLog.write = function (action) {
    if (action === 'REQUEST_DECIDED') throw new Error('synthetic audit failure');
    return write.apply(this, arguments);
  };
  assert.throws(() => decide(instance, requestId), /監査記録の確定に失敗/);
  internal.AuditLog.write = write;

  const task = internal.Database.find('TASKS', 'T2');
  const request = internal.Database.find('TASK_REQUESTS', requestId);
  assert.equal(task.Status, 'Done', 'the effect really was applied');
  assert.equal(request.Status, 'APPROVED', 'the request really was finalized');
  assert.equal(audits(instance, 'REQUEST_DECIDED').length, 0, 'but the audit record is missing');

  const completedAt = task.Completed_At;
  const version = task.Assignment_Version;
  const repaired = decide(instance, requestId);
  assert.equal(repaired.status, 'APPROVED');
  assert.equal(audits(instance, 'REQUEST_DECIDED').length, 1, 'the missing record is written exactly once');
  assert.equal(internal.Database.find('TASKS', 'T2').Completed_At, completedAt, 'the effect is not repeated');
  assert.equal(internal.Database.find('TASKS', 'T2').Assignment_Version, version);
  assert.equal(audits(instance, 'REQUEST_EFFECT_APPLIED').length, 1);

  // A further retry is refused: the record exists now.
  assert.throws(() => decide(instance, requestId), /already decided/);
  assert.equal(audits(instance, 'REQUEST_DECIDED').length, 1);
});
