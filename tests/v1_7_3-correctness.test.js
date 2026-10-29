'use strict';

/**
 * V1.7.3 correctness fixes.
 *
 * 1. `TASK_REQUESTS.Snapshot_Version` is a logical text identifier. An existing cell may hold the
 *    number 1.5 / 1.6 (Sheets typed it as a number), and a whole-row re-validation during a
 *    decision used to fail with `Invalid text: Snapshot_Version`. Only the declared identifier
 *    fields are normalized; every other string field stays strict, and the stored row is never
 *    rewritten just because it was read.
 * 2. An editor-open read that answers after the manager left must never open a form, a native
 *    dialog close (Escape) must discard the form, and an edit must load the latest authorized
 *    row instead of a list row.
 * 3. The application reports its real release version.
 * 4. A parent task beyond the first page stays discoverable through a bounded server search.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const { harness, flush } = require('./support/manager-web-harness');
const { fixture } = require('../scripts/manager-web-preview');

const DOMAIN = { MANAGER_WEB_ALLOWED_DOMAINS: 'example.test' };
const DECIDE = 'DECIDE REQUEST';

function administrator() {
  return fixtures.base({ actor: 'admin@example.test', properties: DOMAIN });
}

/** Writes a value straight into a sheet cell, bypassing application validation. */
function storeCell(instance, table, idName, id, column, value) {
  const sheet = instance.book.getSheetByName(table);
  const headers = sheet.rows[0];
  const idColumn = headers.indexOf(idName);
  const target = headers.indexOf(column);
  assert.ok(idColumn >= 0, idName + ' must be a column');
  assert.ok(target >= 0, column + ' must be a column');
  const index = sheet.rows.findIndex((row, position) => position > 0 && String(row[idColumn]) === String(id));
  assert.ok(index > 0, table + ' row not found: ' + id);
  sheet.rows[index][target] = value;
  return index;
}

function pendingCompletion(instance, requestId, taskId) {
  const c = instance.context, task = c.Database.find('TASKS', taskId || 'T1');
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: requestId, Request_Type: 'COMPLETION_REPORT', Task_ID: task.Task_ID,
    Project_ID: task.Project_ID, Requester_Name: '設計 次郎',
    Submitted_At: '2026-10-01T00:00:00.000Z', Reported_Completion_At: '2026-10-01T00:00:00.000Z',
    Due_Date_At_Submission: c.Domain.date(task.Due_Date), Status: 'PENDING',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(task), Snapshot_Version: '1.6'
  });
  return requestId;
}

function pendingDeadline(instance, requestId, taskId, requested) {
  const c = instance.context, task = c.Database.find('TASKS', taskId || 'T1');
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: requestId, Request_Type: 'DEADLINE_CHANGE', Task_ID: task.Task_ID,
    Project_ID: task.Project_ID, Requester_Name: '設計 次郎',
    Submitted_At: '2026-10-01T00:00:00.000Z', Status: 'PENDING',
    Original_Due_Date: c.Domain.date(task.Due_Date), Due_Date_At_Submission: c.Domain.date(task.Due_Date),
    Requested_Due_Date: requested || '2026-12-22', Reason: '技術的問題',
    Task_Revision_At_Submission: c.SharedDashboardModel.revision(task), Snapshot_Version: '1.6'
  });
  return requestId;
}

function auditActions(c, requestId) {
  return c.Database.read('AUDIT_LOG')
    .filter(row => String(row.Entity_Type) === 'TASK_REQUEST' && String(row.Entity_ID) === String(requestId))
    .map(row => String(row.Action));
}

function decide(instance, requestId, action) {
  return instance.context.Requests.decide(requestId, action, '', DECIDE);
}

/* ------------------------------------------------------------------ *
 * 1.1 Snapshot_Version as a logical text identifier
 * ------------------------------------------------------------------ */

