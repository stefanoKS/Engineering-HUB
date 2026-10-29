/** Explicit action allowlist. No arbitrary global-function or database dispatch. */
var ManagerWebApi = (function () {
  var actions = {
    projectCreate: {call: 'createProject'},
    projectSave: {call: 'updateProject', table: 'PROJECTS', key: 'projectId'},
    projectArchive: {table: 'PROJECTS', key: 'projectId', confirm: true},
    subprojectCreate: {call: 'createSubproject'},
    subprojectSave: {call: 'saveSubproject', table: 'SUBPROJECTS', key: 'subprojectId'},
    subprojectArchive: {call: 'archiveSubproject', table: 'SUBPROJECTS', key: 'subprojectId', confirm: true},
    subprojectReactivate: {call: 'reactivateSubproject', table: 'SUBPROJECTS', key: 'subprojectId', confirm: true},
    taskSave: {call: 'assignTask', table: 'TASKS', key: 'taskId', create: true},
    taskApprove: {call: 'approveAssignment', table: 'TASKS', key: 'taskId', confirm: true},
    taskConfirm: {call: 'confirmSchedule', table: 'TASKS', key: 'taskId', confirm: true},
    responsibilitySave: {call: 'saveResponsibility', table: 'RESPONSIBILITIES', key: 'responsibilityId', create: true},
    responsibilityMove: {call: 'moveResponsibility', table: 'RESPONSIBILITIES', key: 'responsibilityId'},
    responsibilityRetire: {call: 'retireResponsibility', table: 'RESPONSIBILITIES', key: 'responsibilityId', confirm: true},
    responsibilityReactivate: {call: 'reactivateResponsibility', table: 'RESPONSIBILITIES', key: 'responsibilityId', confirm: true},
    memberSave: {call: 'saveMember', table: 'MEMBERS', key: 'memberId', create: true},
    skillCreate: {call: 'createSkill'}, skillAssess: {call: 'setSkill'},
    requestImport: {call: 'importRequests'}, requestDecide: {call: 'decideRequest', confirm: true},
    // V1.7: opening 申請一覧 performs exactly one authorized import and returns the queue, so the
    // page needs one round trip instead of an import plus a separate list read.
    requestSync: {call: 'requests'},
    publication: {call: 'publishPublicationNow', confirm: true},
    reportRefresh: {call: 'refresh', confirm: true},
    emergencyStop: {confirm: true},
    automationSave: {call:'saveAutomationSettings',confirm:true,admin:true},
    // V1.6: reviewed completion correction and the narrow, ADMIN-only safe deletion.
    taskOverrideComplete: {admin: true, confirm: true, table: 'TASKS', key: 'taskId'},
    projectDelete: {admin: true, confirm: true, table: 'PROJECTS', key: 'projectId'},
    subprojectDelete: {admin: true, confirm: true, table: 'SUBPROJECTS', key: 'subprojectId'},
    taskDelete: {admin: true, confirm: true, table: 'TASKS', key: 'taskId'},
    // V1.6.1: finishes an interrupted deletion; appends a missing record only, never deletes.
    deletionReconcile: {admin: true, confirm: true}
  };
  function write(action, input) {
    if (!Object.prototype.hasOwnProperty.call(actions, action)) throw new Error('Unknown manager write action');
    var spec = actions[action];
    if (spec.admin) Access.requireAdmin();
    var p = Object.assign({}, input || {});
    ['actor', 'actorEmail', 'emailOfActor'].forEach(function (key) { if (p[key] !== undefined) throw new Error('Actor spoofing refused'); });
    if (p.role !== undefined && action !== 'memberSave') throw new Error('Role spoofing refused');
    if (action === 'memberSave' && p.role !== undefined) Access.requireAdmin();
    if (spec.confirm && p.confirmed !== true) throw new Error('Explicit confirmation required');
    if (spec.table && !spec.create && !p[spec.key]) throw new Error('Record ID required');
    if (action === 'taskSave') {
      if (p.approve || p.confirmSchedule) throw new Error('Approve assignment and confirm schedule separately');
      // A deadline-only assignment stays valid: the required duration is optional and a task
      // without one keeps an unknown planned start instead of an invented schedule.
      if (!p.taskId && !p.deadline) throw new Error('Deadline required');
      var existingTask = p.taskId ? Domain.required('TASKS', p.taskId) : null;
      var deadlineChanged = existingTask && p.deadline !== undefined && Domain.date(existingTask.Due_Date) !== p.deadline;
      if (deadlineChanged && p.confirmDeadlineChange !== true) throw new Error('Explicit deadline change confirmation required');
      if (p.deadline && (!existingTask || deadlineChanged || p.durationValue !== undefined && String(p.durationValue) !== String(existingTask.Planned_Duration_Value))) {
        var plan = ManagerWeb.unwrap(Ui.planPreview(p));
        if (plan.warnings.some(function (w) { return w.code === 'NON_WORKING_DEADLINE'; }) && p.acknowledgeNonWorking !== true) throw new Error('Non-working deadline acknowledgement required');
      }
    }
    if (action === 'memberSave' && p.memberId) {
      var member = Domain.required('MEMBERS', p.memberId);
      var prior = {name: member.Name, email: member.Email, department: member.Department, position: member.Position,
        capacity: member.Weekly_Capacity_Hours, active: member.Active};
      p = Object.assign(prior, p);
    }
    function check() {
      ManagerWeb.authorize();
      if (action === 'automationSave' && (!p.revision || p.revision !== ManagerWeb.settingsRevision())) throw new Error('EDIT_CONFLICT: Reload settings and review your draft');
      if (spec.table && p[spec.key]) {
        var row = Database.find(spec.table, p[spec.key]);
        if (!row || !p.revision || p.revision !== ManagerWeb.revision(spec.table, row)) throw new Error('EDIT_CONFLICT: 再読み込みして変更内容を確認してください / Reload and review; your draft is preserved');
      }
    }
    return Database.withMutationCheck(check, function () {
      // V1.6 additions run through their own reviewed domain service, never a browser flag.
      if (action === 'taskOverrideComplete') return Completion.override(p.taskId, p.reason, p.confirmation);
      if (action === 'projectDelete') return Deletion.remove('PROJECTS', p.projectId, {reason: p.reason, confirmation: p.confirmation});
      if (action === 'subprojectDelete') return Deletion.remove('SUBPROJECTS', p.subprojectId, {reason: p.reason, confirmation: p.confirmation});
      if (action === 'taskDelete') return Deletion.remove('TASKS', p.taskId, {reason: p.reason, confirmation: p.confirmation});
      if (action === 'deletionReconcile') return Deletion.reconcile(p.confirmation);
      if (action === 'projectArchive') return Projects.archive(p.projectId);
      if (action === 'emergencyStop') return ManagerWeb.unwrap(Ui.saveAutomationSettings({changes: {EMERGENCY_STOP: true, EMAIL_MODE: 'OFF'}}));
      // A project created from the manager dashboard must name an active responsibility.
      if (action === 'projectCreate') p.requireResponsibility = true;
      var result = ManagerWeb.unwrap(Ui[spec.call](p, action === 'taskSave' ? {skipDashboard: true} : undefined));
      if (result && result.error) throw new Error(result.error);
      return result;
    });
  }
  return {write: write};
}());
function managerWebWrite(action, payload) {
  return ManagerWeb.response(function () { Access.requireManager(); return ManagerWebApi.write(action, payload); }, false);
}
