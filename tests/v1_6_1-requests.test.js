'use strict';
/**
 * V1.6.1 gate 2: completion-workflow integrity.
 *
 * A container task derives its completion from its children, so a completion report for it can
 * never be approved. V1.6 accepted such a report, set it to PROCESSING and then failed inside
 * the task validation, leaving the request stuck. The refusal now happens before the claim,
 * and a failure while applying an approval is recorded and recoverable instead of silent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};

function app(actor = 'manager@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

/** A container task with one open child. */
function container(instance) {
  const c = instance.context;
  c.Tasks.create({
    Task_ID: 'T-BOX', Project_ID: 'P1', Task_Name: '装置一式', Owner_Member_ID: 'M-ENG',
    Status: 'In Progress', Due_Date: '2026-12-20'
  });
  c.Tasks.create({
    Task_ID: 'T-BOX1', Project_ID: 'P1', Parent_Task_ID: 'T-BOX', Task_Name: '子作業',
    Owner_Member_ID: 'M-ENG', Status: 'In Progress', Due_Date: '2026-12-10'
  });
  return 'T-BOX';
}

function completionReport(instance, taskId, requestId) {
  const task = instance.context.Database.find('TASKS', taskId);
  instance.context.Database.insert('TASK_REQUESTS', {
    Request_ID: requestId || 'REQ-BOX',
    Request_Type: 'COMPLETION_REPORT',
    Task_ID: taskId,
    Project_ID: task.Project_ID,
    Requester_Name: '自己申告 太郎',
    Submitted_At: '2026-10-20T01:00:00.000Z',
    Completion_Note: '終わりました。',
    Status: 'PENDING',
    Task_Revision_At_Submission: instance.context.SharedDashboardModel.revision(task),
    Due_Date_At_Submission: task.Due_Date || '',
    Reported_Completion_At: '2026-10-20T01:00:00.000Z'
  });
  return requestId || 'REQ-BOX';
}

test('a completion request for a container task is refused before it is claimed', () => {
  const instance = app();
  const parent = container(instance);
  const requestId = completionReport(instance, parent);

  const decided = instance.context.Ui.decideRequest({
    requestId, action: 'APPROVE', note: '確認しました', confirmation: 'DECIDE REQUEST'
  });
  assert.equal(decided.ok, false);
  assert.match(decided.error, /子タスク/);
  const request = instance.context.Database.find('TASK_REQUESTS', requestId);
  assert.equal(request.Status, 'PENDING', 'the request keeps a decidable state, never PROCESSING');
  const task = instance.context.Database.find('TASKS', parent);
  assert.notEqual(task.Status, 'Done', 'a container is never completed directly');
  assert.equal(task.Progress_Percent, 0);
});

test('a completion report for a container task is refused on inbox import', () => {
  const instance = app();
  const c = instance.context;
  const parent = container(instance);

  // The import path validates the same rule without a spreadsheet round trip.
  const normalized = c.Requests.normalize({
    Request_ID: 'REQ-INBOX', Request_Type: 'COMPLETION_REPORT', Task_ID: parent,
    Submitted_At: '2026-10-20T01:00:00.000Z'
  });
  assert.equal(normalized.skipped, true);
  assert.equal(normalized.reason, 'CONTAINER_TASK');
  const leaf = c.Requests.normalize({
    Request_ID: 'REQ-INBOX-2', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T-BOX1',
    Submitted_At: '2026-10-20T01:00:00.000Z'
  });
  assert.equal(leaf.skipped, false, 'a leaf task still accepts a report');
});

test('a deadline change on a container task is still allowed', () => {
  const instance = app();
  const parent = container(instance);
  const requestId = completionReport(instance, parent, 'REQ-BOX-DATE');
  instance.context.Database.update('TASK_REQUESTS', requestId, {
    Request_Type: 'DEADLINE_CHANGE', Original_Due_Date: '2026-12-20', Requested_Due_Date: '2026-12-27',
    Reason: '技術的問題'
  });
  const decided = instance.context.Ui.decideRequest({
    requestId, action: 'APPROVE', note: '', confirmation: 'DECIDE REQUEST'
  });
  assert.equal(decided.ok, true, decided.error);
  assert.equal(instance.context.Domain.date(instance.context.Database.find('TASKS', parent).Due_Date), '2026-12-27');
});

test('a failure while applying an approval is recorded and can be retried', () => {
  const instance = app();
  const c = instance.context;
  const requestId = completionReport(instance, 'T2', 'REQ-FAIL');

  const update = c.Tasks.update;
  let failures = 0;
  c.Tasks.update = function () {
    failures++;
    throw new Error('synthetic write failure');
  };
  const failed = c.Ui.decideRequest({requestId, action: 'APPROVE', note: '', confirmation: 'DECIDE REQUEST'});
  c.Tasks.update = update;

  assert.equal(failed.ok, false);
  assert.match(failed.error, /再試行/);
  assert.equal(failures, 1);
  const request = c.Database.find('TASK_REQUESTS', requestId);
  assert.equal(request.Status, 'PROCESSING', 'the claim is kept so a retry resumes safely');
  assert.match(String(request.Decision_Note), /再試行が必要です/);
  const audit = c.Database.read('AUDIT_LOG').filter(row => row.Action === 'REQUEST_APPROVAL_FAILED');
  assert.equal(audit.length, 1, 'the failure is durable evidence');
  assert.match(String(audit[0].Entity_ID), /REQ-FAIL/);

  // The retry applies the effect exactly once and finalizes the request.
  const retried = c.Ui.decideRequest({requestId, action: 'APPROVE', note: '', confirmation: 'DECIDE REQUEST'});
  assert.equal(retried.ok, true, retried.error);
  const task = c.Database.find('TASKS', 'T2');
  assert.equal(task.Status, 'Done');
  assert.equal(Number(task.Progress_Percent), 100);
  assert.equal(c.Database.find('TASK_REQUESTS', requestId).Status, 'APPROVED');
});

test('a resumed decision never applies the effect twice', () => {
  const instance = app();
  const c = instance.context;
  const requestId = completionReport(instance, 'T2', 'REQ-TWICE');
  assert.equal(c.Ui.decideRequest({requestId, action: 'APPROVE', note: '', confirmation: 'DECIDE REQUEST'}).ok, true);
  const completedAt = c.Database.find('TASKS', 'T2').Completed_At;
  // Simulate an interrupted run that had already applied the effect but not finalized.
  c.Database.update('TASK_REQUESTS', requestId, {Status: 'PROCESSING'});
  const resumed = c.Ui.decideRequest({requestId, action: 'APPROVE', note: '', confirmation: 'DECIDE REQUEST'});
  assert.equal(resumed.ok, true, resumed.error);
  assert.equal(c.Database.find('TASKS', 'T2').Completed_At, completedAt, 'the completion timestamp is unchanged');
  const history = c.Database.read('AUDIT_LOG').filter(row => row.Action === 'REQUEST_DECIDED');
  assert.equal(history.length, 2, 'one row per decision attempt, never a second effect');
});

test('a failed inbox mirror is recorded instead of being swallowed', () => {
  const instance = app();
  const c = instance.context;
  c.PropertiesService.getScriptProperties().setProperty('REQUEST_INBOX_SPREADSHEET_ID', 'inbox-id');
  const open = c.Requests.updateInboxState('REQ-MIRROR', 'APPROVED');
  assert.equal(open, false);
  const audit = c.Database.read('AUDIT_LOG').filter(row => row.Action === 'INBOX_MIRROR_FAILED');
  assert.equal(audit.length, 1, 'the manager can see that the receipt was not mirrored');
});
