'use strict';

/**
 * V1.7.7 authorization and request-synchronization hotfix regression tests.
 *
 * Every test drives the real manager client against the real Apps Script modules. Reads and
 * writes are answered by the test, so a revoked role, a delayed answer or an out-of-order response
 * is reproduced exactly instead of being imitated by a hand-written payload. A denial is produced
 * by the server itself: the manager's stored role is revoked and the real entrypoint answers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const { MockSpreadsheet } = require('./helpers');
const { harness } = require('./support/manager-web-harness');

const DOMAIN = { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' };
const TASKS_NAV = 'タスク';
const REQUESTS_NAV = '申請';
const APPROVE = '承認';
const RELOAD = '再読み込み';
const ACCESS_DENIED = /権限を確認できない/;
const OPEN_DEADLINE = '2026-12-22';
const DECIDED_DEADLINE = '2026-12-23';

function manager() { return fixtures.base({ actor: 'manager@example.test', properties: DOMAIN }); }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let index = 0; index < 40; index += 1) await tick(); }
const content = h => h.document.getElementById('content').textContent;
const notice = h => h.document.getElementById('notice').textContent;
const operations = h => h.calls.map(entry => entry.operation);
const countOf = (h, operation) => operations(h).filter(name => name === operation).length;
const client = h => h.window.ManagerWebClient;
const queued = (h, operation) => h.waiting.some(entry => entry.operation === operation);
function summaryOf(store, id) { return store.tasks.items.filter(item => item.id === id)[0]; }

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

async function answerIfQueued(h, app, operation) {
  if (!queued(h, operation)) return null;
  return answerNext(h, app);
}

async function drain(h, app) {
  while (h.waiting.length) await answerNext(h, app);
}

/** Boots the client and loads the compact task index. */
async function bootTasks(h, app) {
  await tick();
  await answerNext(h, app);
  h.click('nav', TASKS_NAV);
  await answerNext(h, app);
  assert.equal(client(h).store.tasks.loaded, true, 'the index must be loaded');
  return client(h).store;
}

/** Opens 申請一覧, answers the queue read and returns the still-pending page-entry import. */
async function openRequests(h, app) {
  h.click('nav', REQUESTS_NAV);
  await settle();
  await answerIfQueued(h, app, 'requests');
  return takeCall(h, 'requestSync');
}

/** Answers the page-entry import with the real server result. */
async function confirmImport(h, app, sync) {
  assert.equal(sync.operation, 'requestSync', 'the page entry imports once');
  const result = app.context.managerWebWrite(sync.operation, sync.payload);
  assert.equal(result.ok, true, result.error);
  sync.success(result);
  await settle();
  return result;
}

/** Flips the 決定済みを含む filter the way the rendered checkbox does. */
async function showDecided(h, value) {
  const toggle = h.nodes('content').filter(node => node.name === 'showDecided')[0];
  assert.ok(toggle, 'the show-decided filter is rendered');
  toggle.checked = value;
  toggle.dispatchEvent('change', {});
  await settle();
  return toggle;
}

/** Clicks 編集 inside the card of one task. */
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
  const editor = client(h).editor();
  assert.ok(editor, 'the editor must be open');
  return editor;
}

