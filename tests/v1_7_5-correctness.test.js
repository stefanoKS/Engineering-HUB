'use strict';

/**
 * V1.7.5 corrective regression tests — task summaries, the compact task index and the request
 * synchronization lifecycle.
 *
 * Every test drives the real manager client, through the same editor and page entry points a
 * manager uses, against the real Apps Script modules. Server reads and writes are answered by
 * the test, so a superseded, out-of-order or malformed response is reproduced exactly instead of
 * being imitated by a hand-written payload.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const { harness } = require('./support/manager-web-harness');

const DOMAIN = { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' };
const TASKS_NAV = 'タスク';
const PROJECTS_NAV = '案件';
const REQUESTS_NAV = '申請';
const EDIT_LABEL = '編集';
const OPEN_DEADLINE = '2026-12-22';
const DECIDED_DEADLINE = '2026-12-23';

function manager() { return fixtures.base({ actor: 'manager@example.test', properties: DOMAIN }); }
const plain = value => JSON.parse(JSON.stringify(value === undefined ? null : value));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let index = 0; index < 40; index += 1) await tick(); }
const content = h => h.document.getElementById('content').textContent;
const notice = h => h.document.getElementById('notice').textContent;
function summaryOf(store, id) { return store.tasks.items.filter(item => item.id === id)[0]; }
function read(app, operation, payload) {
  const result = app.context.managerWebRead(operation, payload);
  assert.equal(result.ok, true, result.error);
  return result.data;
}
function envelope(app, operation, payload) {
  const result = app.context.managerWebRead(operation, payload);
  assert.equal(result.ok, true, result.error);
  return result;
}
function sheetRowIndex(app, table, idName, id) {
  const sheet = app.book.getSheetByName(table);
  const column = sheet.rows[0].indexOf(idName);
  assert.ok(column >= 0, idName + ' must be a column');
  return sheet.rows.findIndex((cells, position) => position > 0 && String(cells[column]) === String(id));
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
  if (!h.waiting.some(entry => entry.operation === operation)) return null;
  const call = takeCall(h, operation);
  const result = app.context.managerWebRead(call.operation, call.payload);
  assert.equal(result.ok, true, result.error);
  call.success(result);
  await settle();
  return call;
}

/** Answers every queued call in dispatch order. */
async function drain(h, app) {
  while (h.waiting.length) await answerNext(h, app);
}

async function bootTasks(h, app) {
  await tick();
  await answerNext(h, app);
  h.click('nav', TASKS_NAV);
  await answerNext(h, app);
  assert.equal(h.window.ManagerWebClient.store.tasks.loaded, true, 'the index must be loaded');
  return h.window.ManagerWebClient.store;
}

/** Clicks 編集 inside the task card of one task (never another row's button). */
function clickEditOf(h, taskName) {
  const cards = h.document.getElementById('content').descendants()
    .filter(node => String(node.className || '').indexOf('task-card') >= 0);
  const card = cards.filter(node => node.textContent.indexOf(taskName) >= 0)[0];
  assert.ok(card, 'no task card for ' + taskName);
  const edit = card.descendants().filter(node => node.tagName === 'BUTTON' && node.textContent === EDIT_LABEL)[0];
  assert.ok(edit, 'no edit button for ' + taskName);
  edit.dispatchEvent('click', {});
}

/** Opens the editor of one task and answers the reads the form needs. */
async function openTaskEditor(h, app, taskName) {
  clickEditOf(h, taskName);
  await settle();
  await drain(h, app);
  const editor = h.window.ManagerWebClient.editor();
  assert.ok(editor, 'the editor must be open');
  return editor;
}

/** Sets one form control: a checkbox by state, everything else by value. */
function setField(h, name, value) {
  const control = h.nodes('formHost').filter(node => node.name === name)[0];
  assert.ok(control, 'no form control named ' + name);
  if (typeof value === 'boolean') {
    control.checked = value;
    control.dispatchEvent('change', {});
    return control;
  }
  control.value = value;
  control.dispatchEvent('input', {});
  control.dispatchEvent('change', {});
  return control;
}