test('a numeric Snapshot_Version cell is normalized to text when the row is read', () => {
  const a = administrator(), c = a.context;
  const id = pendingCompletion(a, 'REQ-NUM-READ');
  storeCell(a, 'TASK_REQUESTS', 'Request_ID', id, 'Snapshot_Version', 1.5);
  const row = c.Database.find('TASK_REQUESTS', id);
  assert.equal(row.Snapshot_Version, '1.5', 'the identifier is text, not a number');
  assert.equal(typeof row.Snapshot_Version, 'string');
  // Reading never rewrites the stored cell.
  const sheet = a.book.getSheetByName('TASK_REQUESTS');
  const column = sheet.rows[0].indexOf('Snapshot_Version');
  const index = sheet.rows.findIndex((cells, position) => position > 0 && cells[0] === id);
  assert.equal(sheet.rows[index][column], 1.5, 'the sheet cell is untouched by a read');
});

test('completion approval works when Snapshot_Version is a numeric cell and applies once', () => {
  const a = administrator(), c = a.context;
  const id = pendingCompletion(a, 'REQ-NUM-COMPLETE');
  storeCell(a, 'TASK_REQUESTS', 'Request_ID', id, 'Snapshot_Version', 1.6);
  const first = decide(a, id, 'APPROVE');
  assert.equal(first.status, 'APPROVED');
  assert.equal(c.Database.find('TASKS', 'T1').Status, 'Done');
  assert.equal(c.Database.find('TASK_REQUESTS', id).Snapshot_Version, '1.6', 'the logical value is preserved');
  // Repeating the same decision refuses to decide twice and repeats no effect.
  assert.throws(() => decide(a, id, 'APPROVE'), /already decided/i);
  assert.equal(auditActions(c, id).filter(action => action === 'REQUEST_EFFECT_APPLIED').length, 1);
  assert.equal(auditActions(c, id).filter(action => action === 'REQUEST_DECIDED').length, 1);
});

test('deadline approval, rejection, return and staleness all work with a numeric Snapshot_Version', () => {
  const a = administrator(), c = a.context;
  const approveId = pendingDeadline(a, 'REQ-NUM-DEADLINE');
  storeCell(a, 'TASK_REQUESTS', 'Request_ID', approveId, 'Snapshot_Version', 1.5);
  storeCell(a, 'TASK_REQUESTS', 'Request_ID', approveId, 'Task_Revision_At_Submission',
    c.SharedDashboardModel.revision(c.Database.find('TASKS', 'T1')));
  decide(a, approveId, 'APPROVE');
  assert.equal(c.Domain.date(c.Database.find('TASKS', 'T1').Due_Date), '2026-12-22');
  assert.equal(c.Database.read('TASK_DEADLINE_HISTORY').length, 1);

  const rejectId = pendingCompletion(a, 'REQ-NUM-REJECT', 'T2');
  storeCell(a, 'TASK_REQUESTS', 'Request_ID', rejectId, 'Snapshot_Version', 1.6);
  decide(a, rejectId, 'REJECT');
  assert.equal(c.Database.find('TASK_REQUESTS', rejectId).Status, 'REJECTED');
  assert.equal(c.Database.find('TASKS', 'T2').Status, 'Assigned', 'a rejection never changes the task');

  const returnId = pendingCompletion(a, 'REQ-NUM-RETURN', 'T2');
  storeCell(a, 'TASK_REQUESTS', 'Request_ID', returnId, 'Snapshot_Version', 1.6);
  decide(a, returnId, 'RETURN');
  assert.equal(c.Database.find('TASK_REQUESTS', returnId).Status, 'RETURNED');

  const staleId = pendingDeadline(a, 'REQ-NUM-STALE', 'T3', '2026-12-30');
  storeCell(a, 'TASK_REQUESTS', 'Request_ID', staleId, 'Snapshot_Version', 1.5);
  c.Database.update('TASKS', 'T3', {Due_Date: '2026-11-20'});
  decide(a, staleId, 'APPROVE');
  assert.equal(c.Database.find('TASK_REQUESTS', staleId).Status, 'STALE');
  assert.equal(c.Domain.date(c.Database.find('TASKS', 'T3').Due_Date), '2026-11-20',
    'a stale request never overwrites the newer deadline');
});

