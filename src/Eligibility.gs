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

  /** Project switch is opt-out: blank means "inherit the legacy behaviour" (enabled). */
  function projectNotificationsAllowed(project) { return !project || project.Notification_Enabled !== false; }

  function taskNotificationsAllowed(task) { return !!task && task.Notification_Enabled === true; }

  /**
   * A task participates in operational reporting when the task itself is open and both
   * parents are in a working state. Archived parents keep their child rows untouched.
   */
  function taskInActiveWork(task, projects, subprojects) {
    if (!task || !taskOpen(task)) return false;
    var project = projects && projects[task.Project_ID];
    if (!projectContributesWorkload(project)) return false;
    if (task.Subproject_ID && subprojects) {
      var subproject = subprojects[task.Subproject_ID];
      if (!subproject || subproject.Project_ID !== task.Project_ID || !subprojectOpen(subproject)) return false;
    }
    return true;
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
    taskNotificationsAllowed: taskNotificationsAllowed,
    taskInActiveWork: taskInActiveWork
  };
}());