/**
 * Submits the open form and answers the write with the real server result, leaving the
 * follow-up read of the save pending for the caller.
 */
async function submitEditor(h, app, fields) {
  Object.keys(fields || {}).forEach(name => setField(h, name, fields[name]));
  await settle();
  await drain(h, app);
  h.submit();
  await settle();
  assert.ok(h.waiting.length >= 1, 'the save must be dispatched');
  const call = h.waiting.shift();
  assert.equal(call.write, true, 'a save is a write');
  const result = app.context.managerWebWrite(call.operation, call.payload);
  assert.equal(result.ok, true, result.error);
  call.success(result);
  await settle();
  return call;
}

/* ------------------------------------------------------------------ *
 * 1.1 Task summaries keep their server-derived metadata after a save
 * ------------------------------------------------------------------ */

function assigneeFixture() {
  const app = manager();
  app.context.Tasks.update('T1', { Additional_Assignee_IDs: ['M-MGR', 'M-VIEW'] });
  return app;
}

test('an edited task keeps every derived field until the authoritative index answers', async () => {
  const app = assigneeFixture();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  const before = plain(summaryOf(store, 'T1'));
  assert.deepEqual(before.assigneeIds, ['M-ENG', 'M-MGR', 'M-VIEW']);
  assert.equal(before.sharedAssignment, true);
  assert.equal(before.container, false);
  assert.equal(before.depth, 0);

  await openTaskEditor(h, app, '機構設計');
  await submitEditor(h, app, { taskName: '機構設計 改訂' });

  const patched = plain(summaryOf(store, 'T1'));
  assert.equal(patched.name, '機構設計 改訂', 'the authoritative field is applied immediately');
  assert.equal(patched.container, before.container, 'container status is never invented');
  assert.equal(patched.depth, before.depth, 'depth is never reset to zero');
  assert.equal(patched.reviewState, before.reviewState, 'the review state is never blanked');
  assert.deepEqual(patched.assigneeIds, before.assigneeIds, 'the effective assignees are preserved');
  assert.deepEqual(patched.assigneeNames, before.assigneeNames);
  assert.equal(patched.sharedAssignment, true, 'the shared-assignment flag survives a save');
  assert.equal(patched.responsibilityId, before.responsibilityId);

  await answerNext(h, app);
  const served = read(app, 'tasks', { limit: 100 }).items.filter(task => task.id === 'T1')[0];
  assert.deepEqual(plain(summaryOf(store, 'T1')), plain(served),
    'the refreshed summary is exactly the authoritative summary');
});

test('a task save answers with one index read and no whole-snapshot refresh', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await bootTasks(h, app);

  await openTaskEditor(h, app, '要件整理');
  const before = h.calls.length;
  await submitEditor(h, app, { taskName: '要件整理 改訂' });
  await answerNext(h, app);

  assert.deepEqual(h.calls.slice(before).map(call => call.operation), ['taskSave', 'taskIndex'],
    'the task page refreshes the compact index only');
});

test('changing the primary owner and the additional assignees is reflected after the refresh', async () => {
  const app = assigneeFixture();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);

  await openTaskEditor(h, app, '機構設計');
  await submitEditor(h, app, { ownerId: 'M-MGR' });
  const patched = plain(summaryOf(store, 'T1'));
  assert.equal(patched.ownerId, 'M-MGR', 'the new primary owner is applied from the save result');
  assert.equal(patched.owner, '管理 花子', 'the display name follows the owner the snapshot knows');
  assert.deepEqual(patched.assigneeIds, ['M-ENG', 'M-MGR', 'M-VIEW'],
    'the previous assignee list stays until the server answers');

  await answerNext(h, app);
  assert.deepEqual(plain(summaryOf(store, 'T1').assigneeIds), ['M-MGR', 'M-VIEW'],
    'the authoritative list drops the member that is no longer assigned');
  assert.deepEqual(plain(summaryOf(store, 'T1').assigneeNames), ['管理 花子', '閲覧 三郎']);
  assert.equal(summaryOf(store, 'T1').owner, '管理 花子');
});

