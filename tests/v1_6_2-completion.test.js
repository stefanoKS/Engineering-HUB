'use strict';
/**
 * V1.6.2 gate 2.3: the ADMIN completion override keeps durable audit evidence.
 *
 * The task write and its audit record cannot be atomic, so a preparation row is written first
 * and the final row carries the same Operation_ID. An interrupted override is detectable and
 * finalized once by an ADMIN; an incomplete correction is never reported as a success.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};

function app(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

function audits(instance, action) {
  return instance.context.Database.read('AUDIT_LOG').filter(row => String(row.Action) === action);
}

test('a preparation that cannot be written aborts the override before any mutation', () => {
  const instance = app();
  const internal = instance.context;
  const write = internal.AuditLog.write;
  internal.AuditLog.write = function (action) {
    if (action === 'COMPLETION_OVERRIDE_PREPARED') throw new Error('synthetic prepare failure');
    return write.apply(this, arguments);
  };
  assert.throws(() => internal.Completion.override('T2', '誤って完了にした', 'OVERRIDE COMPLETION'),
    /準備記録を書き込めないため中止/);
  internal.AuditLog.write = write;
  const task = internal.Database.find('TASKS', 'T2');
  assert.equal(task.Status, 'Assigned', 'the correction never happens without its evidence');
  assert.equal(audits(instance, 'COMPLETION_OVERRIDDEN').length, 0);
});

test('a failed finalization is reported and can be finalized once, without a second mutation', () => {
  const instance = app();
  const internal = instance.context;
  const write = internal.AuditLog.write;
  internal.AuditLog.write = function (action) {
    if (action === 'COMPLETION_OVERRIDDEN') throw new Error('synthetic finalize failure');
    return write.apply(this, arguments);
  };
  assert.throws(() => internal.Completion.override('T2', '誤って完了にした', 'OVERRIDE COMPLETION'),
    /reconcileCompletionOverrides/);
  internal.AuditLog.write = write;

  const task = internal.Database.find('TASKS', 'T2');
  assert.equal(task.Status, 'Done', 'the correction really happened');
  assert.equal(audits(instance, 'COMPLETION_OVERRIDDEN').length, 0, 'its audit record is missing');
  const completedAt = task.Completed_At;

  const preview = internal.previewCompletionOverrideReconciliation();
  assert.equal(preview.pending.length, 1, 'the gap is visible to an ADMIN');
  assert.equal(preview.pending[0].taskId, 'T2');
  assert.equal(preview.pending[0].previousStatus, 'Assigned');

  const reconciled = internal.reconcileCompletionOverrides('RECONCILE COMPLETIONS');
  assert.equal(reconciled.confirmed.length, 1);
  assert.equal(reconciled.pending, 1);
  assert.equal(audits(instance, 'COMPLETION_OVERRIDDEN').length, 1);
  assert.match(String(audits(instance, 'COMPLETION_OVERRIDDEN')[0].New_Value), /"reconciled":true/);
  assert.equal(internal.Database.find('TASKS', 'T2').Completed_At, completedAt, 'the task is not written again');
});

test('override reconciliation is idempotent and refuses a task that is not Done', () => {
  const instance = app();
  const internal = instance.context;
  const write = internal.AuditLog.write;
  internal.AuditLog.write = function (action) {
    if (action === 'COMPLETION_OVERRIDDEN') throw new Error('synthetic finalize failure');
    return write.apply(this, arguments);
  };
  assert.throws(() => internal.Completion.override('T2', '誤って完了にした', 'OVERRIDE COMPLETION'));
  internal.AuditLog.write = write;
  // A preparation whose mutation never landed: the task is still open.
  internal.AuditLog.write('COMPLETION_OVERRIDE_PREPARED', 'TASK', 'T1', {
    operationId: 'OP-NEVER-APPLIED', actor: 'admin@example.test', reason: '中断',
    previousStatus: 'In Progress', previousProgress: 25
  });

  // A preparation whose task is not Done is reported, never "confirmed".
  const first = internal.reconcileCompletionOverrides('RECONCILE COMPLETIONS');
  assert.equal(first.confirmed.length, 1);
  assert.equal(first.notDone.map(item => item.taskId).join(','), 'T1');
  const second = internal.reconcileCompletionOverrides('RECONCILE COMPLETIONS');
  assert.equal(second.pending, 1, 'only the unconfirmed preparation is still pending');
  assert.equal(second.confirmed.length, 0, 'a confirmation is never appended twice');
  assert.equal(audits(instance, 'COMPLETION_OVERRIDDEN').length, 1);
});

test('only an ADMIN can reconcile and the exact confirmation is required', () => {
  const instance = app('manager@example.test');
  const internal = instance.context;
  assert.throws(() => internal.reconcileCompletionOverrides('RECONCILE COMPLETIONS'), /ADMIN|Insufficient role/);
  instance.setActor('admin@example.test');
  assert.throws(() => internal.reconcileCompletionOverrides(''), /入力が必要/);
});

test('a legacy completion stays readable and is not turned into an audited correction', () => {
  const instance = app();
  const internal = instance.context;
  internal.Database.insert('TASKS', {
    Task_ID: 'T-LEGACY', Project_ID: 'P1', Task_Name: '過去の完了作業', Owner_Member_ID: 'M-ENG',
    Status: 'Done', Progress_Percent: 100, Completed_At: '2026-09-30T00:00:00.000Z'
  });
  const task = internal.Database.find('TASKS', 'T-LEGACY');
  assert.equal(internal.Completion.isLegacyCompletion(task), true);
  // The correction path is a no-op for an already completed row and adds no audit noise.
  internal.Completion.override('T-LEGACY', '確認のみ', 'OVERRIDE COMPLETION');
  assert.equal(audits(instance, 'COMPLETION_OVERRIDDEN').length, 0);
  assert.equal(audits(instance, 'COMPLETION_OVERRIDE_PREPARED').length, 0);
  assert.equal(internal.previewCompletionOverrideReconciliation().pending.length, 0);
});
