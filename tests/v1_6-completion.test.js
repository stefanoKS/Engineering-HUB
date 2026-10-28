'use strict';
/**
 * V1.6 gate 6: employee completion reporting and manager approval.
 *
 * A worker report never marks a task Done. Only a manager decision on the completion report
 * (or an explicit ADMIN data correction with a reason and audit evidence) may write Done.
 * Five entrypoints used to allow a direct transition; every one of them now refuses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};

function app(actor = 'manager@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

/** Submits a completion report for a task, exactly as the request inbox import would. */
function reportCompletion(instance, taskId, options = {}) {
  const task = instance.context.Database.find('TASKS', taskId);
  instance.context.Database.insert('TASK_REQUESTS', {
    Request_ID: options.id || 'REQ-COMPLETE',
    Request_Type: 'COMPLETION_REPORT',
    Task_ID: taskId,
    Project_ID: task.Project_ID,
    Requester_Name: '自己申告 太郎',
    Submitted_At: options.submittedAt || '2026-10-20T01:00:00.000Z',
    Completion_Note: '検査が完了しました。',
    Status: 'PENDING',
    Task_Revision_At_Submission: options.revision === undefined
      ? instance.context.SharedDashboardModel.revision(task) : options.revision,
    Due_Date_At_Submission: task.Due_Date || '',
    Reported_Completion_At: '2026-10-20T01:00:00.000Z'
  });
  return options.id || 'REQ-COMPLETE';
}

test('a completion report does not mark the task done', () => {
  const instance = app('engineer@example.test');
  reportCompletion(instance, 'T2');
  const task = instance.context.Database.find('TASKS', 'T2');
  assert.equal(task.Status, 'Assigned');
  assert.notEqual(task.Progress_Percent, 100);
  assert.equal(instance.context.Completion.reviewState('T2'), 'PENDING', 'the review state is visible');
  assert.equal(instance.context.Completion.reviewState('T1'), '');
});

test('manager approval marks the task done and 100 % exactly once', () => {
  const instance = app('manager@example.test');
  const requestId = reportCompletion(instance, 'T2');
  const result = instance.context.Ui.decideRequest({
    requestId, action: 'APPROVE', note: '確認しました', confirmation: 'DECIDE REQUEST'
  });
  assert.equal(result.ok, true, result.error);
  const task = instance.context.Database.find('TASKS', 'T2');
  assert.equal(task.Status, 'Done');
  assert.equal(Number(task.Progress_Percent), 100);
  assert.ok(task.Completed_At, 'the completion timestamp is recorded once');
  assert.equal(instance.context.Completion.reviewState('T2'), '', 'the pending state is cleared');
  assert.equal(instance.context.Database.find('TASK_REQUESTS', requestId).Status, 'APPROVED');

  // Repeating the decision is refused instead of applying a second transition.
  const again = instance.context.Ui.decideRequest({
    requestId, action: 'APPROVE', note: '', confirmation: 'DECIDE REQUEST'
  });
  assert.equal(again.ok, false);
  assert.match(again.error, /already decided/i);
  assert.equal(instance.context.Database.find('TASKS', 'T2').Completed_At, task.Completed_At);
});

test('returning or rejecting a report never marks the task done', () => {
  for (const action of ['RETURN', 'REJECT']) {
    const instance = app('manager@example.test');
    const requestId = reportCompletion(instance, 'T2', {id: 'REQ-' + action});
    const result = instance.context.Ui.decideRequest({
      requestId, action, note: '再作業してください', confirmation: 'DECIDE REQUEST'
    });
    assert.equal(result.ok, true, result.error);
    const task = instance.context.Database.find('TASKS', 'T2');
    assert.equal(task.Status, 'Assigned', action + ' keeps the previous state');
    assert.equal(Number(task.Progress_Percent), 0);
    assert.equal(instance.context.Database.find('TASK_REQUESTS', requestId).Status,
      action === 'RETURN' ? 'RETURNED' : 'REJECTED');
  }
});