test('removing every additional assignee produces a single-assignee summary', async () => {
  const app = assigneeFixture();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(summaryOf(store, 'T1').sharedAssignment, true);

  await openTaskEditor(h, app, '機構設計');
  const chips = h.nodes('formHost').filter(node => String(node.className || '') === 'chip member-chip');
  assert.equal(chips.length, 2, 'both additional assignees are shown');
  chips.forEach(chip => {
    const remove = chip.descendants().filter(node => node.tagName === 'BUTTON')[0];
    assert.ok(remove, 'every chip has a remove button');
    remove.dispatchEvent('click', {});
  });
  await settle();
  assert.equal(summaryOf(store, 'T1').sharedAssignment, true, 'the flag is not guessed from the form');

  h.submit();
  await settle();
  const call = h.waiting.shift();
  assert.equal(call.operation, 'taskSave');
  assert.deepEqual(plain(call.payload.additionalAssigneeIds), []);
  const result = app.context.managerWebWrite(call.operation, call.payload);
  assert.equal(result.ok, true, result.error);
  call.success(result);
  await settle();

  await answerNext(h, app);
  assert.deepEqual(plain(summaryOf(store, 'T1').assigneeIds), ['M-ENG']);
  assert.equal(summaryOf(store, 'T1').sharedAssignment, false);
});

test('editing a parent task keeps its container flag and its subtask depth', async () => {
  const app = manager();
  app.context.Database.insert('TASKS', { Task_ID: 'T1-CHILD', Project_ID: 'P1', Subproject_ID: 'S1',
    Parent_Task_ID: 'T1', Task_Name: '詳細検討', Owner_Member_ID: 'M-ENG', Status: 'Assigned',
    Priority: 'Medium', Due_Date: '2026-12-10' });
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(summaryOf(store, 'T1').container, true, 'the fixture parent is a container');
  assert.equal(summaryOf(store, 'T1-CHILD').depth, 1);

  await openTaskEditor(h, app, '機構設計');
  await submitEditor(h, app, { taskName: '機構設計 改訂' });
  assert.equal(summaryOf(store, 'T1').container, true, 'the edit does not turn a parent into a leaf');
  assert.equal(summaryOf(store, 'T1-CHILD').depth, 1, 'the child keeps its depth');

  await answerNext(h, app);
  assert.equal(summaryOf(store, 'T1').container, true);
  assert.equal(summaryOf(store, 'T1-CHILD').depth, 1);
});

test('moving a task to another parent updates depth and container status after the refresh', async () => {
  const app = manager();
  const db = app.context.Database;
  db.insert('TASKS', { Task_ID: 'T1-CHILD', Project_ID: 'P1', Subproject_ID: 'S1',
    Parent_Task_ID: 'T1', Task_Name: '詳細検討', Owner_Member_ID: 'M-ENG', Status: 'Assigned',
    Priority: 'Medium', Due_Date: '2026-12-10' });
  db.insert('TASKS', { Task_ID: 'T2-CHILD', Project_ID: 'P1', Subproject_ID: 'S1',
    Parent_Task_ID: 'T2', Task_Name: '要件の詳細', Owner_Member_ID: 'M-ENG', Status: 'Assigned',
    Priority: 'Medium', Due_Date: '2026-12-11' });
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(summaryOf(store, 'T1-CHILD').depth, 1);
  assert.equal(summaryOf(store, 'T2-CHILD').container, false);

  await openTaskEditor(h, app, '詳細検討');
  // A parent must share the project and subproject, so the move stays inside S1.
  const parentSelect = h.nodes('formHost').filter(node => node.tagName === 'SELECT' && node.value === 'T1')[0];
  assert.ok(parentSelect, 'the parent selector holds the current parent');
  parentSelect.value = 'T2-CHILD';
  parentSelect.dispatchEvent('change', {});
  await settle();
  h.submit();
  await settle();
  const move = h.waiting.shift();
  assert.equal(move.operation, 'taskSave');
  const moved = app.context.managerWebWrite(move.operation, move.payload);
  assert.equal(moved.ok, true, moved.error);
  move.success(moved);
  await settle();

  assert.equal(summaryOf(store, 'T1-CHILD').parentId, 'T2-CHILD', 'the new parent is applied at once');
  assert.equal(summaryOf(store, 'T1-CHILD').depth, 1, 'the depth is not guessed locally');

  await answerNext(h, app);
  assert.equal(summaryOf(store, 'T1-CHILD').parentId, 'T2-CHILD');
  assert.equal(summaryOf(store, 'T1-CHILD').depth, 2, 'the authoritative depth is applied');
  assert.equal(summaryOf(store, 'T1').container, false, 'the previous parent is a leaf again');
  assert.equal(summaryOf(store, 'T2-CHILD').container, true);
});