test('only the declared identifier fields are normalized; other text stays strict', () => {
  const a = administrator(), c = a.context;
  const id = pendingDeadline(a, 'REQ-NUM-STRICT');
  // `Reason` is ordinary text: a numeric cell is still an invalid text value.
  storeCell(a, 'TASK_REQUESTS', 'Request_ID', id, 'Reason', 42);
  assert.throws(() => decide(a, id, 'APPROVE'), /Invalid text: Reason/);
  assert.equal(c.Database.find('TASK_REQUESTS', id).Status, 'PENDING', 'nothing was decided');
  assert.equal(c.Domain.date(c.Database.find('TASKS', 'T1').Due_Date), '2026-12-15');
});

/* ------------------------------------------------------------------ *
 * 1.2 / 1.3 Editor lifecycle
 * ------------------------------------------------------------------ */

test('an editor response that arrives after navigating away never opens a form', async () => {
  const a = fixture();
  const h = harness(null, { manual: true });
  await flush();
  h.waiting.shift().success(a.context.managerWebRead('bootstrap'));
  await flush();

  h.click('nav', 'タスク'); await flush();
  const indexCall = h.waiting.shift();
  assert.equal(indexCall.operation, 'taskIndex');
  indexCall.success(a.context.managerWebRead('taskIndex'));
  await flush();

  h.click('content', '編集'); await flush();
  const editorCall = h.waiting.shift();
  assert.equal(editorCall.operation, 'task', 'opening an edit reads the task');

  // The manager leaves before the server answers.
  h.click('nav', '概要'); await flush();
  editorCall.success(a.context.managerWebRead('task', { id: 'T0' }));
  await flush();

  assert.equal(h.window.ManagerWebClient.editor(), null, 'no form may appear after leaving');
  assert.notEqual(h.document.getElementById('editor').open, true, 'the dialog stays closed');
  assert.equal(h.nodes('formHost').length, 0, 'nothing is rendered into the form host');
});

test('a native dialog close (Escape) discards the form and writes nothing', async () => {
  const a = fixture();
  const h = harness((write, operation, payload) => (write
    ? a.context.managerWebWrite(operation, payload)
    : a.context.managerWebRead(operation, payload)));
  await flush();
  h.click('nav', 'タスク'); await flush();
  h.click('content', '編集'); await flush();
  const id = h.window.ManagerWebClient.editor().id;
  const stored = a.context.Database.find('TASKS', id).Task_Name;
  h.fill('taskName', '未保存の値');
  assert.equal(h.window.ManagerWebClient.editor() !== null, true);

  h.document.getElementById('editor').dispatchEvent('close', {});
  await flush();

  assert.equal(h.window.ManagerWebClient.editor(), null, 'the form state is discarded');
  assert.equal(h.nodes('formHost').length, 0, 'the form is removed from the page');
  assert.equal(h.calls.filter(call => call.write).length, 0, 'closing never writes');
  assert.equal(a.context.Database.find('TASKS', id).Task_Name, stored);
  assert.deepEqual([...h.store.keys()].filter(key => key !== 'eh.lang'), [], 'no draft is persisted');
});

test('reopening an editor reads the latest stored row instead of the list row', async () => {
  const a = administrator();
  const h = harness((write, operation, payload) => (write
    ? a.context.managerWebWrite(operation, payload)
    : a.context.managerWebRead(operation, payload)));
  await flush();
  h.click('nav', 'タスク'); await flush();
  h.click('content', '編集'); await flush();
  const id = h.window.ManagerWebClient.editor().id;
  h.click('formHost', '閉じる'); await flush();

  // Another manager changes the row after the list was loaded.
  a.context.Database.update('TASKS', id, {Task_Name: '他の管理者の変更'});
  h.click('content', '編集'); await flush();
  assert.equal(h.window.ManagerWebClient.editor().id, id);
  assert.equal(h.nodes('formHost').find(node => node.name === 'taskName').value, '他の管理者の変更');

  const reads = h.calls.filter(call => call.operation === 'task' && !call.write);
  assert.equal(reads.length, 2, 'each open asks the server for the current row');
  assert.deepEqual(Object.keys(reads[reads.length - 1].payload), ['id'], 'the editor read is scoped to one record ID');
});