function setField(h, name, value) {
  const control = h.nodes('formHost').filter(node => node.name === name)[0];
  assert.ok(control, 'no form control named ' + name);
  control.value = value;
  control.dispatchEvent('input', {});
  control.dispatchEvent('change', {});
  return control;
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** Revokes the manager's server-side role; the next entrypoint call is a real denial. */
function revokeRole(app) {
  app.context.Database.update('MEMBERS', 'M-MGR', {Role: 'VIEWER'});
}

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

/** One pending completion report on T2 — the request the approval test decides. */
function completionRequest() {
  const app = manager();
  seed(app, {
    Request_ID: 'REQ-DONE', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T2', Status: 'PENDING',
    Completion_Note: '完了しました。', Reported_Completion_At: '2026-10-20T01:00:00.000Z'
  });
  return app;
}

/** One pending and one decided deadline change, so the two filters list different rows. */
function requestFixture() {
  const app = manager();
  seed(app, {
    Request_ID: 'REQ-OPEN', Request_Type: 'DEADLINE_CHANGE', Task_ID: 'T1', Status: 'PENDING',
    Requested_Due_Date: OPEN_DEADLINE, Reason: '技術的問題'
  });
  seed(app, {
    Request_ID: 'REQ-DECIDED', Request_Type: 'DEADLINE_CHANGE', Task_ID: 'T1', Status: 'APPROVED',
    Requested_Due_Date: DECIDED_DEADLINE, Decided_At: '2026-10-02T00:00:00.000Z',
    Reviewer: 'manager@example.test'
  });
  return app;
}

/** Seeds the separate request inbox, so one opening of 申請一覧 imports real rows. */
function inboxWith(instance, rows) {
  const fields = instance.context.Requests.INBOX_FIELDS.slice();
  instance.spreadsheets.set('inbox-v177', new MockSpreadsheet('inbox-v177', { REQUESTS: [fields].concat(rows || []) }));
  instance.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', 'inbox-v177');
}

function inboxRow(instance, data) {
  return instance.context.Requests.INBOX_FIELDS.map(field => (data[field] === undefined ? '' : data[field]));
}

/** One completable inbox row for T2. */
function oneInboxCompletion(instance) {
  inboxWith(instance, [inboxRow(instance, {
    Request_ID: 'REQ-INBOX', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T2', Project_ID: 'P1',
    Requester_Name: '設計 次郎', Submitted_At: '2026-10-21T00:00:00.000Z',
    Completion_Note: '完了しました。', Snapshot_Version: '1.6'
  })]);
}

/* ------------------------------------------------------------------ *
 * 1. Authorization denial classification
 * ------------------------------------------------------------------ */

test('the server marks a refused authorization with a stable code', () => {
  const app = manager();
  // The fixture manager is a MANAGER, so an ADMIN requirement is the refusal it can reproduce.
  const denied = app.context.Roles.requireAtLeast.bind(null, 'ADMIN');
  assert.equal(app.context.Roles.DENIED, 'AUTHORIZATION_DENIED');
  assert.throws(denied, error => error.code === 'AUTHORIZATION_DENIED', 'a refusal carries the code');
  assert.equal(app.context.Roles.isDenied(new Error('TIMEOUT')), false, 'a timeout is never a denial');
  assert.equal(app.context.Roles.isDenied(new Error('EDIT_CONFLICT: reload')), false,
    'an edit conflict is never a denial');
  // The re-wrapped message a guarded service produces is still recognizable.
  assert.equal(app.context.Roles.isDenied(new Error('Insufficient role: MANAGER required')), true);

  const allowed = app.context.managerWebRead('requests', {});
  assert.equal(allowed.ok, true, allowed.error);
  assert.equal(allowed.code, undefined, 'a successful answer carries no denial code');

  revokeRole(app);
  const refused = app.context.managerWebRead('requests', {});
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'AUTHORIZATION_DENIED', 'the envelope carries the code');
  assert.match(refused.error, /Insufficient role/);
});

test('an ordinary failure is reported without revoking the page', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  await confirmImport(h, app, await openRequests(h, app));

  // A transport failure is not an authorization answer.
  h.click('content', APPROVE);
  await settle();
  takeCall(h, 'requestDecide').failure(new Error('TIMEOUT'));
  await settle();

  assert.match(notice(h), /TIMEOUT/, 'the failure is reported');
  assert.doesNotMatch(notice(h), ACCESS_DENIED, 'the manager is not falsely revoked');
  assert.notEqual(store.tasks, null, 'the private snapshot stays');
  assert.match(content(h), /要件整理/, 'the queue stays on screen');
  assert.equal(summaryOf(store, 'T2').status, 'Assigned', 'nothing was applied');
});

