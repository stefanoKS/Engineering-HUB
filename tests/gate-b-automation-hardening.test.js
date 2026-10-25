'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures');

const PROPS = { EMAIL_ENABLED: 'true', DRY_RUN: 'false' };
const TIME = '2026-12-01T03:00:00Z';

function liveApp(options = {}) {
  return fixtures.live({ properties: Object.assign({}, PROPS, options.properties) });
}

function configure(app, changes, actor = 'admin@example.test', confirmation = '') {
  return app.context.AutomationSettings.save(changes, actor, confirmation);
}

test('clearing the emergency stop is a LIVE transition: managers cannot restart, admins can', () => {
  const app = liveApp();
  assert.equal(app.context.Notifications.effectiveStatus().mode, 'LIVE');

  // Stopping is always available without friction, even for a MANAGER.
  app.setActor('manager@example.test');
  configure(app, { EMERGENCY_STOP: true }, 'manager@example.test');
  assert.equal(app.context.Notifications.effectiveStatus().mode, 'OFF');
  assert.equal(app.context.Notifications.effectiveStatus().reason, 'EMERGENCY_STOP');
  assert.equal(app.context.Notifications.effectiveStatus().configured, true);

  assert.throws(() => configure(app, { EMERGENCY_STOP: false }, 'manager@example.test'), /confirmation/);
  assert.throws(() => configure(app, { EMERGENCY_STOP: false }, 'manager@example.test', 'ENABLE LIVE EMAIL'),
    /Insufficient role: ADMIN/);
  assert.equal(app.context.Notifications.effectiveStatus().mode, 'OFF');

  // An explicit OFF mode change is also allowed for a MANAGER.
  configure(app, { EMAIL_MODE: 'OFF' }, 'manager@example.test');
  assert.equal(app.context.Notifications.effectiveStatus().mode, 'OFF');

  app.setActor('admin@example.test');
  configure(app, { EMERGENCY_STOP: false, EMAIL_MODE: 'LIVE' }, 'admin@example.test', 'ENABLE LIVE EMAIL');
  assert.equal(app.context.Notifications.effectiveStatus().mode, 'LIVE');

  const audit = app.context.Database.read('AUDIT_LOG');
  assert.equal(audit.filter(row => row.Action === 'EMAIL_LIVE_ACTIVATED').length, 2);
  assert.ok(audit.some(row => row.Action === 'EMAIL_LIVE_DEACTIVATED'));
});

test('LIVE activation requires confirmation and every preflight condition', () => {
  const app = fixtures.base({ properties: PROPS });
  fixtures.activate(app);

  assert.throws(() => configure(app, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false }), /confirmation/);
  assert.throws(() => configure(app, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: true }, 'admin@example.test', 'ENABLE LIVE EMAIL'),
    /emergency stop/);

  // PREVIEW -> LIVE without confirmation is refused even though the mode looks harmless.
  configure(app, { EMAIL_MODE: 'PREVIEW', EMERGENCY_STOP: false });
  assert.throws(() => configure(app, { EMAIL_MODE: 'LIVE' }), /confirmation/);
  configure(app, { EMAIL_MODE: 'LIVE' }, 'admin@example.test', 'ENABLE LIVE EMAIL');
  assert.equal(app.context.Notifications.effectiveStatus().mode, 'LIVE');

  const dryRun = fixtures.base({ properties: { EMAIL_ENABLED: 'true', DRY_RUN: 'true' } });
  dryRun.context.activateNotifications('admin@example.test', 'ACTIVATE NOTIFICATIONS');
  assert.throws(() => configure(dryRun, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false }, 'admin@example.test', 'ENABLE LIVE EMAIL'),
    /DRY_RUN/);

  const noDomain = fixtures.base({ properties: { EMAIL_ENABLED: 'true', DRY_RUN: 'false', ALLOWED_RECIPIENT_DOMAINS: '' } });
  noDomain.context.activateNotifications('admin@example.test', 'ACTIVATE NOTIFICATIONS');
  assert.throws(() => configure(noDomain, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false }, 'admin@example.test', 'ENABLE LIVE EMAIL'),
    /ALLOWED_RECIPIENT_DOMAINS/);

  const notActivated = fixtures.base({ properties: PROPS });
  assert.throws(() => configure(notActivated, { EMAIL_MODE: 'LIVE', EMERGENCY_STOP: false }, 'admin@example.test', 'ENABLE LIVE EMAIL'),
    /notifications are not activated/);
});

test('saved settings win over conflicting legacy Script Properties', () => {
  const app = liveApp();
  configure(app, { EMAIL_MODE: 'OFF', EMERGENCY_STOP: false });
  assert.equal(app.properties.getProperty('EMAIL_ENABLED'), 'true');
  assert.equal(app.properties.getProperty('DRY_RUN'), 'false');
  assert.equal(app.context.Notifications.effectiveStatus().mode, 'OFF');
  assert.equal(app.context.Notifications.effectiveStatus().reason, 'EMAIL_MODE_OFF');

  const conflicting = liveApp();
  conflicting.properties.setProperty('EMAIL_ENABLED', 'false');
  assert.equal(conflicting.context.Notifications.effectiveStatus().mode, 'OFF');
  assert.equal(conflicting.context.Notifications.effectiveStatus().reason, 'LEGACY_SAFETY_FLAGS_BLOCK_LIVE');

  const optIn = fixtures.base({ properties: Object.assign({}, PROPS, { ALLOW_LEGACY_EMAIL_CONFIG: 'true' }) });
  optIn.book.sheets = optIn.book.sheets.filter(sheet => sheet.getName() !== 'AUTOMATION_SETTINGS');
  assert.equal(optIn.context.Notifications.effectiveStatus().reason, 'LEGACY_CONFIGURATION_OPT_IN');
});

