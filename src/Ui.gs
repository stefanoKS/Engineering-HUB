/**
 * Manager-facing UI adapter (container-bound Apps Script only).
 *
 * A standalone script project cannot show SpreadsheetApp.getUi(), so this adapter requires
 * a Sheets-bound deployment. Every write goes through the same validated domain services as
 * the rest of the application, plus a server-side authorization check from Access.gs. Role,
 * actor and owner values supplied by the browser are never trusted for authorization.
 */
var Ui = (function () {
  var MENU = '設計・開発課 管理';

  function guard(action) {
    try {
      return {ok: true, data: action()};
    } catch (error) {
      return {ok: false, error: String(error && error.message ? error.message : error)};
    }
  }

  function plain(value) { return value === undefined ? null : JSON.parse(JSON.stringify(value)); }

  function dateText(value) {
    if (value === undefined || value === null || value === '') return '';
    if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
    var result = String(value);
    return /^\d{4}-\d{2}-\d{2}/.test(result) ? result.slice(0, 10) : '';
  }

  /**
   * Optimistic-concurrency marker. The browser sends the value it loaded; a different
   * stored value means somebody saved the record first, so the edit is refused instead
   * of silently overwriting newer data.
   */
  function timestamp(value) {
    if (value === undefined || value === null || value === '') return '';
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  function stampChanged(loaded, stored) {
    if (!loaded) return false;
    return timestamp(loaded) !== timestamp(stored);
  }

  /** Visibility is an explicit manager decision; blank or unknown values stay private. */
  function visibilityValue(value) {
    var normalized = String(value === undefined || value === null ? '' : value).trim().toUpperCase();
    if (normalized === '' || normalized === 'RESTRICTED') return 'RESTRICTED';
    if (normalized === 'INTERNAL') return 'INTERNAL';
    throw new Error('ダッシュボード表示は INTERNAL または RESTRICTED を指定してください');
  }

  /** Statuses a manager may select; archival uses Projects.archive instead. */
  var PROJECT_STATUSES = ['Planned', 'Active', 'On Hold', 'Completed', 'Cancelled'];

  /**
   * A new project may only be filed under an active responsibility (or stay unassigned).
   * Retirement stops new selection but never hides or changes existing projects.
   */
  function responsibilityForNewProject(value) {
    var id = String(value === undefined || value === null ? '' : value).trim();
    if (!id) return '';
    var row = Database.find('RESPONSIBILITIES', id);
    if (!row) throw new Error('担当領域が見つかりません');
    if (row.Status === 'Retired') throw new Error('廃止した担当領域は新規案件に指定できません');
    return id;
  }

  function projectStatus(value) {
    var status = text(value, '状態');
    if (PROJECT_STATUSES.indexOf(status) < 0) {
      throw new Error('状態は ' + PROJECT_STATUSES.join(' / ') + ' から選択してください');
    }
    return status;
  }

  /**
   * Any ADMIN or MANAGER may edit any project. Project ownership is accountability, not a
   * permission boundary, so two managers can always collaborate on the same project.
   */
  function canManageProject(current, project) {
    if (!project) return false;
    return current.role === 'ADMIN' || current.role === 'MANAGER';
  }

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

  /**
   * Opens a sidebar at a specific section.
   *
   * The initial section and action are template values, never a mutable global, so two
   * users opening different menu entries cannot interfere with each other.
   */
  var VIEWS = ['project', 'task', 'admin'];
  var ACTIONS = ['create', 'assign', 'progress', 'edit'];

  /**
   * The sidebar loads a bounded, deterministic task window so the first render stays fast.
   * The window is never a silent cut-off: `taskTotal`/`tasksTruncated` are returned and
   * `taskOptions()` lets the manager search or narrow to a project to reach any task.
   */
  var TASK_WINDOW = 300;
  var TASK_OPTIONS_WINDOW = 500;

  /** Open work first, then the nearest deadline, then a stable ID order. */
  function compareTasks(left, right) {
    var closedLeft = left.Status === 'Done' || left.Status === 'Cancelled';
    var closedRight = right.Status === 'Done' || right.Status === 'Cancelled';
    if (closedLeft !== closedRight) return closedLeft ? 1 : -1;
    var dueLeft = left.Due_Date ? String(left.Due_Date) : '9999-12-31';
    var dueRight = right.Due_Date ? String(right.Due_Date) : '9999-12-31';
    if (dueLeft !== dueRight) return dueLeft < dueRight ? -1 : 1;
    return String(left.Task_ID || '').localeCompare(String(right.Task_ID || ''));
  }

  function taskItem(current, task) {
    return {
      id: task.Task_ID, name: task.Task_Name, projectId: task.Project_ID,
      subprojectId: task.Subproject_ID || '', ownerId: task.Owner_Member_ID,
      status: task.Status, priority: task.Priority || 'Medium',
      progress: task.Progress_Percent, due: dateText(task.Due_Date),
      plannedStart: dateText(task.Planned_Start),
      durationValue: task.Planned_Duration_Value === '' || task.Planned_Duration_Value === undefined ? '' : task.Planned_Duration_Value,
      durationUnit: task.Planned_Duration_Unit || 'DAY',
      durationBasis: task.Planned_Duration_Basis || 'WORKING_DAYS',
      acceptance: task.Acceptance_Criteria || '',
      estimated: task.Estimated_Hours,
      notify: task.Notification_Enabled === true,
      approved: !!task.Assignment_Approved_At,
      updatedAt: timestamp(task.Last_Updated),
      canEdit: Access.canEditTask(current, task)
    };
  }

  function show(fileName, options) {
    var ui;
    try {
      ui = SpreadsheetApp.getUi();
    } catch (error) {
      throw new Error('この画面はスプレッドシートにバインドされたApps Scriptプロジェクトでのみ表示できます');
    }
    var settings = options || {};
    var view = VIEWS.indexOf(settings.view) >= 0 ? settings.view : 'project';
    var action = ACTIONS.indexOf(settings.action) >= 0 ? settings.action : '';
    var template = HtmlService.createTemplateFromFile(fileName);
    template.initialView = view;
    template.initialAction = action;
    var output = template.evaluate()
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
      var allSubprojects = Database.read('SUBPROJECTS');
      var subprojects = allSubprojects.filter(function (subproject) { return !!projectIds[subproject.Project_ID]; });
      var skills = Access.visibleSkills(current);
      var memberList = Access.memberDirectory(current);
      var memberNames = Object.create(null);
      memberList.forEach(function (member) { memberNames[member.id] = member.name; });
      var responsibilityRows = Responsibilities.list({includeRetired: true});
      var responsibilityCounts = Responsibilities.counts();
      var retiredMap = Responsibilities.retiredMap();
      var responsibilityNames = Object.create(null);
      responsibilityRows.forEach(function (row) { responsibilityNames[row.Responsibility_ID] = row.Name; });
      var children = Subprojects.childrenMap(allSubprojects);
      var parentMap = Subprojects.parentMap(allSubprojects);
      var responsibilityItems = responsibilityRows.map(function (row) {
        var item = responsibilityCounts[row.Responsibility_ID] || {};
        return {
          id: row.Responsibility_ID,
          name: row.Name,
          description: row.Description || '',
          ownerId: row.Owner_Member_ID || '',
          ownerName: memberNames[row.Owner_Member_ID] || '',
          status: row.Status === 'Retired' ? 'Retired' : 'Active',
          retired: row.Status === 'Retired',
          sortOrder: Number(row.Sort_Order) || 0,
          activeProjects: item.activeProjects || 0,
          atRiskProjects: item.atRiskProjects || 0,
          totalProjects: item.totalProjects || 0,
          canEdit: Access.canManageResponsibility(current, row)
        };
      });
      return {
        actor: current,
        canManage: current.role === 'ADMIN' || current.role === 'MANAGER',
        canAdminister: current.role === 'ADMIN',
        responsibilities: responsibilityItems,
        projects: projects.map(function (project) {
          return {
            id: project.Project_ID,
            name: project.Project_Name,
            status: project.Status || 'Planned',
            ownerId: project.Project_Owner_ID || '',
            category: project.Category || '',
            responsibilityId: project.Responsibility_ID || '',
            responsibilityName: responsibilityNames[project.Responsibility_ID] || '',
            needsReassignment: Responsibilities.needsReassignment(project, retiredMap),
            priority: project.Priority || 'Medium',
            deadline: dateText(project.Committed_Deadline),
            description: project.Description || '',
            summary: project.Dashboard_Summary || '',
            visibility: SharedDashboardModel.visibility(project),
            updatedAt: timestamp(project.Last_Updated),
            canEdit: canManageProject(current, project)
          };
        }),
        subprojects: subprojects.map(function (subproject) {
          var level = 1;
          try {
            level = Subprojects.levelOf(subproject.Subproject_ID, parentMap);
          } catch (error) {
            level = 1;
          }
          return {
            id: subproject.Subproject_ID,
            projectId: subproject.Project_ID,
            parentId: subproject.Parent_Subproject_ID || '',
            level: level,
            hasChildren: !!(children[subproject.Subproject_ID] || []).length,
            name: subproject.Subproject_Name,
            ownerId: subproject.Owner_ID || '',
            status: subproject.Status
          };
        }),
        members: Access.memberDirectory(current),
        roles: Members.roles,
        skills: skills.skills.map(function (skill) {
          return {id: skill.Skill_ID, name: skill.Skill_Name, category: skill.Category};
        }),
        tasks: tasks.slice().sort(compareTasks).slice(0, TASK_WINDOW).map(function (task) {
          return taskItem(current, task);
        }),
        taskTotal: tasks.length,
        tasksTruncated: tasks.length > TASK_WINDOW
      };
    });
  }

  /**
   * Lookup endpoint for the task pickers. A manager reaches any task by narrowing to a project
   * or typing part of a name, so a large workbook never silently hides work.
   */
  function taskOptions(payload) {
    return guard(function () {
      payload = payload || {};
      var current = Access.requireUiAccess();
      var projectId = String(payload.projectId || '').trim();
      var query = String(payload.query || '').trim().toLowerCase();
      var requested = Number(payload.limit);
      var limit = isFinite(requested) && requested > 0 && requested <= TASK_OPTIONS_WINDOW ? Math.floor(requested) : TASK_OPTIONS_WINDOW;
      var matches = Access.visibleTasks(current).filter(function (task) {
        if (projectId && String(task.Project_ID) !== projectId) return false;
        if (!query) return true;
        return (String(task.Task_ID || '') + ' ' + String(task.Task_Name || '')).toLowerCase().indexOf(query) >= 0;
      }).sort(compareTasks);
      return {
        tasks: matches.slice(0, limit).map(function (task) { return taskItem(current, task); }),
        total: matches.length,
        truncated: matches.length > limit
      };
    });
  }

  function createProject(payload) {
    return guard(function () {
      var current = Access.requireManager();
      payload = payload || {};
      // The verified manager becomes the owner unless another owner is chosen explicitly.
      var owner = String(payload.ownerId === undefined || payload.ownerId === null ? '' : payload.ownerId).trim();
      if (!owner) owner = current.memberId;
      if (!owner) throw new Error('責任者を指定してください');
      var status = payload.status === undefined || payload.status === '' ? 'Planned' : projectStatus(payload.status);
      if (status === 'Completed') throw new Error('新規プロジェクトは完了状態で作成できません');
      var project = Projects.create({
        Project_Name: text(payload.name, 'プロジェクト名'),
        Description: payload.description || '',
        Category: payload.category || '',
        Responsibility_ID: responsibilityForNewProject(payload.responsibilityId),
        Project_Owner_ID: owner,
        Status: status,
        Priority: payload.priority || 'Medium',
        Planned_Start: payload.plannedStart || '',
        Committed_Deadline: payload.deadline || '',
        Dashboard_Visibility: visibilityValue(payload.visibility),
        Dashboard_Summary: payload.summary || ''
      });
      AuditLog.write('UI_PROJECT_CREATED', 'PROJECT', project.Project_ID,
        {status: project.Status, owner: project.Project_Owner_ID, visibility: project.Dashboard_Visibility,
          responsibility: project.Responsibility_ID || ''});
      return plain(Database.find('PROJECTS', project.Project_ID));
    });
  }

  /**
   * Edits an existing project with a partial patch.
   *
   * Only the fields present in the payload are written, so an edit of one field never
   * blanks another. Project_ID, Original_Deadline, Created_At and the migration/audit
   * identifiers are not editable here.
   *
   * Google Sheets has no multi-row transaction, so every validation — including the
   * responsibility destination and the deadline confirmation — runs before anything is
   * written, and the whole edit is applied as one coordinated project row update. A refused
   * change therefore never leaves earlier fields already committed.
   */
  function updateProject(payload) {
    return guard(function () {
      var current = Access.requireManager();
      payload = payload || {};
      var projectId = text(payload.projectId, 'プロジェクト');
      Access.requireProjectWrite(projectId, current.email);
      var before = Database.find('PROJECTS', projectId);
      if (!before) throw new Error('プロジェクトが見つかりません');
      if (stampChanged(payload.updatedAt, before.Last_Updated)) {
        throw new Error('このプロジェクトは読み込み後に更新されています。再読み込みしてから保存してください');
      }
      var patch = {};
      if (payload.name !== undefined) patch.Project_Name = text(payload.name, 'プロジェクト名');
      if (payload.ownerId !== undefined) patch.Project_Owner_ID = text(payload.ownerId, '責任者');
      if (payload.status !== undefined) patch.Status = projectStatus(payload.status);
      if (payload.category !== undefined) patch.Category = String(payload.category).trim();
      if (payload.priority !== undefined) patch.Priority = text(payload.priority, '優先度');
      if (payload.description !== undefined) patch.Description = String(payload.description);
      if (payload.summary !== undefined) patch.Dashboard_Summary = String(payload.summary);
      if (payload.visibility !== undefined) patch.Dashboard_Visibility = visibilityValue(payload.visibility);
      // A responsibility change is validated here and folded into the same row write.
      var transfer = null;
      if (payload.responsibilityId !== undefined) {
        var targetResponsibility = String(payload.responsibilityId === null ? '' : payload.responsibilityId).trim();
        var currentResponsibility = String(before.Responsibility_ID || '');
        if (targetResponsibility !== currentResponsibility) {
          if (payload.confirmResponsibilityChange !== true) {
            throw new Error('担当領域の変更には確認が必要です');
          }
          var destination = null;
          if (targetResponsibility) {
            destination = Database.find('RESPONSIBILITIES', targetResponsibility);
            if (!destination) throw new Error('担当領域が見つかりません');
            if (destination.Status === 'Retired' && payload.confirmRetiredResponsibility !== true) {
              throw new Error('廃止した担当領域への移動には追加の確認が必要です');
            }
          }
          patch.Responsibility_ID = targetResponsibility;
          transfer = {
            previous: currentResponsibility,
            next: targetResponsibility,
            nextName: destination ? destination.Name : '',
            reason: String(payload.responsibilityReason || '').slice(0, 200)
          };
        }
      }
      if (payload.deadline !== undefined) {
        var deadline = String(payload.deadline || '').trim();
        if (deadline !== dateText(before.Committed_Deadline) && payload.confirmDeadlineChange !== true) {
          throw new Error('確定期限の変更には確認が必要です');
        }
        patch.Committed_Deadline = deadline;
      }
      if (!Object.keys(patch).length) throw new Error('変更する項目がありません');
      if (patch.Status === 'Completed') {
        var rolled = Progress.rollup(Database.read('TASKS').filter(function (task) { return task.Project_ID === projectId; }));
        if (!rolled.calculated || rolled.percent !== 100) {
          throw new Error('全てのタスクが完了していないため、プロジェクトを完了にできません');
        }
        patch.Progress_Percent = 100;
      }
      var project = Projects.update(projectId, patch);
      if (transfer) {
        AuditLog.write('RESPONSIBILITY_TRANSFERRED', 'PROJECT', projectId, {
          previousResponsibilityId: transfer.previous,
          newResponsibilityId: transfer.next,
          reason: transfer.reason,
          actor: current.email
        });
      }
      AuditLog.write('UI_PROJECT_UPDATED', 'PROJECT', projectId, {
        fields: Object.keys(patch).join(','), owner: project.Project_Owner_ID,
        status: project.Status, visibility: project.Dashboard_Visibility,
        responsibility: project.Responsibility_ID || '',
        deadline: dateText(project.Committed_Deadline)
      });
      return plain(Database.find('PROJECTS', projectId));
    });
  }

  function createSubproject(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var parentId = String(payload.parentId || '').trim();
      var subproject = Subprojects.create({
        Project_ID: text(payload.projectId, 'プロジェクト'),
        Parent_Subproject_ID: parentId,
        Subproject_Name: text(payload.name, 'サブプロジェクト名'),
        Owner_ID: payload.ownerId || '',
        Status: payload.status || 'Planned',
        Planned_Start: payload.plannedStart || '',
        Deadline: payload.deadline || ''
      });
      AuditLog.write('UI_SUBPROJECT_CREATED', 'SUBPROJECT', subproject.Subproject_ID,
        {project: subproject.Project_ID, parent: parentId});
      return plain(subproject);
    });
  }

  /**
   * Edits a subproject. A hierarchy change goes through its own audited operation, so the
   * parent is never written as a side effect of renaming a record.
   */
  function saveSubproject(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var subprojectId = text(payload.subprojectId, 'サブプロジェクト');
      var before = Database.find('SUBPROJECTS', subprojectId);
      if (!before) throw new Error('サブプロジェクトが見つかりません');
      var patch = {};
      if (payload.name !== undefined) patch.Subproject_Name = text(payload.name, 'サブプロジェクト名');
      if (payload.ownerId !== undefined) patch.Owner_ID = String(payload.ownerId || '');
      var reparent = null;
      if (payload.parentId !== undefined) {
        var target = String(payload.parentId || '').trim();
        if (target !== String(before.Parent_Subproject_ID || '')) {
          if (payload.confirmReparent !== true) throw new Error('階層の変更には確認が必要です');
          reparent = target;
        }
      }
      if (!Object.keys(patch).length && reparent === null) throw new Error('変更する項目がありません');
      if (reparent !== null) patch.Parent_Subproject_ID = reparent;
      var row = Subprojects.update(subprojectId, patch);
      if (reparent !== null) AuditLog.write('SUBPROJECT_REPARENTED', 'SUBPROJECT', subprojectId,
        {previousParent: before.Parent_Subproject_ID || '', newParent: reparent});
      return plain(row);
    });
  }

  function archiveSubproject(payload) {
    return guard(function () {
      Access.requireManager();
      return plain(Subprojects.archive(text((payload || {}).subprojectId, 'サブプロジェクト')));
    });
  }

  function reactivateSubproject(payload) {
    return guard(function () {
      Access.requireManager();
      return plain(Subprojects.reactivate(text((payload || {}).subprojectId, 'サブプロジェクト')));
    });
  }

  /** Explicit, confirmed task move inside the same project. */
  function moveTask(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var taskId = text(payload.taskId, 'タスク');
      var updated = Subprojects.moveTask(taskId, payload.subprojectId || '', {confirmed: true});
      return plain(updated);
    });
  }

  function saveResponsibility(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var patch = {};
      if (payload.name !== undefined) patch.Name = text(payload.name, '担当領域名');
      if (payload.description !== undefined) patch.Description = String(payload.description);
      if (payload.ownerId !== undefined) patch.Owner_Member_ID = String(payload.ownerId || '');
      if (payload.responsibilityId) {
        if (!Object.keys(patch).length) throw new Error('変更する項目がありません');
        return plain(Responsibilities.update(payload.responsibilityId, patch));
      }
      if (!patch.Name) throw new Error('担当領域名を入力してください');
      return plain(Responsibilities.create(patch));
    });
  }

  /** Moves one responsibility one position up or down in the manager's display order. */
  function moveResponsibility(payload) {
    return guard(function () {
      payload = payload || {};
      Access.requireManager();
      var rows = Responsibilities.all();
      var ids = rows.map(function (row) { return row.Responsibility_ID; });
      var index = ids.indexOf(String(payload.responsibilityId || ''));
      if (index < 0) throw new Error('担当領域が見つかりません');
      var target = payload.direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= ids.length) return {moved: false};
      var swapped = ids.slice();
      var current = swapped[index];
      swapped[index] = swapped[target];
      swapped[target] = current;
      Responsibilities.reorder(swapped);
      return {moved: true};
    });
  }

  function retireResponsibility(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var result = Responsibilities.retire(text(payload.responsibilityId, '担当領域'), {confirmed: true});
      return {retired: true, openProjects: result.openProjects};
    });
  }

  function reactivateResponsibility(payload) {
    return guard(function () {
      Access.requireManager();
      return plain(Responsibilities.reactivate(text((payload || {}).responsibilityId, '担当領域')));
    });
  }

  /** Explicit, confirmed responsibility transfer; ownership and deadlines are untouched. */
  function transferProject(payload) {
    return guard(function () {
      Access.requireManager();
      payload = payload || {};
      var projectId = text(payload.projectId, 'プロジェクト');
      var result = Responsibilities.transferProject(projectId, payload.responsibilityId || '', {
        confirmed: true,
        confirmRetired: payload.confirmRetiredResponsibility === true,
        reason: payload.reason || ''
      });
      return {changed: result.changed, previous: result.previous, next: result.next,
        nextName: result.nextName, project: plain(Database.find('PROJECTS', projectId))};
    });
  }

  /**
   * Builds a partial task patch from the edit payload.
   *
   * A key that is absent from the payload is never written, so an edit cannot blank an
   * unrelated column. An explicit empty value (for example an empty duration) is a
   * deliberate clear and is written.
   */
  function taskPatch(payload, existing) {
    var patch = {};
    if (payload.projectId !== undefined) patch.Project_ID = text(payload.projectId, 'プロジェクト');
    if (payload.subprojectId !== undefined) patch.Subproject_ID = String(payload.subprojectId).trim();
    if (payload.taskName !== undefined) patch.Task_Name = text(payload.taskName, 'タスク名');
    if (payload.description !== undefined) patch.Description = String(payload.description);
    if (payload.ownerId !== undefined) patch.Owner_Member_ID = text(payload.ownerId, '担当者');
    if (payload.status !== undefined) patch.Status = text(payload.status, '状態');
    if (payload.priority !== undefined) patch.Priority = text(payload.priority, '優先度');
    if (payload.plannedStart !== undefined) patch.Planned_Start = String(payload.plannedStart).trim();
    if (payload.deadline !== undefined) patch.Due_Date = String(payload.deadline || '').trim();
    if (payload.actualHours !== undefined) patch.Actual_Hours = optionalNumber(payload.actualHours, '実績時間');
    if (payload.progress !== undefined) {
      patch.Progress_Percent = Number(payload.progress);
      if (patch.Progress_Percent === 100) patch.Status = 'Done';
    }
    if (payload.estimatedHours !== undefined) patch.Estimated_Hours = optionalNumber(payload.estimatedHours, '見積時間');
    if (payload.acceptanceCriteria !== undefined) patch.Acceptance_Criteria = String(payload.acceptanceCriteria);
    if (payload.nextAction !== undefined) patch.Next_Action = String(payload.nextAction);
    if (payload.requiredSkillId !== undefined) patch.Required_Skill_ID = String(payload.requiredSkillId).trim();
    if (payload.requiredSkillLevel !== undefined) {
      patch.Required_Skill_Level = payload.requiredSkillLevel === '' || payload.requiredSkillLevel === null ? '' : Number(payload.requiredSkillLevel);
    }
    if (typeof payload.notify === 'boolean') patch.Notification_Enabled = payload.notify;
    if (payload.durationValue !== undefined) {
      var durationValue = optionalNumber(payload.durationValue, '必要期間');
      if (durationValue !== '' && (!Number.isInteger(durationValue) || durationValue <= 0)) {
        throw new Error('必要期間は0より大きい数値で入力してください');
      }
      patch.Planned_Duration_Value = durationValue;
      patch.Planned_Duration_Unit = durationValue === '' ? '' : (payload.durationUnit || 'DAY');
      patch.Planned_Duration_Basis = durationValue === '' ? '' : (payload.durationBasis || 'WORKING_DAYS');
    }
    var effectiveDuration = patch.Planned_Duration_Value !== undefined
      ? patch.Planned_Duration_Value : existing.Planned_Duration_Value;
    var noDuration = effectiveDuration === '' || effectiveDuration === null || effectiveDuration === undefined;
    if (patch.Planned_Start && noDuration) patch.Planned_Start_Source = 'MANUAL';
    if (!Object.keys(patch).length) throw new Error('変更する項目がありません');
    return patch;
  }

  /**
   * Creates or edits a task. Deadline and required duration stay the primary schedule
   * inputs; the planned start is derived by Tasks.validate / Planning.applyTaskPlan.
   */
  function assignTask(payload, options) {
    return guard(function () {
      payload = payload || {};
      var current = Access.requireManager();
      var task;
      if (payload.taskId) {
        var existing = Access.requireTaskWrite(payload.taskId, current.email).task;
        if (stampChanged(payload.updatedAt, existing.Last_Updated)) {
          throw new Error('このタスクは読み込み後に更新されています。再読み込みしてから保存してください');
        }
        var patch = taskPatch(payload, existing);
        // Moving a task into another project requires rights on the destination project.
        if (patch.Project_ID && patch.Project_ID !== existing.Project_ID) {
          Access.requireProjectWrite(patch.Project_ID, current.email);
        }
        task = Tasks.update(payload.taskId, patch);
      } else {
        var projectId = text(payload.projectId, 'プロジェクト');
        Access.requireProjectWrite(projectId, current.email);
        var durationValue = optionalNumber(payload.durationValue, '必要期間');
        if (durationValue !== '' && (!Number.isInteger(durationValue) || durationValue <= 0)) {
          throw new Error('必要期間は0より大きい数値で入力してください');
        }
        var data = {
          Project_ID: projectId,
          Subproject_ID: payload.subprojectId || '',
          Task_Name: text(payload.taskName, 'タスク名'),
          Description: payload.description || '',
          Owner_Member_ID: text(payload.ownerId, '担当者'),
          Status: Number(payload.progress) === 100 ? 'Done' : (payload.status || 'Assigned'),
          Progress_Percent: payload.progress === undefined || payload.progress === '' ? 0 : Number(payload.progress),
          Actual_Hours: optionalNumber(payload.actualHours, '実績時間'),
          Priority: payload.priority || 'Medium',
          Planned_Start: payload.plannedStart || '',
          Due_Date: payload.deadline || '',
          Estimated_Hours: optionalNumber(payload.estimatedHours, '見積時間'),
          Planned_Duration_Value: durationValue,
          Planned_Duration_Unit: durationValue === '' ? '' : (payload.durationUnit || 'DAY'),
          Planned_Duration_Basis: durationValue === '' ? '' : (payload.durationBasis || 'WORKING_DAYS'),
          Acceptance_Criteria: payload.acceptanceCriteria || '',
          Next_Action: payload.nextAction || '',
          Required_Skill_ID: payload.requiredSkillId || '',
          Required_Skill_Level: payload.requiredSkillLevel === '' || payload.requiredSkillLevel === undefined ? '' : Number(payload.requiredSkillLevel),
          Notification_Enabled: payload.notify === true
        };
        // An explicit start without a duration is a deliberate manual override.
        if (payload.plannedStart && durationValue === '') data.Planned_Start_Source = 'MANUAL';
        task = Tasks.create(data);
      }
      AuditLog.write(payload.taskId ? 'UI_TASK_UPDATED' : 'UI_TASK_ASSIGNED', 'TASK', task.Task_ID,
        {owner: task.Owner_Member_ID, deadline: dateText(task.Due_Date), estimate: task.Estimated_Hours,
          durationValue: task.Planned_Duration_Value, durationUnit: task.Planned_Duration_Unit,
          durationBasis: task.Planned_Duration_Basis, plannedStart: dateText(task.Planned_Start),
          plannedStartSource: task.Planned_Start_Source, notify: task.Notification_Enabled === true});
      if (payload.approve === true) Notifications.approveAssignment(task.Task_ID, current.email, 'APPROVE ASSIGNMENT');
      if (payload.confirmSchedule === true) Tasks.confirmSchedule(task.Task_ID, current.email, 'CONFIRM SCHEDULE');
      var refreshed = options && options.skipDashboard === true ? null : Dashboard.refresh();
      return {task: plain(Database.find('TASKS', task.Task_ID)), dashboard: refreshed};
    });
  }

  /** Read-only planning preview: the calculation is pure and performs no write. */
  function planPreview(payload) {
    return guard(function () {
      payload = payload || {};
      Access.requireManager();
      var holidays = Database.read('HOLIDAYS');
      var milestones = payload.projectId
        ? Database.read('MILESTONES').filter(function (row) { return row.Project_ID === payload.projectId; })
        : [];
      var warnings = Planning.planningWarnings({
        deadline: payload.deadline || '',
        durationValue: payload.durationValue,
        durationUnit: payload.durationUnit || 'DAY',
        durationBasis: payload.durationBasis || 'WORKING_DAYS',
        holidays: holidays,
        milestones: milestones
      });
      var plan = null;
      if (payload.deadline && payload.durationValue !== '' && payload.durationValue !== undefined && payload.durationValue !== null) {
        try {
          plan = Planning.planFromDuration(payload.deadline, payload.durationValue,
            payload.durationUnit || 'DAY', payload.durationBasis || 'WORKING_DAYS', holidays);
        } catch (error) {
          plan = null;
        }
      }
      return {
        startDate: plan ? plan.startDate : '',
        endDate: plan ? plan.endDate : '',
        plannedEnd: plan ? plan.plannedEnd : '',
        length: plan ? plan.length : null,
        warnings: warnings
      };
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

  /** Manager request queue: only aggregated, validated data leaves the server. */
  function requests(payload) {
    return guard(function () {
      Access.requireManager();
      var options = payload || {};
      // Opening the queue imports new inbox rows first. A broken inbox is reported as a
      // warning and never hides the requests that were already imported.
      var imported = null, importError = '';
      if (options.import !== false) {
        try {
          var result = Requests.importInbox(AuditLog.actor());
          if (result && result.error) importError = result.error;
          if (result) imported = {imported: result.imported || 0, skipped: result.skipped || 0, rejected: result.rejected || 0};
        } catch (error) {
          importError = String(error && error.message ? error.message : error);
        }
      }
      var summary = Requests.summary();
      return {
        configured: summary.inboxConfigured,
        imported: imported,
        importError: importError,
        counts: summary.counts,
        requests: Requests.queue({includeDecided: options.includeDecided === true}),
        history: Requests.history(options.taskId || '').slice(0, 50)
      };
    });
  }

  function importRequests() {
    return guard(function () {
      Access.requireManager();
      return Requests.importInbox(AuditLog.actor());
    });
  }

  function decideRequest(payload) {
    return guard(function () {
      payload = payload || {};
      Access.requireManager();
      return plain(Requests.decide(payload.requestId, payload.action, payload.note, payload.confirmation));
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
    taskOptions: taskOptions,
    createProject: createProject,
    updateProject: updateProject,
    createSubproject: createSubproject,
    saveSubproject: saveSubproject,
    archiveSubproject: archiveSubproject,
    reactivateSubproject: reactivateSubproject,
    moveTask: moveTask,
    saveResponsibility: saveResponsibility,
    moveResponsibility: moveResponsibility,
    retireResponsibility: retireResponsibility,
    reactivateResponsibility: reactivateResponsibility,
    transferProject: transferProject,
    assignTask: assignTask,
    planPreview: planPreview,
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
    requests: requests,
    importRequests: importRequests,
    decideRequest: decideRequest,
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
      .addItem('新規プロジェクト', 'showNewProjectSidebar')
      .addItem('担当領域の管理', 'showResponsibilitiesSidebar')
      .addItem('新規サブプロジェクト', 'showNewSubprojectSidebar')
      .addItem('新規タスク', 'showNewTaskSidebar')
      .addItem('タスク割当', 'showTaskAssignmentSidebar')
      .addItem('進捗更新', 'showProgressSidebar')
      .addItem('課題', 'showTaskSidebar')
      .addItem('マイルストーン', 'showProjectSidebar')
      .addItem('メンバー', 'showMembersSidebar')
      .addItem('スキル', 'showSkillsSidebar')
      .addItem('自動化設定', 'showAutomationSidebar')
      .addItem('申請一覧', 'showRequestsSidebar')
      .addItem('ダッシュボード更新', 'refreshDashboardFromMenu')
      .addItem('システム状態', 'showSystemSidebar')
      .addToUi();
  } catch (error) {
    console.warn('設計・開発課 管理 menu requires a container-bound Apps Script project: ' + error.message);
  }
}
function showManagerSidebar() { return Ui.show('UiMenu', {view: 'project'}); }
function showProjectSidebar() { return Ui.show('UiMenu', {view: 'project'}); }
function showNewProjectSidebar() { return Ui.show('UiMenu', {view: 'project', action: 'create'}); }
function showNewSubprojectSidebar() { return Ui.show('UiMenu', {view: 'project', action: 'create'}); }
function showTaskSidebar() { return Ui.show('UiMenu', {view: 'task', action: 'edit'}); }
function showNewTaskSidebar() { return Ui.show('UiMenu', {view: 'task', action: 'assign'}); }
function showTaskAssignmentSidebar() { return Ui.show('UiMenu', {view: 'task', action: 'assign'}); }
function showProgressSidebar() { return Ui.show('UiMenu', {view: 'task', action: 'progress'}); }
function showResponsibilitiesSidebar() { return Ui.show('UiMenu', {view: 'admin', action: 'edit'}); }
function showMembersSidebar() { return Ui.show('UiMenu', {view: 'admin', action: 'edit'}); }
function showSkillsSidebar() { return Ui.show('UiMenu', {view: 'admin', action: 'edit'}); }
function showAutomationSidebar() { return Ui.show('UiSettings', {view: 'admin'}); }
function showRequestsSidebar() { return Ui.show('UiRequests', {view: 'task'}); }
function showSystemSidebar() { return Ui.show('UiSystem', {view: 'admin'}); }
function refreshDashboardFromMenu() {
  var result = Ui.refresh();
  try {
    SpreadsheetApp.getActive().toast(result.ok ? 'ダッシュボードを更新しました' : String(result.error), Ui.MENU, 5);
  } catch (error) { /* standalone execution has no active sheet */ }
  return result;
}

/** google.script.run bridges. */
function uiContext() { return Ui.context(); }
function uiTaskOptions(payload) { return Ui.taskOptions(payload); }
function uiCreateProject(payload) { return Ui.createProject(payload); }
function uiUpdateProject(payload) { return Ui.updateProject(payload); }
function uiCreateSubproject(payload) { return Ui.createSubproject(payload); }
function uiSaveSubproject(payload) { return Ui.saveSubproject(payload); }
function uiArchiveSubproject(payload) { return Ui.archiveSubproject(payload); }
function uiReactivateSubproject(payload) { return Ui.reactivateSubproject(payload); }
function uiMoveTask(payload) { return Ui.moveTask(payload); }
function uiSaveResponsibility(payload) { return Ui.saveResponsibility(payload); }
function uiMoveResponsibility(payload) { return Ui.moveResponsibility(payload); }
function uiRetireResponsibility(payload) { return Ui.retireResponsibility(payload); }
function uiReactivateResponsibility(payload) { return Ui.reactivateResponsibility(payload); }
function uiTransferProject(payload) { return Ui.transferProject(payload); }
function uiAssignTask(payload) { return Ui.assignTask(payload); }
function uiPlanPreview(payload) { return Ui.planPreview(payload); }
function uiRequests(payload) { return Ui.requests(payload); }
function uiImportRequests() { return Ui.importRequests(); }
function uiDecideRequest(payload) { return Ui.decideRequest(payload); }
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