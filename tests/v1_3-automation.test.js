'use strict';

/**
 * V1.3 request automation: safe defaults, the centralized send gate and per-feature toggles.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

function deadlineRequest(overrides) {
  return Object.assign({
    Request_ID: 'REQ-TEST-1', Request_Type: 'DEADLINE_CHANGE', Task_ID: 'T1', Project_ID: 'P1',
    Requester_Name: '設計 次郎', Submitted_At: new Date().toISOString(),
    Original_Due_Date: '2026-12-15', Requested_Due_Date: '2026-12-22',
    Reason: '技術的問題', Explanation: '光学系の再評価が必要です。', Status: 'PENDING'
  }, overrides || {});
}

function completionRequest(overrides) {
  return deadlineRequest(Object.assign({
    Request_ID: 'REQ-TEST-2', Request_Type: 'COMPLETION_REPORT',
    Requested_Due_Date: '', Completion_Note: '完了しました。'
  }, overrides || {}));
}

function withRecipients(instance, extra) {
  fixtures.settings(instance, Object.assign({
    MANAGEMENT_REPORT_RECIPIENTS: 'manager@example.test'
  }, extra || {}));
  return instance;
}

/** A LIVE workbook: the legacy safety flags must also permit real sending. */
function liveApp() {
  return fixtures.live({ properties: { EMAIL_ENABLED: 'true', DRY_RUN: 'false' } });
}

test('request notification switches default to OFF and obey the master mode', () => {
  const app = fixtures.base();
  const state = app.context.AutomationSettings.emailState(app.context.Config.get());
  assert.equal(app.context.AutomationSettings.DEFAULTS.DEADLINE_REQUEST_EMAIL_ENABLED, false);
  assert.equal(app.context.AutomationSettings.DEFAULTS.COMPLETION_REPORT_EMAIL_ENABLED, false);
  assert.equal(app.context.AutomationSettings.DEFAULTS.PENDING_REQUEST_REMINDER_ENABLED, false);
  assert.equal(state.mode, 'OFF');
  assert.equal(state.toggles.DEADLINE_REQUEST, false);
  assert.equal(state.toggles.COMPLETION_REPORT, false);
  assert.equal(state.toggles.PENDING_REQUEST_REMINDER, false);
});

test('nothing is sent before notifications are activated', () => {
  const app = withRecipients(fixtures.base(), { DEADLINE_REQUEST_EMAIL_ENABLED: true });
  const result = app.context.Notifications.notifyRequestSubmitted(deadlineRequest());
  assert.equal(result.reason, 'NOT_ACTIVATED');
  assert.equal(app.sentEmails.length, 0);
});

test('OFF mode never sends a request notification', () => {
  const app = fixtures.base();
  fixtures.activate(app);
  withRecipients(app, { DEADLINE_REQUEST_EMAIL_ENABLED: true, EMAIL_MODE: 'OFF' });
  const result = app.context.Notifications.notifyRequestSubmitted(deadlineRequest());
  assert.equal(app.sentEmails.length, 0);
  assert.equal(result.sent, 0);
});

test('PREVIEW records a preview and never sends real mail', () => {
  const app = fixtures.base();
  fixtures.activate(app);
  withRecipients(app, { DEADLINE_REQUEST_EMAIL_ENABLED: true, EMAIL_MODE: 'PREVIEW', EMERGENCY_STOP: false });
  const result = app.context.Notifications.notifyRequestSubmitted(deadlineRequest());
  assert.equal(app.sentEmails.length, 0);
  assert.equal(result.preview, 1);
  const ledger = app.context.Database.read('NOTIFICATION_LOG');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].Result, 'PREVIEW');
});

test('LIVE sends once and the ledger deduplicates a repeated notification', () => {
  const app = liveApp();
  withRecipients(app, { DEADLINE_REQUEST_EMAIL_ENABLED: true });
  app.context.Notifications.notifyRequestSubmitted(deadlineRequest());
  assert.equal(app.sentEmails.length, 1);
  assert.match(app.sentEmails[0].subject, /申請受付/);
  assert.match(app.sentEmails[0].body, /光学系/);
  app.context.Notifications.notifyRequestSubmitted(deadlineRequest());
  assert.equal(app.sentEmails.length, 1, 'the same request is never notified twice');
});

test('the deadline and completion switches are independent', () => {
  const app = liveApp();
  withRecipients(app, { DEADLINE_REQUEST_EMAIL_ENABLED: false, COMPLETION_REPORT_EMAIL_ENABLED: true });
  const deadline = app.context.Notifications.notifyRequestSubmitted(deadlineRequest());
  assert.equal(deadline.reason, 'REQUEST_NOTIFICATIONS_DISABLED');
  assert.equal(app.sentEmails.length, 0);

  app.context.Notifications.notifyRequestSubmitted(completionRequest());
  assert.equal(app.sentEmails.length, 1);
  assert.match(app.sentEmails[0].subject, /完了報告/);
});

test('the emergency stop blocks every request notification', () => {
  const app = liveApp();
  withRecipients(app, { DEADLINE_REQUEST_EMAIL_ENABLED: true, EMERGENCY_STOP: true });
  const result = app.context.Notifications.notifyRequestSubmitted(deadlineRequest());
  assert.equal(app.sentEmails.length, 0);
  assert.equal(result.mode, 'OFF');
});

test('a decision notification obeys the same gate', () => {
  const app = liveApp();
  withRecipients(app, { DEADLINE_REQUEST_EMAIL_ENABLED: true });
  app.context.Notifications.notifyRequestDecision(deadlineRequest({ Status: 'APPROVED' }), 'APPROVED');
  assert.equal(app.sentEmails.length, 1);
  assert.match(app.sentEmails[0].subject, /申請判断/);
});

test('the pending-request reminder is bounded and switchable', () => {
  const app = liveApp();
  withRecipients(app, { PENDING_REQUEST_REMINDER_ENABLED: false });
  app.context.Database.insert('TASK_REQUESTS', deadlineRequest());
  const disabled = app.context.Notifications.sendPendingRequestReminder();
  assert.equal(disabled.reason, 'PENDING_REQUEST_REMINDER_DISABLED');
  assert.equal(app.sentEmails.length, 0);

  withRecipients(app, { PENDING_REQUEST_REMINDER_ENABLED: true });
  app.context.Notifications.sendPendingRequestReminder();
  assert.equal(app.sentEmails.length, 1);
  assert.match(app.sentEmails[0].subject, /申請リマインド/);
  app.context.Notifications.sendPendingRequestReminder();
  assert.equal(app.sentEmails.length, 1, 'one reminder per day and recipient');
  assert.ok(app.context.AutomationSettings.get().LAST_PENDING_REQUEST_REMINDER_AT);
});

test('request notifications are refused without an approved recipient', () => {
  const app = liveApp();
  fixtures.settings(app, { DEADLINE_REQUEST_EMAIL_ENABLED: true, MANAGEMENT_REPORT_RECIPIENTS: '' });
  const result = app.context.Notifications.notifyRequestSubmitted(deadlineRequest());
  assert.equal(result.reason, 'NO_VALID_RECIPIENTS');
  assert.equal(app.sentEmails.length, 0);
});
