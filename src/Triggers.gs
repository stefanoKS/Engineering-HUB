/**
 * Installable trigger management.
 *
 * Installation is always an explicit action by the effective trigger owner. The desired
 * schedule is derived from the persisted automation settings, so changing the weekly report
 * day or time (or enabling/disabling the report) is detected as drift and the managed
 * triggers are recreated. Unrelated triggers are never touched.
 *
 * Apps Script does not expose an installed trigger's time, so the installed schedule is
 * recorded as a signature in Script Properties and compared on the next run.
 */
var Triggers = (function () {
  var WEEKLY_HANDLER = 'scheduledWeeklyManagementReport';
  var MANAGED = ['scheduledNotificationScan', 'scheduledManagementRefresh', 'scheduledDailyBackup', WEEKLY_HANDLER];
  var SIGNATURE_PROPERTY = 'MANAGED_TRIGGER_SIGNATURE';

  function weeklyEnabled() {
    try {
      return AutomationSettings.configured() && AutomationSettings.get().WEEKLY_MANAGER_REPORT_ENABLED === true;
    } catch (error) {
      return false;
    }
  }

  function weeklySchedule() {
    var values = AutomationSettings.get();
    var time = String(values.WEEKLY_REPORT_TIME || '08:30').split(':');
    var hour = Number(time[0]), minute = Number(time[1]);
    if (!isFinite(hour) || hour < 0 || hour > 23) hour = 8;
    if (!isFinite(minute) || minute < 0 || minute > 59) minute = 30;
    var day = String(values.WEEKLY_REPORT_DAY || 'MONDAY').toUpperCase();
    if (!ScriptApp.WeekDay || !ScriptApp.WeekDay[day]) day = 'MONDAY';
    return {hour: hour, minute: minute, weekDay: day};
  }

  /** Desired schedule for the current settings. */
  function expectedSchedule() {
    var schedule = [
      {handler: 'scheduledNotificationScan', kind: 'hourly', everyHours: 1},
      {handler: 'scheduledManagementRefresh', kind: 'hourly', everyHours: 1},
      {handler: 'scheduledDailyBackup', kind: 'daily', everyDays: 1, atHour: 2}
    ];
    if (weeklyEnabled()) {
      var weekly = weeklySchedule();
      schedule.push({
        handler: WEEKLY_HANDLER, kind: 'weekly', everyWeeks: 1,
        weekDay: weekly.weekDay, atHour: weekly.hour, nearMinute: weekly.minute
      });
    }
    return schedule;
  }

  function expectedHandlers() { return expectedSchedule().map(function (item) { return item.handler; }); }

  function signature() { return JSON.stringify(expectedSchedule()); }

  function create(item) {
    var builder = ScriptApp.newTrigger(item.handler).timeBased();
    if (item.kind === 'daily') builder.everyDays(item.everyDays).atHour(item.atHour).create();
    else if (item.kind === 'weekly') {
      builder.everyWeeks(1).onWeekDay(ScriptApp.WeekDay[item.weekDay]).atHour(item.atHour);
      if (typeof builder.nearMinute === 'function') builder.nearMinute(item.nearMinute);
      builder.create();
    } else builder.everyHours(item.everyHours).create();
  }

  function inspect() {
    var counts = Object.create(null), rows = [], managed = [];
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      var handler = trigger.getHandlerFunction();
      rows.push({handler: handler, uniqueId: trigger.getUniqueId ? String(trigger.getUniqueId() || '') : ''});
      if (MANAGED.indexOf(handler) < 0) return;
      managed.push(trigger);
      counts[handler] = (counts[handler] || 0) + 1;
    });
    return {rows: rows, counts: counts, managed: managed};
  }

  function install(accountEmail, confirmation) {
    if (confirmation !== 'INSTALL AUTHORIZED TRIGGERS') throw new Error('Explicit trigger confirmation required');
    Config.require('SPREADSHEET_ID');
    Config.require('ENVIRONMENT');
    var active = AuditLog.actor();
    var effective = '';
    try { effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase(); } catch (error) {}
    var requested = String(accountEmail || '').trim().toLowerCase();
    if (!active || !effective || active !== effective || requested !== effective) {
      throw new Error('The active and effective authorized accounts must match');
    }
    return Database.withLock(function () {
      var desired = expectedSchedule();
      var handlers = desired.map(function (item) { return item.handler; });
      var current = inspect();
      var properties = PropertiesService.getScriptProperties();
      var stored = properties.getProperty(SIGNATURE_PROPERTY) || '';
      var duplicate = Object.keys(current.counts).some(function (handler) { return current.counts[handler] > 1; });
      var obsolete = Object.keys(current.counts).some(function (handler) { return handlers.indexOf(handler) < 0; });
      var missing = handlers.some(function (handler) { return !current.counts[handler]; });
      var drift = stored !== signature();
      var recreated = drift || duplicate || obsolete || missing;

      if (recreated) {
        // Only managed handlers are removed; unrelated project triggers are preserved.
        current.managed.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
        desired.forEach(create);
      }
      properties.setProperty(SIGNATURE_PROPERTY, signature());
      AuditLog.write('TRIGGERS_INSTALLED', 'SYSTEM', '', {
        account: effective, handlers: handlers, recreated: recreated,
        reason: recreated ? (drift ? 'SCHEDULE_CHANGED' : duplicate ? 'DUPLICATE' : obsolete ? 'OBSOLETE' : 'MISSING') : 'UNCHANGED'
      });
      return {account: effective, handlers: handlers, recreated: recreated, schedule: desired};
    });
  }

  /**
   * Trigger inspection. Installable triggers run as their creator, so a different account
   * cannot see or repair another account's triggers from the editor.
   */
  function diagnostics() {
    Config.require('SPREADSHEET_ID');
    Config.require('ENVIRONMENT');
    var current = inspect();
    var desired = expectedSchedule();
    var handlers = desired.map(function (item) { return item.handler; });
    var duplicates = handlers.concat(Object.keys(current.counts)).filter(function (handler, index, all) {
      return current.counts[handler] > 1 && all.indexOf(handler) === index;
    }).map(function (handler) { return {handler: handler, count: current.counts[handler]}; });
    var missing = handlers.filter(function (handler) { return !current.counts[handler]; });
    var obsolete = Object.keys(current.counts).filter(function (handler) { return handlers.indexOf(handler) < 0; });
    var stored = PropertiesService.getScriptProperties().getProperty(SIGNATURE_PROPERTY) || '';
    return {
      triggers: current.rows,
      duplicates: duplicates,
      installed: handlers.filter(function (handler) { return !!current.counts[handler]; }),
      missing: missing,
      obsolete: obsolete,
      expected: handlers,
      schedule: desired,
      scheduleSignature: signature(),
      installedSignature: stored,
      scheduleMatches: stored === signature() && !missing.length && !duplicates.length && !obsolete.length,
      weeklyReportHandlerPresent: !!current.counts[WEEKLY_HANDLER],
      note: 'Installable triggers execute as their creator; other accounts cannot inspect or repair them. Apps Script fires time-based triggers approximately, so the configured minute is a target, not a guarantee.'
    };
  }

  return {
    install: install,
    diagnostics: diagnostics,
    expectedHandlers: expectedHandlers,
    expectedSchedule: expectedSchedule,
    weeklySchedule: weeklySchedule,
    signature: signature
  };
})();