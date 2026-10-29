'use strict';

/**
 * V1.7.6 request consistency and asynchronous-safety regression tests.
 *
 * Every test drives the real manager client against the real Apps Script modules. Server reads
 * and writes are answered by the test, so a superseded, delayed or out-of-order response is
 * reproduced exactly instead of being imitated by a hand-written payload.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const { MockSpreadsheet } = require('./helpers');
const { harness } = require('./support/manager-web-harness');

const DOMAIN = { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' };
const TASKS_NAV = 'タスク';
const PROJECTS_NAV = '案件';
const REQUESTS_NAV = '申請';
const ADMIN_NAV = '管理';
const APPROVE = '承認';
const REJECT = '却下';
const RETURN = '差戻し';
const RELOAD = '再読み込み';
const ACCESS_DENIED = /権限を確認できない/;

function manager() { return fixtures.base({ actor: 'manager@example.test', properties: DOMAIN }); }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let index = 0; index < 40; index += 1) await tick(); }
const content = h => h.document.getElementById('content').textContent;
const notice = h => h.document.getElementById('notice').textContent;
const operations = h => h.calls.map(entry => entry.operation);
function summaryOf(store, id) { return store.tasks.items.filter(item => item.id === id)[0]; }
function read(app, operation, payload) {
  const result = app.context.managerWebRead(operation, payload);
  assert.equal(result.ok, true, result.error);
  return result.data;
}
function clientOf(app, options) {
  return harness((write, operation, payload) => write
    ? app.context.managerWebWrite(operation, payload)
    : app.context.managerWebRead(operation, payload), options || {});
}

/** Answers the next queued call with the real server result. */
async function answerNext(h, app) {
  const call = h.waiting.shift();
  assert.ok(call, 'the client must have a queued call');
  const result = call.write
    ? app.context.managerWebWrite(call.operation, call.payload)
    : app.context.managerWebRead(call.operation, call.payload);
  assert.equal(result.ok, true, call.operation + ': ' + result.error);
  call.success(result);
  await settle();
  return call;
}

/** Removes one queued call of the given operation, whatever its position in the queue. */
function takeCall(h, operation) {
  const index = h.waiting.findIndex(entry => entry.operation === operation);
  assert.ok(index >= 0, 'no queued call for ' + operation);
  return h.waiting.splice(index, 1)[0];
}

/** Answers one queued call of the given operation if it is waiting. */
async function answerIfQueued(h, app, operation) {
  const index = h.waiting.findIndex(entry => entry.operation === operation);
  if (index < 0) return null;
  const call = h.waiting.splice(index, 1)[0];
  const result = app.context.managerWebRead(call.operation, call.payload);
  assert.equal(result.ok, true, result.error);
  call.success(result);
  await settle();
  return call;
}

async function drain(h, app) {
  while (h.waiting.length) await answerNext(h, app);
}

function queued(h, operation) { return h.waiting.some(entry => entry.operation === operation); }

async function bootTasks(h, app) {
  await tick();
  await answerNext(h, app);
  h.click('nav', TASKS_NAV);
  await answerNext(h, app);
  assert.equal(h.window.ManagerWebClient.store.tasks.loaded, true, 'the index must be loaded');
  return h.window.ManagerWebClient.store;
}

/** Opens 申請一覧, answers the queue read and returns the still-pending page-entry import. */
async function openRequests(h, app) {
  h.click('nav', REQUESTS_NAV);
  await settle();
  // A cached queue paints without a read; a fresh entry reads it first.
  await answerIfQueued(h, app, 'requests');
  return takeCall(h, 'requestSync');
}

/** Answers the page-entry import with the real server result and returns its payload. */
async function confirmImport(h, app, sync) {
  assert.equal(sync.operation, 'requestSync', 'the page entry imports once');
  const result = app.context.managerWebWrite(sync.operation, sync.payload);
  assert.equal(result.ok, true, result.error);
  sync.success(result);
  await settle();
  return result.data;
}

/** Decides one request the way the card button does and answers the authoritative result. */
async function decide(h, app, label) {
  h.click('content', label);
  await settle();
  const call = takeCall(h, 'requestDecide');
  const result = app.context.managerWebWrite(call.operation, call.payload);
  assert.equal(result.ok, true, result.error);
  call.success(result);
  await settle();
  return result.data;
}

/** Sets one form control by value. */
function setField(h, name, value) {
  const control = h.nodes('formHost').filter(node => node.name === name)[0];
  assert.ok(control, 'no form control named ' + name);
  control.value = value;
  control.dispatchEvent('input', {});
  control.dispatchEvent('change', {});
  return control;
}