test('member, responsibility and subproject editors load through the allowlisted editor read', async () => {
  const a = administrator(), c = a.context;
  c.Database.insert('RESPONSIBILITIES', {Responsibility_ID: 'R1', Name: '製品設計', Status: 'Active', Sort_Order: 1});
  const member = c.managerWebRead('editor', { type: 'member', id: 'M-ENG' });
  assert.equal(member.ok, true, member.error);
  assert.equal(member.data.record.Member_ID, 'M-ENG');
  assert.equal(member.data.record.Name, '設計 次郎');
  assert.equal(typeof member.data.record._revision, 'string');

  const area = c.managerWebRead('editor', { type: 'responsibility', id: 'R1' });
  assert.equal(area.ok, true, area.error);
  assert.equal(area.data.record.Responsibility_ID, 'R1');
  assert.ok(Array.isArray(area.data.record._additionalMemberIds));

  const subproject = c.managerWebRead('editor', { type: 'subproject', id: 'S1' });
  assert.equal(subproject.ok, true, subproject.error);
  assert.equal(subproject.data.record.Subproject_ID, 'S1');

  // No arbitrary table may be read through this operation.
  assert.equal(c.managerWebRead('editor', { type: 'AUDIT_LOG', id: 'x' }).ok, false);
  assert.equal(c.managerWebRead('editor', { type: 'member', id: 'missing' }).ok, false);
});

/* ------------------------------------------------------------------ *
 * 1.4 Release version
 * ------------------------------------------------------------------ */

test('the application reports its release version, separate from schema and contract', () => {
  const a = administrator(), c = a.context;
  const status = c.managerWebRead('status');
  assert.equal(status.ok, true, status.error);
  assert.equal(status.data.version, '1.7.5');
  assert.equal(status.data.schema, 8, 'the schema version stays its own value');
  const bootstrap = c.managerWebRead('bootstrap');
  assert.equal(bootstrap.data.version, '1.7.5');
  assert.equal(bootstrap.data.contract, '1.6', 'the snapshot contract stays its own value');
});

test('the system status page shows the same release version', async () => {
  const a = administrator();
  const h = harness((write, operation, payload) => (write
    ? a.context.managerWebWrite(operation, payload)
    : a.context.managerWebRead(operation, payload)));
  await flush();
  h.click('nav', '管理'); await flush();
  h.click('content', 'システム状態'); await flush();
  const text = h.document.getElementById('content').textContent;
  assert.match(text, /1.7.5/);
  assert.doesNotMatch(text, /1\.6\.1/);
});

/* ------------------------------------------------------------------ *
 * 1.5 Parent task discovery above one page
 * ------------------------------------------------------------------ */

test('the parent search finds a task beyond the first page and keeps the hierarchy rules', () => {
  const a = administrator(), c = a.context;
  const rows = Array.from({ length: 260 }, (_, index) => ({
    Task_ID: 'BULK-' + index, Project_ID: 'P1', Task_Name: 'Bulk task ' + index,
    Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  }));
  fixtures.bulk(a, 'TASKS', rows);

  const first = c.managerWebRead('parentOptions', { projectId: 'P1', subprojectId: '', limit: 200 });
  assert.equal(first.ok, true, first.error);
  assert.ok(first.data.items.length <= 200, 'the page is bounded');
  assert.equal(first.data.complete, false, 'a larger project is reported incomplete');

  const found = c.managerWebRead('parentOptions', { projectId: 'P1', subprojectId: '', query: 'Bulk task 149' });
  assert.equal(found.data.items.length, 1);
  assert.equal(found.data.items[0].id, 'BULK-149');

  // The edited task and its descendants are never offered as its own parent.
  c.Database.update('TASKS', 'BULK-10', {Parent_Task_ID: 'BULK-1'});
  const excluded = c.managerWebRead('parentOptions',
    { projectId: 'P1', subprojectId: '', excludeTaskId: 'BULK-1', query: 'Bulk task' });
  const ids = excluded.data.items.map(item => item.id);
  assert.equal(ids.indexOf('BULK-1'), -1, 'a task is never its own parent');
  assert.equal(ids.indexOf('BULK-10'), -1, 'a descendant is never offered as a parent');
  assert.ok(ids.indexOf('BULK-2') >= 0, 'an unrelated task stays selectable');
});

