'use strict';
/**
 * V1.6.1 gate 4: member history survives reassignment.
 *
 * V1.6 selected a member's tasks by the current `Owner_Member_ID`, so work that moved to
 * another member disappeared from the member who did it. Ownership is now historical:
 * the append-only audit evidence is used as well, an explicit reassignment event is written,
 * and former assignments show the current owner instead of rewriting the past.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};

function app(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

function profile(instance, memberId) {
  const result = instance.context.managerWebRead('member', {id: memberId});
  assert.equal(result.ok, true, result.error);
  return result.data;
}

test('reassignment keeps the previous owner history and shows the new owner', () => {
  const instance = app();
  const c = instance.context;
  const task = c.Tasks.create({
    Task_ID: 'T-MOVE', Project_ID: 'P1', Task_Name: '引き継ぎ作業', Owner_Member_ID: 'M-ENG',
    Status: 'Assigned', Due_Date: '2026-12-20'
  });
  const before = profile(instance, 'M-ENG');
  assert.equal(before.current.filter(item => item.id === task.Task_ID).length, 1);

  c.Tasks.update(task.Task_ID, {Owner_Member_ID: 'M-MGR'});

  const previousOwner = profile(instance, 'M-ENG');
  const former = previousOwner.previous.filter(item => item.id === task.Task_ID)[0];
  assert.ok(former, 'the work does not vanish from the member who owned it');
  assert.equal(former.formerAssignment, true);
  assert.equal(former.currentOwnerId, 'M-MGR');
  assert.equal(former.currentOwner, '管理 花子');
  assert.equal(previousOwner.current.filter(item => item.id === task.Task_ID).length, 0);

  const newOwner = profile(instance, 'M-MGR');
  assert.equal(newOwner.current.filter(item => item.id === task.Task_ID).length, 1);
  assert.equal(newOwner.previous.filter(item => item.id === task.Task_ID).length, 0);
});

test('a reassignment writes an explicit audit event with both owners', () => {
  const instance = app();
  const c = instance.context;
  const task = c.Tasks.create({
    Task_ID: 'T-AUDIT', Project_ID: 'P1', Task_Name: '記録する作業', Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  c.Tasks.update(task.Task_ID, {Owner_Member_ID: 'M-VIEW'});
  const rows = c.Database.read('AUDIT_LOG').filter(row => row.Action === 'TASK_REASSIGNED');
  assert.equal(rows.length, 1);
  const detail = JSON.parse(String(rows[0].New_Value));
  assert.equal(detail.previousOwner, 'M-ENG');
  assert.equal(detail.newOwner, 'M-VIEW');
  assert.equal(String(rows[0].Entity_ID), 'T-AUDIT');
  assert.equal(String(rows[0].Actor), 'admin@example.test', 'the verified actor is recorded');

  // An unrelated edit is not a reassignment.
  c.Tasks.update(task.Task_ID, {Next_Action: '確認'});
  assert.equal(c.Database.read('AUDIT_LOG').filter(row => row.Action === 'TASK_REASSIGNED').length, 1);
});

test('completed work stays in the history after the task is reassigned', () => {
  const instance = app();
  const c = instance.context;
  fixtures.activate(instance);
  const task = c.Tasks.create({
    Task_ID: 'T-DONE', Project_ID: 'P1', Task_Name: '完了した作業', Owner_Member_ID: 'M-ENG',
    Status: 'Assigned', Due_Date: '2026-12-20'
  });
  fixtures.complete(instance, task.Task_ID);
  c.Tasks.update(task.Task_ID, {Owner_Member_ID: 'M-MGR'});

  const history = profile(instance, 'M-ENG');
  const completed = history.previous.filter(item => item.id === task.Task_ID)[0];
  assert.ok(completed, 'the completion stays attributed to the member who did it');
  assert.equal(completed.formerAssignment, true);
  assert.match(String(completed.completedAt), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(completed.acceptance, 'LEGACY', 'an approval without a request row is marked as legacy');
});

test('the profile states its limitation when no audit evidence exists', () => {
  const instance = app();
  const c = instance.context;
  // A row written outside the application carries no audit row at all.
  c.Database.insert('TASKS', {
    Task_ID: 'T-SILENT', Project_ID: 'P1', Task_Name: '記録なし作業', Owner_Member_ID: 'M-ENG',
    Status: 'Done', Progress_Percent: 100, Completed_At: '2026-10-01T00:00:00.000Z'
  });
  assert.equal(c.Database.read('AUDIT_LOG').length, 0, 'the seed wrote no audit row');
  const history = profile(instance, 'M-ENG');
  assert.equal(history.previous.filter(item => item.id === 'T-SILENT').length, 1,
    'the stored owner still qualifies as current work history');
  assert.equal(history.ownership.limitation, 'AUDIT_LOG_EMPTY', 'the gap is stated, not hidden');
  assert.equal(history.activity.length, 0, 'no activity is invented');
});

test('the member profile returns only allowlisted task fields', () => {
  const instance = app();
  const data = profile(instance, 'M-ENG');
  const serialized = JSON.stringify(data);
  assert.doesNotMatch(serialized, /Acceptance_Criteria|Description|Next_Action/);
  assert.equal(data.ownership.evidence, 'AUDIT_LOG');
});
