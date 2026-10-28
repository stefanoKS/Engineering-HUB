/**
 * One shared policy for "is this project/subproject/task still operational?".
 * Every active-work view must use these helpers so archived or cancelled work
 * never leaks into workload, dashboards, reminders or reports while history stays intact.
 */
var Eligibility = (function () {
  var OPEN_TASK = ['Not Started', 'Assigned', 'In Progress', 'Blocked', 'On Hold'];
  var ACTIVE_TASK = ['Not Started', 'Assigned', 'In Progress', 'Blocked'];
  var WORKLOAD_PROJECT = ['Active', 'Planned'];
  var NOTIFY_PROJECT = ['Active', 'Planned'];

  function projectOpen(project) { return !!project && NOTIFY_PROJECT.indexOf(project.Status) >= 0; }

  function projectContributesWorkload(project) { return !!project && WORKLOAD_PROJECT.indexOf(project.Status) >= 0; }

  function projectArchived(project) { return !!project && project.Status === 'Archived'; }

  function projectCompleted(project) { return !!project && project.Status === 'Completed'; }

  function projectAtRiskEligible(project) { return projectOpen(project); }

  function taskOpen(task) { return !!task && OPEN_TASK.indexOf(task.Status) >= 0; }

  function taskReminderEligible(task) { return !!task && ACTIVE_TASK.indexOf(task.Status) >= 0; }

  function subprojectOpen(subproject) { return !subproject || NOTIFY_PROJECT.indexOf(subproject.Status) >= 0; }

  /** Bounded walk guard: the hierarchy allows four levels, so a longer chain is malformed data. */
  function maxChain() {
    var depth = typeof Subprojects !== 'undefined' && Subprojects.MAX_DEPTH ? Subprojects.MAX_DEPTH : 4;
    return depth + 2;
  }

  /**
   * The single ancestor-aware rule for "is this subproject node part of active work?".
   *
   * Returns false when the node is missing, belongs to another project, sits beneath an
   * archived (or otherwise non-working) ancestor, or when the stored links form a cycle or
   * point at a missing parent. `subprojects` is an index keyed by Subproject_ID.
   */
  function subprojectInActiveWork(subprojectId, projectId, subprojects) {
    var id = String(subprojectId === undefined || subprojectId === null ? '' : subprojectId);
    if (!id) return true;
    if (!subprojects) return false;
    var node = subprojects[id];
    var guard = 0;
    var seen = Object.create(null);
    while (node) {
      var key = String(node.Subproject_ID || '');
      if (seen[key]) return false;
      seen[key] = true;
      if (projectId !== undefined && projectId !== null && String(node.Project_ID) !== String(projectId)) return false;
      if (!subprojectOpen(node)) return false;
      var parentId = String(node.Parent_Subproject_ID || '');
      if (!parentId) return true;
      if (guard++ > maxChain()) return false;
      node = subprojects[parentId];
    }
    // A missing parent means the stored hierarchy is broken; treat the branch as inactive.
    return false;
  }

  /** Project switch is opt-out: blank means "inherit the legacy behaviour" (enabled). */
  function projectNotificationsAllowed(project) { return !project || project.Notification_Enabled !== false; }

  function taskNotificationsAllowed(task) { return !!task && task.Notification_Enabled === true; }

  /**
   * A task participates in operational reporting when the task itself is open and both
   * parents are in a working state. Archived parents keep their child rows untouched.
   * A task in a nested subproject is governed by its whole ancestor chain, so archiving a
   * parent removes its descendants from active-work figures without deleting anything.
   */
  function taskInActiveWork(task, projects, subprojects) {
    if (!task || !taskOpen(task)) return false;
    var project = projects && projects[task.Project_ID];
    if (!projectContributesWorkload(project)) return false;
    return subprojectInActiveWork(task.Subproject_ID, task.Project_ID, subprojects);
  }

  /**
   * Reminder eligibility. The immediate subproject used to be the only check, which let a task
   * beneath an archived parent still produce reminders; the ancestor chain is now shared.
   */
  function taskNotifiable(task, project, subprojects) {
    if (!taskNotifiableBase(task, project)) return false;
    return subprojectInActiveWork(task.Subproject_ID, task && task.Project_ID, subprojects);
  }

  function taskNotifiableBase(task, project) {
    return taskNotificationsAllowed(task) && projectOpen(project) && taskReminderEligible(task);
  }

  return {
    projectOpen: projectOpen,
    projectContributesWorkload: projectContributesWorkload,
    projectArchived: projectArchived,
    projectCompleted: projectCompleted,
    projectAtRiskEligible: projectAtRiskEligible,
    projectNotificationsAllowed: projectNotificationsAllowed,
    taskOpen: taskOpen,
    taskReminderEligible: taskReminderEligible,
    subprojectOpen: subprojectOpen,
    subprojectInActiveWork: subprojectInActiveWork,
    taskNotificationsAllowed: taskNotificationsAllowed,
    taskInActiveWork: taskInActiveWork,
    taskNotifiable: taskNotifiable
  };
}());
