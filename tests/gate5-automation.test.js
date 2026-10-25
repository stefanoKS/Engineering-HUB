'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const FLAGS = { properties: { EMAIL_ENABLED: 'true', DRY_RUN: 'false' } };

function live(options = {}) {
  return fixtures.live({ properties: Object.assign({}, FLAGS.properties, options.properties) });
}

function scan(app, now = '2026-12-01T03:00:00Z') {
  return app.context.scanNotifications(now);
}

test('automation settings persist in the workbook and are audited', () => {
  const app = fixtures.base();
  fixtures.settings(app, { PROJECT_STALE_DAYS: 14, ASSIGNMENT_EMAIL_ENABLED: true });
  assert.equal(app.context.AutomationSettings.get().PROJECT_STALE_DAYS, 14);
  assert.equal(app.context.AutomationSettings.get().ASSIGNMENT_EMAIL_ENABLED, true);
  assert.equal(app.context.AutomationSettings.configured(), true);

  const audit = app.context.Database.read('AUDIT_LOG').filter(row => row.Action === 'SETTING_CHANGED');
  assert.equal(audit.length, 2);
  assert.ok(audit.some(row => row.Entity_ID === 'PROJECT_STALE_DAYS' && row.Actor === 'admin@example.test'));
  assert.match(audit.find(row => row.Entity_ID === 'PROJECT_STALE_DAYS').New_Value, /14/);

  // A fresh read of the workbook returns the stored value, so deployments never reset it.
  const stored = app.context.Database.read('AUTOMATION_SETTINGS').find(row => row.Setting_ID === 'PROJECT_STALE_DAYS');
  assert.equal(JSON.parse(stored.Value), 14);

  app.context.AutomationSettings.restoreDefaults('admin@example.test', 'RESTORE SAFE DEFAULTS');
  assert.equal(app.context.AutomationSettings.get().PROJECT_STALE_DAYS, 7);
  assert.equal(app.context.AutomationSettings.get().ASSIGNMENT_EMAIL_ENABLED, false);
  assert.equal(app.context.AutomationSettings.get().EMAIL_MODE, 'OFF');
  assert.throws(() => app.context.AutomationSettings.restoreDefaults('admin@example.test', 'yes'), /confirmation/);
});

test('settings reject malformed values, unknown keys and status writes', () => {
  const app = fixtures.base();
  assert.throws(() => fixtures.settings(app, { REMINDER_OFFSETS: [7, 7] }), /Duplicate reminder offset/);
  assert.throws(() => fixtures.settings(app, { REMINDER_OFFSETS: [0] }), /between 1 and 365/);
  assert.throws(() => fixtures.settings(app, { REMINDER_OFFSETS: [] }), /At least one/);
  assert.throws(() => fixtures.settings(app, { WEEKLY_REPORT_TIME: '25:00' }), /HH:mm/);
  assert.throws(() => fixtures.settings(app, { EXECUTION_WINDOW_START: '20:00', EXECUTION_WINDOW_END: '08:00' }), /preflight|window/);
  assert.throws(() => fixtures.settings(app, { UNKNOWN_SETTING: true }), /Unknown automation setting/);
  assert.throws(() => fixtures.settings(app, { LAST_BACKUP_TIME: 'x' }), /Status values/);
  assert.throws(() => fixtures.settings(app, { MANAGEMENT_REPORT_RECIPIENTS: ['x@outside.test'] }), /domain is not allowed/);
  assert.throws(() => fixtures.settings(app, { PROJECT_STALE_DAYS: 0 }), /integer between 1 and 365/);
});

test('unmigrated workbooks fail closed and need the documented legacy opt-in', () => {
  const legacy = fixtures.base(FLAGS);
  legacy.book.sheets = legacy.book.sheets.filter(sheet => sheet.getName() !== 'AUTOMATION_SETTINGS');
  assert.equal(legacy.context.AutomationSettings.configured(), false);
  const status = legacy.context.Notifications.effectiveStatus();
  assert.equal(status.mode, 'OFF');
  assert.equal(status.reason, 'LEGACY_CONFIGURATION_BLOCKED');

  const optInFlags = { EMAIL_ENABLED: 'true', DRY_RUN: 'false', ALLOW_LEGACY_EMAIL_CONFIG: 'true' };
  const optIn = fixtures.base({ properties: optInFlags });
  optIn.book.sheets = optIn.book.sheets.filter(sheet => sheet.getName() !== 'AUTOMATION_SETTINGS');
  assert.equal(optIn.context.Notifications.effectiveStatus().mode, 'LIVE');
  assert.equal(optIn.context.Notifications.effectiveStatus().reason, 'LEGACY_CONFIGURATION_OPT_IN');

  const dryLegacy = fixtures.base({ properties: Object.assign({}, optInFlags, { DRY_RUN: 'true' }) });
  dryLegacy.book.sheets = dryLegacy.book.sheets.filter(sheet => sheet.getName() !== 'AUTOMATION_SETTINGS');
  assert.equal(dryLegacy.context.Notifications.effectiveStatus().mode, 'PREVIEW');
});

