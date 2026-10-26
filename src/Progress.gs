/**
 * Effort-weighted progress rollup.
 *
 * Known positive estimates are the weight. Unknown estimates keep a documented
 * temporary fallback weight of 1 so unestimated work still moves the number, while
 * the unknown count is reported separately and never presented as real hours.
 * Cancelled tasks are excluded; zero-hour estimates carry no weight but are counted.
 */
var Progress = (function () {
  var UNKNOWN_WEIGHT = 1;
  var CANCELLED = 'Cancelled';
  var DONE = 'Done';

  function clamp(value) {
    var number = Number(value);
    if (!isFinite(number)) return 0;
    return Math.max(0, Math.min(100, number));
  }

  function percent(task) {
    if (task.Status === DONE) return 100;
    if (task.Status === CANCELLED) return 0;
    return clamp(task.Progress_Percent);
  }

  function weight(task) {
    if (Estimates.known(task.Estimated_Hours)) return task.Estimated_Hours > 0 ? task.Estimated_Hours : 0;
    return UNKNOWN_WEIGHT;
  }

  function rollup(tasks) {
    var weighted = 0, weightTotal = 0, percentTotal = 0, counted = 0;
    var unknown = 0, zeroEstimate = 0;
    (tasks || []).forEach(function (task) {
      if (!task || task.Status === CANCELLED) return;
      counted++;
      var value = percent(task), itemWeight = weight(task);
      if (Estimates.known(task.Estimated_Hours)) {
        if (itemWeight === 0) zeroEstimate++;
      } else {
        unknown++;
      }
      weightTotal += itemWeight;
      weighted += itemWeight * value;
      percentTotal += value;
    });
    if (!counted) return {calculated: false, percent: null, tasks: 0, unknown: 0, zeroEstimate: 0};
    var value = weightTotal > 0 ? weighted / weightTotal : percentTotal / counted;
    return {
      calculated: true,
      percent: Math.round(value * 100) / 100,
      tasks: counted,
      unknown: unknown,
      zeroEstimate: zeroEstimate
    };
  }

  function group(tasks, key) {
    var result = Object.create(null);
    (tasks || []).forEach(function (task) {
      var id = String(task[key] || '');
      if (!id) return;
      if (!result[id]) result[id] = [];
      result[id].push(task);
    });
    return result;
  }

  /**
   * Tasks of one subproject node plus every descendant node.
   *
   * Only tasks are counted, never child percentages, so a parent rollup cannot double
   * count: each task belongs to exactly one node and the project rollup uses its own
   * project grouping. Depth is bounded to two levels by Subprojects, so this stays cheap.
   */
  function subtreeTasks(subprojectId, children, tasksBySubproject) {
    var collected = (tasksBySubproject[subprojectId] || []).slice();
    (children[subprojectId] || []).forEach(function (childId) {
      collected = collected.concat(subtreeTasks(childId, children, tasksBySubproject));
    });
    return collected;
  }

  function display(rollupResult) { return rollupResult && rollupResult.calculated ? rollupResult.percent : '未計算'; }

  /** Recalculate stored project/subproject progress without touching other columns. */
  function refresh() {
    return Database.withLock(function () {
      var tasks = Database.read('TASKS');
      var projects = Database.read('PROJECTS');
      var subprojects = Database.read('SUBPROJECTS');
      var children = Subprojects.childrenMap(subprojects);
      var byProject = group(tasks, 'Project_ID');
      var bySubproject = group(tasks, 'Subproject_ID');
      var projectPatches = [], subprojectPatches = [], unknown = 0;

      projects.forEach(function (project) {
        var result = rollup(byProject[project.Project_ID] || []);
        unknown += result.unknown;
        var value = result.calculated ? result.percent : '';
        if (String(project.Progress_Percent === '' || project.Progress_Percent === null || project.Progress_Percent === undefined ? '' : project.Progress_Percent) !== String(value)) {
          projectPatches.push({id: project.Project_ID, patch: {Progress_Percent: value}});
        }
      });
      subprojects.forEach(function (subproject) {
        // A parent reflects its own tasks plus every descendant task, exactly once.
        var result = rollup(subtreeTasks(subproject.Subproject_ID, children, bySubproject));
        var value = result.calculated ? result.percent : '';
        if (String(subproject.Progress_Percent === '' || subproject.Progress_Percent === null || subproject.Progress_Percent === undefined ? '' : subproject.Progress_Percent) !== String(value)) {
          subprojectPatches.push({id: subproject.Subproject_ID, patch: {Progress_Percent: value}});
        }
      });
      if (projectPatches.length) Database.updateMany('PROJECTS', projectPatches);
      if (subprojectPatches.length) Database.updateMany('SUBPROJECTS', subprojectPatches);
      return {projects: projectPatches.length, subprojects: subprojectPatches.length, unknownTasks: unknown};
    });
  }

  return {percent: percent, weight: weight, rollup: rollup, group: group, display: display,
    subtreeTasks: subtreeTasks, refresh: refresh};
}());
function refreshProgress() { return Progress.refresh(); }