/** Clicks 編集 inside the card of one task (never another row's button). */
function clickEditOf(h, name) {
  const cards = h.document.getElementById('content').descendants()
    .filter(node => String(node.className || '').indexOf('task-card') >= 0);
  const card = cards.filter(node => node.textContent.indexOf(name) >= 0)[0];
  assert.ok(card, 'no task card for ' + name);
  const edit = card.descendants().filter(node => node.tagName === 'BUTTON' && node.textContent === '編集')[0];
  assert.ok(edit, 'no edit button for ' + name);
  edit.dispatchEvent('click', {});
}

/** Opens the editor of one task, answering only the reads the form itself needs. */
async function openEditorFor(h, app, name) {
  clickEditOf(h, name);
  await settle();
  await answerIfQueued(h, app, 'task');
  await answerIfQueued(h, app, 'editor');
  await answerIfQueued(h, app, 'project');
  const editor = h.window.ManagerWebClient.editor();
  assert.ok(editor, 'the editor must be open');
  return editor;
}

/** Saves the open form; the write is answered and the follow-up reads stay queued. */
async function saveEditor(h, app, fields) {
  Object.keys(fields || {}).forEach(key => setField(h, key, fields[key]));
  await settle();
  h.submit();
  await settle();
  const call = takeCall(h, 'taskSave');
  const result = app.context.managerWebWrite(call.operation, call.payload);
  assert.equal(result.ok, true, result.error);
  call.success(result);
  await settle();
  return result;
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** One PENDING request bound to the current revision of its task. */
function seed(app, data) {
  const c = app.context, task = c.Database.find('TASKS', data.Task_ID);
  c.Database.insert('TASK_REQUESTS', Object.assign({
    Project_ID: task.Project_ID, Requester_Name: '設計 次郎',
    Submitted_At: '2026-10-01T00:00:00.000Z',
    Original_Due_Date: c.Domain.date(task.Due_Date),
    Due_Date_At_Submission: c.Domain.date(task.Due_Date),
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(task),
    Snapshot_Version: '1.6'
  }, data));
  return data.Request_ID;
}

function completionRequest() {
  const app = manager();
  seed(app, {
    Request_ID: 'REQ-DONE', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T2', Status: 'PENDING',
    Completion_Note: '完了しました。', Reported_Completion_At: '2026-10-20T01:00:00.000Z'
  });
  return app;
}

function deadlineRequest() {
  const app = manager();
  seed(app, {
    Request_ID: 'REQ-DUE', Request_Type: 'DEADLINE_CHANGE', Task_ID: 'T1', Status: 'PENDING',
    Requested_Due_Date: '2026-12-23', Reason: '技術的問題'
  });
  return app;
}

/** Seeds the separate request inbox so an ordinary queue read imports one completion report. */
function inboxWith(instance, rows) {
  const fields = instance.context.Requests.INBOX_FIELDS.slice();
  instance.spreadsheets.set('inbox-v176', new MockSpreadsheet('inbox-v176', { REQUESTS: [fields].concat(rows || []) }));
  instance.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', 'inbox-v176');
}

function inboxRow(instance, data) {
  return instance.context.Requests.INBOX_FIELDS.map(field => (data[field] === undefined ? '' : data[field]));
}

/* ------------------------------------------------------------------ *
 * 1. A request decision never leaves stale task state
 * ------------------------------------------------------------------ */

test('approving a completion request shows the authoritative completion state', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(summaryOf(store, 'T2').status, 'Assigned');
  assert.equal(summaryOf(store, 'T2').reviewState, 'PENDING', 'the queue shows a pending review');

  await confirmImport(h, app, await openRequests(h, app));
  await decide(h, app, APPROVE);

  // One narrow index read answers the decision; the whole snapshot is never re-read.
  assert.equal(queued(h, 'taskIndex'), true, 'the loaded index is refreshed after the decision');
  assert.equal(queued(h, 'bootstrap'), false, 'a decision never triggers a full snapshot refresh');
  await drain(h, app);

  const task = summaryOf(store, 'T2');
  assert.equal(task.status, 'Done', 'the approved completion is displayed');
  assert.equal(task.progress, 100, 'the approved progress is displayed');
  assert.equal(task.reviewState, '', 'the pending-review badge is cleared');
  assert.equal(store.at.bootstrap, 0, 'the aggregates are marked stale for the next visit');
  assert.match(content(h), /対象のデータはありません/, 'the decided request leaves no open queue entry');
});