test('OFF mode suppresses every outgoing message even with all features enabled', () => {
  const app = fixtures.base(FLAGS);
  fixtures.activate(app);
  fixtures.approve(app, 'T1');
  fixtures.settings(app, {
    ASSIGNMENT_EMAIL_ENABLED: true, REASSIGNMENT_EMAIL_ENABLED: true, DEADLINE_CHANGE_EMAIL_ENABLED: true,
    DEADLINE_REMINDER_ENABLED: true, OVERDUE_REMINDER_ENABLED: true, EMERGENCY_STOP: false
  });
  const result = scan(app, '2026-12-30T03:00:00Z');
  assert.equal(result.mode, 'OFF');
  assert.equal(result.reason, 'EMAIL_MODE_OFF');
  assert.equal(app.sentEmails.length, 0);
  assert.equal(app.context.Database.read('NOTIFICATION_LOG').length, 0);
});

test('PREVIEW evaluates eligibility without sending or consuming live dedupe keys', () => {
  const app = fixtures.base(FLAGS);
  fixtures.activate(app);
  fixtures.approve(app, 'T1');
  fixtures.settings(app, { EMAIL_MODE: 'PREVIEW', ASSIGNMENT_EMAIL_ENABLED: true, EMERGENCY_STOP: false });

  const first = scan(app);
  assert.equal(app.sentEmails.length, 0);
  assert.equal(first.preview, 1);
  const log = app.context.Database.read('NOTIFICATION_LOG');
  assert.equal(log.length, 1);
  assert.equal(log[0].Result, 'PREVIEW');
  assert.match(log[0].Notification_Key, /^PREVIEW:/);

  scan(app);
  assert.equal(app.context.Database.read('NOTIFICATION_LOG').length, 1, 'same-day preview is not duplicated');

  fixtures.settings(app, { EMAIL_MODE: 'LIVE' }, 'ENABLE LIVE EMAIL');
  const liveResult = scan(app);
  assert.equal(liveResult.sent, 1, 'live key was not consumed by the preview');
  assert.equal(app.sentEmails.length, 1);
});

test('LIVE requires administrator role, explicit confirmation, emergency stop off and a passing preflight', () => {
  const app = fixtures.base(FLAGS);
  fixtures.activate(app);
  assert.throws(() => fixtures.settings(app, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false }), /confirmation/);
  assert.throws(() => fixtures.settings(app, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: true }, 'ENABLE LIVE EMAIL'), /emergency stop/);

  const managerApp = fixtures.base({ actor: 'manager@example.test', properties: FLAGS.properties });
  managerApp.context.activateNotifications('manager@example.test', 'ACTIVATE NOTIFICATIONS');
  assert.throws(() => managerApp.context.AutomationSettings.save(
    { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false }, 'manager@example.test', 'ENABLE LIVE EMAIL'
  ), /Insufficient role: ADMIN/);

  const dryApp = fixtures.base({ properties: { EMAIL_ENABLED: 'true', DRY_RUN: 'true' } });
  dryApp.context.activateNotifications('admin@example.test', 'ACTIVATE NOTIFICATIONS');
  assert.throws(() => fixtures.settings(dryApp, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false }, 'ENABLE LIVE EMAIL'), /preflight/);

  const openDomain = fixtures.base({ properties: { EMAIL_ENABLED: 'true', DRY_RUN: 'false', ALLOWED_RECIPIENT_DOMAINS: '' } });
  openDomain.context.activateNotifications('admin@example.test', 'ACTIVATE NOTIFICATIONS');
  assert.throws(() => fixtures.settings(openDomain, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false }, 'ENABLE LIVE EMAIL'), /ALLOWED_RECIPIENT_DOMAINS/);

  fixtures.settings(app, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false }, 'ENABLE LIVE EMAIL');
  assert.equal(fixtures.settings(app, { ASSIGNMENT_EMAIL_ENABLED: true }).effective.mode, 'LIVE');
});

