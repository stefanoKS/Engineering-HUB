/** V1.5 manager HTML Service entrypoint. Employee deployment remains separate. */
function doGet() {
  return Database.withReadContext(function () {
    ManagerWeb.authorize();
    return HtmlService.createTemplateFromFile('ManagerWebIndex').evaluate()
      .setTitle('設計・開発課 管理').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  });
}

var ManagerWeb = (function () {
  // Bounds of the one-shot navigation snapshot. Above them the browser keeps the paginated,
  // server-side search path instead of receiving a truncated list.
  var TASK_INDEX_LIMIT = 3000, PROJECT_INDEX_LIMIT = 1000;
  function authorize() {
    var email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    var domains = String(PropertiesService.getScriptProperties().getProperty('MANAGER_WEB_ALLOWED_DOMAINS') || '')
      .toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!email || domains.indexOf(email.split('@')[1]) < 0) throw new Error('MANAGER_ACCESS_DENIED');
    return Access.requireManager();
  }
  function unwrap(result) {
    if (!result || result.ok !== true) throw new Error(result && result.error || 'Operation failed');
    return result.data;
  }
  function response(fn, readOnly) {
    var started = Date.now(), metrics = {dataMs: 0, tableReads: 0};
    try {
      var execute = function (context) {
        var actor = authorize();
        var result = fn(actor);
        if (context) { metrics.dataMs = context.dataMs; metrics.tableReads = context.reads; }
        return result;
      };
      var data = Database.withReadContext(execute, !readOnly);
      metrics.executionMs = Date.now() - started;
      metrics.applicationMs = Math.max(0, metrics.executionMs - metrics.dataMs);
      return {ok: true, data: JSON.parse(JSON.stringify(data)), metrics: metrics};
    } catch (error) {
      return {ok: false, error: String(error.message || error), metrics: {executionMs: Date.now() - started}};
    }
  }
  function record(table, row) {
    if (!row) throw new Error('NOT_FOUND');
    var dto = {};
    Schema.tables[table].fields.forEach(function (f) {
      var value = row[f.name];
      dto[f.name] = value instanceof Date ? (f.type === 'date' ? Domain.date(value) : value.toISOString()) : (value === undefined ? '' : value);
    });
    return dto;
  }
  function digest(value) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8);
    return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  }
  function revision(table,row) {return digest(record(table,row));}
  function settingsRevision() {return digest(AutomationSettings.describe().filter(function(s){return !s.status;}).map(function(s){return [s.key,s.value];}));}
  function editable(table, row) { var data = record(table, row); data._revision = revision(table, row); return data; }
  function index(table) {
    var map = Object.create(null), key = Schema.tables[table].id;
    Database.read(table).forEach(function (row) { if (map[row[key]]) throw new Error('Duplicate stable ID'); map[row[key]] = row; });
    return map;
  }
  function page(rows, input) {
    var offset = Math.max(0, Math.floor(Number(input.offset) || 0));
    var limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 50)));
    return {items: rows.slice(offset, offset + limit), total: rows.length, offset: offset, limit: limit};
  }
  function projectList(rows) {
    var members = index('MEMBERS'), responsibilities = index('RESPONSIBILITIES');
    var projects = rows || Database.read('PROJECTS'), only = Object.create(null);
    projects.forEach(function (p) { only[p.Project_ID] = true; });
    // Fresh values: a task save skips the report refresh, so the stored columns may lag.
    var metrics = Dashboard.projectMetrics(undefined, only);
    return projects.map(function (p) {
      var m = metrics[p.Project_ID] || {}, deadline = Domain.date(p.Committed_Deadline);
      var state = deadlineState(deadline, p.Status);
      return {id: p.Project_ID, name: p.Project_Name, responsibilityId: p.Responsibility_ID || '',
        responsibility: responsibilities[p.Responsibility_ID] ? responsibilities[p.Responsibility_ID].Name : '',
        responsibilityColor: p.Responsibility_ID && responsibilities[p.Responsibility_ID]
          ? Responsibilities.colorOf(responsibilities[p.Responsibility_ID]) : '',
        ownerId: p.Project_Owner_ID || '',
        owner: members[p.Project_Owner_ID] ? members[p.Project_Owner_ID].Name : '', status: p.Status,
        priority: p.Priority || '', category: p.Category || '',
        deadline: deadline, deadlineKind: state.kind, daysRemaining: state.days,
        progress: typeof m.progress === 'number' ? m.progress : '', health: m.health || 'UNKNOWN',
        healthReasons: m.healthReasons || [], totalTasks: m.tasks || 0,
        doneTasks: m.doneTasks || 0, overdueTasks: m.overdueTasks || 0};
    });
  }
  /** Neutral deadline wording pair; the browser renders the translated label. */
  function deadlineState(deadline, status) {
    var due = Health.day(deadline);
    if (!due) return {kind: 'none', days: null};
    var days = Health.daysBetween(Domain.today(), due);
    if (status === 'Completed') return {kind: 'done', days: days};
    // Cancelled and archived projects keep their date but get no "remaining" wording.
    if (status === 'Cancelled' || status === 'Archived') return {kind: 'closed', days: days};
    if (days === 0) return {kind: 'today', days: 0};
    return {kind: days < 0 ? 'overdue' : 'future', days: days};
  }
  /** Compact, allowlisted task summary. Descriptions, criteria, notes and hours stay out. */
  function taskSummary(task, projects, members, treeIndex, reviewStates) {
    var project = projects[task.Project_ID] || {};
    var view = treeIndex ? TaskTree.viewIn(task, treeIndex)
      : {container: false, progress: Progress.percent(task), status: task.Status, depth: 0};
    return {id: task.Task_ID, name: task.Task_Name, projectId: task.Project_ID,
      project: project.Project_Name || '', subprojectId: task.Subproject_ID || '',
      parentId: task.Parent_Task_ID || '', container: view.container, depth: view.depth,
      ownerId: task.Owner_Member_ID || '',
      owner: (members[task.Owner_Member_ID] || {}).Name || '',
      responsibilityId: project.Responsibility_ID || '',
      deadline: Domain.date(task.Due_Date), status: view.status,
      progress: view.progress, priority: task.Priority,
      reviewState: (reviewStates || {})[String(task.Task_ID)] || ''};
  }
  /** One ordering definition so a locally sorted browser list matches the server page. */
  function taskOrder(input) {
    var priorities = {Critical: 0, High: 1, Medium: 2, Low: 3};
    return function (a, b) {
      var order = input && input.sort === 'priority'
        ? (priorities[a.Priority] || 0) - (priorities[b.Priority] || 0)
        : (Domain.date(a.Due_Date) || '9999').localeCompare(Domain.date(b.Due_Date) || '9999');
      return order || a.Task_ID.localeCompare(b.Task_ID);
    };
  }
  function taskList(input) {
    var projects = index('PROJECTS'), members = index('MEMBERS');
    var treeIndex = TaskTree.buildIndex(Database.read('TASKS'));
    var rows = Tasks.list(input).filter(function (t) {
      if (input.responsibilityId && String((projects[t.Project_ID] || {}).Responsibility_ID || '') !== input.responsibilityId) return false;
      if (input.deadlineBefore && (!t.Due_Date || Domain.date(t.Due_Date) > input.deadlineBefore)) return false;
      if (input.deadlineAfter && (!t.Due_Date || Domain.date(t.Due_Date) < input.deadlineAfter)) return false;
      if (input.priority && String(t.Priority || '') !== String(input.priority)) return false;
      // "Top level" hides subtasks so the list stays readable without losing the hierarchy.
      if (input.treeScope === 'TOP' && TaskTree.parentOf(t)) return false;
      if (input.parentTaskId !== undefined && TaskTree.parentOf(t) !== String(input.parentTaskId || '')) return false;
      return true;
    });
    rows.sort(taskOrder(input));
    var result = page(rows, input);
    var reviewStates = Requests.pendingCompletionStates();
    result.items = result.items.map(function (t) { return taskSummary(t, projects, members, treeIndex, reviewStates); });
    return result;
  }
  function responsibilityOptions() {
    return Responsibilities.all().map(function (r) {
      return {id: r.Responsibility_ID, name: r.Name, status: r.Status, color: Responsibilities.colorOf(r)};
    });
  }

  /**
   * Responsibility cards for the manager home: name, colour, owner, active projects, open and
   * overdue tasks and a weighted progress value. Everything is computed from the same rows the
   * overview uses, so every area is measured with one rule.
   */
  function responsibilitySummaries() {
    var today = Domain.today();
    var members = index('MEMBERS');
    var areas = Object.create(null);
    Responsibilities.all().forEach(function (row, position) {
      areas[row.Responsibility_ID] = {
        id: row.Responsibility_ID, name: row.Name, status: row.Status,
        color: Responsibilities.colorOf(row, position),
        ownerId: row.Owner_Member_ID || '',
        owner: (members[row.Owner_Member_ID] || {}).Name || '',
        totalProjects: 0, projects: 0, openTasks: 0, overdueTasks: 0, tasks: []
      };
    });
    var unassigned = {id: '', name: '', status: 'Active', color: '', ownerId: '', owner: '',
      totalProjects: 0, projects: 0, openTasks: 0, overdueTasks: 0, tasks: []};
    var areaOf = Object.create(null);
    Database.read('PROJECTS').forEach(function (project) {
      var areaId = String(project.Responsibility_ID || '');
      areaOf[project.Project_ID] = areaId;
      var bucket = areaId && areas[areaId] ? areas[areaId] : unassigned;
      bucket.totalProjects++;
      if (['Archived', 'Cancelled', 'Completed'].indexOf(project.Status) < 0) bucket.projects++;
    });
    Database.read('TASKS').forEach(function (task) {
      var areaId = areaOf[task.Project_ID] || '';
      var bucket = areaId && areas[areaId] ? areas[areaId] : unassigned;
      bucket.tasks.push(task);
      if (['Done', 'Cancelled'].indexOf(task.Status) >= 0) return;
      bucket.openTasks++;
      var due = Domain.date(task.Due_Date);
      if (due && due < today) bucket.overdueTasks++;
    });
    function finish(bucket) {
      var rolled = Progress.rollup(bucket.tasks);
      return {id: bucket.id, name: bucket.name, status: bucket.status, color: bucket.color,
        ownerId: bucket.ownerId, owner: bucket.owner, totalProjects: bucket.totalProjects,
        projects: bucket.projects, openTasks: bucket.openTasks, overdueTasks: bucket.overdueTasks,
        progress: rolled.calculated ? rolled.percent : '', progressCalculated: rolled.calculated};
    }
    var items = Responsibilities.all().map(function (row) { return finish(areas[row.Responsibility_ID]); });
    return {items: items, unassigned: finish(unassigned)};
  }
  /** Reference choices for the create/edit forms; identifiers and names only. */
  function referenceOptions() {
    return {members: Database.read('MEMBERS').map(function (m) { return {id: m.Member_ID, name: m.Name, active: m.Active}; }),
      projects: Database.read('PROJECTS').map(function (p) { return {id: p.Project_ID, name: p.Project_Name}; }),
      responsibilities: responsibilityOptions()};
  }
  /** KPI, upcoming and pending values shared by the overview page and the bootstrap payload. */
  function overviewCore(actor, projects) {
    var active = projects.filter(function (p) { return ['Archived','Cancelled','Completed'].indexOf(p.status) < 0; });
    var today = Domain.today(), end = new Date(today + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 7);
    var tasks = Tasks.list({activeOnly: true}), soon = 0, overdue = 0, upcoming = [];
    var endDate = end.toISOString().slice(0,10), projectIndex = index('PROJECTS'), memberIndex = index('MEMBERS');
    var taskTree = TaskTree.buildIndex(Database.read('TASKS'));
    tasks.forEach(function (t) { var due = Domain.date(t.Due_Date); if (due && due < today) overdue++;         if (due >= today && due <= endDate) { var view = TaskTree.viewIn(t, taskTree); soon++; upcoming.push({id:t.Task_ID,name:t.Task_Name,project:(projectIndex[t.Project_ID]||{}).Project_Name||'',owner:(memberIndex[t.Owner_Member_ID]||{}).Name||'',deadline:due,status:view.status,progress:view.progress,responsibilityId:(projectIndex[t.Project_ID]||{}).Responsibility_ID||''}); } });
    var member = Database.find('MEMBERS', actor.memberId);
    return {version: '1.6', actor: {name: member.Name, role: actor.role},
      kpis: {active: active.length, risk: active.filter(function (p) { return ['RED','YELLOW','UNKNOWN'].indexOf(p.health) >= 0; }).length, soon: soon, overdue: overdue},
      upcoming: {items: upcoming.sort(function(a,b){return a.deadline.localeCompare(b.deadline)||a.id.localeCompare(b.id);}).slice(0,5),total:soon},
      pending: Database.read('TASK_REQUESTS').filter(function (r) { return r.Status === 'PENDING'; }).length,
      refreshedAt: new Date().toISOString()};
  }
  function overview(actor) {
    var projects = projectList(), core = overviewCore(actor, projects);
    core.projects = page(projects, {limit: 20});
    core.responsibilities = responsibilityOptions();
    core.responsibilityCards = responsibilitySummaries();
    return core;
  }
  /** All-or-nothing dataset: an oversized set carries no rows at all, never a silent prefix. */
  function dataset(rows, limit) {
    var complete = rows.length <= limit;
    return {items: complete ? rows : [], total: rows.length, complete: complete, limit: limit};
  }
  // Compact task index: one header row plus value rows, so a few thousand summaries do not
  // repeat every field name. The browser rebuilds the objects and never sees a private field.
  var TASK_COLUMNS = ['id', 'name', 'projectId', 'project', 'subprojectId', 'ownerId', 'owner',
    'responsibilityId', 'deadline', 'status', 'progress', 'priority', 'parentId', 'container', 'depth', 'reviewState'];
  function taskIndex(projects, members) {
    var all = Tasks.list({}), complete = all.length <= TASK_INDEX_LIMIT;
    var treeIndex = TaskTree.buildIndex(all);
    var reviewStates = Requests.pendingCompletionStates();
    var rows = complete ? all.sort(taskOrder({})).map(function (t) {
      var summary = taskSummary(t, projects, members, treeIndex, reviewStates);
      return TASK_COLUMNS.map(function (column) { return summary[column]; });
    }) : [];
    return {columns: TASK_COLUMNS, rows: rows, total: all.length, complete: complete, limit: TASK_INDEX_LIMIT};
  }
  /**
   * One authorized read for ordinary navigation: overview values, reference choices, every
   * project summary and the size of the task index. The browser answers list, search, filter
   * and detail navigation from this in-memory snapshot and revalidates in the background;
   * Google Sheets remains the only authoritative store.
   *
   * A dataset that exceeds its bound reports complete:false and carries no truncated rows, so
   * the browser keeps the paginated server operations instead of implying that a partial list
   * covers every record.
   */
  function bootstrap(actor) {
    var projects = projectList(), core = overviewCore(actor, projects);
    var all = Tasks.list({});
    return {contract: '1.6', version: core.version, actor: core.actor, refreshedAt: core.refreshedAt,
      kpis: core.kpis, upcoming: core.upcoming, pending: core.pending,
      overviewProjects: page(projects, {limit: 20}),
      responsibilities: responsibilityOptions(), responsibilityCards: responsibilitySummaries(),
      references: referenceOptions(),
      projects: dataset(projects, PROJECT_INDEX_LIMIT),
      tasks: {total: all.length, complete: all.length <= TASK_INDEX_LIMIT, limit: TASK_INDEX_LIMIT}};
  }
  /**
   * One member's current work, previous work and recorded activity.
   *
   * Attribution uses the immutable owner ID and the task ID only. A typed requester name is
   * never used to claim that somebody worked on a task, and no event is invented: the list is
   * exactly what the append-only audit, request and deadline-history records contain.
   */
  function memberProfile(input) {
    var members = index('MEMBERS'), projects = index('PROJECTS');
    var member = Database.find('MEMBERS', String(input.id || ''));
    if (!member) throw new Error('NOT_FOUND');
    var allTasks = Database.read('TASKS');
    var treeIndex = TaskTree.buildIndex(allTasks);
    var reviewStates = Requests.pendingCompletionStates();
    var owned = allTasks.filter(function (task) { return task.Owner_Member_ID === member.Member_ID; });
    var summaries = owned.map(function (task) { return taskSummary(task, projects, members, treeIndex, reviewStates); });
    var accepted = Object.create(null);
    Database.read('TASK_REQUESTS').forEach(function (request) {
      if (String(request.Request_Type) !== 'COMPLETION_REPORT') return;
      if (String(request.Status) !== 'APPROVED') return;
      accepted[String(request.Task_ID)] = request.Decided_At || request.Submitted_At || '';
    });
    function withCompletion(summary) {
      var task = allTasks.filter(function (row) { return row.Task_ID === summary.id; })[0] || {};
      return Object.assign({}, summary, {
        completedAt: task.Completed_At ? String(task.Completed_At).slice(0, 10) : '',
        acceptedAt: accepted[String(summary.id)] ? String(accepted[String(summary.id)]) : '',
        acceptance: accepted[String(summary.id)] ? 'APPROVED' : (task.Completed_At ? 'LEGACY' : '')
      });
    }
    var current = summaries.filter(function (summary) { return ['Done', 'Cancelled'].indexOf(summary.status) < 0; });
    var previous = summaries.filter(function (summary) { return summary.status === 'Done'; }).map(withCompletion);
    var taskIds = Object.create(null);
    owned.forEach(function (task) { taskIds[String(task.Task_ID)] = true; });
    var activity = [];
    Database.read('AUDIT_LOG').forEach(function (row) {
      // Domain saves record the table name ('TASKS'); explicit actions use 'TASK'.
      if (['TASK', 'TASKS'].indexOf(String(row.Entity_Type)) < 0) return;
      if (!taskIds[String(row.Entity_ID)]) return;
      activity.push({at: String(row.Timestamp || ''), action: String(row.Action || ''),
        taskId: String(row.Entity_ID), actor: String(row.Actor || ''), source: 'AUDIT_LOG'});
    });
    Database.read('TASK_DEADLINE_HISTORY').forEach(function (row) {
      if (!taskIds[String(row.Task_ID)]) return;
      activity.push({at: String(row.Changed_At || ''), action: 'DEADLINE_CHANGED',
        taskId: String(row.Task_ID), actor: String(row.Changed_By || ''), source: 'TASK_DEADLINE_HISTORY'});
    });
    activity.sort(function (a, b) { return b.at.localeCompare(a.at); });
    return {
      member: {id: member.Member_ID, name: member.Name, department: member.Department,
        position: member.Position, role: Roles.normalize(member.Role), active: member.Active === true},
      current: current, previous: previous, activity: activity.slice(0, 50),
      activityTotal: activity.length
    };
  }
  function read(operation, input, actor) {
    input = input || {};
    switch (operation) {
      case 'overview': return overview(actor);
      case 'member': return memberProfile(input);
      case 'deletion': Access.requireAdmin(); return Deletion.preflight(String(input.table || ''), String(input.id || ''));
      case 'projects': {
        // Page the stored rows first so only the visible cards are recalculated.
        var paged = page(Projects.list(input), input);
        paged.items = projectList(paged.items);
        return paged;
      }
      case 'tasks': return taskList(input);
      case 'bootstrap': return bootstrap(actor);
      case 'taskIndex': return taskIndex(index('PROJECTS'), index('MEMBERS'));
      case 'project': {
        var p = Database.find('PROJECTS', input.id);
        var subs = Database.read('SUBPROJECTS').filter(function (s) { return s.Project_ID === input.id; });
        var projectTasks = Database.read('TASKS').filter(function (t) { return t.Project_ID === input.id; });
        var children = Subprojects.childrenMap(subs), grouped = Progress.group(projectTasks, 'Subproject_ID');
        return {record: editable('PROJECTS', p), progress: Progress.rollup(projectTasks),
          subprojects: subs.map(function (s) { var dto = editable('SUBPROJECTS', s);
            dto._progress = Progress.rollup(Progress.subtreeTasks(s.Subproject_ID, children, grouped)); return dto; })};
      }
      case 'task': return {record: editable('TASKS', Database.find('TASKS', input.id)), confirmations: Database.read('SCHEDULE_CONFIRMATIONS').filter(function (r) { return r.Task_ID === input.id; }).map(function (r) { return record('SCHEDULE_CONFIRMATIONS', r); })};
      case 'references': return referenceOptions();
      case 'members': return page(Database.read('MEMBERS').filter(function (m) { return !input.query || (m.Name + ' ' + m.Department).toLowerCase().indexOf(String(input.query).toLowerCase()) >= 0; }).map(function (m) { return editable('MEMBERS', m); }), input);
      case 'responsibilities': return {items: Responsibilities.all().map(function (r) { return editable('RESPONSIBILITIES', r); })};
      case 'skills': return {items: Database.read('SKILLS').map(function (s) { return record('SKILLS', s); }), assessments: unwrap(Ui.skills())};
      case 'requests': return unwrap(Ui.requests({import: false, includeDecided: input.includeDecided === true}));
      case 'automation': {var automation=unwrap(Ui.automationSettings());automation.revision=settingsRevision();return automation;}
      case 'publication': return unwrap(Ui.publicationStatus());
      case 'status': {
        var status = unwrap(Ui.status());
        return {version: '1.6', schema: Schema.version, environment: status.health.environment,
          valid: status.valid, errorCount: status.errorCount, rowCounts: status.rowCounts,
          emailMode: status.health.emailMode, emergencyStop: status.health.emergencyStop,
          calendarEnabled: status.health.calendarEnabled, dryRun: status.health.dryRun};
      }
      case 'plan': return unwrap(Ui.planPreview(input));
      default: throw new Error('Unknown manager read operation');
    }
  }
  return {authorize: authorize, response: response, read: read, unwrap: unwrap, editable: editable, revision: revision, settingsRevision: settingsRevision};
}());

function managerWebRead(operation, payload) {
  return ManagerWeb.response(function (actor) { return ManagerWeb.read(operation, payload, actor); }, true);
}