test('a task awaiting completion approval keeps its pending review state after a save', async () => {
  const app = manager();
  const c = app.context, task = c.Database.find('TASKS', 'T1');
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: 'REQ-PENDING-1', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T1',
    Project_ID: task.Project_ID, Requester_Name: '設計 次郎',
    Submitted_At: '2026-10-01T00:00:00.000Z', Reported_Completion_At: '2026-10-01T00:00:00.000Z',
    Due_Date_At_Submission: c.Domain.date(task.Due_Date), Status: 'PENDING',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(task), Snapshot_Version: '1.6'
  });
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(summaryOf(store, 'T1').reviewState, 'PENDING', 'the fixture request is pending');

  await openTaskEditor(h, app, '機構設計');
  await submitEditor(h, app, { priority: 'High' });
  assert.equal(summaryOf(store, 'T1').reviewState, 'PENDING', 'an unrelated save never clears a pending review');

  await answerNext(h, app);
  assert.equal(summaryOf(store, 'T1').reviewState, 'PENDING');
  assert.equal(summaryOf(store, 'T1').priority, 'High');
});

test('a stale completion-approval state survives an unrelated save', async () => {
  const app = manager();
  const c = app.context, task = c.Database.find('TASKS', 'T1');
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: 'REQ-STALE-1', Request_Type: 'COMPLETION_REPORT', Task_ID: 'T1',
    Project_ID: task.Project_ID, Requester_Name: '設計 次郎',
    Submitted_At: '2026-10-01T00:00:00.000Z', Reported_Completion_At: '2026-10-01T00:00:00.000Z',
    Due_Date_At_Submission: c.Domain.date(task.Due_Date), Status: 'STALE',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(task), Snapshot_Version: '1.6'
  });
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(summaryOf(store, 'T1').reviewState, 'STALE');

  await openTaskEditor(h, app, '機構設計');
  await submitEditor(h, app, { deadline: '2026-12-21', confirmDeadlineChange: true });
  assert.equal(summaryOf(store, 'T1').reviewState, 'STALE', 'the stale marker is not reset locally');

  await answerNext(h, app);
  assert.equal(summaryOf(store, 'T1').reviewState, 'STALE', 'the server still reports the stale request');
  assert.equal(summaryOf(store, 'T1').deadline, '2026-12-21');
});

test('a created task appears from the authoritative index with its derived values', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  const before = store.tasks.total;

  h.click('content', '新規作成');
  await settle();
  await drain(h, app);
  setField(h, 'projectId', 'P1');
  await settle();
  await drain(h, app);
  setField(h, 'taskName', '新規タスク');
  setField(h, 'ownerId', 'M-ENG');
  setField(h, 'deadline', '2026-12-24');
  await settle();
  h.submit();
  await settle();
  const create = h.waiting.shift();
  assert.equal(create.operation, 'taskSave');
  const created = app.context.managerWebWrite(create.operation, create.payload);
  assert.equal(created.ok, true, created.error);
  create.success(created);
  await settle();

  assert.equal(store.tasks.total, before, 'the count is not guessed locally');
  assert.equal(store.tasks.items.some(task => task.name === '新規タスク'), false);

  await answerNext(h, app);
  const summary = store.tasks.items.filter(task => task.name === '新規タスク')[0];
  assert.ok(summary, 'the created task is listed');
  assert.equal(summary.project, '検査装置');
  assert.equal(summary.owner, '設計 次郎');
  assert.deepEqual(plain(summary.assigneeIds), ['M-ENG']);
  assert.equal(summary.sharedAssignment, false);
  assert.equal(summary.container, false);
  assert.equal(summary.depth, 0);
  assert.equal(store.tasks.total, before + 1, 'the authoritative count replaces the snapshot count');
});