test('individual feature toggles work independently with the shared run cap', () => {
  const app = live();
  fixtures.approve(app, 'T1');
  let result = scan(app);
  assert.equal(app.sentEmails.length, 0, 'assignment email disabled');
  assert.equal(result.mode, 'LIVE');

  fixtures.settings(app, { ASSIGNMENT_EMAIL_ENABLED: true });
  result = scan(app);
  assert.equal(result.sent, 1);
  assert.match(app.sentEmails[0].subject, /新規割当/);

  scan(app);
  assert.equal(app.sentEmails.length, 1, 'repeated scan cannot duplicate a normal delivery');
});

test('per-project and per-task switches take precedence over feature toggles', () => {
  const projectOff = live();
  fixtures.approve(projectOff, 'T1');
  fixtures.settings(projectOff, { ASSIGNMENT_EMAIL_ENABLED: true });
  projectOff.context.Database.update('PROJECTS', 'P1', { Notification_Enabled: false });
  scan(projectOff);
  assert.equal(projectOff.sentEmails.length, 0);

  const taskOff = live();
  fixtures.approve(taskOff, 'T1');
  fixtures.settings(taskOff, { ASSIGNMENT_EMAIL_ENABLED: true });
  taskOff.context.Database.update('TASKS', 'T1', { Notification_Enabled: false });
  scan(taskOff);
  assert.equal(taskOff.sentEmails.length, 0);
});

test('configurable reminder offsets send one stage per run and catch up safely', () => {
  const app = live();
  fixtures.approve(app, 'T1');
  fixtures.settings(app, { DEADLINE_REMINDER_ENABLED: true, REMINDER_OFFSETS: [3] });
  scan(app, '2026-12-09T03:00:00Z');
  assert.equal(app.sentEmails.length, 0, 'six days before the deadline is not a configured stage');
  scan(app, '2026-12-12T03:00:00Z');
  assert.equal(app.sentEmails.length, 1);
  assert.match(app.context.Database.read('NOTIFICATION_LOG')[0].Notification_Key, /"3"/);

  const catchUp = live();
  fixtures.approve(catchUp, 'T1');
  fixtures.settings(catchUp, { DEADLINE_REMINDER_ENABLED: true, REMINDER_OFFSETS: [7, 2], REMINDER_CATCHUP_DAYS: 3 });
  scan(catchUp, '2026-12-11T03:00:00Z');
  assert.equal(catchUp.sentEmails.length, 1);
  assert.match(catchUp.context.Database.read('NOTIFICATION_LOG')[0].Notification_Key, /"7"/);
  scan(catchUp, '2026-12-12T03:00:00Z');
  assert.equal(catchUp.sentEmails.length, 1, 'a stale stage is not repeated');
  scan(catchUp, '2026-12-13T03:00:00Z');
  assert.equal(catchUp.sentEmails.length, 2);
  assert.match(catchUp.context.Database.read('NOTIFICATION_LOG')[1].Notification_Key, /"2"/);
});

test('weekday-only sending and the JST execution window suppress reminders', () => {
  const weekend = live();
  fixtures.approve(weekend, 'T1');
  fixtures.settings(weekend, {
    DEADLINE_REMINDER_ENABLED: true, REMINDER_OFFSETS: [3], REMINDER_CATCHUP_DAYS: 3,
    WEEKDAY_ONLY_SENDING: true, EXECUTION_WINDOW_START: '08:00', EXECUTION_WINDOW_END: '20:00'
  });
  scan(weekend, '2026-12-12T03:00:00Z'); // Saturday 12:00 JST
  assert.equal(weekend.sentEmails.length, 0);
  scan(weekend, '2026-12-14T03:00:00Z'); // Monday 12:00 JST, two days before
  assert.equal(weekend.sentEmails.length, 1);

  const night = live();
  fixtures.approve(night, 'T1');
  fixtures.settings(night, {
    DEADLINE_REMINDER_ENABLED: true, REMINDER_OFFSETS: [3], WEEKDAY_ONLY_SENDING: false,
    EXECUTION_WINDOW_START: '08:00', EXECUTION_WINDOW_END: '20:00'
  });
  scan(night, '2026-12-12T14:00:00Z'); // 23:00 JST
  assert.equal(night.sentEmails.length, 0);
  scan(night, '2026-12-12T03:00:00Z');
  assert.equal(night.sentEmails.length, 1);
});

