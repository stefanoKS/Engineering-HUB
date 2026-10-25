/** Installation is always an explicit action by the effective trigger owner. */
var Triggers = (function () {
  var HANDLERS = ['scheduledNotificationScan', 'scheduledManagementRefresh', 'scheduledDailyBackup'];
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
      var existing = Object.create(null);
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        var handler = trigger.getHandlerFunction();
        if (HANDLERS.indexOf(handler) === -1) return;
        if (existing[handler]) ScriptApp.deleteTrigger(trigger);
        else existing[handler] = true;
      });
      HANDLERS.forEach(function (handler) {
        if (existing[handler]) return;
        var builder = ScriptApp.newTrigger(handler).timeBased();
        if (handler === 'scheduledDailyBackup') builder.everyDays(1).atHour(2).create();
        else builder.everyHours(1).create();
      });
      AuditLog.write('TRIGGERS_INSTALLED', 'SYSTEM', '', {account: effective, handlers: HANDLERS});
      return {account: effective, handlers: HANDLERS.slice()};
    });
  }
  return {install: install};
})();