test('restarting LIVE after a stop does not replay notifications', () => {
  const app = liveApp();
  fixtures.approve(app, 'T1');
  configure(app, { ASSIGNMENT_EMAIL_ENABLED: true });
  assert.equal(app.context.scanNotifications(TIME).sent, 1);
  assert.equal(app.sentEmails.length, 1);

  configure(app, { EMERGENCY_STOP: true });
  assert.equal(app.context.scanNotifications(TIME).sent, 0);
  configure(app, { EMERGENCY_STOP: false }, 'admin@example.test', 'ENABLE LIVE EMAIL');
  assert.equal(app.context.scanNotifications(TIME).sent, 0);
  assert.equal(app.sentEmails.length, 1);
  assert.equal(app.context.Database.read('NOTIFICATION_LOG').length, 1);
});

test('weekly report schedule follows the configured day, time and enabled state', () => {
  const app = fixtures.base();
  const unrelated = app.context.ScriptApp.newTrigger('unrelated').timeBased().everyDays(1).create();
  app.context.installAuthorizedTriggers('admin@example.test', 'INSTALL AUTHORIZED TRIGGERS');
  assert.equal(app.triggers.length, 4);
  assert.equal(app.context.Triggers.diagnostics().weeklyReportHandlerPresent, false);
  assert.equal(app.context.Triggers.diagnostics().scheduleMatches, true);

  configure(app, { WEEKLY_MANAGER_REPORT_ENABLED: true, MANAGEMENT_REPORT_RECIPIENTS: ['manager@example.test'],
    WEEKLY_REPORT_DAY: 'MONDAY', WEEKLY_REPORT_TIME: '08:30' });
  let diagnostics = app.context.Triggers.diagnostics();
  assert.equal(diagnostics.weeklyReportHandlerPresent, false);
  assert.equal(diagnostics.scheduleMatches, false, 'a changed schedule must be detected as drift');
  assert.equal(diagnostics.missing.join(','), 'scheduledWeeklyManagementReport');

  app.context.installAuthorizedTriggers('admin@example.test', 'INSTALL AUTHORIZED TRIGGERS');
  let weekly = app.triggers.find(trigger => trigger.handler === 'scheduledWeeklyManagementReport');
  assert.equal(weekly.weekDay, 'MONDAY');
  assert.equal(weekly.hour, 8);
  assert.equal(weekly.minute, 30);
  assert.equal(app.context.Triggers.diagnostics().scheduleMatches, true);

  // Time change -> recreated with the new hour and minute.
  configure(app, { WEEKLY_REPORT_TIME: '14:45' });
  assert.equal(app.context.Triggers.diagnostics().scheduleMatches, false);
  app.context.installAuthorizedTriggers('admin@example.test', 'INSTALL AUTHORIZED TRIGGERS');
  weekly = app.triggers.find(trigger => trigger.handler === 'scheduledWeeklyManagementReport');
  assert.equal(weekly.hour, 14);
  assert.equal(weekly.minute, 45);
  assert.equal(app.triggers.filter(trigger => trigger.handler === 'scheduledWeeklyManagementReport').length, 1);

  // Day change -> recreated on the new weekday.
  configure(app, { WEEKLY_REPORT_DAY: 'FRIDAY' });
  app.context.installAuthorizedTriggers('admin@example.test', 'INSTALL AUTHORIZED TRIGGERS');
  weekly = app.triggers.find(trigger => trigger.handler === 'scheduledWeeklyManagementReport');
  assert.equal(weekly.weekDay, 'FRIDAY');
  assert.equal(app.triggers.filter(trigger => trigger.handler === 'scheduledWeeklyManagementReport').length, 1);

  // Disabling the feature removes the obsolete managed trigger and keeps unrelated ones.
  configure(app, { WEEKLY_MANAGER_REPORT_ENABLED: false });
  app.context.installAuthorizedTriggers('admin@example.test', 'INSTALL AUTHORIZED TRIGGERS');
  assert.equal(app.triggers.some(trigger => trigger.handler === 'scheduledWeeklyManagementReport'), false);
  assert.ok(app.triggers.includes(unrelated), 'unrelated triggers are never touched');
  assert.equal(app.triggers.length, 4);
  const final = app.context.Triggers.diagnostics();
  assert.equal(final.duplicates.length, 0);
  assert.equal(final.obsolete.length, 0);
  assert.equal(final.scheduleMatches, true);
});

test('a disabled weekly report sends nothing even while its handler still exists', () => {
  const app = liveApp();
  configure(app, { WEEKLY_MANAGER_REPORT_ENABLED: true, MANAGEMENT_REPORT_RECIPIENTS: ['manager@example.test'] });
  const first = app.context.scheduledWeeklyManagementReport();
  assert.equal(first.sent, 1);
  configure(app, { WEEKLY_MANAGER_REPORT_ENABLED: false });
  const second = app.context.scheduledWeeklyManagementReport();
  assert.equal(second.sent, 0);
  assert.equal(second.reason, 'WEEKLY_REPORT_DISABLED');
  assert.equal(app.sentEmails.length, 1);
});

test('trigger installation still needs an explicit, account-matched confirmation', () => {
  const app = fixtures.base();
  assert.throws(() => app.context.installAuthorizedTriggers('admin@example.test', 'yes'), /confirmation/);
  assert.throws(() => app.context.installAuthorizedTriggers('other@example.test', 'INSTALL AUTHORIZED TRIGGERS'),
    /active and effective authorized accounts/);
  assert.equal(app.triggers.length, 0);
});