test('completed tasks, archived projects and invalid recipients never receive reminders', () => {
  const completed = live();
  fixtures.approve(completed, 'T1');
  fixtures.settings(completed, { DEADLINE_REMINDER_ENABLED: true, REMINDER_OFFSETS: [3] });
  completed.context.updateTask('T1', { Status: 'Done', Progress_Percent: 100 });
  scan(completed, '2026-12-12T03:00:00Z');
  assert.equal(completed.sentEmails.length, 0);

  const archived = live();
  fixtures.approve(archived, 'T1');
  fixtures.settings(archived, { DEADLINE_REMINDER_ENABLED: true, REMINDER_OFFSETS: [3] });
  archived.context.Database.update('PROJECTS', 'P1', { Status: 'Archived' });
  scan(archived, '2026-12-12T03:00:00Z');
  assert.equal(archived.sentEmails.length, 0);

  const invalid = live();
  fixtures.approve(invalid, 'T1');
  fixtures.settings(invalid, { DEADLINE_REMINDER_ENABLED: true, REMINDER_OFFSETS: [3] });
  invalid.context.Database.update('MEMBERS', 'M-ENG', { Email: 'owner@outside.test' });
  scan(invalid, '2026-12-12T03:00:00Z');
  assert.equal(invalid.sentEmails.length, 0);
  assert.equal(invalid.context.Database.read('NOTIFICATION_LOG').length, 0);
});

test('switching a feature off and on again never replays history', () => {
  const app = live();
  fixtures.approve(app, 'T1');
  fixtures.settings(app, { ASSIGNMENT_EMAIL_ENABLED: true });
  scan(app);
  assert.equal(app.sentEmails.length, 1);
  fixtures.settings(app, { ASSIGNMENT_EMAIL_ENABLED: false });
  scan(app);
  assert.equal(app.sentEmails.length, 1);
  fixtures.settings(app, { ASSIGNMENT_EMAIL_ENABLED: true });
  scan(app);
  assert.equal(app.sentEmails.length, 1);
  assert.equal(app.context.Database.read('NOTIFICATION_LOG').length, 1);
});

test('weekly management report is separate, deduplicated and requires valid recipients', () => {
  const app = live();
  fixtures.settings(app, {
    WEEKLY_MANAGER_REPORT_ENABLED: true,
    MANAGEMENT_REPORT_RECIPIENTS: ['manager@example.test', 'manager@example.test']
  });
  const first = app.context.Notifications.sendWeeklyReport('2026-12-01T03:00:00Z');
  assert.equal(first.sent, 1);
  assert.match(app.sentEmails[0].subject, /週次管理レポート/);
  assert.match(app.sentEmails[0].body, /期限超過タスク/);

  const second = app.context.Notifications.sendWeeklyReport('2026-12-01T03:00:00Z');
  assert.equal(second.sent, 0);
  assert.equal(app.sentEmails.length, 1);

  const disabled = live();
  assert.equal(disabled.context.Notifications.sendWeeklyReport('2026-12-01T03:00:00Z').reason, 'WEEKLY_REPORT_DISABLED');

  const empty = fixtures.base(FLAGS);
  empty.context.Database.book().getSheets()
    .filter(sheet => sheet.getName() === 'PROJECTS')
    .forEach(sheet => { sheet.rows = [sheet.rows[0]]; });
  empty.context.Database.book().getSheets()
    .filter(sheet => sheet.getName() === 'TASKS')
    .forEach(sheet => { sheet.rows = [sheet.rows[0]]; });
  fixtures.activate(empty);
  fixtures.settings(empty, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false, WEEKLY_MANAGER_REPORT_ENABLED: true,
    MANAGEMENT_REPORT_RECIPIENTS: ['manager@example.test'] }, 'ENABLE LIVE EMAIL');
  assert.equal(empty.context.Notifications.sendWeeklyReport('2026-12-01T03:00:00Z').reason, 'EMPTY_REPORT');
  assert.equal(empty.sentEmails.length, 0);
});

