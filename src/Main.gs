/** Public manual and installable-trigger entrypoints; initialization sends nothing. */
function activateNotifications(actorEmail, confirmation) {
  return Notifications.activate(actorEmail, confirmation);
}
function approveTaskNotifications(taskId, actorEmail, confirmation) {
  return Notifications.approveAssignment(taskId, actorEmail, confirmation);
}
function reconcileNotifications() { return Notifications.reconcile(); }
function scanNotifications() { return Notifications.scan(); }
function syncMilestoneCalendar() { return CalendarSync.sync(); }
function installAuthorizedTriggers(accountEmail, confirmation) {
  return Triggers.install(accountEmail, confirmation);
}
function refreshManagement(asOf) {
  Config.get();
  return Database.withLock(function () {
    return {dashboard: Dashboard.refresh(asOf), workload: Planning.workload(asOf), skills: Skills.matrix()};
  });
}
function scheduledNotificationScan() {
  return {notifications: Notifications.scan(), calendar: CalendarSync.sync()};
}
function scheduledManagementRefresh() { return refreshManagement(); }
function scheduledDailyBackup() { return Backup.create(); }
function dailyAutomation() {
  return {notifications: Notifications.scan(), calendar: CalendarSync.sync(),
    management: refreshManagement(), backup: Backup.create()};
}
function healthCheck() {
  Config.require('SPREADSHEET_ID');
  Config.require('ENVIRONMENT');
  var config = Config.get();
  var book = Database.book();
  return {
    spreadsheetId: book.getId(), environment: config.environment,
    emailEnabled: config.emailEnabled, dryRun: config.dryRun,
    notificationsActivated: !!config.notificationActivationAt,
    calendarEnabled: config.calendarEnabled
  };
}
function validateSystem() {
  var health = healthCheck();
  var tables = Object.keys(Schema.tables);
  var counts = {};
  var records = {}, ids = {}, errors = [];
  tables.forEach(function (table) {
    var definition = Schema.tables[table];
    try {
      records[table] = Database.read(table);
      counts[table] = records[table].length;
      ids[table] = Object.create(null);
      records[table].forEach(function (row) {
        var id = String(row[definition.id] || '');
        if (!id || ids[table][id]) errors.push(table + ': missing or duplicate ID ' + id);
        ids[table][id] = true;
      });
    } catch (error) {
      records[table] = [];
      ids[table] = Object.create(null);
      errors.push(table + ': ' + error.message);
    }
  });
  tables.forEach(function (table) {
    records[table].forEach(function (row) {
      Schema.tables[table].fields.forEach(function (field) {
        var value = row[field.name];
        var blank = value === '' || value === null || value === undefined;
        var prefix = table + '/' + row[Schema.tables[table].id] + '/' + field.name;
        if (blank && field.required) errors.push(prefix + ': required');
        if (!blank && field.values && field.values.indexOf(value) === -1) errors.push(prefix + ': invalid value');
        if (!blank && field.ref && !ids[field.ref][String(value)]) errors.push(prefix + ': missing reference');
        if (!blank && field.type === 'number' && (typeof value !== 'number' || !isFinite(value))) errors.push(prefix + ': invalid number');
        if (!blank && field.type === 'boolean' && typeof value !== 'boolean') errors.push(prefix + ': invalid boolean');
      });
    });
  });
  return {valid: errors.length === 0, health: health, rowCounts: counts, errors: errors};
}
