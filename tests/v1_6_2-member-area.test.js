'use strict';
/**
 * V1.6.2 gate 4: member history attribution and responsibility navigation.
 *
 * A member's profile used to present every event touching their work as if the member had done
 * it. Verified member actions are now separated from the task's change history. Selecting an
 * area no longer recomputes and reships the whole area snapshot, and the previous area's
 * figures are never shown under a newly selected area.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const {harness, flush} = require('./support/manager-web-harness');
const {fixture} = require('../scripts/manager-web-preview');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};

function app(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

function profile(instance, memberId) {
  const result = instance.context.managerWebRead('member', {id: memberId});
  assert.equal(result.ok, true, result.error);
  return result.data;
}

function clientOf(instance, options) {
  return harness((write, operation, payload) => write
    ? instance.context.managerWebWrite(operation, payload)
    : instance.context.managerWebRead(operation, payload), options || {});
}

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let index = 0; index < 40; index += 1) await tick(); }

test('a member edit is attributed to the verified member, not to the task', () => {
  const instance = app();
  instance.setActor('engineer@example.test');
  instance.context.Tasks.update('T2', {Next_Action: '仕様確認'});
  instance.setActor('admin@example.test');

  const data = profile(instance, 'M-ENG');
  assert.equal(data.memberActions.length, 1, 'the member acted on their own task');
  assert.equal(data.memberActions[0].taskId, 'T2');
  assert.equal(data.memberActions[0].attribution, 'MEMBER');
  assert.equal(data.memberActions[0].verified, true);
  assert.equal(data.taskHistory.length, 1);
  assert.equal(data.activity.length, 1, 'the documented alias still works');
});

test('a manager edit is task history, not a verified member action', () => {
  const instance = app('manager@example.test');
  instance.context.Tasks.update('T1', {Next_Action: '設計変更'});

  const data = profile(instance, 'M-ENG');
  assert.equal(data.memberActions.length, 0, 'the member did not perform this edit');
  assert.equal(data.taskHistory.length, 1, 'but it is part of the task history');
  assert.equal(data.taskHistory[0].attribution, 'OTHER');
  assert.equal(data.taskHistory[0].verified, false);
  assert.equal(data.taskHistory[0].actor, 'manager@example.test');
});

test('a reassignment stays in the previous owner history and is nobody’s verified action', () => {
  const instance = app('admin@example.test');
  const internal = instance.context;
  const task = internal.Tasks.create({
    Task_ID: 'T-HANDOVER', Project_ID: 'P1', Task_Name: '引き継ぎ作業', Owner_Member_ID: 'M-ENG',
    Status: 'Assigned', Due_Date: '2026-12-20'
  });
  internal.Tasks.update(task.Task_ID, {Owner_Member_ID: 'M-MGR'});

  const former = profile(instance, 'M-ENG');
  assert.equal(former.current.filter(item => item.id === 'T-HANDOVER').length, 0);
  assert.equal(former.previous.filter(item => item.id === 'T-HANDOVER').length, 1,
    'the work does not vanish from the member who owned it');
  assert.equal(former.memberActions.length, 0, 'an ADMIN reassignment is not the member’s action');
  assert.equal(former.taskHistory.filter(entry => entry.taskId === 'T-HANDOVER').length >= 1, true);

  const successor = profile(instance, 'M-MGR');
  assert.equal(successor.current.filter(item => item.id === 'T-HANDOVER').length, 1);
  assert.equal(successor.memberActions.length, 0, 'nor is it the new owner’s action');
});

test('an unverified actor is labelled instead of being attributed to the member', () => {
  const instance = app();
  const internal = instance.context;
  // An identity Google could not disclose: the actor is blank.
  internal.Database.insert('AUDIT_LOG', {
    Audit_ID: 'AUDIT-BLANK', Timestamp: '2026-10-22T00:00:00.000Z', Actor: '',
    Action: 'UPDATE', Entity_Type: 'TASKS', Entity_ID: 'T2', Previous_Value: '{}',
    New_Value: JSON.stringify({Task_ID: 'T2', Owner_Member_ID: 'M-ENG'}), Result: 'SUCCESS'
  });
  const data = profile(instance, 'M-ENG');
  assert.equal(data.taskHistory.length, 1);
  assert.equal(data.taskHistory[0].attribution, 'UNVERIFIED');
  assert.equal(data.taskHistory[0].verified, false);
  assert.equal(data.memberActions.length, 0, 'an unverified actor is never claimed as the member');
});

test('a scoped overview keeps the same KPIs without recomputing the area snapshot', () => {
  const instance = fixture(10);
  const internal = instance.context;
  const full = internal.managerWebRead('overview', {responsibilityId: 'R1'});
  const lean = internal.managerWebRead('overview', {responsibilityId: 'R1', areas: false});
  assert.equal(full.ok, true, full.error);
  assert.equal(lean.ok, true, lean.error);
  assert.ok(full.data.responsibilityCards, 'the default response still carries the area cards');
  assert.equal(lean.data.responsibilityCards, undefined, 'the snapshot copy is not recomputed');
  assert.equal(JSON.stringify(lean.data.kpis), JSON.stringify(full.data.kpis), 'the KPIs are identical');
  assert.equal(JSON.stringify(lean.data.counts), JSON.stringify(full.data.counts));
  assert.equal(JSON.stringify(lean.data.upcoming), JSON.stringify(full.data.upcoming));
  assert.ok(JSON.stringify(lean.data).length < JSON.stringify(full.data).length,
    'the area switch ships a smaller payload');
});

test('returning to a visited area is answered from the local cache', async () => {
  const instance = fixture(10);
  const h = clientOf(instance);
  await flush();
  const overviewCalls = () => h.calls.filter(call => call && call.operation === 'overview').length;
  const areaCard = name => h.nodes('content')
    .filter(node => node.tagName === 'BUTTON' && node.textContent.indexOf(name) === 0)[0];

  areaCard('製品設計').dispatchEvent('click', {});
  await flush();
  await flush();
  assert.equal(overviewCalls(), 1, 'the first visit resolves the scope on the server');
  const scoped = h.calls.filter(call => call && call.operation === 'overview')[0];
  assert.equal(scoped.payload.areas, false, 'the area snapshot is not requested again');
  assert.equal(h.window.ManagerWebClient.store.responsibilityCards.items.length, 2,
    'the snapshot still holds every area card');

  // Back to every area, then the same area again: no further read.
  h.nodes('content').filter(node => node.tagName === 'BUTTON' && node.textContent.indexOf('製品設計') === 0)
    .slice(-1)[0].dispatchEvent('click', {});
  await flush();
  await flush();
  assert.equal(overviewCalls(), 1, 'a revisited area is served from memory');
});

test('a first visit never shows the previous area numbers', async () => {
  const instance = fixture(10);
  const h = clientOf(instance, {manual: true});
  await tick();
  await tick();
  h.waiting.shift().success(instance.context.managerWebRead('bootstrap'));
  await settle();
  while (h.waiting.length) h.waiting.shift().success(instance.context.managerWebRead('taskIndex'));
  await settle();
  assert.equal(h.nodes('content').filter(node => node.className === 'kpi').length, 4,
    'the unscoped overview renders its KPIs from the snapshot');

  const card = h.nodes('content').filter(node => node.tagName === 'BUTTON' && node.textContent.indexOf('製品設計') === 0)[0];
  card.dispatchEvent('click', {});
  await tick();
  // While the authoritative payload is in flight, no number is shown at all.
  assert.equal(h.nodes('content').filter(node => node.className === 'kpi').length, 0,
    'an area KPI is never approximated');
  assert.match(h.document.getElementById('content').textContent, /集計を読み込んでいます/);
  assert.match(h.document.getElementById('nav').textContent, /製品設計/, 'the navigation stays usable');
});

test('an older area response never overwrites a newer selection', async () => {
  const instance = fixture(10);
  const h = clientOf(instance, {manual: true});
  await tick();
  await tick();
  h.waiting.shift().success(instance.context.managerWebRead('bootstrap'));
  await settle();
  while (h.waiting.length) h.waiting.shift().success(instance.context.managerWebRead('taskIndex'));
  await settle();

  const areaCard = name => h.nodes('content')
    .filter(node => node.tagName === 'BUTTON' && node.textContent.indexOf(name) === 0)[0];
  areaCard('製品設計').dispatchEvent('click', {});
  await tick();
  const first = h.waiting.shift();
  areaCard('工程設計').dispatchEvent('click', {});
  await tick();
  const second = h.waiting.shift();
  assert.equal(first.operation, 'overview');
  assert.equal(second.operation, 'overview');
  assert.equal(first.payload.responsibilityId, 'R1');
  assert.equal(second.payload.responsibilityId, 'R2');

  // The newer response lands first; the older one must be discarded.
  second.success(instance.context.managerWebRead('overview', second.payload));
  await settle();
  first.success(instance.context.managerWebRead('overview', first.payload));
  await settle();
  const content = h.document.getElementById('content').textContent;
  // The 工程設計 area is R2 (all its projects are Archived), so its scoped project list is
  // empty; the earlier 製品設計 payload must not be painted over it.
  assert.match(content, /工程設計/);
  assert.equal(content.indexOf('製品設計の'), -1, 'the superseded payload is discarded');
});