test('an outdated index answer never replaces a newer save result', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);

  await openTaskEditor(h, app, '機構設計');
  await submitEditor(h, app, { taskName: '古い名前' });
  // The first save's index read stays unanswered; its answer describes that save only.
  const staleRead = takeCall(h, 'taskIndex');
  const staleEnvelope = envelope(app, 'taskIndex', {});
  assert.equal(staleEnvelope.data.rows.length, 3);

  // A second save happens before the first answer is delivered.
  clickEditOf(h, '古い名前');
  await settle();
  const detailRead = takeCall(h, 'task');
  const detail = app.context.managerWebRead('task', detailRead.payload);
  assert.equal(detail.ok, true, detail.error);
  detailRead.success(detail);
  await settle();
  await answerIfQueued(h, app, 'project');
  setField(h, 'taskName', '新しい名前');
  await settle();
  h.submit();
  await settle();
  const write = takeCall(h, 'taskSave');
  const written = app.context.managerWebWrite(write.operation, write.payload);
  assert.equal(written.ok, true, written.error);
  write.success(written);
  await settle();

  // The newer save started its own read; it is answered first, the older answer last.
  takeCall(h, 'taskIndex').success(envelope(app, 'taskIndex', {}));
  await settle();
  staleRead.success(staleEnvelope);
  await settle();
  await drain(h, app);

  assert.equal(summaryOf(store, 'T1').name, '新しい名前', 'the superseded answer is discarded');
  assert.equal(store.tasks.items.filter(task => task.id === 'T1').length, 1);
});

/* ------------------------------------------------------------------ *
 * 1.3 Task-index mismatch recovery
 * ------------------------------------------------------------------ */

test('an index with a changed record count is accepted instead of leaving the page loading', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(store.tasks.total, 3);

  // Somebody else creates a task between the snapshot and the next index read.
  app.context.Database.insert('TASKS', { Task_ID: 'T9', Project_ID: 'P1', Task_Name: '追加作業',
    Owner_Member_ID: 'M-ENG', Status: 'Assigned', Priority: 'Medium', Due_Date: '2026-12-28' });
  await openTaskEditor(h, app, '機構設計');
  await submitEditor(h, app, { taskName: '機構設計 改訂' });
  await answerNext(h, app);

  assert.equal(store.tasks.loaded, true, 'the page is not left in a loading state');
  assert.equal(store.tasks.total, 4, 'the newer count is authoritative');
  assert.notEqual(summaryOf(store, 'T9'), undefined);
  assert.match(content(h), /追加作業/);
  assert.doesNotMatch(content(h), /読み込み中/);
});

test('a record count that shrinks is accepted as the newer authoritative index', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  const store = await bootTasks(h, app);
  assert.equal(store.tasks.total, 3);

  app.book.getSheetByName('TASKS').deleteRow(sheetRowIndex(app, 'TASKS', 'Task_ID', 'T2') + 1);
  assert.equal(read(app, 'bootstrap').tasks.total, 2, 'the fixture really lost a record');
  await openTaskEditor(h, app, '機構設計');
  await submitEditor(h, app, { taskName: '機構設計 改訂' });
  await answerNext(h, app);

  assert.equal(store.tasks.loaded, true);
  assert.equal(store.tasks.total, 2);
  assert.equal(summaryOf(store, 'T2'), undefined);
  assert.doesNotMatch(content(h), /読み込み中/);
});

