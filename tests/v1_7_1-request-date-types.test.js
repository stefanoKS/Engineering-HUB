'use strict';

/**
 * V1.7.1 regression: `TASK_REQUESTS.Due_Date_At_Submission` must be validated as a date.
 *
 * Google Sheets materializes a date cell as a JavaScript `Date`. `Database.update` re-validates
 * the *whole* stored row, so a text-typed field holding a `Date` made every decision that
 * rewrites the request row fail with `Invalid text: Due_Date_At_Submission` — approval,
 * rejection, return and the recovery paths all write `Status`. The tests below place a real
 * `Date` in the sheet cell (exactly what Sheets returns) and then drive the real decision
 * engine, so the failure mode cannot come back unnoticed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const DECIDE = 'DECIDE REQUEST';

function app() {
  return fixtures.base({ properties: { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' } });
}

/** Writes a value straight into a sheet cell, bypassing application validation. */
function storeCell(app, table, idName, id, column, value) {
  const sheet = app.book.getSheetByName(table);
  const headers = sheet.rows[0];
  const idColumn = headers.indexOf(idName);
  const target = headers.indexOf(column);
  assert.ok(idColumn >= 0, idName + ' must be a column');
  assert.ok(target >= 0, column + ' must be a column');
  const index = sheet.rows.findIndex((row, position) => position > 0 && String(row[idColumn]) === String(id));
  assert.ok(index > 0, table + ' row not found: ' + id);
  sheet.rows[index][target] = value;
  return index;
}

function pendingCompletion(a, requestId, taskId) {
  const c = a.context, task = c.Database.find('TASKS', taskId || 'T1');
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: requestId, Request_Type: 'COMPLETION_REPORT', Task_ID: task.Task_ID,
    Project_ID: task.Project_ID, Requester_Name: '設計 次郎',
    Submitted_At: '2026-10-01T00:00:00.000Z', Reported_Completion_At: '2026-10-01T00:00:00.000Z',
    Due_Date_At_Submission: c.Domain.date(task.Due_Date), Status: 'PENDING',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(task)
  });
  return requestId;
}

function pendingDeadline(a, requestId, taskId) {
  const c = a.context, task = c.Database.find('TASKS', taskId || 'T1');
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: requestId, Request_Type: 'DEADLINE_CHANGE', Task_ID: task.Task_ID,
    Project_ID: task.Project_ID, Requester_Name: '設計 次郎',
    Submitted_At: '2026-10-01T00:00:00.000Z', Status: 'PENDING',
    Original_Due_Date: c.Domain.date(task.Due_Date),
    Due_Date_At_Submission: c.Domain.date(task.Due_Date),
    Requested_Due_Date: '2026-12-22', Reason: '技術的問題',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(task)
  });
  return requestId;
}

/** Simulates Google Sheets returning the date cell as a Date object. */
function sheetDate(app, requestId) {
  return storeCell(app, 'TASK_REQUESTS', 'Request_ID', requestId, 'Due_Date_At_Submission',
    new Date('2026-12-15T00:00:00.000Z'));
}

function auditActions(c, requestId) {
  return c.Database.read('AUDIT_LOG')
    .filter(row => String(row.Entity_Type) === 'TASK_REQUEST' && String(row.Entity_ID) === String(requestId))
    .map(row => String(row.Action));
}

function count(c, requestId, action) {
  return auditActions(c, requestId).filter(value => value === action).length;
}

/* ------------------------------------------------------------------ *
 * 1. The schema contract
 * ------------------------------------------------------------------ */

test('TASK_REQUESTS types every date as a date and keeps the revision digest as text', () => {
  const c = app().context;
  const fields = Object.create(null);
  c.Schema.tables.TASK_REQUESTS.fields.forEach(field => { fields[field.name] = field.type; });
  assert.deepEqual(JSON.parse(JSON.stringify(fields)), {
    Request_ID: 'string',
    Request_Type: 'string',
    Task_ID: 'string',
    Project_ID: 'string',
    Requester_Name: 'string',
    Submitted_At: 'datetime',
    Original_Due_Date: 'date',
    Requested_Due_Date: 'date',
    Reason: 'string',
    Explanation: 'string',
    Completion_Note: 'string',
    Status: 'string',
    Reviewer: 'string',
    Decided_At: 'datetime',
    Decision_Note: 'string',
    Task_Revision_At_Submission: 'string',
    Due_Date_At_Submission: 'date',
    Reported_Completion_At: 'datetime',
    Accepted_Completion_At: 'datetime',
    Inbox_Request_ID: 'string',
    Imported_At: 'datetime',
    Snapshot_Version: 'string'
  });
  assert.equal(fields.Task_Revision_At_Submission, 'string',
    'the revision is an opaque digest and must never be validated as a date');
});

