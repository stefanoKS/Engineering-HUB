/**
 * Manager-facing UI adapter (container-bound Apps Script only).
 *
 * A standalone script project cannot show SpreadsheetApp.getUi(), so this adapter requires
 * a Sheets-bound deployment. Every write goes through the same validated domain services as
 * the rest of the application, plus a server-side authorization check from Access.gs. Role,
 * actor and owner values supplied by the browser are never trusted for authorization.
 */
var Ui = (function () {
  var MENU = 'Engineering HUB';

  function guard(action) {
    try {
      return {ok: true, data: action()};
    } catch (error) {
      return {ok: false, error: String(error && error.message ? error.message : error)};
    }
  }

  function plain(value) { return value === undefined ? null : JSON.parse(JSON.stringify(value)); }

  function text(value, label) {
    var result = String(value === undefined || value === null ? '' : value).trim();
    if (!result) throw new Error(label + 'を入力してください');
    return result;
  }

  function optionalNumber(value, label) {
    if (value === '' || value === null || value === undefined) return '';
    var number = Number(value);
    if (!isFinite(number) || number < 0) throw new Error(label + 'は0以上の数値で入力してください');
    return number;
  }

  function show(fileName) {
    var ui;
    try {
      ui = SpreadsheetApp.getUi();
    } catch (error) {
      throw new Error('この画面はスプレッドシートにバインドされたApps Scriptプロジェクトでのみ表示できます');
    }
    var output = HtmlService.createTemplateFromFile(fileName).evaluate()
      .setTitle(MENU)
      .setWidth(460)
      .setHeight(680);
    ui.showSidebar(output);
    return '表示しました: ' + fileName;
  }

  function context() {
    return guard(function () {
      var current = Access.requireUiAccess();
      var tasks = Access.visibleTasks(current);
      var projects = Access.visibleProjects(current, tasks);
      var projectIds = Object.create(null);
      projects.forEach(function (project) { projectIds[project.Project_ID] = true; });
      var subprojects = Database.read('SUBPROJECTS').filter(function (subproject) { return !!projectIds[subproject.Project_ID]; });
      var skills = Access.visibleSkills(current);
      return {
        actor: current,
        canManage: current.role === 'ADMIN' || current.role === 'MANAGER',
        canAdminister: current.role === 'ADMIN',
        projects: projects.map(function (project) {
          return {id: project.Project_ID, name: project.Project_Name, status: project.Status};
        }),
        subprojects: subprojects.map(function (subproject) {
          return {id: subproject.Subproject_ID, projectId: subproject.Project_ID, name: subproject.Subproject_Name, status: subproject.Status};
        }),
        members: Access.memberDirectory(current),
        roles: Members.roles,
        skills: skills.skills.map(function (skill) {
          return {id: skill.Skill_ID, name: skill.Skill_Name, category: skill.Category};
        }),
        tasks: tasks.slice(0, 300).map(function (task) {
          return {
            id: task.Task_ID, name: task.Task_Name, projectId: task.Project_ID,
            ownerId: task.Owner_Member_ID, status: task.Status,
            progress: task.Progress_Percent, due: task.Due_Date || '',
            estimated: task.Estimated_Hours, approved: !!task.Assignment_Approved_At
          };
        })
      };
    });
  }

  function createProject(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var project = Projects.create({
        Project_Name: text(payload.name, 'プロジェクト名'),
        Description: payload.description || '',
        Category: payload.category || '',
        Project_Owner_ID: payload.ownerId || '',
        Status: payload.status || 'Planned',
        Priority: payload.priority || 'Medium',
        Planned_Start: payload.plannedStart || '',
        Committed_Deadline: payload.deadline || ''
      });
      AuditLog.write('UI_PROJECT_CREATED', 'PROJECT', project.Project_ID, {status: project.Status});
      return plain(project);
    });
  }

  function createSubproject(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var subproject = Subprojects.create({
        Project_ID: text(payload.projectId, 'プロジェクト'),
        Subproject_Name: text(payload.name, 'サブプロジェクト名'),
        Owner_ID: payload.ownerId || '',
        Status: payload.status || 'Planned',
        Planned_Start: payload.plannedStart || '',
        Deadline: payload.deadline || ''
      });
      AuditLog.write('UI_SUBPROJECT_CREATED', 'SUBPROJECT', subproject.Subproject_ID, {project: subproject.Project_ID});
      return plain(subproject);
    });
  }

  /** Deadline-only assignment is valid; start date and estimate stay optional. */
  function assignTask(payload) {
    return guard(function () {
      payload = payload || {};
      var current = Access.requireManager();
      var projectId = text(payload.projectId, 'プロジェクト');
      if (payload.taskId) {
        // Updating an existing task: the caller must own the task or manage its project.
        Access.requireTaskWrite(payload.taskId, current.email);
      } else {
        Access.requireProjectWrite(projectId, current.email);
      }
      var data = {
        Project_ID: projectId,
        Subproject_ID: payload.subprojectId || '',
        Task_Name: text(payload.taskName, 'タスク名'),
        Description: payload.description || '',
        Owner_Member_ID: text(payload.ownerId, '担当者'),
        Status: payload.status || 'Assigned',
        Priority: payload.priority || 'Medium',
        Planned_Start: payload.plannedStart || '',
        Due_Date: payload.deadline || '',
        Estimated_Hours: optionalNumber(payload.estimatedHours, '見積時間'),
        Acceptance_Criteria: payload.acceptanceCriteria || '',
        Next_Action: payload.nextAction || '',
        Required_Skill_ID: payload.requiredSkillId || '',
        Required_Skill_Level: payload.requiredSkillLevel === '' || payload.requiredSkillLevel === undefined ? '' : Number(payload.requiredSkillLevel),
        Notification_Enabled: payload.notify === true
      };
      var task = payload.taskId ? Tasks.update(payload.taskId, data) : Tasks.create(data);
      AuditLog.write('UI_TASK_ASSIGNED', 'TASK', task.Task_ID,
        {owner: data.Owner_Member_ID, deadline: data.Due_Date, estimate: data.Estimated_Hours, notify: data.Notification_Enabled});
      if (payload.approve === true) Notifications.approveAssignment(task.Task_ID, current.email, 'APPROVE ASSIGNMENT');
      if (payload.confirmSchedule === true) Tasks.confirmSchedule(task.Task_ID, current.email, 'CONFIRM SCHEDULE');
      var refreshed = Dashboard.refresh();
      return {task: plain(Database.find('TASKS', task.Task_ID)), dashboard: refreshed};
    });
  }

  function updateProgress(payload) {
    return guard(function () {
      payload = payload || {};
      var current = Access.requireUiAccess();
      var taskId = text(payload.taskId, 'タスク');
      Access.requireTaskWrite(taskId, current.email);
      var progress = Number(payload.progress);
      if (!isFinite(progress) || progress < 0 || progress > 100) throw new Error('進捗率は0〜100で入力してください');
      var patch = {Progress_Percent: progress};
      if (payload.status) patch.Status = payload.status;
      if (payload.nextAction !== undefined) patch.Next_Action = payload.nextAction;
      if (progress === 100) patch.Status = 'Done';
      else if (patch.Status === 'Done') throw new Error('100%未満では完了にできません');
      var task = Tasks.update(taskId, patch);
      return plain(task);
    });
  }

  function approveAssignment(payload) {
    return guard(function () {
      var current = Access.requireManager();
      var taskId = text((payload || {}).taskId, 'タスク');
      Access.requireTaskWrite(taskId, current.email);
      return Notifications.approveAssignment(taskId, current.email, 'APPROVE ASSIGNMENT');
    });
  }

  function confirmSchedule(payload) {
    return guard(function () {
      var current = Access.requireManager();
      var taskId = text((payload || {}).taskId, 'タスク');
      Access.requireTaskWrite(taskId, current.email);
      return plain(Tasks.confirmSchedule(taskId, current.email, 'CONFIRM SCHEDULE'));
    });
  }

  function members() {
    return guard(function () {
      Access.requireManager();
      return Database.read('MEMBERS').map(function (member) {
        var open = Members.openTasks(member.Member_ID);
        return {
          id: member.Member_ID, name: member.Name, email: member.Email, department: member.Department,
          position: member.Position, active: member.Active === true, role: Roles.normalize(member.Role),
          capacity: member.Weekly_Capacity_Hours, openTasks: open.length,
          overdue: open.filter(function (task) { return task.Due_Date && task.Due_Date < Domain.today(); }).length,
          nextDeadline: open.map(function (task) { return task.Due_Date || ''; }).filter(Boolean).sort()[0] || ''
        };
      });
    });
  }

  function saveMember(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var capacity = optionalNumber(payload.capacity, '週容量');
      var data = {
        Name: text(payload.name, '氏名'),
        Email: text(payload.email, 'メールアドレス'),
        Department: payload.department || '',
        Position: payload.position || '',
        Weekly_Capacity_Hours: capacity === '' ? 0 : capacity,
        Active: payload.active !== false
      };
      // The role is data, not an authorization claim: Members.guardRoleChange validates it
      // against the verified actor and refuses any privilege escalation.
      if (payload.role !== undefined && payload.role !== '') data.Role = payload.role;
      var member = payload.memberId ? Members.update(payload.memberId, data) : Members.create(Object.assign({Role: 'MEMBER'}, data));
      return plain(member);
    });
  }

  function deactivateMember(payload) {
    return guard(function () {
      Access.requireManager();
      return plain(Members.deactivate(text((payload || {}).memberId, 'メンバー')));
    });
  }

  function skills() {
    return guard(function () {
      var current = Access.requireUiAccess();
      var visible = Access.visibleSkills(current);
      var matrix = Skills.matrix();
      if (current.role === 'ADMIN' || current.role === 'MANAGER') return {matrix: matrix, gaps: Skills.gaps()};
      var own = matrix.filter(function (row, index) { return index === 0 || row[0] === current.memberId; });
      return {matrix: own, gaps: []};
    });
  }

  function setSkill(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var level = Number(payload.level);
      if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error('スキルレベルは0〜4の整数で入力してください');
      return plain(Skills.setMember(text(payload.memberId, 'メンバー'), text(payload.skillId, 'スキル'), level, {
        assessmentDate: payload.assessmentDate || '',
        assessedBy: payload.assessedBy || '',
        evidence: payload.evidence,
        trainingAction: payload.trainingAction,
        nextReviewDate: payload.nextReviewDate || ''
      }));
    });
  }

  function createSkill(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      return plain(Skills.create({
        Skill_Name: text(payload.name, 'スキル名'), Category: payload.category || '',
        Description: payload.description || '', Required_Level: optionalNumber(payload.requiredLevel, '要求レベル')
      }));
    });
  }

  function createIssue(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      return plain(Issues.create({
        Project_ID: text(payload.projectId, 'プロジェクト'),
        Subproject_ID: payload.subprojectId || '',
        Task_ID: payload.taskId || '',
        Description: text(payload.description, '課題内容'),
        Severity: payload.severity || 'Medium',
        Status: 'Open',
        Owner_ID: payload.ownerId || '',
        Raised_Date: payload.raisedDate || Domain.today(),
        Target_Close_Date: payload.targetCloseDate || '',
        Corrective_Action: payload.correctiveAction || ''
      }));
    });
  }

  function createMilestone(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      return plain(Milestones.create({
        Project_ID: text(payload.projectId, 'プロジェクト'),
        Subproject_ID: payload.subprojectId || '',
        Milestone_Name: text(payload.name, 'マイルストーン名'),
        Owner_ID: payload.ownerId || '',
        Target_Date: text(payload.targetDate, '目標日'),
        Gate_Type: payload.gateType || '',
        Status: payload.status || '',
        Acceptance_Criteria: payload.acceptanceCriteria || ''
      }));
    });
  }

  function automationSettings() {
    return guard(function () {
      Access.requireManager();
      return {
        settings: AutomationSettings.describe(),
        status: Notifications.effectiveStatus(),
        history: Notifications.history(20).map(function (row) {
          return {
            id: row.Notification_ID, type: row.Notification_Type, recipient: row.Recipient,
            result: row.Result, created: plain(row.Created_At), error: row.Error_Details
          };
        })
      };
    });
  }

  function saveAutomationSettings(payload) {
    return guard(function () {
      payload = payload || {};
      Access.requireManager();
      var result = AutomationSettings.save(payload.changes || {}, AuditLog.actor(), payload.confirmation || '');
      return {updated: result.updated, mode: result.effective.mode, reason: result.effective.reason};
    });
  }

  function restoreAutomationDefaults(payload) {
    return guard(function () {
      Access.requireManager();
      var result = AutomationSettings.restoreDefaults(AuditLog.actor(),
        payload && payload.confirmation ? payload.confirmation : '');
      return {restored: true, mode: result.effective.mode};
    });
  }

  function previewNotifications() {
    return guard(function () {
      Access.requireManager();
      return Notifications.preview().map(function (item) {
        return {taskId: item.taskId, type: item.type, stage: item.stage, recipient: item.recipient, subject: item.subject};
      });
    });
  }

  /** Shared dashboard publication status. Never returns the destination spreadsheet id. */
  function publicationStatus() {
    return guard(function () {
      Access.requireManager();
      return SharedDashboardPublisher.status();
    });
  }

  function savePublicationSettings(payload) {
    return guard(function () {
      payload = payload || {};
      Access.requireManager();
      var result = SharedDashboardPublisher.saveSettings(payload.changes || {}, AuditLog.actor(), payload.confirmation || '');
      return {
        updated: result.updated,
        enabled: AutomationSettings.get().SHARED_DASHBOARD_PUBLISH_ENABLED === true
      };
    });
  }

  function publicationPreview() {
    return guard(function () {
      Access.requireManager();
      var preview = SharedDashboardPublisher.preview();
      return {
        initialized: preview.initialized,
        publishedVersion: preview.publishedVersion,
        unchanged: preview.unchanged,
        counts: preview.counts,
        storedCounts: preview.storedCounts,
        excluded: preview.excluded,
        warnings: preview.warnings.map(function (warning) { return warning.code; })
      };
    });
  }

  function publishPublicationNow() {
    return guard(function () {
      Access.requireManager();
      var result = SharedDashboardPublisher.publish({mode: 'MANUAL', actorEmail: AuditLog.actor()});
      return {
        version: result.version, asOf: result.asOf, counts: result.counts,
        excluded: result.excluded, warnings: result.warnings
      };
    });
  }

  function notificationHistory() {
    return guard(function () {
      Access.requireManager();
      return Notifications.history(50).map(function (row) {
        return {id: row.Notification_ID, type: row.Notification_Type, recipient: row.Recipient,
          result: row.Result, created: plain(row.Created_At), error: row.Error_Details};
      });
    });
  }

  function reconcileUncertain(payload) {
    return guard(function () {
      Access.requireManager();
      return Notifications.reconcileUncertain(AuditLog.actor(), (payload || {}).confirmation || '');
    });
  }

  function refresh() {
    return guard(function () {
      Access.requireUiAccess();
      return refreshManagement();
    });
  }

  function status() {
    return guard(function () {
      Access.requireUiAccess();
      return systemStatus();
    });
  }

  return {
    MENU: MENU,
    show: show,
    context: context,
    createProject: createProject,
    createSubproject: createSubproject,
    assignTask: assignTask,
    updateProgress: updateProgress,
    approveAssignment: approveAssignment,
    confirmSchedule: confirmSchedule,
    members: members,
    saveMember: saveMember,
    deactivateMember: deactivateMember,
    skills: skills,
    setSkill: setSkill,
    createSkill: createSkill,
    createIssue: createIssue,
    createMilestone: createMilestone,
    automationSettings: automationSettings,
    saveAutomationSettings: saveAutomationSettings,
    restoreAutomationDefaults: restoreAutomationDefaults,
    previewNotifications: previewNotifications,
    publicationStatus: publicationStatus,
    savePublicationSettings: savePublicationSettings,
    publicationPreview: publicationPreview,
    publishPublicationNow: publishPublicationNow,
    notificationHistory: notificationHistory,
    reconcileUncertain: reconcileUncertain,
    refresh: refresh,
    status: status
  };
}());

