/**
 * Unknown effort is not zero. A blank value means "not estimated yet" and must stay
 * distinguishable from an intentional zero estimate in every calculation and report.
 */
var Estimates = (function () {
  function unknown(value) { return value === '' || value === null || value === undefined; }

  function known(value) {
    if (unknown(value)) return false;
    return typeof value === 'number' && isFinite(value) && value >= 0;
  }

  function hours(value) { return known(value) ? value : null; }

  function remaining(task) {
    if (!known(task.Estimated_Hours)) return null;
    var actual = known(task.Actual_Hours) ? task.Actual_Hours : 0;
    return Math.max(0, task.Estimated_Hours - actual);
  }

  function label(value) { return known(value) ? String(value) : '未見積'; }

  return { unknown: unknown, known: known, hours: hours, remaining: remaining, label: label };
}());