async function openTasksWithIndexAnswer(h, payload) {
  h.click('nav', TASKS_NAV);
  const call = h.waiting.shift();
  assert.equal(call.operation, 'taskIndex');
  if (payload instanceof Error) call.failure(payload); else call.success(payload);
  await settle();
  return call;
}

test('an unusable index payload recovers through the snapshot and the paginated page', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await tick();
  await answerNext(h, app);

  await openTasksWithIndexAnswer(h, { ok: true, data: {} });
  assert.equal(h.waiting[0].operation, 'bootstrap', 'the snapshot is refreshed once');
  await answerNext(h, app);
  assert.equal(h.waiting[0].operation, 'taskIndex', 'the index is retried with a fresh count');
  h.waiting.shift().success({ ok: true, data: {} });
  await settle();
  assert.equal(h.waiting[0].operation, 'tasks', 'the paginated path answers an unusable index');
  await answerNext(h, app);

  assert.match(content(h), /機構設計/, 'the task list is displayed');
  assert.doesNotMatch(content(h), /読み込み中/, 'no permanent loading state');
  assert.ok(h.calls.filter(call => call.operation === 'taskIndex').length <= 2, 'the recovery is bounded');
});

test('an index without rows or columns is treated as unusable', async () => {
  const payloads = [{ columns: ['id'], total: 3 }, { rows: [], total: 3 }, { columns: [], rows: [], total: 3 },
    { columns: ['id'], rows: [[]], total: 1 }];
  for (const payload of payloads) {
    const app = manager();
    const h = clientOf(app, { manual: true });
    await tick();
    await answerNext(h, app);
    await openTasksWithIndexAnswer(h, { ok: true, data: payload });
    await answerNext(h, app);
    h.waiting.shift().success({ ok: true, data: payload });
    await settle();
    await answerNext(h, app);
    assert.match(content(h), /機構設計/, 'the paginated list answers instead: ' + JSON.stringify(payload));
    assert.doesNotMatch(content(h), /読み込み中/);
  }
});

test('an index whose rows disagree with its own total is refused', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await tick();
  await answerNext(h, app);
  const real = read(app, 'taskIndex');
  const lying = { columns: real.columns, rows: real.rows, total: 99, complete: true, limit: 3000 };
  await openTasksWithIndexAnswer(h, { ok: true, data: lying });
  await answerNext(h, app);
  h.waiting.shift().success({ ok: true, data: lying });
  await settle();
  await answerNext(h, app);
  assert.match(content(h), /機構設計/, 'the authoritative page is shown');
  assert.equal(h.window.ManagerWebClient.store.tasks.total, 3);
});

test('a server failure on the index is recovered by one snapshot read and one retry', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await tick();
  await answerNext(h, app);

  await openTasksWithIndexAnswer(h, { ok: false, error: 'Sheets read failed' });
  assert.equal(h.waiting[0].operation, 'bootstrap');
  await answerNext(h, app);
  assert.equal(h.waiting[0].operation, 'taskIndex');
  await answerNext(h, app);

  assert.match(content(h), /機構設計/);
  assert.doesNotMatch(content(h), /読み込み中/);
  assert.equal(h.window.ManagerWebClient.store.tasks.loaded, true);
});

test('a failing snapshot refresh leaves a readable error and a retry, never a loading state', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await tick();
  await answerNext(h, app);

  await openTasksWithIndexAnswer(h, new Error('index read failed'));
  assert.equal(h.waiting[0].operation, 'bootstrap');
  h.waiting.shift().failure(new Error('bootstrap failed'));
  await settle();

  assert.match(notice(h), /bootstrap failed/, 'the failure is reported');
  assert.match(content(h), /再試行/, 'the page offers a retry');
  assert.doesNotMatch(content(h), /読み込み中/);
  await settle();
  assert.equal(h.waiting.length, 0, 'no automatic retry loop is started');
});