/** Template inclusion for the bound UI; HtmlService resolves this global by name. */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Google Sheets menu; requires a container-bound deployment. */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu(Ui.MENU)
      .addItem('ダッシュボード', 'showManagerSidebar')
      .addItem('新規プロジェクト', 'showManagerSidebar')
      .addItem('新規サブプロジェクト', 'showManagerSidebar')
      .addItem('新規タスク', 'showManagerSidebar')
      .addItem('タスク割当', 'showManagerSidebar')
      .addItem('進捗更新', 'showManagerSidebar')
      .addItem('課題', 'showManagerSidebar')
      .addItem('マイルストーン', 'showManagerSidebar')
      .addItem('メンバー', 'showManagerSidebar')
      .addItem('スキル', 'showManagerSidebar')
      .addItem('自動化設定', 'showAutomationSidebar')
      .addItem('ダッシュボード更新', 'refreshDashboardFromMenu')
      .addItem('システム状態', 'showSystemSidebar')
      .addToUi();
  } catch (error) {
    console.warn('Engineering HUB menu requires a container-bound Apps Script project: ' + error.message);
  }
}
function showManagerSidebar() { return Ui.show('UiMenu'); }
function showAutomationSidebar() { return Ui.show('UiSettings'); }
function showSystemSidebar() { return Ui.show('UiSystem'); }
function refreshDashboardFromMenu() {
  var result = Ui.refresh();
  try {
    SpreadsheetApp.getActive().toast(result.ok ? 'ダッシュボードを更新しました' : String(result.error), 'Engineering HUB', 5);
  } catch (error) { /* standalone execution has no active sheet */ }
  return result;
}

