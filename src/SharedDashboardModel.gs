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
  var CONTRACT_VERSION = '1.3';
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

  /** Aggregates a project's published tasks so the portfolio needs no task payload. */
  function aggregates(tasks, today) {
    var value = {open: 0, done: 0, overdue: 0, blocked: 0, dueSoon: 0};
    (tasks || []).forEach(function (task) {
      if (task.Status === DONE) value.done++;
      else if (task.Status !== CANCELLED) value.open++;
      if (task.Status === 'Blocked') value.blocked++;
      if (overdue(task, today)) value.overdue++;
      if (dueSoon(task, today)) value.dueSoon++;
    });
    return value;
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
    var counts = aggregates(owned, context.today);
    return {
      projectId: text(project.Project_ID),
      projectName: text(project.Project_Name),
      category: text(project.Category),
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
      totalTasks: owned.length
    };
  }

  function subprojectDto(subproject, context) {
    var tasks = context.tasksBySubproject[subproject.Subproject_ID] || [];
    var rolled = Progress.rollup(tasks);
    return {
      subprojectId: text(subproject.Subproject_ID),
      projectId: text(subproject.Project_ID),
      name: text(subproject.Subproject_Name),
      ownerName: context.memberNames[String(subproject.Owner_ID || '')] || '',
      status: text(subproject.Status),
      progress: rolled.calculated ? rolled.percent : null,
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
    return {
      taskId: text(task.Task_ID),
      projectId: text(task.Project_ID),
      subprojectId: text(task.Subproject_ID),
      name: text(task.Task_Name),
      ownerName: context.memberNames[String(task.Owner_Member_ID || '')] || '',
      status: text(task.Status),
      priority: text(task.Priority),
      plannedStart: day(task.Planned_Start),
      dueDate: day(task.Due_Date),
      progress: Progress.percent(task),
      // Public_Note is the only approved free-text field. Description, Next_Action and
      // Acceptance_Criteria are private and are never substituted.
      publicNote: text(task.Public_Note),
      revision: revision(task),
      pendingRequest: !!(context.pendingRequests && context.pendingRequests[String(task.Task_ID)])
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
      if (!publishedIds[projectId]) { excluded.subprojects++; return; }
      publishedSubprojects.push(subproject);
      subprojectById[id] = subproject;
    });

    var publishedTasks = [];
    tasks.forEach(function (task) {
      var id = String(task.Task_ID || '');
      var projectId = String(task.Project_ID || '');
      if (!id) { excluded.tasks++; warnings.push({code: 'TASK_WITHOUT_ID', id: ''}); return; }
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

    var context = {
      today: today,
      limits: limits,
      // Aggregates and grouping use only published tasks, so a restricted sibling can
      // never change a published project's numbers.
      memberNames: memberNames(input.members),
      tasksByProject: index(publishedTasks, 'Project_ID'),
      tasksBySubproject: index(publishedTasks, 'Subproject_ID'),
      milestonesByProject: index(publishedMilestones, 'Project_ID'),
      issuesByProject: index(input.issues || [], 'Project_ID'),
      // Only a boolean indicator is published; request text stays in the private workbook.
      pendingRequests: input.pendingRequests || Object.create(null)
    };

    var projectDtos = publishedProjects.map(function (project) { return projectDto(project, context); });
    var subprojectDtos = publishedSubprojects.map(function (subproject) { return subprojectDto(subproject, context); });
    var taskDtos = publishedTasks.map(function (task) { return taskDto(task, context); });
    var milestoneDtos = publishedMilestones.map(milestoneDto);

    return {
      contractVersion: CONTRACT_VERSION,
      asOf: today,
      projects: projectDtos,
      subprojects: subprojectDtos,
      tasks: taskDtos,
      milestones: milestoneDtos,
      counts: {
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

  var PROJECT_PUBLIC_FIELDS = ['projectId', 'projectName', 'category', 'ownerName', 'status', 'progress',
    'health', 'committedDeadline', 'forecastDeadline', 'summary', 'lastUpdated', 'terminal',
    'openTasks', 'doneTasks', 'overdueTasks', 'blockedTasks', 'dueSoonTasks', 'totalTasks'];
  var SUBPROJECT_PUBLIC_FIELDS = ['subprojectId', 'projectId', 'name', 'ownerName', 'status', 'progress', 'deadline', 'terminal'];
  var TASK_PUBLIC_FIELDS = ['taskId', 'projectId', 'subprojectId', 'name', 'ownerName', 'status', 'priority',
    'plannedStart', 'dueDate', 'progress', 'publicNote', 'revision', 'pendingRequest'];
  var MILESTONE_PUBLIC_FIELDS = ['milestoneId', 'projectId', 'subprojectId', 'name', 'targetDate', 'actualDate', 'status'];

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    DUE_SOON_DAYS: DUE_SOON_DAYS,
    PROJECT_PUBLIC_FIELDS: PROJECT_PUBLIC_FIELDS,
    SUBPROJECT_PUBLIC_FIELDS: SUBPROJECT_PUBLIC_FIELDS,
    TASK_PUBLIC_FIELDS: TASK_PUBLIC_FIELDS,
    MILESTONE_PUBLIC_FIELDS: MILESTONE_PUBLIC_FIELDS,
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
