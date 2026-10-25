var Tasks = (function () {
  var assignmentFields = ['Owner_Member_ID', 'Project_ID', 'Subproject_ID', 'Planned_Start', 'Due_Date', 'Estimated_Hours', 'Task_Name', 'Dependency_IDs'];
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
  }
  function approvalPatch(before) {
    var row = Object.assign({}, before);
    if (!row.Owner_Member_ID || !row.Planned_Start || !row.Due_Date || row.Estimated_Hours === '' || row.Estimated_Hours === undefined || row.Estimated_Hours === null) Domain.fail('Approval requires owner, dates and an estimate');
    validate(row, before);
    var actor = AuditLog.actor();
    if (!actor) Domain.fail('Assignment approval requires a verified active account');
    row.Assignment_Approved_At = Domain.now();
    if (typeof Notifications !== 'undefined' && Notifications.snapshot) row.Notification_Baseline = Notifications.snapshot(row);
    var patch = {};
    ['Assignment_Approved_At', 'Notification_Baseline'].forEach(function (field) {
      if (row[field] !== before[field]) patch[field] = row[field];
    });
    return patch;
  }
  return {
    create: function (data) { return Domain.save('TASKS', null, Object.assign({ Status: 'Not Started', Progress_Percent: 0 }, data), validate); },
    update: function (id, patch) { return Domain.save('TASKS', id, patch, validate); },
    approvalPatch: approvalPatch, dependencies: dependencies, validateGraph: validateGraph
  };
})();
function createTask(data) { return Tasks.create(data); }
function updateTask(id, patch) { return Tasks.update(id, patch); }
function approveTaskAssignment(id, actorEmail, confirmation) { return Notifications.approveAssignment(id, actorEmail, confirmation); }