test('an edit conflict keeps the editor and its entered values', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  const editor = await openEditorFor(h, app, '機構設計');
  setField(h, 'taskName', '競合テスト');
  await settle();

  // Somebody else saves the same task first, so the loaded revision is no longer current.
  app.context.Tasks.update('T1', {Progress_Percent: 30});
  h.submit();
  await settle();
  const call = takeCall(h, 'taskSave');
  const result = app.context.managerWebWrite(call.operation, call.payload);
  assert.equal(result.ok, false, 'the stale save is refused');
  assert.match(result.error, /EDIT_CONFLICT/);
  call.success(result);
  await settle();

  assert.equal(client(h).editor(), editor, 'the form stays open for correction');
  assert.doesNotMatch(notice(h), ACCESS_DENIED, 'an edit conflict never revokes');
  const field = h.nodes('formHost').filter(node => node.name === 'taskName')[0];
  assert.equal(field.value, '競合テスト', 'the entered value is preserved');
  assert.equal(app.context.Database.find('TASKS', 'T1').Task_Name, '機構設計');
});

/* ------------------------------------------------------------------ *
 * 2. A genuine denial revokes every private cached view
 * ------------------------------------------------------------------ */

test('a denied approval clears every private cached view', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  await confirmImport(h, app, await openRequests(h, app));
  assert.match(content(h), /完了しました/, 'the pending request is on screen');
  assert.notEqual(client(h).api.peek('taskIndex', {}), null, 'the index payload is cached');

  revokeRole(app);
  h.click('content', APPROVE);
  await settle();
  const call = takeCall(h, 'requestDecide');
  const result = app.context.managerWebWrite(call.operation, call.payload);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUTHORIZATION_DENIED');
  call.success(result);
  await settle();

  assert.match(notice(h), ACCESS_DENIED, 'the access-denied message is shown');
  assert.equal(content(h), '', 'no private row is rendered');
  assert.equal(store.tasks, null, 'the task snapshot is dropped');
  assert.equal(store.projects, null, 'the project snapshot is dropped');
  assert.equal(store.overview, null);
  assert.equal(store.actor, null);
  assert.equal(client(h).api.peek('taskIndex', {}), null, 'no cached payload survives');
  assert.equal(client(h).api.peek('requests', {}), null, 'the queue payload is dropped');
  assert.equal(client(h).editor(), null);

  // No further UI action is accepted.
  h.click('nav', TASKS_NAV);
  await settle();
  assert.equal(content(h), '', 'a navigation never repaints private data');
  assert.match(notice(h), ACCESS_DENIED);
  assert.equal(h.waiting.length, 0, 'and never reads from the server again');
});

test('a denied import never renders the rows it read', async () => {
  const app = completionRequest();
  oneInboxCompletion(app);
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  const sync = await openRequests(h, app);

  revokeRole(app);
  const result = app.context.managerWebWrite(sync.operation, sync.payload);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUTHORIZATION_DENIED');
  sync.success(result);
  await settle();

  assert.match(notice(h), ACCESS_DENIED);
  assert.equal(content(h), '', 'the imported queue is never painted');
  assert.equal(store.tasks, null);
  assert.equal(client(h).store.references, null);
  assert.equal(app.context.Database.read('TASK_REQUESTS').length, 1, 'the server still refused the import');
});

test('a denied task save closes the editor and discards its unsaved state', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  await openEditorFor(h, app, '機構設計');
  setField(h, 'taskName', '未保存の名前');
  await settle();

  revokeRole(app);
  h.submit();
  await settle();
  const call = takeCall(h, 'taskSave');
  const result = app.context.managerWebWrite(call.operation, call.payload);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUTHORIZATION_DENIED');
  call.success(result);
  await settle();

  assert.equal(client(h).editor(), null, 'the editor is closed');
  assert.equal(h.document.getElementById('formHost').textContent, '', 'the form is discarded');
  assert.equal(store.tasks, null);
  assert.match(notice(h), ACCESS_DENIED);
  assert.equal(app.context.Database.find('TASKS', 'T1').Task_Name, '機構設計', 'nothing was written');
});