/** google.script.run bridges. */
function uiContext() { return Ui.context(); }
function uiCreateProject(payload) { return Ui.createProject(payload); }
function uiCreateSubproject(payload) { return Ui.createSubproject(payload); }
function uiAssignTask(payload) { return Ui.assignTask(payload); }
function uiUpdateProgress(payload) { return Ui.updateProgress(payload); }
function uiApproveAssignment(payload) { return Ui.approveAssignment(payload); }
function uiConfirmSchedule(payload) { return Ui.confirmSchedule(payload); }
function uiMembers() { return Ui.members(); }
function uiSaveMember(payload) { return Ui.saveMember(payload); }
function uiDeactivateMember(payload) { return Ui.deactivateMember(payload); }
function uiSkills() { return Ui.skills(); }
function uiSetSkill(payload) { return Ui.setSkill(payload); }
function uiCreateSkill(payload) { return Ui.createSkill(payload); }
function uiCreateIssue(payload) { return Ui.createIssue(payload); }
function uiCreateMilestone(payload) { return Ui.createMilestone(payload); }
function uiAutomationSettings() { return Ui.automationSettings(); }
function uiSaveAutomationSettings(payload) { return Ui.saveAutomationSettings(payload); }
function uiRestoreAutomationDefaults(payload) { return Ui.restoreAutomationDefaults(payload); }
function uiPreviewNotifications() { return Ui.previewNotifications(); }
function uiPublicationStatus() { return Ui.publicationStatus(); }
function uiSavePublicationSettings(payload) { return Ui.savePublicationSettings(payload); }
function uiPublicationPreview() { return Ui.publicationPreview(); }
function uiPublishPublicationNow() { return Ui.publishPublicationNow(); }
function uiNotificationHistory() { return Ui.notificationHistory(); }
function uiReconcileUncertain(payload) { return Ui.reconcileUncertain(payload); }
function uiRefresh() { return Ui.refresh(); }
function uiSystemStatus() { return Ui.status(); }