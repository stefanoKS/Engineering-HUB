'use strict';
/**
 * V1.6.1 gate 3: deletion and audit integrity.
 *
 * V1.6 removed the row first and then wrote the tombstone inside a try/catch that only logged,
 * so it could report success without any durable record. The order is now
 * preflight → backup → durable intent → row removal → tombstone, and an interrupted removal is
 * reported and recoverable. Cascading removal is not offered at all.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};

function app(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

function emptyTask(instance, id) {
  return instance.context.Tasks.create({
    Task_ID: id, Project_ID: 'P1', Task_Name: '誤登録', Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
}

function actions(instance, action) {
  return instance.context.Database.read('AUDIT_LOG').filter(row => row.Action === action);
}

test('a successful removal records the intent before the row and the record after it', () => {
  const instance = app();
  emptyTask(instance, 'T-GONE');
  const result = instance.context.deleteRecord('TASKS', 'T-GONE', {
    reason: '誤登録', confirmation: 'DELETE T-GONE'
  });
  assert.equal(result.deleted, true);
  assert.equal(result.finalized, true, 'success is reported only with a written record');
  assert.equal(instance.context.Database.find('TASKS', 'T-GONE'), null);
  const prepared = actions(instance, 'RECORD_DELETE_PREPARED');
  const deleted = actions(instance, 'RECORD_DELETED');
  assert.equal(prepared.length, 1);
  assert.equal(deleted.length, 1);
  assert.ok(JSON.parse(String(prepared[0].New_Value)).record, 'the intent keeps the removed row');
  assert.equal(instance.context.Deletion.pendingOperations().length, 0);
});

test('a removal is aborted when the durable intent cannot be written', () => {
  const instance = app();
  const c = instance.context;
  emptyTask(instance, 'T-KEEP');
  const write = c.AuditLog.write;
  c.AuditLog.write = function (action) {
    if (action === 'RECORD_DELETE_PREPARED') throw new Error('synthetic audit failure');
    return write.apply(null, arguments);
  };
  assert.throws(() => c.deleteRecord('TASKS', 'T-KEEP', {reason: '誤登録', confirmation: 'DELETE T-KEEP'}),
    /中止しました/);
  assert.ok(c.Database.find('TASKS', 'T-KEEP'), 'nothing is removed without a durable intent');
});

test('a failed tombstone is reported, keeps the ID reserved and can be reconciled', () => {
  const instance = app();
  const c = instance.context;
  emptyTask(instance, 'T-HALF');
  const write = c.AuditLog.write;
  c.AuditLog.write = function (action) {
    if (action === 'RECORD_DELETED') throw new Error('synthetic tombstone failure');
    return write.apply(null, arguments);
  };
  assert.throws(() => c.deleteRecord('TASKS', 'T-HALF', {reason: '誤登録', confirmation: 'DELETE T-HALF'}),
    /reconcileDeletions/);
  c.AuditLog.write = write;

  assert.equal(c.Database.find('TASKS', 'T-HALF'), null, 'the row really is gone');
  assert.equal(c.Deletion.isDeletedId('TASKS', 'T-HALF'), true, 'the prepared ID stays reserved');
  assert.throws(() => c.Deletion.assertFreshId('TASKS', 'T-HALF'), /再利用/);
  const pending = c.Deletion.pendingOperations();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'T-HALF');
  assert.ok(pending[0].backup, 'the reported intent keeps the backup reference');

  const reconciled = c.reconcileDeletions('RECONCILE DELETIONS');
  assert.equal(reconciled.failed.length, 0);
  assert.equal(reconciled.confirmed.length, 1);
  assert.equal(actions(instance, 'RECORD_DELETED').length, 1);
  assert.equal(c.Deletion.pendingOperations().length, 0);
  assert.equal(actions(instance, 'DELETION_RECONCILED').length, 1);

  // Repeating the recovery is harmless and appends nothing.
  const again = c.reconcileDeletions('RECONCILE DELETIONS');
  assert.equal(again.confirmed.length, 0);
  assert.equal(actions(instance, 'RECORD_DELETED').length, 1);
});

test('reconciliation never touches a row that still exists', () => {
  const instance = app();
  const c = instance.context;
  emptyTask(instance, 'T-STILL');
  // An intent without a removal, as an interrupted run before the deleteRow call.
  c.AuditLog.write('RECORD_DELETE_PREPARED', 'TASKS', 'T-STILL', {reason: '誤登録', backup: 'BK-1'});
  const result = c.reconcileDeletions('RECONCILE DELETIONS');
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.rowPresent.length, 1);
  assert.ok(c.Database.find('TASKS', 'T-STILL'), 'the existing row is never removed by recovery');
  assert.equal(actions(instance, 'RECORD_DELETED').length, 0);
});

test('reconciliation requires an administrator and the exact confirmation', () => {
  const instance = app('manager@example.test');
  assert.throws(() => instance.context.reconcileDeletions('RECONCILE DELETIONS'), /ADMIN/);
  const admin = app();
  assert.throws(() => admin.context.reconcileDeletions('reconcile'), /RECONCILE DELETIONS/);
  const web = admin.context.managerWebWrite('deletionReconcile', {confirmed: false, confirmation: 'RECONCILE DELETIONS'});
  assert.equal(web.ok, false, 'the browser must confirm explicitly');
});

test('nested work, confirmations and requests block a removal', () => {
  const instance = app();
  const c = instance.context;
  const parent = c.Tasks.create({
    Task_ID: 'T-PARENT', Project_ID: 'P1', Task_Name: '親', Owner_Member_ID: 'M-ENG', Status: 'In Progress'
  });
  c.Tasks.create({
    Task_ID: 'T-KID', Project_ID: 'P1', Parent_Task_ID: parent.Task_ID, Task_Name: '子',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  const summary = c.preflightRecordDeletion('TASKS', parent.Task_ID);
  assert.equal(summary.deletable, false);
  assert.equal(summary.blocking.some(item => item.field === 'Parent_Task_ID'), true, 'a nested child blocks');
  assert.throws(() => c.deleteRecord('TASKS', parent.Task_ID, {
    reason: '誤登録', confirmation: 'DELETE ' + parent.Task_ID
  }), /安全に削除できません/);

  const plain = c.Tasks.create({
    Task_ID: 'T-PLAIN', Project_ID: 'P1', Task_Name: '素の作業', Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  c.ScheduleConfirmations.confirm(plain, 'admin@example.test', 'manual');
  const blocked = c.preflightRecordDeletion('TASKS', plain.Task_ID);
  assert.equal(blocked.deletable, false, 'a confirmed schedule is operational history');
  assert.equal(blocked.blocking.some(item => item.table === 'SCHEDULE_CONFIRMATIONS'), true);

  const requested = c.Tasks.create({
    Task_ID: 'T-REQ', Project_ID: 'P1', Task_Name: '申請あり', Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: 'REQ-1', Request_Type: 'DEADLINE_CHANGE', Task_ID: requested.Task_ID, Project_ID: 'P1',
    Requester_Name: '自己申告', Submitted_At: '2026-10-20T01:00:00.000Z', Status: 'PENDING',
    Original_Due_Date: '', Requested_Due_Date: '2026-12-25', Reason: '技術的問題'
  });
  const withRequest = c.preflightRecordDeletion('TASKS', requested.Task_ID);
  assert.equal(withRequest.deletable, false);
  assert.equal(withRequest.blocking.some(item => item.table === 'TASK_REQUESTS'), true);
});

test('the project delete control is offered to administrators only', async () => {
  const {harness} = require('./support/manager-web-harness');
  const {fixture} = require('../scripts/manager-web-preview');
  async function detail(role) {
    const instance = fixture(4);
    const h = harness((write, op, payload) => {
      const result = write
        ? instance.context.managerWebWrite(op, payload)
        : instance.context.managerWebRead(op, payload);
      // The client gate is what is under test here; the server keeps its own ADMIN check.
      if (result && result.ok && result.data && result.data.actor) result.data.actor.role = role;
      return result;
    });
    h.click('nav', '案件');
    await new Promise(resolve => setTimeout(resolve, 20));
    const edit = h.nodes('content').filter(node => node.tagName === 'BUTTON' && node.textContent === '編集')[0];
    assert.ok(edit, 'a project card offers the edit control');
    edit.dispatchEvent('click', {});
    await new Promise(resolve => setTimeout(resolve, 20));
    return h.document.getElementById('content').textContent;
  }
  assert.match(await detail('ADMIN'), /完全削除（管理者）/);
  assert.doesNotMatch(await detail('MANAGER'), /完全削除（管理者）/);
});