test('approving a deadline extension shows the new deadline', async () => {
  const app = deadlineRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(summaryOf(store, 'T1').deadline, '2026-12-15');

  await confirmImport(h, app, await openRequests(h, app));
  await decide(h, app, APPROVE);
  await drain(h, app);

  assert.equal(summaryOf(store, 'T1').deadline, '2026-12-23', 'the approved deadline is displayed');
  const stored = read(app, 'task', { id: 'T1' }).record.Due_Date;
  assert.equal(String(stored).slice(0, 10), '2026-12-23', 'the server holds the same deadline');
  assert.equal(store.tasks.items.filter(item => item.id === 'T1').length, 1, 'no duplicate row appears');
});

test('a rejected request clears its review state without touching the task', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);

  await confirmImport(h, app, await openRequests(h, app));
  await decide(h, app, REJECT);
  await drain(h, app);

  assert.equal(summaryOf(store, 'T2').reviewState, '', 'the pending badge is cleared');
  assert.equal(summaryOf(store, 'T2').status, 'Assigned', 'a rejection never completes a task');
  assert.equal(app.context.Database.read('TASK_REQUESTS')
    .filter(row => row.Request_ID === 'REQ-DONE')[0].Status, 'REJECTED');
});

test('a returned request clears its review state without touching the task', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);

  await confirmImport(h, app, await openRequests(h, app));
  await decide(h, app, RETURN);
  await drain(h, app);

  assert.equal(summaryOf(store, 'T2').reviewState, '', 'the pending badge is cleared');
  assert.equal(summaryOf(store, 'T2').status, 'Assigned');
  assert.equal(app.context.Database.read('TASK_REQUESTS')
    .filter(row => row.Request_ID === 'REQ-DONE')[0].Status, 'RETURNED');
});

test('a stale decision reports itself and never overwrites the newer deadline', async () => {
  const app = deadlineRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);

  // Somebody else changes the deadline after submission, so the request no longer applies.
  app.context.Tasks.update('T1', { Due_Date: '2026-12-19' });
  await confirmImport(h, app, await openRequests(h, app));
  const result = await decide(h, app, APPROVE);

  assert.equal(result.status, 'STALE', 'the server refuses the stale request');
  assert.match(notice(h), /申請は古い情報に基づいています/);
  await drain(h, app);

  assert.equal(summaryOf(store, 'T1').deadline, '2026-12-19', 'the newer stored deadline wins');
  assert.equal(app.context.Database.find('TASK_REQUESTS', 'REQ-DUE').Status, 'STALE');
});

test('repeating an approval mutates the task and the audit log once', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  await confirmImport(h, app, await openRequests(h, app));
  await decide(h, app, APPROVE);
  await drain(h, app);

  const applied = () => app.context.Database.read('AUDIT_LOG')
    .filter(row => row.Action === 'REQUEST_EFFECT_APPLIED').length;
  const decided = () => app.context.Database.read('AUDIT_LOG')
    .filter(row => row.Action === 'REQUEST_DECIDED').length;
  assert.equal(applied(), 1);
  assert.equal(decided(), 1);

  // A decided card offers no decision any more, so the client cannot repeat it from a button.
  assert.equal(h.nodes('content').filter(node => node.textContent === APPROVE).length, 0,
    'a decided request offers no decision buttons');
  // A repeated submission is refused and applies nothing twice.
  const repeat = app.context.managerWebWrite('requestDecide',
    { requestId: 'REQ-DONE', action: 'APPROVE', note: '', confirmed: true, confirmation: 'DECIDE REQUEST' });
  assert.equal(repeat.ok, false, 'a terminal request is never decided again');
  assert.equal(applied(), 1);
  assert.equal(decided(), 1);
  assert.equal(read(app, 'task', { id: 'T2' }).record.Progress_Percent, 100);
});

test('an ambiguous decision is reported and never replayed', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  await confirmImport(h, app, await openRequests(h, app));

  h.click('content', APPROVE);
  await settle();
  const first = takeCall(h, 'requestDecide');
  const stored = app.context.managerWebWrite(first.operation, first.payload);
  assert.equal(stored.ok, true, stored.error);
  const applied = app.context.Database.read('AUDIT_LOG')
    .filter(row => row.Action === 'REQUEST_EFFECT_APPLIED').length;

  // The transport answer is lost: the client must not replay the approval to refresh the screen.
  first.failure(new Error('TIMEOUT'));
  await settle();
  assert.match(notice(h), /TIMEOUT/);
  assert.equal(queued(h, 'requestDecide'), false, 'an ambiguous decision is never retried');
  assert.equal(app.context.Database.read('AUDIT_LOG')
    .filter(row => row.Action === 'REQUEST_EFFECT_APPLIED').length, applied);
});

