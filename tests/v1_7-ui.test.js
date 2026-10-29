'use strict';

/**
 * V1.7 interface regression tests.
 *
 * Manager side: Position on the member card, the Yes/No deletion confirmation and the additional
 * assignee multi-select. Employee side: the worker view and the non-blocking submission states.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const dashboardFixtures = require('./dashboard-fixtures');
const { harness, flush } = require('./support/manager-web-harness');
const { fixture: managerFixture } = require('../scripts/manager-web-preview');

function manager() {
  const a = managerFixture();
  const h = harness((write, operation, payload) => (write
    ? a.context.managerWebWrite(operation, payload)
    : a.context.managerWebRead(operation, payload)));
  return { a, h };
}

function findByClass(root, className) {
  return root.descendants().filter(node => String(node.className).split(' ').indexOf(className) >= 0);
}

test('the Members page shows Position next to department and system role', async () => {
  const { h } = manager();
  await flush();
  h.click('nav', '管理');
  h.click('content', 'メンバー');
  await flush();
  const text = h.document.getElementById('content').textContent;
  assert.match(text, /課長/, 'the administrator position is shown');
  assert.match(text, /主任/, 'a manager position is shown');
  assert.match(text, /主任[\s\S]*MANAGER|MANAGER[\s\S]*主任/, 'role and position stay separate values');
});

test('permanent deletion asks once with Yes/No and never asks for a typed code', async () => {
  const { a, h } = manager();
  await flush();
  const created = a.context.Tasks.create({
    Project_ID: 'P0', Task_Name: '誤登録タスク', Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  });
  h.window.ManagerWebClient.deletion('TASKS', created.Task_ID, '誤登録タスク', '', h.document.getElementById('content'));
  await flush();

  const panel = h.nodes('content').find(node => node.className === 'deletion-panel');
  assert.ok(panel, 'the deletion panel opens');
  assert.equal(h.nodes('content').some(node => node.name === 'deleteConfirmation'), false,
    'the typed confirmation field is gone');
  assert.ok(h.nodes('content').some(node => node.name === 'deleteReason'), 'the reason is still required');

  const reason = h.nodes('content').find(node => node.name === 'deleteReason');
  reason.value = '誤って登録したため';
  reason.dispatchEvent('change', {});

  const execute = h.nodes('content').filter(node => node.tagName === 'BUTTON' &&
    node.textContent === '完全削除（管理者）' && node.parentNode && node.parentNode.className === 'toolbar')[0];
  assert.ok(execute, 'the delete button exists');
  execute.dispatchEvent('click', {});
  await flush();

  const dialog = h.document.body.childNodes.find(node => node.className === 'deletion-confirm');
  assert.ok(dialog, 'one confirmation dialog opens');
  const labels = dialog.descendants().filter(node => node.tagName === 'BUTTON').map(node => node.textContent);
  assert.deepEqual(JSON.parse(JSON.stringify(labels)), ['はい、削除する', 'いいえ、キャンセル']);
  assert.match(dialog.textContent, /完全に削除しますか/);
  assert.match(dialog.textContent, /誤登録タスク/, 'the record name is shown');
  assert.match(dialog.textContent, /取り消せません/, 'the irreversibility is stated');

  dialog.descendants().filter(node => node.tagName === 'BUTTON')[1].dispatchEvent('click', {});
  await flush();
  assert.equal(h.calls.some(call => call.write && call.operation === 'taskDelete'), false, 'No performs no write');
  assert.equal(a.context.Database.find('TASKS', created.Task_ID).Task_ID, created.Task_ID);
  assert.equal(h.document.body.childNodes.some(node => node.className === 'deletion-confirm'), false);

  execute.dispatchEvent('click', {});
  await flush();
  const confirmed = h.document.body.childNodes.find(node => node.className === 'deletion-confirm');
  confirmed.descendants().filter(node => node.tagName === 'BUTTON')[0].dispatchEvent('click', {});
  await flush();
  const write = h.calls.filter(call => call.write && call.operation === 'taskDelete')[0];
  assert.ok(write, 'Yes submits the deletion');
  assert.equal(write.payload.confirmation, 'DELETE ' + created.Task_ID, 'the client derives the exact code');
  assert.equal(write.payload.reason, '誤って登録したため');
});

test('the task editor offers an additional-assignee multi-select without the primary owner', async () => {
  const { h } = manager();
  await flush();
  h.click('nav', 'タスク');
  await flush();
  h.click('content', '編集');
  await flush();

  const multi = h.nodes('formHost').find(node => node.className === 'member-multiselect');
  assert.ok(multi, 'the multi-select is rendered');
  const select = multi.descendants().find(node => node.tagName === 'SELECT');
  assert.ok(select, 'a searchable list is offered');
  assert.equal(select.childNodes.some(option => option.value === 'M-ENG'), false,
    'the primary owner is never offered as an additional assignee');
  assert.ok(select.childNodes.some(option => option.value === 'M-MGR'), 'other active members are offered');
  assert.match(multi.textContent, /追加担当者/);
});

/* ---------------- employee dashboard ---------------- */