test('a Date in the deadline cell no longer blocks rewriting the request row', () => {
  const a = app(), c = a.context;
  const id = pendingCompletion(a, 'REQ-DATE-ROW');
  sheetDate(a, id);
  // This is exactly the operation every decision performs, and it used to throw
  // `Invalid text: Due_Date_At_Submission`.
  assert.doesNotThrow(() => c.Database.update('TASK_REQUESTS', id, {Decision_Note: '確認済み'}));
  assert.equal(c.Database.find('TASK_REQUESTS', id).Decision_Note, '確認済み');
});

test('every date-typed request cell survives being returned by Sheets as a Date object', () => {
  const a = app(), c = a.context;
  const id = pendingCompletion(a, 'REQ-ALL-DATES');
  // The audit of all TASK_REQUESTS fields: only the date/datetime ones may ever hold a Date, and
  // each of them must accept one without failing validation.
  ['Submitted_At', 'Original_Due_Date', 'Requested_Due_Date', 'Decided_At', 'Due_Date_At_Submission',
    'Reported_Completion_At', 'Accepted_Completion_At', 'Imported_At'].forEach(column => {
    storeCell(a, 'TASK_REQUESTS', 'Request_ID', id, column, new Date('2026-12-15T00:00:00.000Z'));
  });
  assert.doesNotThrow(() => c.Database.update('TASK_REQUESTS', id, {Reviewer: 'admin@example.test'}));
  assert.equal(c.Database.find('TASK_REQUESTS', id).Reviewer, 'admin@example.test');
});

/* ------------------------------------------------------------------ *
 * 2-5. Completion approval
 * ------------------------------------------------------------------ */

test('a completion approval works when the deadline cell is a Date and writes one clean journal', () => {
  const a = app(), c = a.context;
  const id = pendingCompletion(a, 'REQ-COMPLETE');
  sheetDate(a, id);

  const result = c.Requests.decide(id, 'APPROVE', '内容を確認しました', DECIDE);
  assert.equal(result.status, 'APPROVED');

  const task = c.Database.find('TASKS', 'T1');
  assert.equal(task.Status, 'Done');
  assert.equal(Number(task.Progress_Percent), 100);

  const request = c.Database.find('TASK_REQUESTS', id);
  assert.equal(request.Status, 'APPROVED');
  assert.equal(request.Reviewer, 'admin@example.test');
  assert.ok(request.Decided_At, 'the decision time is recorded');
  assert.ok(request.Accepted_Completion_At, 'the approved completion time is recorded');

  assert.deepEqual(JSON.parse(JSON.stringify(auditActions(c, id))),
    ['REQUEST_DECISION_PREPARED', 'REQUEST_EFFECT_APPLIED', 'REQUEST_DECIDED']);
});

/* ------------------------------------------------------------------ *
 * 6. Deadline-change approval
 * ------------------------------------------------------------------ */

test('a deadline-change approval works when the deadline cell is a Date and records the history once', () => {
  const a = app(), c = a.context;
  const id = pendingDeadline(a, 'REQ-DEADLINE');
  sheetDate(a, id);

  const result = c.Requests.decide(id, 'APPROVE', '客先合意済み', DECIDE);
  assert.equal(result.status, 'APPROVED');

  assert.equal(c.Domain.date(c.Database.find('TASKS', 'T1').Due_Date), '2026-12-22');
  const request = c.Database.find('TASK_REQUESTS', id);
  assert.equal(request.Status, 'APPROVED');
  assert.deepEqual(JSON.parse(JSON.stringify(auditActions(c, id))),
    ['REQUEST_DECISION_PREPARED', 'REQUEST_EFFECT_APPLIED', 'REQUEST_DECIDED']);

  const history = c.Database.read('TASK_DEADLINE_HISTORY').filter(row => row.Task_ID === 'T1');
  assert.equal(history.length, 1, 'the deadline history is written exactly once');
  assert.equal(c.Domain.date(history[0].New_Due_Date), '2026-12-22');
});

/* ------------------------------------------------------------------ *
 * 7. Reject and return
 * ------------------------------------------------------------------ */

test('reject and return work when the deadline cell is a Date and never touch the task', () => {
  const a = app(), c = a.context;
  const rejected = pendingCompletion(a, 'REQ-REJECT');
  const returned = pendingDeadline(a, 'REQ-RETURN');
  sheetDate(a, rejected);
  sheetDate(a, returned);
  const before = JSON.stringify(c.Database.find('TASKS', 'T1'));

  assert.equal(c.Requests.decide(rejected, 'REJECT', '証跡が不足しています', DECIDE).status, 'REJECTED');
  assert.equal(c.Requests.decide(returned, 'RETURN', '理由を追記してください', DECIDE).status, 'RETURNED');

  assert.equal(c.Database.find('TASK_REQUESTS', rejected).Status, 'REJECTED');
  assert.equal(c.Database.find('TASK_REQUESTS', returned).Status, 'RETURNED');
  assert.equal(c.Database.find('TASK_REQUESTS', rejected).Decision_Note, '証跡が不足しています');
  assert.equal(JSON.stringify(c.Database.find('TASKS', 'T1')), before, 'a refusal never mutates the task');
  assert.deepEqual(JSON.parse(JSON.stringify(auditActions(c, rejected))),
    ['REQUEST_DECISION_PREPARED', 'REQUEST_DECIDED']);
  assert.deepEqual(JSON.parse(JSON.stringify(auditActions(c, returned))),
    ['REQUEST_DECISION_PREPARED', 'REQUEST_DECIDED']);
});

