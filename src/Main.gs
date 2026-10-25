/** Public manual and installable-trigger entrypoints; initialization sends nothing. */
function activateNotifications(actorEmail, confirmation) {
  return Notifications.activate(actorEmail, confirmation);
}
function approveTaskNotifications(taskId, actorEmail, confirmation) {
  return Notifications.approveAssignment(taskId, actorEmail, confirmation);
}
function reconcileNotifications() { return Notifications.reconcile(); }
function scanNotifications(nowValue) { return Notifications.scan(nowValue); }
function syncMilestoneCalendar() { return CalendarSync.sync(); }
function installAuthorizedTriggers(accountEmail, confirmation) {
  return Triggers.install(accountEmail, confirmation);
}

/** Manual refresh: always available even when scheduled refreshes are switched off. */
function refreshManagement(asOf) {
  Config.get();
  var dashboard = Dashboard.refresh(asOf);
  var workload = Planning.workload(asOf);
  var skills = Skills.matrix();
  AutomationSettings.setStatus('LAST_WORKLOAD_REFRESH_AT', Domain.now());
  return {dashboard: dashboard, workload: workload, skills: skills};
}
function scheduledNotificationScan() {
  return {notifications: Notifications.scan(), calendar: CalendarSync.sync()};
}
function scheduledManagementRefresh() {
  Config.get();
  var values = AutomationSettings.get();
  var configured = AutomationSettings.configured();
  var dashboardOn = !configured || values.AUTO_DASHBOARD_REFRESH_ENABLED === true;
  var workloadOn = !configured || values.AUTO_WORKLOAD_REFRESH_ENABLED === true;
  if (!dashboardOn && !workloadOn) return {skipped: 'AUTO_REFRESH_DISABLED'};
  var result = {};
  if (dashboardOn) result.dashboard = Dashboard.refresh();
  if (workloadOn) {
    result.workload = Planning.workload();
    AutomationSettings.setStatus('LAST_WORKLOAD_REFRESH_AT', Domain.now());
  }
  if (dashboardOn) result.skills = Skills.matrix();
  return result;
}
function scheduledDailyBackup() {
  Config.get();
  if (AutomationSettings.configured() && AutomationSettings.get().DAILY_BACKUP_ENABLED !== true) {
    AutomationSettings.setStatus('LAST_BACKUP_RESULT', 'SKIPPED_DISABLED');
    return {disabled: true};
  }
  try {
    var reference = createDatabaseBackup();
    AutomationSettings.setStatus('LAST_BACKUP_TIME', Domain.now());
    AutomationSettings.setStatus('LAST_BACKUP_RESULT', 'VERIFIED');
    return {reference: reference};
  } catch (error) {
    AutomationSettings.setStatus('LAST_BACKUP_RESULT', 'FAILED ' + String(error.message || error).slice(0, 200));
    throw error;
  }
}
function scheduledWeeklyManagementReport() { return Notifications.sendWeeklyReport(); }
function dailyAutomation() {
  return {
    notifications: Notifications.scan(),
    calendar: CalendarSync.sync(),
    management: scheduledManagementRefresh(),
    backup: scheduledDailyBackup()
  };
}
function previewPendingNotifications(nowValue) { return Notifications.preview(nowValue); }
function reconcileUncertainDeliveries(actorEmail, confirmation) {
  return Notifications.reconcileUncertain(actorEmail, confirmation);
}
function notifyWeeklyManagementReport() {
  return Notifications.sendWeeklyReport();
}
function healthCheck() {
  Config.require('SPREADSHEET_ID');
  Config.require('ENVIRONMENT');
  var config = Config.get();
  var book = Database.book();
  var status = Notifications.effectiveStatus();
  return {
    spreadsheetId: book.getId(), environment: config.environment,
    emailEnabled: config.emailEnabled, dryRun: config.dryRun,
    notificationsActivated: !!config.notificationActivationAt,
    calendarEnabled: config.calendarEnabled,
    emailMode: status.mode, emailModeReason: status.reason,
    automationConfigured: status.configured, emergencyStop: status.emergencyStop
  };
}
function systemStatus() {
  var validation = validateSystem();
  return {
    health: healthCheck(),
    valid: validation.valid,
    errors: validation.errors.slice(0, 25),
    errorCount: validation.errors.length,
    rowCounts: validation.rowCounts,
    automation: Notifications.effectiveStatus(),
    triggers: Triggers.diagnostics(),
    settings: AutomationSettings.describe()
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