/* ------------------------------------------------------------------ *
 * 2. An import updates the pending indicator only when the queue changed
 * ------------------------------------------------------------------ */

test('importing a new completion request updates the pending badge', async () => {
  const app = manager();
  inboxWith(app, [inboxRow(app, {
    Request_ID: 'REQ-INBOX', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T2', Project_ID: 'P1',
    Requester_Name: '設計 次郎', Submitted_At: '2026-10-21T00:00:00.000Z',
    Completion_Note: '完了しました。', Snapshot_Version: '1.6'
  })]);
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(summaryOf(store, 'T2').reviewState, '');

  await confirmImport(h, app, await openRequests(h, app));
  await drain(h, app);

  assert.equal(summaryOf(store, 'T2').reviewState, 'PENDING', 'the imported report shows a pending review');
  assert.match(content(h), /要件整理/);
});

test('an import that changes nothing never refreshes the task index', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);

  const beforeIndex = operations(h).filter(operation => operation === 'taskIndex').length;
  const beforeSnapshot = operations(h).filter(operation => operation === 'bootstrap').length;
  const sync = await openRequests(h, app);
  assert.equal(sync.payload.includeDecided, false);
  await confirmImport(h, app, sync);
  await drain(h, app);

  assert.equal(operations(h).filter(operation => operation === 'taskIndex').length, beforeIndex,
    'an unchanged queue pays for no index read');
  assert.equal(operations(h).filter(operation => operation === 'bootstrap').length, beforeSnapshot,
    'and no extra snapshot read either');
});

/* ------------------------------------------------------------------ *
 * 3. Revocation drops every delayed response
 * ------------------------------------------------------------------ */

test('a delayed request synchronization never repaints after access is revoked', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  const sync = await openRequests(h, app);

  // A reload on the same entry starts one more queue read; it answers with an access denial.
  h.click('content', RELOAD);
  await settle();
  takeCall(h, 'requests').success({ ok: false, error: 'MANAGER_ACCESS_DENIED: identity not verified' });
  await settle();
  assert.match(notice(h), ACCESS_DENIED);
  assert.equal(h.window.ManagerWebClient.store.tasks, null, 'the snapshot is dropped with the access');

  // That page entry's import answers afterwards with a valid payload.
  sync.success(app.context.managerWebWrite('requestSync', sync.payload));
  await settle();
  await drain(h, app);

  assert.equal(content(h), '', 'no private row is rendered after revocation');
  assert.match(notice(h), ACCESS_DENIED, 'the access-denied message stays');
  assert.equal(h.window.ManagerWebClient.store.projects, null, 'no project data is restored');
  assert.equal(h.window.ManagerWebClient.store.tasks, null, 'no task data is restored');
  assert.equal(h.window.ManagerWebClient.editor(), null, 'no editor is opened');
});

test('a delayed snapshot never restores data after access is revoked', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);

  // A background snapshot refresh is in flight when the identity is rejected.
  h.window.ManagerWebClient.api.read('bootstrap', {}, true).catch(() => null);
  await settle();
  const staleBootstrap = takeCall(h, 'bootstrap');

  h.click('nav', 'メンバー');
  await settle();
  takeCall(h, 'members').success({ ok: false, error: 'MANAGER_ACCESS_DENIED: identity not verified' });
  await settle();
  assert.match(notice(h), ACCESS_DENIED);

  staleBootstrap.success(app.context.managerWebRead('bootstrap'));
  await settle();

  assert.equal(content(h), '', 'a late snapshot never repaints the revoked page');
  assert.equal(h.window.ManagerWebClient.store.tasks, null);
  assert.match(notice(h), ACCESS_DENIED);
});

/* ------------------------------------------------------------------ *
 * 4. In-flight reads never overwrite a newer write
 * ------------------------------------------------------------------ */