function workerPayload() {
  return {
    ok: true,
    data: {
      meta: {contractVersion: '1.6'},
      workers: ['設計 次郎', '管理 花子'],
      projects: [{projectId: 'P1', projectName: '検査装置', responsibilityId: ''}],
      responsibilities: [],
      totals: {matched: 1, open: 1, completed: 0, overdue: 0},
      filters: {group: 'open'},
      tasks: [{
        taskId: 'T1', projectId: 'P1', projectName: '検査装置', name: '機構設計',
        ownerName: '設計 次郎', assigneeNames: ['設計 次郎', '管理 花子'], sharedAssignment: true,
        status: 'In Progress', statusLabel: '進行中', priority: 'Medium', priorityLabel: '中',
        dueDate: '2026-12-15', deadlineLabel: 'あと47日', deadlineKind: 'future', daysRemaining: 47,
        progress: 40, reviewLabel: '承認待ち', pendingRequest: true
      }],
      total: 1, offset: 0, limit: 20
    }
  };
}

function employeeServer(overrides) {
  const viewer = fixtures.base({ actor: 'admin@example.test' });
  viewer.context.Database.update('PROJECTS', 'P1', { Dashboard_Visibility: 'INTERNAL' });
  const snapshot = dashboardFixtures.attachSnapshot(viewer);
  viewer.context.initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + dashboardFixtures.SNAPSHOT_ID);
  dashboardFixtures.enablePublication(viewer);
  viewer.context.publishSharedDashboard();
  const dash = dashboardFixtures.dashboardFor(snapshot);
  const calls = [];
  const server = Object.assign({
    dashboardPortfolio: request => dash.context.dashboardPortfolio(request),
    dashboardProject: (id, options) => dash.context.dashboardProject(id, options),
    dashboardTask: (projectId, taskId) => dash.context.dashboardTask(projectId, taskId),
    dashboardWorkerTasks: request => { calls.push(request); return workerPayload(); },
    requestSubmissionConfig: () => ({ok: true, data: {enabled: true, reasons: []}}),
    submitDeadlineRequest: () => ({ok: true, data: {requestId: 'REQ-9', status: 'RECEIVED'}}),
    submitCompletionReport: () => ({ok: true, data: {requestId: 'REQ-10', status: 'RECEIVED'}}),
    requestSubmissionStatus: () => ({ok: true, data: {status: 'PENDING'}})
  }, overrides || {});
  return { server, calls };
}

async function openFirstTask(client) {
  const list = client.document.getElementById('project-list');
  const card = list.descendants().find(node => node.getAttribute('data-project-id') === 'P1');
  list.dispatchEvent('click', {target: card});
  await dashboardFixtures.flush();
  const groups = client.document.getElementById('detail-groups');
  const button = groups.descendants().find(node => node.hasAttribute('data-open-task'));
  groups.dispatchEvent('click', {target: button});
  await dashboardFixtures.flush();
}

test('the worker view lists a shared task with every assignee and filters by worker', async () => {
  const { server, calls } = employeeServer();
  const client = dashboardFixtures.runClient(server);
  await dashboardFixtures.flush();

  client.document.getElementById('view-workers').dispatchEvent('click', {});
  await dashboardFixtures.flush();

  const list = client.document.getElementById('worker-list');
  const row = list.descendants().find(node => node.hasAttribute('data-worker-task'));
  assert.ok(row, 'a worker task row is rendered');
  assert.match(row.textContent, /機構設計/);
  assert.match(row.textContent, /設計 次郎、管理 花子/, 'every assignee is named');
  assert.match(row.textContent, /承認待ち/, 'approval status is displayed separately from the task status');
  assert.match(client.document.getElementById('worker-count').textContent, /1 件中 1–1 件/);

  const select = client.document.getElementById('worker-worker');
  select.value = '管理 花子';
  select.dispatchEvent('change', {});
  await dashboardFixtures.flush();
  assert.equal(calls[calls.length - 1].worker, '管理 花子', 'the filter is sent to the server');
});