test('a delayed answer never restores data or a form after revocation', async () => {
  const app = completionRequest();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  await confirmImport(h, app, await openRequests(h, app));
  h.click('nav', TASKS_NAV);
  await settle();

  // A save is dispatched and stays unanswered.
  await openEditorFor(h, app, '要件整理');
  setField(h, 'taskName', '遅延保存');
  await settle();
  h.submit();
  await settle();
  const save = takeCall(h, 'taskSave');
  const saved = app.context.managerWebWrite(save.operation, save.payload);
  assert.equal(saved.ok, true, saved.error);

  // A background revalidation answers with a denial first.
  h.click('content', RELOAD);
  await settle();
  takeCall(h, 'bootstrap').success({ ok: false, error: 'MANAGER_ACCESS_DENIED', code: 'AUTHORIZATION_DENIED' });
  await settle();
  assert.match(notice(h), ACCESS_DENIED);
  assert.equal(client(h).editor(), null, 'the open form is discarded');

  // The older save answer arrives afterwards with its success payload.
  save.success(saved);
  await settle();
  await drain(h, app);

  assert.equal(content(h), '', 'a delayed answer never repaints the revoked page');
  assert.match(notice(h), ACCESS_DENIED, 'the access-denied message stays');
  assert.doesNotMatch(notice(h), /保存しました|saved/);
  assert.equal(store.tasks, null, 'no private data is restored');
  assert.equal(client(h).editor(), null, 'no form is reopened');
});

/* ------------------------------------------------------------------ *
 * 3. Request list refresh after an import created rows
 * ------------------------------------------------------------------ */

test('a filter change during the import refreshes the selected filter', async () => {
  const app = requestFixture();
  oneInboxCompletion(app);
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  const sync = await openRequests(h, app);
  assert.equal(sync.payload.includeDecided, false);

  // The manager switches to 決定済みを含む while the import is still running.
  await showDecided(h, true);
  const allRead = takeCall(h, 'requests');
  assert.equal(allRead.payload.includeDecided, true);

  // That read answers first, and it cannot contain a request the import has not created yet.
  allRead.success(app.context.managerWebRead('requests', allRead.payload));
  await settle();
  assert.doesNotMatch(content(h), /完了しました/, 'the imported request is not listed yet');

  // The import now creates one request.
  const result = app.context.managerWebWrite(sync.operation, sync.payload);
  assert.equal(result.data.imported.imported, 1);
  sync.success(result);
  await settle();

  // One fresh read of the currently selected filter — no second import.
  const refresh = takeCall(h, 'requests');
  assert.equal(refresh.payload.includeDecided, true, 'the current filter is re-read');
  refresh.success(app.context.managerWebRead('requests', refresh.payload));
  await settle();
  await drain(h, app);

  assert.match(content(h), /完了しました/, 'the imported request is listed under the current filter');
  assert.equal(countOf(h, 'requestSync'), 1, 'the import is never repeated');
  assert.equal(app.context.Database.read('TASK_REQUESTS').length, 3, 'no duplicate request is created');
});

test('an import that finishes before the filter read leaves that read authoritative', async () => {
  const app = requestFixture();
  oneInboxCompletion(app);
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  const sync = await openRequests(h, app);

  await showDecided(h, true);
  const allRead = takeCall(h, 'requests');
  const readsBefore = countOf(h, 'requests');

  // The import completes while the filtered read is still in flight.
  const result = app.context.managerWebWrite(sync.operation, sync.payload);
  assert.equal(result.data.imported.imported, 1);
  sync.success(result);
  await settle();

  assert.equal(queued(h, 'requests'), false, 'the running read is not duplicated');
  assert.equal(countOf(h, 'requests'), readsBefore, 'and no extra read is issued');

  // The superseded answer is discarded, so the page re-reads the current filter once.
  allRead.success(app.context.managerWebRead('requests', allRead.payload));
  await settle();
  const reread = takeCall(h, 'requests');
  assert.equal(reread.payload.includeDecided, true);
  reread.success(app.context.managerWebRead('requests', reread.payload));
  await settle();
  await drain(h, app);

  assert.match(content(h), /完了しました/, 'the authoritative filtered read lists the new request');
  assert.equal(countOf(h, 'requestSync'), 1);
});