test('calendar and daily backup switches are independent and never bypass migration backups', () => {
  const calendarApp = live({ properties: { CALENDAR_ENABLED: 'true', CALENDAR_ID: 'hub@group.calendar.google.com' } });
  calendarApp.context.Database.insert('MILESTONES', { Milestone_ID: 'MS1', Project_ID: 'P1', Milestone_Name: '設計審査', Target_Date: '2026-12-20' });
  assert.equal(calendarApp.context.CalendarSync.sync().disabled, true);
  fixtures.settings(calendarApp, { CALENDAR_SYNC_ENABLED: true });
  assert.equal(calendarApp.context.CalendarSync.sync().created, 1);
  assert.equal(calendarApp.calendarEvents.length, 1);
  assert.match(calendarApp.context.AutomationSettings.get().CALENDAR_LAST_SYNC_STATUS, /OK/);

  const backupApp = live();
  assert.equal(backupApp.context.scheduledDailyBackup().disabled, true);
  assert.equal(backupApp.backups.length, 0);
  fixtures.settings(backupApp, { DAILY_BACKUP_ENABLED: true });
  assert.ok(backupApp.context.scheduledDailyBackup().reference);
  assert.equal(backupApp.backups.length, 1);

  const migrationApp = fixtures.base();
  fixtures.settings(migrationApp, { DAILY_BACKUP_ENABLED: false });
  const backupsBefore = migrationApp.backups.length;
  // A migration always takes its verified backup, regardless of the daily schedule switch.
  migrationApp.properties.setProperty('APPROVED_MIGRATIONS', '003_management_reliability');
  const history = migrationApp.book.getSheetByName('SCHEMA_MIGRATIONS');
  history.rows = [history.rows[0], ['INITIALIZE_V2', new Date().toISOString(), 0, 2, 'SUCCESS', 'NEW_EMPTY_DATABASE']];
  migrationApp.context.Migrations.upgrade();
  assert.equal(migrationApp.backups.length, backupsBefore + 1);
  assert.equal(migrationApp.context.AutomationSettings.get().DAILY_BACKUP_ENABLED, false);
});

test('ambiguous delivery is recorded and never retried automatically', () => {
  const app = live();
  fixtures.approve(app, 'T1');
  fixtures.settings(app, { ASSIGNMENT_EMAIL_ENABLED: true });
  app.context.MailApp.sendEmail = () => { throw new Error('network failure after possible delivery'); };
  const result = scan(app);
  assert.equal(result.pending, 1);
  scan(app);
  const pending = app.context.Database.read('NOTIFICATION_LOG');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].Result, 'PENDING');

  const db = app.context.Database;
  db.update('NOTIFICATION_LOG', pending[0].Notification_ID, { Created_At: new Date(Date.now() - 3600000).toISOString() });
  const marked = app.context.reconcileUncertainDeliveries('admin@example.test', 'RECONCILE DELIVERY');
  assert.equal(marked.marked, 1);
  assert.equal(db.find('NOTIFICATION_LOG', pending[0].Notification_ID).Result, 'DELIVERY_UNCERTAIN');
  scan(app);
  assert.equal(db.read('NOTIFICATION_LOG').length, 1);
  assert.throws(() => app.context.reconcileUncertainDeliveries('admin@example.test', 'retry'), /confirmation/);
});

test('trigger installation stays idempotent and reports duplicates', () => {
  const app = fixtures.base();
  app.context.installAuthorizedTriggers('admin@example.test', 'INSTALL AUTHORIZED TRIGGERS');
  const diagnostics = app.context.Triggers.diagnostics();
  assert.equal(diagnostics.installed.slice().sort().join(','), 'scheduledDailyBackup,scheduledManagementRefresh,scheduledNotificationScan');
  assert.equal(diagnostics.missing.length, 0);
  assert.equal(diagnostics.duplicates.length, 0);

  app.context.ScriptApp.newTrigger('scheduledNotificationScan').timeBased().everyHours(1).create();
  assert.equal(app.context.Triggers.diagnostics().duplicates.length, 1);

  fixtures.settings(app, { WEEKLY_MANAGER_REPORT_ENABLED: true, MANAGEMENT_REPORT_RECIPIENTS: ['manager@example.test'] });
  assert.equal(app.context.Triggers.expectedHandlers().length, 4);
  app.context.installAuthorizedTriggers('admin@example.test', 'INSTALL AUTHORIZED TRIGGERS');
  const after = app.context.Triggers.diagnostics();
  assert.equal(after.weeklyReportHandlerPresent, true);
  assert.equal(after.duplicates.length, 0);
  assert.match(after.note, /creator/);
});

test('automation status is exposed without leaking script properties or identifiers', () => {
  const app = live({ properties: { CALENDAR_ENABLED: 'true', CALENDAR_ID: 'hub@group.calendar.google.com' } });
  const status = app.context.Notifications.effectiveStatus();
  assert.equal(status.mode, 'LIVE');
  assert.equal(status.configured, true);
  assert.equal(status.emergencyStop, false);
  assert.equal(status.toggles.NEW_ASSIGNMENT, false);
  assert.equal(status.allowedDomains.join(','), 'example.test');

  const rows = app.context.AutomationSettings.viewRows();
  const flat = rows.flat().join('|');
  assert.match(flat, /自動化設定/);
  assert.doesNotMatch(flat, /hub@group\.calendar\.google\.com/);
  assert.doesNotMatch(flat, /test-db/);

  const describe = app.context.AutomationSettings.describe();
  assert.ok(describe.every(item => item.key !== 'CALENDAR_ID'));
});