test('submitting a request closes the form immediately and reports 受付完了 only after the acknowledgement', async () => {
  const { server } = employeeServer();
  let resolveSubmit;
  const pending = new Promise(resolve => { resolveSubmit = resolve; });
  server.submitDeadlineRequest = () => pending;
  const client = dashboardFixtures.runClient(server);
  await dashboardFixtures.flush();
  await openFirstTask(client);

  const body = client.document.getElementById('drawer-body');
  const section = findByClass(body, 'request-section')[0];
  findByClass(section, 'request-button')[0].dispatchEvent('click');
  await dashboardFixtures.flush();

  const deadline = body.descendants().find(node => node.id === 'request-deadline');
  const requester = body.descendants().find(node => node.id === 'request-requester');
  deadline.value = '2026-12-24';
  requester.value = '設計 次郎';
  deadline.dispatchEvent('input');
  requester.dispatchEvent('input');
  findByClass(body, 'request-button').filter(node => node.textContent === '申請を送信')[0].dispatchEvent('click');
  await dashboardFixtures.flush();

  assert.equal(client.document.getElementById('task-drawer').hidden, true, 'the form closes immediately');
  const activity = client.document.getElementById('request-activity-list');
  assert.equal(activity.hidden, false, 'a persistent receipt indicator appears');
  assert.match(activity.textContent, /送信中|受付完了/);

  resolveSubmit({ok: true, data: {requestId: 'REQ-9', status: 'RECEIVED'}});
  await dashboardFixtures.flush();
  assert.match(activity.textContent, /受付完了/);
  assert.match(activity.textContent, /REQ-9/);
});

test('a failed submission is reported as a failure and never as success', async () => {
  const { server } = employeeServer({
    submitDeadlineRequest: () => ({ok: false, error: {code: 'REQUEST_RATE_LIMITED', message: '上限'}})
  });
  const client = dashboardFixtures.runClient(server);
  await dashboardFixtures.flush();
  await openFirstTask(client);

  const body = client.document.getElementById('drawer-body');
  findByClass(body, 'request-section')[0] &&
    findByClass(findByClass(body, 'request-section')[0], 'request-button')[0].dispatchEvent('click');
  await dashboardFixtures.flush();
  const deadline = body.descendants().find(node => node.id === 'request-deadline');
  const requester = body.descendants().find(node => node.id === 'request-requester');
  deadline.value = '2026-12-24';
  requester.value = '設計 次郎';
  deadline.dispatchEvent('input');
  requester.dispatchEvent('input');
  findByClass(body, 'request-button').filter(node => node.textContent === '申請を送信')[0].dispatchEvent('click');
  await dashboardFixtures.flush();

  const activity = client.document.getElementById('request-activity-list');
  assert.match(activity.textContent, /送信失敗/);
  assert.doesNotMatch(activity.textContent, /受付完了/);
});

test('an interrupted send is reported as an unknown outcome and is never silently retried', async () => {
  const { server } = employeeServer();
  const interrupted = JSON.stringify([{
    attemptId: 'A-1', type: 'DEADLINE_CHANGE', taskId: 'T1', taskName: '機構設計',
    at: '2026-10-29T00:00:00.000Z', transport: 'SENDING', requestId: ''
  }]);
  const client = dashboardFixtures.runClient(server, {storage: {'eh.submissions': interrupted}});
  await dashboardFixtures.flush();
  const activity = client.document.getElementById('request-activity-list');
  assert.equal(activity.hidden, false);
  assert.match(activity.textContent, /送信結果不明/);
  assert.doesNotMatch(activity.textContent, /受付完了/);
  const stored = JSON.parse(client.store.get('eh.submissions'));
  assert.equal(stored[0].transport, 'OUTCOME_UNKNOWN');
  assert.equal(JSON.stringify(stored).indexOf('光学系'), -1, 'no request text is persisted');
});