test('an index above the compact bound falls back to the paginated page', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await tick();
  await answerNext(h, app);

  await openTasksWithIndexAnswer(h, { ok: true, data: { columns: [], rows: [], total: 4000, complete: false, limit: 3000 } });
  assert.equal(h.waiting[0].operation, 'tasks');
  await answerNext(h, app);
  assert.match(content(h), /機構設計/);
  assert.equal(h.window.ManagerWebClient.store.tasks.complete, false);
  assert.equal(h.window.ManagerWebClient.store.tasks.loaded, false);
  assert.doesNotMatch(content(h), /読み込み中/);
});

test('rapid navigation between tasks and projects never leaves a loading state', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await tick();
  await answerNext(h, app);
  h.click('nav', TASKS_NAV);
  h.click('nav', PROJECTS_NAV);
  await settle();
  await drain(h, app);
  h.click('nav', TASKS_NAV);
  await drain(h, app);
  assert.match(content(h), /機構設計/);
  assert.doesNotMatch(content(h), /読み込み中/);
});

test('the filter bar and the area scope stay usable after a recovery', async () => {
  const app = manager();
  const h = clientOf(app, { manual: true });
  await tick();
  await answerNext(h, app);
  await openTasksWithIndexAnswer(h, { ok: true, data: {} });
  await answerNext(h, app);
  h.waiting.shift().success({ ok: true, data: {} });
  await settle();
  await answerNext(h, app);

  const assignee = h.nodes('content').filter(node => node.name === 'assigneeId')[0];
  assert.ok(assignee, 'the filter bar is still rendered');
  assignee.value = 'M-ENG';
  assignee.dispatchEvent('change', {});
  await settle();
  assert.match(content(h), /機構設計/);
});

/* ------------------------------------------------------------------ *
 * 1.2 Request synchronization generation
 * ------------------------------------------------------------------ */

function requestFixture() {
  const app = manager();
  const c = app.context, task = c.Database.find('TASKS', 'T1');
  const shared = { Task_ID: 'T1', Project_ID: task.Project_ID, Requester_Name: '設計 次郎',
    Submitted_At: '2026-10-01T00:00:00.000Z',
    Original_Due_Date: c.Domain.date(task.Due_Date), Due_Date_At_Submission: c.Domain.date(task.Due_Date),
    Reason: '技術的問題',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(task), Snapshot_Version: '1.6' };
  c.Database.insert('TASK_REQUESTS', Object.assign({}, shared, {
    Request_ID: 'REQ-OPEN', Request_Type: 'DEADLINE_CHANGE', Status: 'PENDING',
    Requested_Due_Date: OPEN_DEADLINE
  }));
  c.Database.insert('TASK_REQUESTS', Object.assign({}, shared, {
    Request_ID: 'REQ-DECIDED', Request_Type: 'DEADLINE_CHANGE', Status: 'APPROVED',
    Requested_Due_Date: DECIDED_DEADLINE, Decided_At: '2026-10-02T00:00:00.000Z',
    Reviewer: 'manager@example.test'
  }));
  return app;
}

/** Boots the client, opens 申請 and returns the still-pending import of that page entry. */
async function bootRequests(h, app) {
  await tick();
  await answerNext(h, app);
  h.click('nav', REQUESTS_NAV);
  await settle();
  assert.equal(h.waiting[0].operation, 'requests', 'the queue is read first');
  await answerNext(h, app);
  assert.equal(h.waiting[0].operation, 'requestSync', 'one import per page entry');
  return h.waiting.shift();
}

test('an older request synchronization never overwrites a newer page entry', async () => {
  const app = requestFixture();
  const h = clientOf(app, { manual: true });
  const abandoned = await bootRequests(h, app);

  h.click('nav', PROJECTS_NAV);
  await settle();
  await drain(h, app);
  h.click('nav', REQUESTS_NAV);
  await settle();
  const current = h.waiting.shift();
  assert.equal(current.operation, 'requestSync', 'the new entry starts its own import');
  current.success(app.context.managerWebWrite('requestSync', current.payload));
  await settle();
  assert.match(content(h), /2026-12-22/, 'the newer entry shows the queue');

  const stale = app.context.managerWebWrite('requestSync', abandoned.payload);
  stale.data = Object.assign({}, stale.data, { importError: 'ABANDONED-VISIT' });
  abandoned.success(stale);
  await settle();
  assert.doesNotMatch(content(h), /ABANDONED-VISIT/, 'an abandoned result never paints');
  assert.match(content(h), /2026-12-22/);
});

