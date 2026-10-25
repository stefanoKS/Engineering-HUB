/** Installation is always an explicit action by the effective trigger owner. */
var Triggers = (function () {
  var BASE_HANDLERS = ['scheduledNotificationScan', 'scheduledManagementRefresh', 'scheduledDailyBackup'];
  var WEEKLY_HANDLER = 'scheduledWeeklyManagementReport';

  function weeklyEnabled() {
    try {
      return AutomationSettings.configured() && AutomationSettings.get().WEEKLY_MANAGER_REPORT_ENABLED === true;
    } catch (error) {
      return false;
    }
  }

  function expectedHandlers() {
    return weeklyEnabled() ? BASE_HANDLERS.concat([WEEKLY_HANDLER]) : BASE_HANDLERS.slice();
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
      var handlers = expectedHandlers();
      var existing = Object.create(null);
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        var handler = trigger.getHandlerFunction();
        if (handlers.indexOf(handler) === -1) return;
        if (existing[handler]) ScriptApp.deleteTrigger(trigger);
        else existing[handler] = true;
      });
      handlers.forEach(function (handler) {
        if (existing[handler]) return;
        var builder = ScriptApp.newTrigger(handler).timeBased();
        if (handler === 'scheduledDailyBackup') builder.everyDays(1).atHour(2).create();
        else if (handler === WEEKLY_HANDLER) builder.everyWeeks(1).onWeekDay(ScriptApp.WeekDay[AutomationSettings.get().WEEKLY_REPORT_DAY]).atHour(8).create();
        else builder.everyHours(1).create();
      });
      AuditLog.write('TRIGGERS_INSTALLED', 'SYSTEM', '', {account: effective, handlers: handlers});
      return {account: effective, handlers: handlers.slice()};
    });
  }

  /**
   * Trigger inspection. Installable triggers run as their creator, so a different
   * account cannot see or repair another account's triggers from the editor.
   */
  function diagnostics() {
    Config.require('SPREADSHEET_ID');
    Config.require('ENVIRONMENT');
    var rows = ScriptApp.getProjectTriggers().map(function (trigger) {
      return {
        handler: trigger.getHandlerFunction(),
        uniqueId: trigger.getUniqueId ? String(trigger.getUniqueId() || '') : ''
      };
    });
    var counts = Object.create(null);
    rows.forEach(function (row) { counts[row.handler] = (counts[row.handler] || 0) + 1; });
    var handlers = BASE_HANDLERS.concat([WEEKLY_HANDLER]);
    var duplicates = handlers.concat(Object.keys(counts)).filter(function (handler, index, all) {
      return counts[handler] > 1 && all.indexOf(handler) === index;
    }).map(function (handler) {
      return {handler: handler, count: counts[handler]};
    });
    return {
      triggers: rows,
      duplicates: duplicates,
      installed: handlers.filter(function (handler) { return !!counts[handler]; }),
      missing: expectedHandlers().filter(function (handler) { return !counts[handler]; }),
      expected: expectedHandlers(),
      weeklyReportHandlerPresent: !!counts[WEEKLY_HANDLER],
      note: 'Installable triggers execute as their creator; other accounts cannot inspect or repair them.'
    };
  }

  return {install: install, diagnostics: diagnostics, expectedHandlers: expectedHandlers};
})();