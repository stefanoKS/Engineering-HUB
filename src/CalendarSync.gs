/** Opt-in sync uses stored event IDs plus a private ownership marker. */
var CalendarSync = (function () {
  function enabled(value) { return value === true || String(value).toLowerCase() === 'true'; }

  /** Most restrictive resolution: the legacy master switch AND the persisted toggle. */
  function enabledBySettings() {
    if (!enabled(Config.get().calendarEnabled)) return false;
    if (!AutomationSettings.configured()) return true;
    return AutomationSettings.get().CALENDAR_SYNC_ENABLED === true;
  }

  function sync() {
    Config.require('SPREADSHEET_ID');
    Config.require('ENVIRONMENT');
    var config = Config.get();
    if (!enabledBySettings()) {
      AutomationSettings.setStatus('CALENDAR_LAST_SYNC_AT', Domain.now());
      AutomationSettings.setStatus('CALENDAR_LAST_SYNC_STATUS', 'SKIPPED_DISABLED');
      return {created: 0, updated: 0, skipped: 0, disabled: true};
    }
    var calendarId = Config.require('CALENDAR_ID');
    if (calendarId === 'primary' || String(calendarId).indexOf('@group.calendar.google.com') === -1) {
      throw new Error('A dedicated secondary calendar is required');
    }
    return Database.withLock(function () {
      var calendar = CalendarApp.getCalendarById(calendarId);
      if (!calendar) throw new Error('Configured calendar is unavailable');
      var result = {created: 0, updated: 0, skipped: 0, disabled: false};
      var projects = Object.create(null);
      Database.read('PROJECTS').forEach(function (project) { projects[project.Project_ID] = project; });
      Database.read('MILESTONES').forEach(function (milestone) {
        var project = projects[milestone.Project_ID];
        var due = new Date(milestone.Target_Date);
        if (!project || !milestone.Target_Date || isNaN(due.getTime())) { result.skipped++; return; }
        var cancelled = String(project.Status).toLowerCase() === 'cancelled' ||
          String(milestone.Status).toLowerCase() === 'cancelled';
        var marker = 'Engineering-HUB:' + config.spreadsheetId + ':' + milestone.Milestone_ID;
        var title = (cancelled ? '[CANCELLED] ' : '') + (milestone.Milestone_Name || milestone.Milestone_ID);
        var description = marker + '\nProject: ' + milestone.Project_ID + '\nMilestone: ' + milestone.Milestone_ID;
        var hash = JSON.stringify([title, due.toISOString().slice(0, 10), description]);
        var event = milestone.Calendar_Event_ID ? calendar.getEventById(milestone.Calendar_Event_ID) : null;
        if (milestone.Calendar_Event_ID && !event) {
          // A missing event needs deliberate repair, not an automatic duplicate.
          result.skipped++;
          return;
        }
        if (event && String(event.getDescription() || '').split('\n')[0] !== marker) {
          result.skipped++;
          return;
        }
        if (event && milestone.Calendar_Sync_Hash === hash) { result.skipped++; return; }
        if (enabled(config.dryRun)) { result.skipped++; return; }
        if (!event) {
          if (cancelled) { result.skipped++; return; }
          event = calendar.createAllDayEvent(title, due, {description: description});
          Database.update('MILESTONES', milestone.Milestone_ID, {
            Calendar_Event_ID: event.getId(), Calendar_Sync_Hash: hash
          });
          result.created++;
        } else {
          event.setTitle(title);
          event.setDescription(description);
          event.setAllDayDate(due);
          Database.update('MILESTONES', milestone.Milestone_ID, {Calendar_Sync_Hash: hash});
          result.updated++;
        }
      });
      AutomationSettings.setStatus('CALENDAR_LAST_SYNC_AT', Domain.now());
      AutomationSettings.setStatus('CALENDAR_LAST_SYNC_STATUS',
        'OK created=' + result.created + ' updated=' + result.updated + ' skipped=' + result.skipped);
      return result;
    });
  }
  return {sync: sync, enabledBySettings: enabledBySettings};
})();