test('the parent search refuses an unknown project scope and needs a manager', () => {
  const a = administrator(), c = a.context;
  const empty = c.managerWebRead('parentOptions', { projectId: '' });
  assert.equal(empty.ok, true, empty.error);
  assert.equal(empty.data.items.length, 0);
  a.setActor('engineer@example.test');
  const denied = c.managerWebRead('parentOptions', { projectId: 'P1' });
  assert.equal(denied.ok, false, 'a MEMBER cannot read the manager parent search');
});

test('the task editor finds a parent beyond one page through the bounded server search', async () => {
  const a = fixtures.base({ actor: 'admin@example.test', properties: DOMAIN });
  fixtures.bulk(a, 'TASKS', Array.from({ length: 3001 }, (_, index) => ({
    Task_ID: 'BULK-' + index, Project_ID: 'P1', Subproject_ID: '', Task_Name: 'Bulk task ' + index,
    Owner_Member_ID: 'M-ENG', Status: 'Assigned'
  })));
  const h = harness((write, operation, payload) => (write
    ? a.context.managerWebWrite(operation, payload)
    : a.context.managerWebRead(operation, payload)));
  await flush();
  h.click('nav', 'タスク'); await flush();
  h.click('content', '編集'); await flush();

  const reads = h.calls.filter(call => call.operation === 'parentOptions');
  assert.ok(reads.length >= 1, 'the editor asks the server for parent choices');
  assert.equal(reads[0].payload.projectId, 'P1');

  const search = h.nodes('formHost').find(node => node.type === 'search');
  assert.ok(search, 'the parent selector has a name search');
  search.value = 'Bulk task 3000';
  search.dispatchEvent('input', {});
  await flush();

  const last = h.calls.filter(call => call.operation === 'parentOptions').pop();
  assert.equal(last.payload.query, 'Bulk task 3000', 'typing searches the server instead of silently missing it');
  const select = h.nodes('formHost').find(node => node.name === 'parentTaskId');
  assert.ok(select.childNodes.some(option => option.value === 'BULK-3000'),
    'the far task is offered as a parent');
});

test('decision reconciliation works with a numeric Snapshot_Version cell', () => {
  const a = administrator(), c = a.context;
  // An interrupted approval: the request is PROCESSING with no request-specific evidence.
  c.Database.insert('TASK_REQUESTS', {
    Request_ID: 'REQ-NUM-RECON', Request_Type: 'DEADLINE_CHANGE', Task_ID: 'T1', Project_ID: 'P1',
    Requester_Name: '設計 次郎', Submitted_At: '2026-10-01T00:00:00.000Z', Status: 'PROCESSING',
    Original_Due_Date: '2026-12-15', Due_Date_At_Submission: '2026-12-15',
    Requested_Due_Date: '2026-12-30', Reason: '技術的問題', Snapshot_Version: '1.6'
  });
  storeCell(a, 'TASK_REQUESTS', 'Request_ID', 'REQ-NUM-RECON', 'Snapshot_Version', 1.6);
  const preview = c.Requests.previewDecisionReconciliation();
  assert.equal(preview.count, 1);
  assert.equal(preview.items[0].state, 'REVIEW_REQUIRED');
  assert.equal(preview.items[0].safeToConfirm, false);

  c.Requests.resolveDecision('REQ-NUM-RECON', 'MARK_STALE', '', c.Requests.RECONCILE_CONFIRMATION);
  assert.equal(c.Database.find('TASK_REQUESTS', 'REQ-NUM-RECON').Status, 'STALE');
  assert.equal(c.Domain.date(c.Database.find('TASKS', 'T1').Due_Date), '2026-12-15',
    'reconciliation never writes the task');
  assert.equal(c.Requests.previewDecisionReconciliation().count, 0, 'the request left the ambiguous state');
});
