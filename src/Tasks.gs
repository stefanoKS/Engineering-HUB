var Tasks = (function () {
  // Material assignment details: changing any of these invalidates stale approval.
  var assignmentFields = ['Owner_Member_ID', 'Project_ID', 'Subproject_ID', 'Planned_Start', 'Due_Date',
    'Estimated_Hours', 'Task_Name', 'Dependency_IDs', 'Priority', 'Acceptance_Criteria',
    'Required_Skill_ID', 'Required_Skill_Level'];
  // Progress updates must not revoke approval; date/effort changes must revoke schedule confirmation.
  var scheduleFields = ['Planned_Start', 'Due_Date', 'Estimated_Hours'];

  function dependencies(value) {
    if (!value) return [];
    var values = Array.isArray(value) ? value : String(value).split(',');
    return values.map(function (id) { return String(id).trim(); }).filter(function (id, i, all) { return id && all.indexOf(id) === i; });
  }

  function validateGraph(rows) {
    var map = Object.create(null), visited = Object.create(null), visiting = Object.create(null);
    rows.forEach(function (row) { map[row.Task_ID] = row; });
    function visit(id) {
      if (visiting[id]) Domain.fail('Cyclic task dependency');
      if (visited[id]) return;
      var task = map[id];
      if (!task) Domain.fail('Unknown task dependency: ' + id);
      visiting[id] = true;
      dependencies(task.Dependency_IDs).forEach(function (dependency) {
        if (!map[dependency]) Domain.fail('Unknown task dependency: ' + dependency);
        if (map[dependency].Project_ID !== task.Project_ID) Domain.fail('Dependencies must belong to the same project');
        visit(dependency);
      });
      delete visiting[id];
      visited[id] = true;
    }
    Object.keys(map).forEach(visit);
    return true;
  }

  function validate(row, before) {
    Domain.projectLink(row);
    Domain.dates(row);
    Domain.number(row.Estimated_Hours, 'Estimated_Hours', 0);
    Domain.number(row.Actual_Hours, 'Actual_Hours', 0);
    Domain.number(row.Progress_Percent, 'Progress_Percent', 0, 100);
    Domain.number(row.Planned_Duration_Value, 'Planned_Duration_Value', 0);
    if (row.Owner_Member_ID) {
      var owner = Domain.required('MEMBERS', row.Owner_Member_ID);
      if (owner.Active !== true) Domain.fail('Task owner must be active');
    }
    if (row.Required_Skill_ID) Domain.required('SKILLS', row.Required_Skill_ID);
    Domain.number(row.Required_Skill_Level, 'Required_Skill_Level', 0, 4);
    if (row.Status === 'Done' && row.Progress_Percent !== 100) Domain.fail('Completed tasks must have 100% progress');
    if (row.Progress_Percent === 100 && row.Status !== 'Done') Domain.fail('100% progress requires Done status');
    row.Completed_At = row.Status === 'Done' ? ((before && before.Completed_At) || Domain.now()) : '';
    row.Dependency_IDs = dependencies(row.Dependency_IDs).join(',');
    // V1.3: a manager-entered duration and deadline derive the planned start. Legacy rows
    // (no duration) keep their stored start; no estimate is ever invented.
    Planning.applyTaskPlan(row, {holidays: Database.read('HOLIDAYS')});
    var graph = Database.read('TASKS').filter(function (task) { return !before || task.Task_ID !== before.Task_ID; });
    graph.push(Object.assign({}, row, { Task_ID: row.Task_ID || '__new_task__' }));
    validateGraph(graph);
    if (!before || assignmentFields.some(function (field) { return row[field] !== before[field]; })) {
      row.Assignment_Version = before ? Number(before.Assignment_Version || 0) + 1 : 1;
      row.Assignment_Approved_At = '';
      if (typeof Notifications !== 'undefined' && Notifications.snapshot) row.Notification_Baseline = Notifications.snapshot(row);
    } else {
      row.Assignment_Version = before.Assignment_Version;
      row.Assignment_Approved_At = before.Assignment_Approved_At;
    }
    if (before && scheduleFields.some(function (field) { return row[field] !== before[field]; })) {
      ScheduleConfirmations.invalidate(before.Task_ID, 'SCHEDULE_CHANGED');
    }
  }

  /** Shared assignment validation: no date or effort fabrication is required to assign work. */
  function requireAssignable(row) {
    if (!row.Task_Name) Domain.fail('Assignment requires a task name');
    Domain.projectLink(row);
    if (!row.Owner_Member_ID) Domain.fail('Assignment approval requires an owner');
    var owner = Domain.required('MEMBERS', row.Owner_Member_ID);
    if (owner.Active !== true) Domain.fail('Assignment approval requires an active owner');
    return row;
  }

  function approvalPatch(before) {
    var row = Object.assign({}, before);
    requireAssignable(row);
    var actor = AuditLog.actor();
    if (!actor) Domain.fail('Assignment approval requires a verified active account');
    var approvedAt = new Date();
    row.Assignment_Approved_At = approvedAt;
    if (typeof Notifications !== 'undefined' && Notifications.snapshot) row.Notification_Baseline = Notifications.snapshot(row);
    return {Assignment_Approved_At: approvedAt, Notification_Baseline: row.Notification_Baseline};
  }

  function confirmSchedule(taskId, actorEmail, confirmation) {
    if (confirmation !== 'CONFIRM SCHEDULE') throw new Error('Explicit schedule confirmation required');
    var actor = AuditLog.actor();
    var requested = String(actorEmail || '').trim().toLowerCase();
    if (!actor || (requested && requested !== actor)) throw new Error('Schedule confirmation requires a verified account');
    return Database.withLock(function () {
      var task = Database.find('TASKS', taskId);
      if (!task) Domain.fail('Unknown task');
      requireAssignable(task);
      if (!task.Due_Date) Domain.fail('Schedule confirmation requires a deadline');
      if (!Estimates.known(task.Estimated_Hours)) Domain.fail('Schedule confirmation requires a known effort estimate');
      return ScheduleConfirmations.confirm(task, actor, 'manual confirmation');
    });
  }

  function list(filter) {
    filter = filter || {};
    var projects = Object.create(null), subprojects = Object.create(null);
    Database.read('PROJECTS').forEach(function (project) { projects[project.Project_ID] = project; });
    Database.read('SUBPROJECTS').forEach(function (subproject) { subprojects[subproject.Subproject_ID] = subproject; });
    var query = String(filter.query || '').toLowerCase();
    var statuses = filter.status ? (Array.isArray(filter.status) ? filter.status : [filter.status]) : null;
    return Database.read('TASKS').filter(function (task) {
      if (filter.projectId && task.Project_ID !== filter.projectId) return false;
      if (filter.subprojectId !== undefined && String(task.Subproject_ID || '') !== String(filter.subprojectId || '')) return false;
      if (filter.ownerId && task.Owner_Member_ID !== filter.ownerId) return false;
      if (statuses && statuses.indexOf(task.Status) < 0) return false;
      if (filter.activeOnly && !Eligibility.taskInActiveWork(task, projects, subprojects)) return false;
      if (filter.overdueOn && !(task.Due_Date && task.Due_Date < Domain.date(filter.overdueOn) && task.Status !== 'Done' && task.Status !== 'Cancelled')) return false;
      if (query) {
        var haystack = [task.Task_ID, task.Task_Name, task.Description, task.Acceptance_Criteria].join(' ').toLowerCase();
        if (haystack.indexOf(query) < 0) return false;
      }
      return true;
    });
  }

  function create(data) {
    return Domain.save('TASKS', null, Object.assign({ Status: 'Not Started', Progress_Percent: 0 }, data), validate, null, function (row) {
      Projects.touch(row.Project_ID);
    });
  }

  function update(id, patch) {
    return Domain.save('TASKS', id, patch, validate, null, function (row, before) {
      if (before && before.Project_ID !== row.Project_ID) Projects.touch(before.Project_ID);
      Projects.touch(row.Project_ID);
    });
  }

  function reassign(id, ownerId) { return update(id, { Owner_Member_ID: ownerId }); }

  function complete(id) { return update(id, { Status: 'Done', Progress_Percent: 100 }); }

  function recordBlocker(id, note) {
    return update(id, { Status: 'Blocked', Next_Action: note || 'ブロッカー対応' });
  }

  return {
    create: create,
    update: update,
    approvalPatch: approvalPatch,
    confirmSchedule: confirmSchedule,
    dependencies: dependencies,
    validateGraph: validateGraph,
    list: list,
    reassign: reassign,
    complete: complete,
    recordBlocker: recordBlocker
  };
})();
function createTask(data) { return Tasks.create(data); }
function updateTask(id, patch) { return Tasks.update(id, patch); }
function approveTaskAssignment(id, actorEmail, confirmation) { return Notifications.approveAssignment(id, actorEmail, confirmation); }
function confirmTaskSchedule(id, actorEmail, confirmation) { return Tasks.confirmSchedule(id, actorEmail, confirmation); }
function reassignTask(id, ownerMemberId) { return Tasks.reassign(id, ownerMemberId); }
function completeTask(id) { return Tasks.complete(id); }
function recordTaskBlocker(id, note) { return Tasks.recordBlocker(id, note); }
function listTasks(filter) { return Tasks.list(filter); }