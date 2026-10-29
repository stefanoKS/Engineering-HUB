/**
 * Public data contract for the shared employee dashboard.
 *
 * Everything here is a pure transformation: source rows come in, allowlisted DTOs come
 * out. No source row is ever forwarded, so a column added to the workbook cannot leak
 * into the published snapshot by accident. Fields are listed explicitly below; there is
 * deliberately no `Object.assign(row, ...)` or "copy everything except ..." path.
 *
 * Never published (see docs/dashboard/DATA_CONTRACT.md): e-mail addresses, MEMBER_SKILLS,
 * assessment evidence, capacity/HR data, NOTIFICATION_LOG, AUDIT_LOG, AUTOMATION_SETTINGS,
 * SETTINGS, Script Properties, OAuth tokens, private issue text, acceptance criteria and
 * internal error details.
 *
 * A project is published only when `Dashboard_Visibility` is exactly `INTERNAL`. Blank,
 * unknown and `RESTRICTED` projects stay private, so migrated workbooks publish nothing
 * until a manager reviews each project.
 */
var SharedDashboardModel = (function () {
  // V1.5 adds the nested-task hierarchy, the responsibility colour and the completion review
  // state. The version is explicit so an older snapshot is rejected instead of being read as
  // if it had the new fields (see docs/dashboard/DATA_CONTRACT.md).
  var CONTRACT_VERSION = '1.6';
  var VISIBILITY = ['INTERNAL', 'RESTRICTED'];
  var DONE = 'Done';
  var CANCELLED = 'Cancelled';
  // Completed/Archived projects stay published; the viewer hides them behind a filter.
  var TERMINAL_STATUSES = ['Completed', 'Cancelled', 'Archived'];
  var DUE_SOON_DAYS = 7;
  var MAX_TEXT = 300;

  function text(value) {
    if (value === null || value === undefined) return '';
    var clean = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    return clean.length > MAX_TEXT ? clean.slice(0, MAX_TEXT) : clean;
  }

  function day(value) {
    var normalized = Health.day(value);
    return normalized || '';
  }

  function number(value) {
    if (value === '' || value === null || value === undefined) return null;
    var parsed = Number(value);
    return isFinite(parsed) ? parsed : null;
  }

  function visibility(project) {
    var value = String((project && project.Dashboard_Visibility) || '').trim().toUpperCase();
    return VISIBILITY.indexOf(value) >= 0 ? value : 'RESTRICTED';
  }

  function isInternal(project) { return visibility(project) === 'INTERNAL'; }

  function isTerminal(status) { return TERMINAL_STATUSES.indexOf(String(status || '')) >= 0; }

  function openTask(task) {
    return task.Status !== DONE && task.Status !== CANCELLED;
  }

  function daysBetween(from, to) {
    if (!from || !to) return null;
    return Math.round((new Date(to + 'T00:00:00Z').getTime() - new Date(from + 'T00:00:00Z').getTime()) / 86400000);
  }

  function daysRemaining(dueDate, today) {
    return daysBetween(day(today), day(dueDate));
  }

  function overdue(task, today) {
    var due = day(task.Due_Date);
    if (!due || !openTask(task)) return false;
    return due < day(today);
  }

  function dueSoon(task, today) {
    var due = day(task.Due_Date);
    if (!due || !openTask(task)) return false;
    var remaining = daysBetween(day(today), due);
    return remaining !== null && remaining >= 0 && remaining <= DUE_SOON_DAYS;
  }

  function index(rows, key) {
    var result = Object.create(null);
    (rows || []).forEach(function (row) {
      var id = String(row[key] || '');
      if (!id) return;
      if (!result[id]) result[id] = [];
      result[id].push(row);
    });
    return result;
  }

  function memberNames(members) {
    var names = Object.create(null);
    (members || []).forEach(function (member) {
      names[String(member.Member_ID || '')] = text(member.Name);
    });
    return names;
  }

  /**
   * Published responsibility label.
   *
   * Only the display name, the stable ID, the display order and a retired flag are shared.
   * The internal description and the owner are manager-only information.
   */
  function responsibilityDto(row) {
    var order = number(row.Sort_Order);
    return {
      responsibilityId: text(row.Responsibility_ID),
      name: text(row.Name),
      sortOrder: order === null ? 0 : order,
      retired: String(row.Status || '') === 'Retired',
      // A validated #RRGGBB value; blank when the manager has not chosen one.
      color: /^#[0-9A-Fa-f]{6}$/.test(text(row.Color_Hex)) ? text(row.Color_Hex).toUpperCase() : ''
    };
  }

  function responsibilityNames(responsibilities) {
    var names = Object.create(null);
    (responsibilities || []).forEach(function (row) {
      names[String(row.Responsibility_ID || '')] = text(row.Name);
    });
    return names;
  }

  /** Nesting level inside the published hierarchy; roots are level 1. */
  function subprojectLevels(subprojects) {
    var parent = Object.create(null);
    (subprojects || []).forEach(function (row) {
      parent[String(row.Subproject_ID || '')] = String(row.Parent_Subproject_ID || '');
    });
    var levels = Object.create(null);
    Object.keys(parent).forEach(function (id) {
      var level = 1, cursor = id, guard = 0;
      while (parent[cursor]) {
        cursor = parent[cursor];
        level++;
        if (guard++ > 8) { level = 1; break; }
      }
      levels[id] = level;
    });
    return levels;
  }

  /**
   * Aggregates a project's published tasks so the portfolio needs no task payload.
   *
   * `done` and `total` stay historical, while open/blocked/overdue/due-soon describe active
   * work: a task beneath an archived (or otherwise non-working) subproject is excluded with
   * the same ancestor rule the manager dashboards use. Nothing is deleted or re-stamped.
   */
  function aggregates(tasks, context) {
    var value = {open: 0, done: 0, overdue: 0, blocked: 0, dueSoon: 0};
    // Leaf work only: a task that contains subtasks is not an extra unit of work.
    TaskTree.leaves(tasks || []).forEach(function (task) {
      if (task.Status === DONE) { value.done++; return; }
      if (task.Status === CANCELLED) return;
      if (!taskActive(task, context)) return;
      value.open++;
      if (task.Status === 'Blocked') value.blocked++;
      if (overdue(task, context.today)) value.overdue++;
      if (dueSoon(task, context.today)) value.dueSoon++;
    });
    return value;
  }

  /** True when the task's whole published subproject chain is still working. */
  function taskActive(task, context) {
    if (!task.Subproject_ID) return true;
    var index = context.subprojectById || Object.create(null);
    // An unpublished or dangling node cannot be proven inactive, so its tasks stay counted.
    if (!index[String(task.Subproject_ID)]) return true;
    return Eligibility.subprojectInActiveWork(task.Subproject_ID, task.Project_ID, index);
  }

  function projectDto(project, context) {
    var owned = context.tasksByProject[project.Project_ID] || [];
    var rolled = Progress.rollup(owned);
    var health = Health.classify(project, {
      today: context.today, tasks: owned,
      milestones: context.milestonesByProject[project.Project_ID] || [],
      issues: context.issuesByProject[project.Project_ID] || [],
      limits: context.limits
    });
    var counts = aggregates(owned, context);
    return {
      projectId: text(project.Project_ID),
      projectName: text(project.Project_Name),
      category: text(project.Category),
      responsibilityId: text(project.Responsibility_ID),
      responsibilityName: context.responsibilityNames[String(project.Responsibility_ID || '')] || '',
      ownerName: context.memberNames[String(project.Project_Owner_ID || '')] || '',
      status: text(project.Status),
      progress: rolled.calculated ? rolled.percent : null,
      health: text(health.health),
      committedDeadline: day(project.Committed_Deadline),
      forecastDeadline: day(project.Forecast_End),
      summary: text(project.Dashboard_Summary),
      lastUpdated: day(project.Last_Updated) || day(project.Created_At),
      terminal: isTerminal(project.Status),
      openTasks: counts.open,
      doneTasks: counts.done,
      overdueTasks: counts.overdue,
      blockedTasks: counts.blocked,
      dueSoonTasks: counts.dueSoon,
      totalTasks: TaskTree.leaves(owned).length
    };
  }

  function subprojectDto(subproject, context) {
    var direct = context.tasksBySubproject[subproject.Subproject_ID] || [];
    // A parent subproject reports its own tasks plus every descendant task, counted once.
    var subtree = Progress.subtreeTasks(subproject.Subproject_ID, context.subprojectChildren,
      context.tasksBySubproject);
    var rolled = Progress.rollup(subtree);
    return {
      subprojectId: text(subproject.Subproject_ID),
      projectId: text(subproject.Project_ID),
      parentSubprojectId: text(subproject.Parent_Subproject_ID),
      level: context.subprojectLevels[String(subproject.Subproject_ID || '')] || 1,
      name: text(subproject.Subproject_Name),
      ownerName: context.memberNames[String(subproject.Owner_ID || '')] || '',
      status: text(subproject.Status),
      progress: rolled.calculated ? rolled.percent : null,
      directTasks: TaskTree.leaves(direct).length,
      totalTasks: TaskTree.leaves(subtree).length,
      deadline: day(subproject.Deadline) || day(subproject.Planned_End),
      terminal: isTerminal(subproject.Status)
    };
  }

  /**
   * Opaque task revision used by the V1.3 request workflow.
   *
   * The value never exposes member IDs or internal version numbers, but it changes when
   * the assignment (owner, dates, effort) changes, so a request submitted against an older
   * revision cannot silently overwrite a newer assignment or deadline.
   */
  function revision(task) {
    var payload = [text(task.Task_ID), text(task.Owner_Member_ID), day(task.Due_Date),
      String(Number(task.Assignment_Version || 0))].join('|');
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload, Utilities.Charset.UTF_8);
    return bytes.slice(0, 8).map(function (byte) {
      var value = ((byte % 256) + 256) % 256;
      return (value < 16 ? '0' : '') + value.toString(16);
    }).join('');
  }

  function taskDto(task, context) {
    // A task with subtasks reports the derived completion of its leaf work, so the viewer
    // never shows a container as an independent unit of progress. The hierarchy index is
    // built once per snapshot, not once per task.
    var view = context.taskIndex ? TaskTree.viewIn(task, context.taskIndex)
      : {container: false, progress: Progress.percent(task), status: text(task.Status)};
    return {
      taskId: text(task.Task_ID),
      projectId: text(task.Project_ID),
      subprojectId: text(task.Subproject_ID),
      parentTaskId: text(task.Parent_Task_ID),
      container: view.container,
      name: text(task.Task_Name),
      ownerName: context.memberNames[String(task.Owner_Member_ID || '')] || '',
      status: text(view.status),
      priority: text(task.Priority),
      plannedStart: day(task.Planned_Start),
      dueDate: day(task.Due_Date),
      progress: view.progress,
      // Public_Note is the only approved free-text field. Description, Next_Action and
      // Acceptance_Criteria are private and are never substituted.
      publicNote: text(task.Public_Note),
      revision: revision(task),
      pendingRequest: !!(context.pendingRequests && context.pendingRequests[String(task.Task_ID)]),
      // '' | 'PENDING' | 'STALE' — a state only, never the reporter or the note.
      reviewState: (context.reviewStates || {})[String(task.Task_ID)] || '',
      completedAt: day(task.Completed_At),
      // Contract 1.6: the primary assignee first, then the additional assignees. A display-name
      // list only: no member identifier, e-mail address or role is published.
      assigneeNames: (context.assigneeNames ? context.assigneeNames(task) : []).filter(function (name) {
        return !!text(name);
      })
    };
  }

  function milestoneDto(milestone) {
    return {
      milestoneId: text(milestone.Milestone_ID),
      projectId: text(milestone.Project_ID),
      subprojectId: text(milestone.Subproject_ID),
      name: text(milestone.Milestone_Name),
      targetDate: day(milestone.Target_Date),
      actualDate: day(milestone.Actual_Date),
      status: text(milestone.Status)
    };
  }

  /**
   * Builds the complete sanitized snapshot.
   *
   * @param {object} input published-candidate source rows and helpers
   * @returns {{contractVersion: string, asOf: string, projects: Array, subprojects: Array,
   *   tasks: Array, milestones: Array, counts: object, excluded: object, warnings: Array}}
   */
  function build(input) {
    var today = day(input.today || (typeof Domain !== 'undefined' ? Domain.today() : new Date()));
    var limits = input.limits || (typeof Health !== 'undefined' ? Health.thresholds() : {});
    var projects = input.projects || [];
    var subprojects = input.subprojects || [];
    var tasks = input.tasks || [];
    var milestones = input.milestones || [];
    var excluded = {projects: 0, subprojects: 0, tasks: 0, milestones: 0};
    var warnings = [];

    var publishedProjects = [];
    var publishedIds = Object.create(null);
    projects.forEach(function (project) {
      if (!project.Project_ID) { excluded.projects++; warnings.push({code: 'PROJECT_WITHOUT_ID', id: ''}); return; }
      if (text(project.Deleted_At)) { excluded.projects++; return; }
      if (!isInternal(project)) { excluded.projects++; return; }
      publishedProjects.push(project);
      publishedIds[String(project.Project_ID)] = true;
    });

    var publishedSubprojects = [];
    var subprojectById = Object.create(null);
    var sourceSubprojects = Object.create(null);
    subprojects.forEach(function (subproject) {
      var sourceId = String(subproject.Subproject_ID || '');
      if (sourceId) sourceSubprojects[sourceId] = subproject;
    });
    subprojects.forEach(function (subproject) {
      var id = String(subproject.Subproject_ID || '');
      var projectId = String(subproject.Project_ID || '');
      if (!id) { excluded.subprojects++; warnings.push({code: 'SUBPROJECT_WITHOUT_ID', id: ''}); return; }
      if (text(subproject.Deleted_At)) { excluded.subprojects++; return; }
      if (!publishedIds[projectId]) { excluded.subprojects++; return; }
      publishedSubprojects.push(subproject);
      subprojectById[id] = subproject;
    });

    var publishedTasks = [];
    tasks.forEach(function (task) {
      var id = String(task.Task_ID || '');
      var projectId = String(task.Project_ID || '');
      if (!id) { excluded.tasks++; warnings.push({code: 'TASK_WITHOUT_ID', id: ''}); return; }
      if (text(task.Deleted_At)) { excluded.tasks++; return; }
      if (!publishedIds[projectId]) { excluded.tasks++; return; }
      var subprojectId = String(task.Subproject_ID || '');
      if (subprojectId) {
        var source = sourceSubprojects[subprojectId];
        if (source && String(source.Project_ID) !== projectId) {
          // Cross-project reference: never publish it, because it would bypass the
          // visibility decision made for the other project.
          excluded.tasks++;
          warnings.push({code: 'TASK_CROSS_PROJECT_REFERENCE', id: id});
          return;
        }
        if (!subprojectById[subprojectId]) {
          // Unknown or unpublished subproject: keep the task visible under 全体タスク.
          warnings.push({code: 'TASK_UNKNOWN_SUBPROJECT', id: id});
        }
      }
      publishedTasks.push(task);
    });

    var publishedMilestones = [];
    milestones.forEach(function (milestone) {
      var id = String(milestone.Milestone_ID || '');
      var projectId = String(milestone.Project_ID || '');
      if (!id) { excluded.milestones++; warnings.push({code: 'MILESTONE_WITHOUT_ID', id: ''}); return; }
      if (text(milestone.Deleted_At)) { excluded.milestones++; return; }
      if (!publishedIds[projectId]) { excluded.milestones++; return; }
      var subprojectId = String(milestone.Subproject_ID || '');
      if (subprojectId) {
        var source = sourceSubprojects[subprojectId];
        if (source && String(source.Project_ID) !== projectId) {
          excluded.milestones++;
          warnings.push({code: 'MILESTONE_CROSS_PROJECT_REFERENCE', id: id});
          return;
        }
        if (!subprojectById[subprojectId]) warnings.push({code: 'MILESTONE_UNKNOWN_SUBPROJECT', id: id});
      }
      publishedMilestones.push(milestone);
    });

    // Filters only ever offer responsibilities that label a published project, so no
    // unpublished organizational area leaks through the filter metadata.
    var responsibilityIndex = Object.create(null);
    (input.responsibilities || []).forEach(function (row) {
      var id = String(row.Responsibility_ID || '');
      if (id) responsibilityIndex[id] = row;
    });
    var publishedResponsibilities = [];
    var publishedResponsibilityIds = Object.create(null);
    publishedProjects.forEach(function (project) {
      var id = String(project.Responsibility_ID || '');
      if (!id || publishedResponsibilityIds[id]) return;
      var source = responsibilityIndex[id];
      if (!source) {
        warnings.push({code: 'RESPONSIBILITY_UNKNOWN', id: id});
        return;
      }
      publishedResponsibilityIds[id] = true;
      publishedResponsibilities.push(source);
    });
    publishedResponsibilities.sort(function (left, right) {
      var a = Number(left.Sort_Order), b = Number(right.Sort_Order);
      var leftOrder = isFinite(a) ? a : Number.MAX_SAFE_INTEGER;
      var rightOrder = isFinite(b) ? b : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return text(left.Name).localeCompare(text(right.Name), 'ja');
    });

    var memberNameMap = memberNames(input.members);
    var context = {
      today: today,
      limits: limits,
      // Aggregates and grouping use only published tasks, so a restricted sibling can
      // never change a published project's numbers.
      memberNames: memberNameMap,
      responsibilities: publishedResponsibilities,
      responsibilityNames: responsibilityNames(publishedResponsibilities),
      subprojectLevels: subprojectLevels(publishedSubprojects),
      subprojectChildren: (function () {
        // Children are grouped from published rows only: an unpublished subproject can
        // never leak a task count into a parent's rollup.
        var children = Object.create(null);
        publishedSubprojects.forEach(function (row) {
          var parent = String(row.Parent_Subproject_ID || '');
          if (!parent) return;
          if (!children[parent]) children[parent] = [];
          children[parent].push(String(row.Subproject_ID));
        });
        return children;
      }()),
      tasksByProject: index(publishedTasks, 'Project_ID'),
      tasksBySubproject: index(publishedTasks, 'Subproject_ID'),
      // The published task list and one hierarchy index, used to derive container progress
      // from leaf work only.
      tasks: publishedTasks,
      taskIndex: TaskTree.buildIndex(publishedTasks),
      subprojectById: (function () {
        var rows = Object.create(null);
        publishedSubprojects.forEach(function (row) { rows[String(row.Subproject_ID)] = row; });
        return rows;
      }()),
      milestonesByProject: index(publishedMilestones, 'Project_ID'),
      issuesByProject: index(input.issues || [], 'Project_ID'),
      // Only a boolean indicator and a review state are published; request text stays in the
      // private workbook.
      pendingRequests: input.pendingRequests || Object.create(null),
      reviewStates: input.reviewStates || Object.create(null),
      // Contract 1.6: display names of every assignee, resolved once per snapshot. Member
      // identifiers, e-mail addresses and roles are never part of this list. A caller that
      // publishes additional assignees supplies the resolver; otherwise the primary owner is
      // the only assignee the model can honestly name.
      assigneeNames: input.assigneeNames || function (task) {
        var owner = memberNameMap[String(task.Owner_Member_ID || '')] || '';
        return owner ? [owner] : [];
      }
    };

    var projectDtos = publishedProjects.map(function (project) { return projectDto(project, context); });
    var subprojectDtos = publishedSubprojects.map(function (subproject) { return subprojectDto(subproject, context); });
    var responsibilityDtos = publishedResponsibilities.map(responsibilityDto);
    var taskDtos = publishedTasks.map(function (task) { return taskDto(task, context); });
    var milestoneDtos = publishedMilestones.map(milestoneDto);

    return {
      contractVersion: CONTRACT_VERSION,
      asOf: today,
      responsibilities: responsibilityDtos,
      projects: projectDtos,
      subprojects: subprojectDtos,
      tasks: taskDtos,
      milestones: milestoneDtos,
      counts: {
        responsibilities: responsibilityDtos.length,
        projects: projectDtos.length,
        subprojects: subprojectDtos.length,
        tasks: taskDtos.length,
        milestones: milestoneDtos.length
      },
      excluded: excluded,
      warnings: warnings
    };
  }

  function stable(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stable(value[key]);
    }).join(',') + '}';
  }

  /** Deterministic content hash of the sanitized payload (not of the source workbook). */
  function hash(snapshot) {
    var payload = stable({
      contractVersion: snapshot.contractVersion,
      responsibilities: snapshot.responsibilities,
      projects: snapshot.projects,
      subprojects: snapshot.subprojects,
      tasks: snapshot.tasks,
      milestones: snapshot.milestones
    });
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload, Utilities.Charset.UTF_8);
    return bytes.map(function (byte) {
      var value = ((byte % 256) + 256) % 256;
      return (value < 16 ? '0' : '') + value.toString(16);
    }).join('');
  }

  /** Defensive allowlist check used by tests, the publisher and the viewer service. */
  function isPublicFieldSet(fieldSet, allowed) {
    return Object.keys(fieldSet || {}).every(function (key) { return allowed.indexOf(key) >= 0; });
  }

  var PROJECT_PUBLIC_FIELDS = ['projectId', 'projectName', 'category', 'responsibilityId', 'responsibilityName',
    'ownerName', 'status', 'progress', 'health', 'committedDeadline', 'forecastDeadline', 'summary', 'lastUpdated',
    'terminal', 'openTasks', 'doneTasks', 'overdueTasks', 'blockedTasks', 'dueSoonTasks', 'totalTasks'];
  var SUBPROJECT_PUBLIC_FIELDS = ['subprojectId', 'projectId', 'parentSubprojectId', 'level', 'name', 'ownerName',
    'status', 'progress', 'directTasks', 'totalTasks', 'deadline', 'terminal'];
  var RESPONSIBILITY_PUBLIC_FIELDS = ['responsibilityId', 'name', 'sortOrder', 'retired', 'color'];
  var TASK_PUBLIC_FIELDS = ['taskId', 'projectId', 'subprojectId', 'parentTaskId', 'container', 'name',
    'ownerName', 'status', 'priority', 'plannedStart', 'dueDate', 'progress', 'publicNote', 'revision',
    'pendingRequest', 'reviewState', 'completedAt', 'assigneeNames'];
  var MILESTONE_PUBLIC_FIELDS = ['milestoneId', 'projectId', 'subprojectId', 'name', 'targetDate', 'actualDate', 'status'];

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    DUE_SOON_DAYS: DUE_SOON_DAYS,
    PROJECT_PUBLIC_FIELDS: PROJECT_PUBLIC_FIELDS,
    SUBPROJECT_PUBLIC_FIELDS: SUBPROJECT_PUBLIC_FIELDS,
    RESPONSIBILITY_PUBLIC_FIELDS: RESPONSIBILITY_PUBLIC_FIELDS,
    TASK_PUBLIC_FIELDS: TASK_PUBLIC_FIELDS,
    MILESTONE_PUBLIC_FIELDS: MILESTONE_PUBLIC_FIELDS,
    responsibilityDto: responsibilityDto,
    subprojectLevels: subprojectLevels,
    visibility: visibility,
    isInternal: isInternal,
    isTerminal: isTerminal,
    openTask: openTask,
    overdue: overdue,
    dueSoon: dueSoon,
    daysRemaining: daysRemaining,
    build: build,
    hash: hash,
    revision: revision,
    isPublicFieldSet: isPublicFieldSet,
    stable: stable
  };
}());
