'use strict';
/**
 * V1.6 gate 8: work by member, with an honest history.
 *
 * Attribution uses the immutable owner ID and the task ID. A typed requester name is never used
 * to claim that somebody worked on a task, and no event is invented when no record exists.
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

test('a member profile separates current work, previous work and recorded activity', () => {
  const instance = app();
  const data = profile(instance, 'M-ENG');
  assert.equal(data.member.id, 'M-ENG');
  assert.equal(data.member.name, '設計 次郎');
  const current = data.current.map(task => task.id).sort();
  assert.equal(current.join(','), 'T1,T2,T3');
  assert.equal(data.previous.length, 0, 'no completion is invented');
  assert.equal(data.activity.length, 0, 'no audit row exists yet');

  // A real edit writes a real audit row; the activity list is exactly that record.
  instance.context.Tasks.update('T2', {Next_Action: '仕様確認'});
  const after = profile(instance, 'M-ENG');
  assert.equal(after.activity.length, 1);
  assert.equal(after.activity[0].taskId, 'T2');
  assert.equal(after.activity[0].action, 'UPDATE');
  assert.equal(after.activity[0].source, 'AUDIT_LOG');
  assert.equal(after.activity[0].actor, 'admin@example.test', 'the recorded actor is the verified account');
});

test('approved completion appears in the previous work with its dates and acceptance', () => {
  const instance = app('manager@example.test');
  const c = instance.context;
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: 'REQ-DONE', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T2', Project_ID: 'P1',
    Requester_Name: 'だれか', Submitted_At: '2026-10-20T01:00:00.000Z', Status: 'PENDING',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(c.Database.find('TASKS', 'T2'))
  });
  const decided = c.Ui.decideRequest({requestId: 'REQ-DONE', action: 'APPROVE', note: '', confirmation: 'DECIDE REQUEST'});
  assert.equal(decided.ok, true, decided.error);
  const data = profile(instance, 'M-ENG');
  const completed = data.previous.filter(task => task.id === 'T2')[0];
  assert.ok(completed, 'the approved completion is previous work');
  assert.equal(completed.acceptance, 'APPROVED');
  assert.match(completed.completedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(completed.acceptedAt, 'the manager acceptance timestamp is shown');
  assert.equal(data.current.filter(task => task.id === 'T2').length, 0, 'it left the current work');
});

test('a self-reported requester name is never used to attribute work', () => {
  const instance = app('manager@example.test');
  const c = instance.context;
  // A report typed under somebody else's name must not create history for that member.
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: 'REQ-FAKE', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T2', Project_ID: 'P1',
    Requester_Name: '設計 次郎', Submitted_At: '2026-10-20T01:00:00.000Z', Status: 'PENDING',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(c.Database.find('TASKS', 'T2'))
  });
  const engineer = c.managerWebRead('member', {id: 'M-ENG'}).data;
  assert.equal(engineer.previous.length, 0, 'a pending report is not history');
  assert.equal(engineer.activity.length, 0, 'a typed name is not an activity record');
});

test('the member view is reachable from the member list without a page reload', () => {
  const {harness} = require('./support/manager-web-harness');
  const {fixture} = require('../scripts/manager-web-preview');
  const instance = fixture(4);
  const h = harness((write, op, payload) => write
    ? instance.context.managerWebWrite(op, payload)
    : instance.context.managerWebRead(op, payload));
  return Promise.resolve().then(() => {
    h.click('nav', 'メンバー');
    return new Promise(resolve => setTimeout(resolve, 20)).then(() => {
      assert.match(h.document.getElementById('content').textContent, /設計 次郎|管理 花子/);
    });
  });
});
