'use strict';
/**
 * V1.6.2 gate 3: employee receipt reconciliation.
 *
 * Spreadsheet A (the private workbook) is authoritative. Spreadsheet C (the request inbox) only
 * carries the receipt the employee sees. When mirroring a manager decision fails, an authorized
 * manager can preview the mismatch and repair *only* the mirrored state.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');
const {MockSpreadsheet} = require('./helpers');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};
const INBOX_ID = 'inbox-reconcile';

function app(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

/** Inbox rows are positional: the manager project reads the strict header contract. */
function inboxWith(instance, rows) {
  const fields = instance.context.Requests.INBOX_FIELDS.slice();
  const book = new MockSpreadsheet(INBOX_ID, {REQUESTS: [fields].concat(rows || [])});
  instance.spreadsheets.set(INBOX_ID, book);
  instance.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', INBOX_ID);
  return book;
}

function inboxRow(instance, data) {
  const fields = instance.context.Requests.INBOX_FIELDS;
  return fields.map(field => (data[field] === undefined ? '' : data[field]));
}

function request(instance, id, status) {
  instance.context.Database.insert('TASK_REQUESTS', {
    Request_ID: id, Request_Type: 'COMPLETION_REPORT', Task_ID: 'T2', Project_ID: 'P1',
    Requester_Name: '自己申告 太郎', Submitted_At: '2026-10-20T01:00:00.000Z',
    Completion_Note: '完了しました。', Status: status,
    Reported_Completion_At: '2026-10-20T01:00:00.000Z'
  });
  return id;
}

function inboxState(book, requestId) {
  const values = book.getSheetByName('REQUESTS').getDataRange().getValues();
  const header = values[0];
  const row = values.filter((cells, index) => index > 0 && cells[header.indexOf('Request_ID')] === requestId)[0];
  return row ? row[header.indexOf('Inbox_State')] : null;
}

const REPAIR = 'RECONCILE REQUEST INBOX';

test('an APPROVED, REJECTED or RETURNED decision is mirrored to a stale receipt', () => {
  for (const status of ['APPROVED', 'REJECTED', 'RETURNED']) {
    const instance = app();
    const internal = instance.context;
    const id = request(instance, 'REQ-' + status, status);
    const book = inboxWith(instance, [inboxRow(instance, {
      Request_ID: id, Request_Type: 'COMPLETION_REPORT', Task_ID: 'T2', Project_ID: 'P1',
      Inbox_State: 'RECEIVED'
    })]);

    const preview = internal.Requests.previewInboxReconciliation();
    assert.equal(preview.available, true, preview.error);
    assert.equal(preview.counts.needsSync, 1, status);
    assert.equal(preview.items[0].state, 'NEEDS_SYNC');

    const repaired = internal.Requests.reconcileInboxStates(REPAIR);
    assert.equal(repaired.updated, 1, status);
    assert.equal(inboxState(book, id), status);
    // The request itself is untouched.
    assert.equal(internal.Database.find('TASK_REQUESTS', id).Status, status);
    assert.equal(internal.Database.find('TASKS', 'T2').Status, 'Assigned', 'the task is never changed');
  }
});

test('a receipt that already matches is not written again', () => {
  const instance = app();
  const internal = instance.context;
  const id = request(instance, 'REQ-SYNCED', 'APPROVED');
  const book = inboxWith(instance, [inboxRow(instance, {
    Request_ID: id, Task_ID: 'T2', Project_ID: 'P1', Inbox_State: 'APPROVED'
  })]);
  const preview = internal.Requests.previewInboxReconciliation();
  assert.equal(preview.counts.synced, 1);
  assert.equal(preview.items[0].state, 'ALREADY_SYNCED');

  // A sentinel makes an accidental rewrite observable.
  book.getSheetByName('REQUESTS').getRange(2, instance.context.Requests.INBOX_FIELDS.indexOf('Inbox_State') + 1)
    .setValue('APPROVED');
  const repaired = internal.Requests.reconcileInboxStates(REPAIR);
  assert.equal(repaired.updated, 0, 'nothing needs to be written');
  assert.equal(inboxState(book, id), 'APPROVED');
});

test('a missing inbox row is reported and never recreated', () => {
  const instance = app();
  const internal = instance.context;
  request(instance, 'REQ-MISSING', 'APPROVED');
  const book = inboxWith(instance, []);
  const preview = internal.Requests.previewInboxReconciliation();
  assert.equal(preview.counts.missing, 1);
  assert.equal(preview.items[0].state, 'MISSING_INBOX_ROW');
  const repaired = internal.Requests.reconcileInboxStates(REPAIR);
  assert.equal(repaired.updated, 0);
  assert.equal(repaired.missing, 1, 'the caller is told, not silently given success');
  assert.equal(book.getSheetByName('REQUESTS').getLastRow(), 1, 'no replacement row is appended');
});

test('a conflicting task identity is refused instead of overwritten', () => {
  const instance = app();
  const internal = instance.context;
  const id = request(instance, 'REQ-CONFLICT', 'APPROVED');
  const book = inboxWith(instance, [inboxRow(instance, {
    Request_ID: id, Task_ID: 'T-OTHER', Project_ID: 'P1', Inbox_State: 'RECEIVED'
  })]);
  const preview = internal.Requests.previewInboxReconciliation();
  assert.equal(preview.counts.mismatch, 1);
  assert.equal(preview.items[0].state, 'IDENTITY_MISMATCH');
  const repaired = internal.Requests.reconcileInboxStates(REPAIR);
  assert.equal(repaired.updated, 0);
  assert.equal(repaired.mismatch, 1);
  assert.equal(inboxState(book, id), 'RECEIVED', 'the conflicting row keeps its value');
});