test('a snapshot read started before a save can never overwrite the newer state', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  const client = h.window.ManagerWebClient;

  // 1. A save completes and drops the cached snapshot and aggregates.
  await openEditorFor(h, app, '機構設計');
  await saveEditor(h, app, { taskName: '機構設計 改訂' });
  await drain(h, app);

  // 2. A snapshot refresh starts while no snapshot payload is cached.
  h.click('nav', '概要');
  await settle();
  const early = takeCall(h, 'bootstrap');
  const earlyEnvelope = app.context.managerWebRead('bootstrap');
  earlyEnvelope.data.kpis = Object.assign({}, earlyEnvelope.data.kpis, { active: 999 });

  // 3. A newer save completes before that snapshot answers.
  await openEditorFor(h, app, '機構設計 改訂');
  await saveEditor(h, app, { taskName: '機構設計 再改訂' });
  assert.equal(queued(h, 'bootstrap'), true, 'the newer save starts its own snapshot read');
  const fresh = takeCall(h, 'bootstrap');
  assert.notEqual(fresh, early, 'the new generation is read again instead of joining the old read');

  // 4. The newer answer arrives first; the older one arrives last.
  fresh.success(app.context.managerWebRead('bootstrap'));
  await settle();
  early.success(earlyEnvelope);
  await settle();
  await drain(h, app);

  const cached = client.api.peek('bootstrap', {});
  assert.notEqual((cached.kpis || {}).active, 999, 'the older snapshot is never cached');
  assert.notEqual(((store.overview || {}).kpis || {}).active, 999, 'and never rendered');
  assert.equal(summaryOf(store, 'T1').name, '機構設計 再改訂', 'the newer save stays authoritative');
});

/* ------------------------------------------------------------------ *
 * 5. Page lifecycles stay independent
 * ------------------------------------------------------------------ */

test('the latest request import wins over an overlapping older one', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);

  h.click('nav', REQUESTS_NAV);
  await settle();
  await answerNext(h, app);
  const abandoned = takeCall(h, 'requestSync');

  h.click('nav', PROJECTS_NAV);
  await settle();
  await drain(h, app);
  await confirmImport(h, app, await openRequests(h, app));
  assert.match(content(h), /要件整理/, 'the current entry shows its queue');

  const stale = app.context.managerWebWrite('requestSync', abandoned.payload);
  stale.data = Object.assign({}, stale.data, { importError: 'ABANDONED-VISIT' });
  abandoned.success(stale);
  await settle();
  await drain(h, app);

  assert.doesNotMatch(content(h), /ABANDONED-VISIT/, 'an abandoned import never paints');
  assert.match(content(h), /要件整理/, 'the current page keeps its own queue');
});

test('leaving the page during a decision keeps the abandoned answer off the screen', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  await confirmImport(h, app, await openRequests(h, app));

  h.click('content', APPROVE);
  await settle();
  const decision = takeCall(h, 'requestDecide');
  const result = app.context.managerWebWrite(decision.operation, decision.payload);
  assert.equal(result.ok, true, result.error);

  // The manager navigates away before the decision answers.
  h.click('nav', TASKS_NAV);
  await settle();
  await drain(h, app);
  decision.success(result);
  await settle();
  await drain(h, app);

  assert.match(content(h), /機構設計/, 'the open page still shows tasks');
  assert.doesNotMatch(content(h), /完了しました/, 'the abandoned answer never paints the queue');
  assert.equal(summaryOf(store, 'T2').status, 'Done', 'the authoritative result still reaches the index');
});

/* ------------------------------------------------------------------ *
 * 6. Failures stay bounded and readable
 * ------------------------------------------------------------------ */

test('a failed index refresh after a decision uses the bounded recovery path', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  await confirmImport(h, app, await openRequests(h, app));
  await decide(h, app, APPROVE);

  takeCall(h, 'taskIndex').failure(new Error('TIMEOUT'));
  await settle();
  assert.equal(queued(h, 'bootstrap'), true, 'the snapshot is read once');
  await answerIfQueued(h, app, 'bootstrap');
  assert.equal(queued(h, 'taskIndex'), true, 'the index is retried once');
  await answerIfQueued(h, app, 'taskIndex');

  assert.equal(summaryOf(store, 'T2').status, 'Done');
  assert.equal(store.tasks.loaded, true, 'the page is never left in a loading state');
});

test('a broken queue payload after a decision reports a contract error', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  await confirmImport(h, app, await openRequests(h, app));
  await decide(h, app, APPROVE);

  takeCall(h, 'requests').success({ ok: true, data: { counts: {}, configured: true } });
  await settle();

  assert.match(notice(h), /INVALID_RESPONSE/);
  assert.doesNotMatch(content(h), /対象のデータはありません/, 'a broken payload is never an empty state');
  assert.match(content(h), /再試行/);
});

test('an automation payload without its status is a contract error', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  h.click('nav', ADMIN_NAV);
  await settle();
  h.click('content', '自動化');
  await settle();
  takeCall(h, 'automation').success({ ok: true, data: { settings: [], history: [] } });
  await settle();

  assert.match(notice(h), /INVALID_RESPONSE/, 'the missing field is reported, not thrown');
  assert.match(notice(h), /automation\.status/);
});
