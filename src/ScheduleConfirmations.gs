/**
 * Schedule confirmation is deliberately separate from assignment approval.
 *
 * A manager can assign work with only a deadline. Confirming the schedule additionally
 * asserts that the deadline (and, when known, the start date and effort estimate) are
 * realistic. Schedule confirmation is versioned: changing dates or the estimate
 * supersedes the previous confirmation without deleting history.
 */
var ScheduleConfirmations = (function () {
  var TABLE = 'SCHEDULE_CONFIRMATIONS';

  function rows() { return Database.read(TABLE); }

  function active(taskId) {
    var matches = rows().filter(function (row) {
      return row.Task_ID === taskId && row.Active === true;
    });
    return matches.length ? matches[0] : null;
  }

  function supersede(taskId) {
    var patches = rows().filter(function (row) {
      return row.Task_ID === taskId && row.Active === true;
    }).map(function (row) {
      return {id: row.Schedule_Confirmation_ID, patch: {Active: false}};
    });
    if (patches.length) Database.updateMany(TABLE, patches);
    return patches.length;
  }

  function confirm(task, actorEmail, note) {
    var previous = active(task.Task_ID);
    supersede(task.Task_ID);
    var row = Database.insert(TABLE, {
      Task_ID: task.Task_ID,
      Active: true,
      Version: previous ? Number(previous.Version || 0) + 1 : 1,
      Planned_Start: task.Planned_Start || '',
      Due_Date: task.Due_Date || '',
      Estimated_Hours: Estimates.known(task.Estimated_Hours) ? task.Estimated_Hours : '',
      Confirmed_At: new Date(),
      Confirmed_By: String(actorEmail || '').toLowerCase(),
      Notes: note || ''
    });
    AuditLog.record(TABLE, row.Schedule_Confirmation_ID, 'SCHEDULE_CONFIRMED', previous, row, 'SUCCESS');
    return row;
  }

  function invalidate(taskId, reason) {
    var count = supersede(taskId);
    if (count) AuditLog.write('SCHEDULE_CONFIRMATION_INVALIDATED', 'TASK', taskId, {reason: reason || 'SCHEDULE_CHANGED'});
    return count;
  }

  function history(taskId) { return rows().filter(function (row) { return row.Task_ID === taskId; }); }

  return {active: active, confirm: confirm, invalidate: invalidate, history: history};
}());