test('an unavailable inbox changes nothing in the manager workbook', () => {
  const instance = app();
  const internal = instance.context;
  const id = request(instance, 'REQ-NO-INBOX', 'APPROVED');
  // Configured, but the spreadsheet cannot be opened.
  instance.properties.setProperty('REQUEST_INBOX_SPREADSHEET_ID', 'not-there');

  const preview = internal.Requests.previewInboxReconciliation();
  assert.equal(preview.available, false);
  assert.match(preview.error, /not available|not configured/);
  assert.throws(() => internal.Requests.reconcileInboxStates(REPAIR), /管理データは変更していません/);
  assert.equal(internal.Database.find('TASK_REQUESTS', id).Status, 'APPROVED',
    'the authoritative decision survives');
});

test('reconciliation is idempotent across repeated attempts', () => {
  const instance = app();
  const internal = instance.context;
  const id = request(instance, 'REQ-TWICE', 'APPROVED');
  const book = inboxWith(instance, [inboxRow(instance, {
    Request_ID: id, Task_ID: 'T2', Project_ID: 'P1', Inbox_State: 'RECEIVED'
  })]);
  assert.equal(internal.Requests.reconcileInboxStates(REPAIR).updated, 1);
  const second = internal.Requests.reconcileInboxStates(REPAIR);
  assert.equal(second.updated, 0, 'a second attempt writes nothing');
  assert.equal(second.alreadySynced, 1);
  assert.equal(inboxState(book, id), 'APPROVED');
  assert.equal(internal.Database.read('AUDIT_LOG')
    .filter(row => row.Action === 'REQUEST_INBOX_RECONCILED').length, 2,
  'each attempt is recorded, but only one wrote a receipt');
});

test('reconciliation requires a manager, the exact confirmation and leaks no request text', () => {
  const instance = app('manager@example.test');
  const internal = instance.context;
  const id = request(instance, 'REQ-AUTH', 'APPROVED');
  inboxWith(instance, [inboxRow(instance, {
    Request_ID: id, Task_ID: 'T2', Project_ID: 'P1', Inbox_State: 'RECEIVED',
    Requester_Name: '設計 次郎', Reason: '技術的問題', Explanation: '社外秘の詳細',
    Completion_Note: '社外秘の完了メモ'
  })]);
  // A manager may repair.
  assert.throws(() => internal.Requests.reconcileInboxStates(''), /入力が必要/);
  const repaired = internal.Requests.reconcileInboxStates(REPAIR);
  assert.equal(repaired.updated, 1);

  // A member and a viewer may not, even through the browser entrypoints.
  for (const actor of ['engineer@example.test', 'viewer@example.test']) {
    instance.setActor(actor);
    assert.throws(() => internal.previewRequestInboxReconciliation(), /Insufficient role|ADMIN|MANAGER/);
    assert.throws(() => internal.reconcileRequestInbox(REPAIR), /Insufficient role|ADMIN|MANAGER/);
    const viaUi = internal.Ui.requestInboxReconcile({confirmation: REPAIR});
    assert.equal(viaUi.ok, false, 'the sidebar entrypoint is refused too');
  }

  instance.setActor('manager@example.test');
  const payload = internal.previewRequestInboxReconciliation();
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /社外秘|技術的問題|設計 次郎/,
    'requester, reason and note never enter the reconciliation payload');
});

test('reconciliation works while employee submissions are closed and never changes the flag', () => {
  const instance = app();
  const internal = instance.context;
  // The manager project does not own the submission flag; it must not invent or change one.
  assert.equal(instance.properties.getProperty('REQUEST_SUBMISSION_ENABLED'), null);
  const id = request(instance, 'REQ-CLOSED', 'REJECTED');
  const book = inboxWith(instance, [inboxRow(instance, {
    Request_ID: id, Task_ID: 'T2', Project_ID: 'P1', Inbox_State: 'RECEIVED'
  })]);
  assert.equal(internal.Requests.reconcileInboxStates(REPAIR).updated, 1);
  assert.equal(inboxState(book, id), 'REJECTED');
  assert.equal(instance.properties.getProperty('REQUEST_SUBMISSION_ENABLED'), null,
    'the submission flag is neither read nor written');
});

test('the sidebar exposes preview and repair as separate authorized entrypoints', () => {
  const instance = app();
  const internal = instance.context;
  const id = request(instance, 'REQ-UI', 'APPROVED');
  const book = inboxWith(instance, [inboxRow(instance, {
    Request_ID: id, Task_ID: 'T2', Project_ID: 'P1', Inbox_State: 'RECEIVED'
  })]);
  const preview = internal.Ui.requestInboxPreview();
  assert.equal(preview.ok, true, preview.error);
  assert.equal(preview.data.counts.needsSync, 1);
  const repaired = internal.Ui.requestInboxReconcile({confirmation: REPAIR});
  assert.equal(repaired.ok, true, repaired.error);
  assert.equal(repaired.data.updated, 1);
  assert.equal(inboxState(book, id), 'APPROVED');
});