test('an import that created nothing refreshes nothing', async () => {
  const app = requestFixture();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  const sync = await openRequests(h, app);

  await showDecided(h, true);
  const allRead = takeCall(h, 'requests');
  allRead.success(app.context.managerWebRead('requests', allRead.payload));
  await settle();
  const readsBefore = countOf(h, 'requests');

  const result = app.context.managerWebWrite(sync.operation, sync.payload);
  assert.equal(result.data.imported.imported, 0, 'the inbox held nothing new');
  sync.success(result);
  await settle();

  assert.equal(queued(h, 'requests'), false, 'no request-list read is added');
  assert.equal(countOf(h, 'requests'), readsBefore);
  assert.match(content(h), /2026-12-23/, 'the selected filter stays on screen');
});

test('only the current filter is displayed after fast filter changes', async () => {
  const app = requestFixture();
  oneInboxCompletion(app);
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  const sync = await openRequests(h, app);

  await showDecided(h, true);
  const allRead = takeCall(h, 'requests');
  await showDecided(h, false);
  assert.equal(allRead.payload.includeDecided, true, 'the first filter was read first');

  // The superseded filter answers after the current one was already requested: it is dropped.
  allRead.success(app.context.managerWebRead('requests', allRead.payload));
  await settle();
  assert.doesNotMatch(content(h), /2026-12-23/, 'the superseded filter never paints');

  const openRead = takeCall(h, 'requests');
  assert.equal(openRead.payload.includeDecided, false, 'the current filter is read');
  openRead.success(app.context.managerWebRead('requests', openRead.payload));
  await settle();
  assert.match(content(h), /2026-12-22/, 'the pending request is listed');
  assert.doesNotMatch(content(h), /2026-12-23/, 'the decided row stays filtered out');

  // The import belongs to the filter that is selected again, so its own answer is reused.
  const result = app.context.managerWebWrite(sync.operation, sync.payload);
  sync.success(result);
  await settle();
  await drain(h, app);

  assert.match(content(h), /2026-12-22/, 'the pending request stays listed');
  assert.match(content(h), /完了しました/, 'and the imported request is shown too');
  assert.doesNotMatch(content(h), /2026-12-23/, 'the decided row stays filtered out');
  assert.equal(queued(h, 'requests'), false, 'the current answer is reused, not re-read');
  assert.equal(countOf(h, 'requestSync'), 1, 'the filter change never re-imports');
});

test('leaving the page during the import never repaints it', async () => {
  const app = requestFixture();
  oneInboxCompletion(app);
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  const sync = await openRequests(h, app);

  h.click('nav', TASKS_NAV);
  await settle();
  await drain(h, app);
  const readsBefore = countOf(h, 'requests');

  const result = app.context.managerWebWrite(sync.operation, sync.payload);
  assert.equal(result.data.imported.imported, 1);
  sync.success(result);
  await settle();
  await drain(h, app);

  assert.match(content(h), /機構設計/, 'the manager stays on the task page');
  assert.doesNotMatch(content(h), /完了しました/, 'the abandoned queue is never painted');
  assert.equal(queued(h, 'requests'), false, 'the abandoned page is not refreshed');
  assert.equal(countOf(h, 'requests'), readsBefore);
});

test('a failed import keeps the queue visible and refreshes nothing', async () => {
  const app = requestFixture();
  oneInboxCompletion(app);
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);
  const sync = await openRequests(h, app);
  const readsBefore = countOf(h, 'requests');

  sync.failure(new Error('IMPORT_UNAVAILABLE'));
  await settle();

  assert.match(content(h), /IMPORT_UNAVAILABLE/, 'the failure is reported as a warning');
  assert.match(content(h), /2026-12-22/, 'the loaded requests stay visible');
  assert.doesNotMatch(content(h), /完了しました/, 'a failed import never claims success');
  assert.doesNotMatch(notice(h), ACCESS_DENIED, 'an unavailable inbox never revokes');
  assert.equal(countOf(h, 'requests'), readsBefore, 'an ambiguous import is never replayed');
  assert.equal(countOf(h, 'requestSync'), 1);
});