test('a stale report cannot overwrite a task that changed after submission', () => {
  const instance = app('manager@example.test');
  const requestId = reportCompletion(instance, 'T2', {id: 'REQ-STALE', revision: 'expired-revision'});
  const result = instance.context.Ui.decideRequest({
    requestId, action: 'APPROVE', note: '', confirmation: 'DECIDE REQUEST'
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.status, 'STALE');
  assert.equal(instance.context.Database.find('TASKS', 'T2').Status, 'Assigned');
});

test('every direct completion entrypoint is refused', () => {
  const instance = app('admin@example.test');
  const c = instance.context;
  assert.throws(() => c.Tasks.complete('T2'), /完了報告と管理者の承認/);
  assert.equal(c.Database.find('TASKS', 'T2').Status, 'Assigned');

  const progress = c.Ui.updateProgress({taskId: 'T2', progress: 100});
  assert.equal(progress.ok, false);
  assert.match(progress.error, /完了報告と管理者の承認/);

  const save = c.managerWebWrite('taskSave', {
    taskId: 'T2', revision: c.managerWebRead('task', {id: 'T2'}).data.record._revision, progress: 100
  });
  assert.equal(save.ok, false);
  assert.match(save.error, /承認/);

  assert.throws(() => c.updateTask('T2', {Status: 'Done', Progress_Percent: 100}), /完了報告と管理者の承認/);

  // A new task can never be created already complete.
  assert.throws(() => c.Tasks.create({Project_ID: 'P1', Task_Name: 'いきなり完了', Owner_Member_ID: 'M-ENG',
    Status: 'Done', Progress_Percent: 100}), /完了状態で作成/);
  assert.equal(c.Database.find('TASKS', 'T2').Status, 'Assigned');
});

test('a manager cannot report or approve a completion for themselves outside the request workflow', () => {
  const instance = app('manager@example.test');
  // There is no API that turns a caller-supplied approval flag into Done.
  const attempt = instance.context.managerWebWrite('taskSave', {
    taskId: 'T2',
    revision: instance.context.managerWebRead('task', {id: 'T2'}).data.record._revision,
    status: 'Done'
  });
  assert.equal(attempt.ok, false);
});

test('an ADMIN correction is explicit, reasoned and separately audited', () => {
  const instance = app('admin@example.test');
  const c = instance.context;
  assert.throws(() => c.Completion.override('T2', '誤って完了にした', 'WRONG'), /OVERRIDE COMPLETION/);
  assert.throws(() => c.Completion.override('T2', '', 'OVERRIDE COMPLETION'), /理由/);
  const updated = c.overrideTaskCompletion('T2', '誤って完了にした', 'OVERRIDE COMPLETION');
  assert.equal(updated.Status, 'Done');
  const audit = c.Database.read('AUDIT_LOG').filter(row => row.Action === 'COMPLETION_OVERRIDDEN');
  assert.equal(audit.length, 1, 'the correction keeps its own immutable evidence');
  assert.match(String(audit[0].New_Value), /誤って完了にした/);

  const manager = app('manager@example.test');
  assert.throws(() => manager.context.overrideTaskCompletion('T2', '理由', 'OVERRIDE COMPLETION'), /ADMIN/);
});

test('pre-existing completed records stay valid legacy data', () => {
  const instance = app('manager@example.test');
  const c = instance.context;
  c.Database.insert('TASKS', {Task_ID: 'T-LEGACY', Project_ID: 'P1', Task_Name: '旧完了', Owner_Member_ID: 'M-ENG',
    Status: 'Done', Progress_Percent: 100, Completed_At: '2025-04-01T00:00:00.000Z'});
  const legacy = c.Database.find('TASKS', 'T-LEGACY');
  assert.equal(c.Completion.isLegacyCompletion(legacy), true);
  // Editing an unrelated field of a legacy record is allowed and keeps its completion.
  const renamed = c.Tasks.update('T-LEGACY', {Task_Name: '旧完了（改名）'});
  assert.equal(renamed.Status, 'Done');
  assert.equal(renamed.Completed_At, '2025-04-01T00:00:00.000Z');
});

test('the published snapshot exposes the review state but never the report text', () => {
  const instance = app('admin@example.test');
  const snapshotFixtures = require('./dashboard-fixtures');
  instance.context.Database.update('PROJECTS', 'P1', {Dashboard_Visibility: 'INTERNAL'});
  reportCompletion(instance, 'T2');
  const snapshot = snapshotFixtures.attachSnapshot(instance);
  instance.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + snapshotFixtures.SNAPSHOT_ID);
  snapshotFixtures.enablePublication(instance);
  instance.context.publishSharedDashboard();
  const viewer = snapshotFixtures.dashboardFor(snapshot);
  const detail = viewer.context.dashboardProject('P1');
  assert.equal(detail.ok, true, detail.error);
  const task = detail.data.tasks.filter(row => row.taskId === 'T2')[0];
  assert.equal(task.reviewState, 'PENDING');
  assert.equal(task.reviewLabel, '承認待ち');
  const payload = JSON.stringify(detail.data);
  assert.doesNotMatch(payload, /検査が完了しました|自己申告/, 'request text is never published');
});
