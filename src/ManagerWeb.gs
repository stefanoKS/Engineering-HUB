/** V1.5 manager HTML Service entrypoint. Employee deployment remains separate. */
function doGet() {
  return Database.withReadContext(function () {
    ManagerWeb.authorize();
    return HtmlService.createTemplateFromFile('ManagerWebIndex').evaluate()
      .setTitle('設計・開発課 管理').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  });
}

var ManagerWeb = (function () {
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
  function projectList(input) {
    var members = index('MEMBERS'), responsibilities = index('RESPONSIBILITIES');
    return Projects.list(input).map(function (p) {
      return {id: p.Project_ID, name: p.Project_Name, responsibilityId: p.Responsibility_ID || '',
        responsibility: responsibilities[p.Responsibility_ID] ? responsibilities[p.Responsibility_ID].Name : '',
        owner: members[p.Project_Owner_ID] ? members[p.Project_Owner_ID].Name : '', status: p.Status,
        deadline: Domain.date(p.Committed_Deadline), progress: p.Progress_Percent, health: p.Health || 'UNKNOWN'};
    });
  }
  function taskList(input) {
    var projects = index('PROJECTS'), members = index('MEMBERS');
    var rows = Tasks.list(input).filter(function (t) {
      if (input.responsibilityId && String((projects[t.Project_ID] || {}).Responsibility_ID || '') !== input.responsibilityId) return false;
      if (input.deadlineBefore && (!t.Due_Date || Domain.date(t.Due_Date) > input.deadlineBefore)) return false;
      if (input.deadlineAfter && (!t.Due_Date || Domain.date(t.Due_Date) < input.deadlineAfter)) return false;
      return true;
    });
    var priorities = {Critical: 0, High: 1, Medium: 2, Low: 3};
    rows.sort(function (a, b) {
      return (input.sort === 'priority' ? (priorities[a.Priority] || 0) - (priorities[b.Priority] || 0) :
        (Domain.date(a.Due_Date) || '9999').localeCompare(Domain.date(b.Due_Date) || '9999')) || a.Task_ID.localeCompare(b.Task_ID);
    });
    var result = page(rows, input);
    result.items = result.items.map(function (t) { return {id: t.Task_ID, name: t.Task_Name,
      projectId: t.Project_ID, project: (projects[t.Project_ID] || {}).Project_Name || '', subprojectId: t.Subproject_ID || '',
      owner: (members[t.Owner_Member_ID] || {}).Name || '', deadline: Domain.date(t.Due_Date),
      status: t.Status, progress: t.Progress_Percent, priority: t.Priority}; });
    return result;
  }
  function overview(actor) {
    var projects = projectList({}), active = projects.filter(function (p) { return ['Archived','Cancelled','Completed'].indexOf(p.status) < 0; });
    var today = Domain.today(), end = new Date(today + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 7);
    var tasks = Tasks.list({activeOnly: true}), soon = 0, overdue = 0, upcoming = [];
    var endDate = end.toISOString().slice(0,10), projectIndex = index('PROJECTS'), memberIndex = index('MEMBERS');
    tasks.forEach(function (t) { var due = Domain.date(t.Due_Date); if (due && due < today) overdue++; if (due >= today && due <= endDate) { soon++; upcoming.push({id:t.Task_ID,name:t.Task_Name,project:(projectIndex[t.Project_ID]||{}).Project_Name||'',owner:(memberIndex[t.Owner_Member_ID]||{}).Name||'',deadline:due,status:t.Status,progress:t.Progress_Percent}); } });
    var member = Database.find('MEMBERS', actor.memberId);
    return {version: '1.5.0', actor: {name: member.Name, role: actor.role},
      kpis: {active: active.length, risk: active.filter(function (p) { return ['RED','YELLOW','UNKNOWN'].indexOf(p.health) >= 0; }).length, soon: soon, overdue: overdue},
      projects: page(projects, {limit: 20}), responsibilities: Responsibilities.all().map(function (r) { return {id: r.Responsibility_ID, name: r.Name, status: r.Status}; }),
      upcoming: {items: upcoming.sort(function(a,b){return a.deadline.localeCompare(b.deadline)||a.id.localeCompare(b.id);}).slice(0,5),total:soon},
      pending: Database.read('TASK_REQUESTS').filter(function (r) { return r.Status === 'PENDING'; }).length,
      refreshedAt: new Date().toISOString()};
  }
  function read(operation, input, actor) {
    input = input || {};
    switch (operation) {
      case 'overview': return overview(actor);
      case 'projects': return page(projectList(input), input);
      case 'tasks': return taskList(input);
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
      case 'references': return {members: Database.read('MEMBERS').map(function (m) { return {id: m.Member_ID, name: m.Name, active: m.Active}; }),
        projects: projectList({}).map(function (p) { return {id: p.id, name: p.name}; }),
        responsibilities: Responsibilities.all().map(function (r) { return {id: r.Responsibility_ID, name: r.Name, status: r.Status}; })};
      case 'members': return page(Database.read('MEMBERS').filter(function (m) { return !input.query || (m.Name + ' ' + m.Department).toLowerCase().indexOf(String(input.query).toLowerCase()) >= 0; }).map(function (m) { return editable('MEMBERS', m); }), input);
      case 'responsibilities': return {items: Responsibilities.all().map(function (r) { return editable('RESPONSIBILITIES', r); })};
      case 'skills': return {items: Database.read('SKILLS').map(function (s) { return record('SKILLS', s); }), assessments: unwrap(Ui.skills())};
      case 'requests': return unwrap(Ui.requests({import: false, includeDecided: input.includeDecided === true}));
      case 'automation': {var automation=unwrap(Ui.automationSettings());automation.revision=settingsRevision();return automation;}
      case 'publication': return unwrap(Ui.publicationStatus());
      case 'status': {
        var status = unwrap(Ui.status());
        return {version: '1.5.0', schema: Schema.version, environment: status.health.environment,
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