/* ------------------------------------------------------------------ *
 * 8. No duplicate effect or decision
 * ------------------------------------------------------------------ */

test('a repeated decision with a Date cell applies no second effect and writes no second decision', () => {
  const a = app(), c = a.context;
  const completion = pendingCompletion(a, 'REQ-ONCE');
  const deadline = pendingDeadline(a, 'REQ-ONCE-DEADLINE');
  sheetDate(a, completion);
  sheetDate(a, deadline);

  c.Requests.decide(completion, 'APPROVE', '承認', DECIDE);
  assert.throws(() => c.Requests.decide(completion, 'APPROVE', '承認', DECIDE), /already decided/);
  assert.equal(count(c, completion, 'REQUEST_DECIDED'), 1);
  assert.equal(count(c, completion, 'REQUEST_EFFECT_APPLIED'), 1);
  assert.equal(c.Database.read('TASK_DEADLINE_HISTORY').filter(row => row.Request_ID === completion).length, 0);

  c.Requests.decide(deadline, 'APPROVE', '承認', DECIDE);
  assert.throws(() => c.Requests.decide(deadline, 'APPROVE', '承認', DECIDE), /already decided/);
  assert.equal(count(c, deadline, 'REQUEST_DECIDED'), 1);
  assert.equal(count(c, deadline, 'REQUEST_EFFECT_APPLIED'), 1);
  assert.equal(c.Database.read('TASK_DEADLINE_HISTORY').filter(row => row.Request_ID === deadline).length, 1,
    'one approval writes one history row');
});

/* ------------------------------------------------------------------ *
 * 9-10. Text and blank dates stay valid
 * ------------------------------------------------------------------ */

test('a yyyy-MM-dd text value keeps working for the same field', () => {
  const a = app(), c = a.context;
  const id = pendingCompletion(a, 'REQ-TEXT-DATE');
  const stored = c.Database.find('TASK_REQUESTS', id).Due_Date_At_Submission;
  assert.equal(stored, '2026-12-15', 'the imported value is the plain calendar text');
  assert.equal(c.Requests.decide(id, 'APPROVE', '承認', DECIDE).status, 'APPROVED');
  assert.equal(c.Database.find('TASKS', 'T1').Status, 'Done');
});

test('blank optional dates remain valid', () => {
  const a = app(), c = a.context;
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: 'REQ-BLANK', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T2', Project_ID: 'P1',
    Requester_Name: '設計 次郎', Submitted_At: '2026-10-01T00:00:00.000Z', Status: 'PENDING',
    Due_Date_At_Submission: '', Reported_Completion_At: '',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(c.Database.find('TASKS', 'T2'))
  });
  const result = c.Requests.decide('REQ-BLANK', 'APPROVE', '承認', DECIDE);
  assert.equal(result.status, 'APPROVED');
  assert.equal(c.Database.find('TASKS', 'T2').Status, 'Done');
});

/* ------------------------------------------------------------------ *
 * 11. The revision digest and staleness protection
 * ------------------------------------------------------------------ */

test('the revision digest stays text and staleness protection still refuses a changed task', () => {
  const a = app(), c = a.context;
  const id = pendingCompletion(a, 'REQ-STALE');
  sheetDate(a, id);
  assert.equal(typeof c.Database.find('TASK_REQUESTS', id).Task_Revision_At_Submission, 'string');

  // A material assignment change moves the revision after the worker submitted the report.
  c.Tasks.update('T1', { Owner_Member_ID: 'M-MGR' });

  const result = c.Requests.decide(id, 'APPROVE', '承認', DECIDE);
  assert.equal(result.status, 'STALE');
  assert.equal(result.reason, 'Task changed after submission');
  assert.equal(c.Database.find('TASK_REQUESTS', id).Status, 'STALE');
  assert.notEqual(c.Database.find('TASKS', 'T1').Status, 'Done', 'a stale request never completes the task');
  assert.equal(count(c, id, 'REQUEST_DECIDED'), 0);
  assert.equal(count(c, id, 'REQUEST_EFFECT_APPLIED'), 0);
});

test('the stale decision itself works when the deadline cell is a Date', () => {
  const a = app(), c = a.context;
  const id = pendingDeadline(a, 'REQ-STALE-DATE');
  sheetDate(a, id);
  c.Tasks.update('T1', { Due_Date: '2026-12-30' });

  const result = c.Requests.decide(id, 'APPROVE', '承認', DECIDE);
  assert.equal(result.status, 'STALE');
  assert.equal(c.Domain.date(c.Database.find('TASKS', 'T1').Due_Date), '2026-12-30',
    'the newer deadline is never overwritten');
  assert.equal(c.Database.read('TASK_DEADLINE_HISTORY').filter(row => row.Request_ID === id).length, 0);
});