test('a failure from an abandoned visit does not set the current error state', async () => {
  const app = requestFixture();
  const h = clientOf(app, { manual: true });
  const abandoned = await bootRequests(h, app);

  h.click('nav', PROJECTS_NAV);
  await settle();
  await drain(h, app);
  h.click('nav', REQUESTS_NAV);
  await settle();
  const current = h.waiting.shift();

  abandoned.failure(new Error('IMPORT_TIMEOUT_FROM_ABANDONED_VISIT'));
  await settle();
  assert.doesNotMatch(content(h), /IMPORT_TIMEOUT_FROM_ABANDONED_VISIT/);
  assert.doesNotMatch(notice(h), /IMPORT_TIMEOUT_FROM_ABANDONED_VISIT/);

  current.success(app.context.managerWebWrite('requestSync', current.payload));
  await settle();
  assert.match(content(h), /2026-12-22/);
  assert.doesNotMatch(notice(h), /IMPORT_TIMEOUT_FROM_ABANDONED_VISIT/);
});

test('a filter change during the import keeps the newer filter result', async () => {
  const app = requestFixture();
  const h = clientOf(app, { manual: true });
  const openImport = await bootRequests(h, app);
  assert.equal(openImport.payload.includeDecided, false);

  const toggle = h.nodes('content').filter(node => node.name === 'showDecided')[0];
  assert.ok(toggle, 'the show-decided filter is rendered');
  toggle.checked = true;
  toggle.dispatchEvent('change', {});
  await settle();
  assert.equal(h.waiting.length, 1, 'the filter change issues its own read');
  assert.equal(h.waiting[0].operation, 'requests');
  assert.equal(h.waiting[0].payload.includeDecided, true);
  await answerNext(h, app);
  assert.match(content(h), /2026-12-23/, 'the decided request is listed for the new filter');

  const openOnly = app.context.managerWebWrite('requestSync', openImport.payload);
  assert.equal(openOnly.data.requests.length, 1);
  openImport.success(openOnly);
  await settle();
  assert.match(content(h), /2026-12-23/, 'the superseded import result does not narrow the list');
  assert.equal(h.waiting.length, 0, 'the superseded answer starts no extra read');
});

test('one import happens per page entry and a filter change never re-imports', async () => {
  const app = requestFixture();
  const h = clientOf(app, { manual: true });
  const call = await bootRequests(h, app);
  call.success(app.context.managerWebWrite('requestSync', call.payload));
  await settle();
  assert.equal(h.calls.filter(entry => entry.operation === 'requestSync').length, 1);

  const toggle = h.nodes('content').filter(node => node.name === 'showDecided')[0];
  toggle.checked = true;
  toggle.dispatchEvent('change', {});
  await settle();
  await drain(h, app);
  assert.equal(h.calls.filter(entry => entry.operation === 'requestSync').length, 1,
    'a filter change reads the queue; it never repeats the import');
  assert.equal(app.context.Database.read('TASK_REQUESTS').length, 2, 'no duplicate request is created');
});

test('a failed import is reported and the queue stays visible', async () => {
  const app = requestFixture();
  const h = clientOf(app, { manual: true });
  const call = await bootRequests(h, app);
  call.failure(new Error('IMPORT_UNAVAILABLE'));
  await settle();
  assert.match(content(h), /IMPORT_UNAVAILABLE/, 'the failure is reported as a warning');
  assert.match(content(h), /2026-12-22/, 'the imported requests stay visible');
  assert.equal(h.waiting.length, 0, 'an ambiguous write is never retried automatically');
});
