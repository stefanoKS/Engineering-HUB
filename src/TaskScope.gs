/**
 * One counting policy for every manager-facing task statistic (V1.6.1).
 *
 * V1.6 counted raw task rows for the responsibility cards and the overview KPIs while every
 * progress rollup counted leaf work only. The same word therefore meant two different things.
 * This module is the single place that decides what a number means:
 *
 * - **work item**: a task without children. Only work items are counted as work.
 * - **container**: a task with children. It organises work, it is never an extra unit of work.
 * - **active work**: a work item that is open, whose project is still working and whose whole
 *   subproject ancestor chain is still working (the shared `Eligibility` rule).
 * - **open work**: active work that is neither Done nor Cancelled.
 * - **overdue**: open work whose due date is before today.
 * - **completed**: work items marked Done, counted for history only and never mixed into the
 *   active figures.
 * - **cancelled**: excluded from every workload figure.
 *
 * Callers must keep those labels distinct in the UI; see docs/RESPONSIBILITIES.md.
 */
var TaskScope = (function () {
  function index(rows, key) {
    var map = Object.create(null);
    (rows || []).forEach(function (row) { if (row && row[key] !== undefined) map[String(row[key])] = row; });
    return map;
  }

  function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }

  /**
   * Builds one scope over the current task rows. The tables are read through `Database.read`,
   * so an already-open read context pays no extra spreadsheet read.
   */
  function create(tasks) {
    var list = tasks || Database.read('TASKS');
    var tree = TaskTree.buildIndex(list);
    var projects = index(Database.read('PROJECTS'), 'Project_ID');
    var subprojects = index(Database.read('SUBPROJECTS'), 'Subproject_ID');
    var leaves = list.filter(function (task) { return !TaskTree.isContainer(task.Task_ID, tree.children); });
    var containers = list.filter(function (task) { return TaskTree.isContainer(task.Task_ID, tree.children); });
    var workItems = Object.create(null);
    leaves.forEach(function (task) { workItems[task.Task_ID] = true; });

    function isContainer(task) { return !!task && TaskTree.isContainer(task.Task_ID, tree.children); }

    function inActiveWork(task) {
      if (!task || isContainer(task)) return false;
      return Eligibility.taskInActiveWork(task, projects, subprojects);
    }

    var active = leaves.filter(inActiveWork);

    function overdue(task, today) {
      var due = Domain.date(task.Due_Date);
      return !!due && due < today;
    }

    function emptyCounts() {
      return {workItems: 0, containers: 0, activeWork: 0, openWork: 0, overdueWork: 0, completedWork: 0, cancelledWork: 0};
    }

    /** Adds one task to a counter bucket with the single counting policy. */
    function accumulate(target, task, day) {
      if (isContainer(task)) { target.containers++; return; }
      target.workItems++;
      var status = text(task.Status);
      if (status === 'Done') { target.completedWork++; return; }
      if (status === 'Cancelled') { target.cancelledWork++; return; }
      if (!inActiveWork(task)) return;
      target.activeWork++;
      target.openWork++;
      if (overdue(task, day)) target.overdueWork++;
    }

    /**
     * Counts work for a subset (for example one responsibility area or one project).
     * `include(task)` filters the raw task list; the counting rules stay identical.
     */
    function summarise(include, today) {
      var day = today || Domain.today(), target = emptyCounts();
      list.forEach(function (task) { if (!include || include(task)) accumulate(target, task, day); });
      return target;
    }

    /**
     * Counts work per group in one pass. `groupOf(task)` returns the group key, so a per-group
     * figure and a total can never be produced by two different rules.
     */
    function summariseBy(groupOf, today) {
      var day = today || Domain.today(), result = Object.create(null);
      list.forEach(function (task) {
        var key = String(groupOf(task) || '');
        if (!result[key]) result[key] = emptyCounts();
        accumulate(result[key], task, day);
      });
      return result;
    }

    /** Open work items due inside the window, ordered by due date then ID. */
    function upcoming(from, to, include) {
      return active.filter(function (task) {
        if (include && !include(task)) return false;
        var due = Domain.date(task.Due_Date);
        return !!due && due >= from && due <= to;
      }).sort(function (a, b) {
        return Domain.date(a.Due_Date).localeCompare(Domain.date(b.Due_Date)) || a.Task_ID.localeCompare(b.Task_ID);
      });
    }

    return {
      tasks: list,
      leaves: leaves,
      containers: containers,
      tree: tree,
      projects: projects,
      subprojects: subprojects,
      isContainer: isContainer,
      inActiveWork: inActiveWork,
      activeWork: active,
      summarise: summarise,
      summariseBy: summariseBy,
      upcoming: upcoming
    };
  }

  return {create: create};
}());
