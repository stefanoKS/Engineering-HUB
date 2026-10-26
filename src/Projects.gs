var Domain = (function () {
  function fail(message) { throw new Error(message); }
  function date(value, label) {
    if (value === '' || value === null || value === undefined) return '';
    if (value instanceof Date) value = Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
    var text = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) !== text) fail((label || 'Date') + ' must be a valid yyyy-MM-dd date');
    return text;
  }
  function required(table, id) {
    var row = Database.find(table, id);
    if (!row) fail(table + ' reference not found: ' + id);
    return row;
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function actor() {
    try { return Session.getActiveUser().getEmail() || 'system'; } catch (e) { return 'system'; }
  }
  function now() { return new Date().toISOString(); }
  function number(value, name, min, max) {
    if (value === '' || value === null || value === undefined) return;
    if (typeof value !== 'number' || !isFinite(value) || value < min || (max !== undefined && value > max)) fail(name + ' is out of range');
  }
  function dates(row) {
    ['Planned_Start', 'Planned_End', 'Due_Date', 'Forecast_End', 'Committed_Deadline', 'Original_Deadline', 'Deadline', 'Target_Date', 'Actual_Date', 'Actual_Completion', 'Raised_Date', 'Target_Close_Date'].forEach(function (field) {
      if (row[field]) date(row[field], field);
    });
    var end = row.Due_Date || row.Planned_End || row.Forecast_End || row.Committed_Deadline;
    if (row.Planned_Start && end && date(row.Planned_Start) > date(end)) fail('Planned_Start must not exceed end date');
    number(row.Progress_Percent, 'Progress_Percent', 0, 100);
    if ((row.Status === 'Completed' || row.Status === 'Done') && row.Progress_Percent !== undefined && row.Progress_Percent !== 100) fail('Completed records must have 100% progress');
  }
  function projectLink(row) {
    if (row.Project_ID) required('PROJECTS', row.Project_ID);
    if (row.Subproject_ID) {
      var sub = required('SUBPROJECTS', row.Subproject_ID);
      if (!row.Project_ID || sub.Project_ID !== row.Project_ID) fail('Subproject must belong to the selected project');
    }
  }
  function save(table, id, data, validate, action, after) {
    return Database.withLock(function () {
      var before = id ? required(table, id) : null;
      var row = Object.assign({}, before || {}, data);
      if (id && data[Schema.tables[table].id] && data[Schema.tables[table].id] !== id) fail('IDs are immutable');
      if (validate) validate(row, before);
      var changed = {};
      Object.keys(row).forEach(function (field) {
        if (!before || JSON.stringify(row[field]) !== JSON.stringify(before[field])) changed[field] = row[field];
      });
      var result = id ? Database.update(table, id, changed) : Database.insert(table, row);
      AuditLog.record(table, result[Schema.tables[table].id], action || (id ? 'UPDATE' : 'CREATE'), before, result, 'SUCCESS');
      if (after) after(result, before);
      return result;
    });
  }
  function today() {
    return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return { fail: fail, date: date, required: required, copy: copy, actor: actor, now: now, number: number, dates: dates, projectLink: projectLink, save: save, today: today };
})();

var Projects = (function () {
  function validate(row) {
    Domain.dates(row);
    if (row.Project_Owner_ID) Domain.required('MEMBERS', row.Project_Owner_ID);
    if (row.Responsibility_ID) Domain.required('RESPONSIBILITIES', row.Responsibility_ID);
    if (row.Archived_At && row.Status !== 'Archived') Domain.fail('Archived_At is only valid for archived projects');
  }

  /** Application-managed "last meaningful update"; dashboard refreshes never call this. */
  function touch(projectId) {
    if (!projectId) return null;
    var project = Database.find('PROJECTS', projectId);
    if (!project) return null;
    if (project.Status === 'Archived') return project;
    return Database.update('PROJECTS', projectId, {Last_Updated: Domain.now()});
  }

  function list(filter) {
    filter = filter || {};
    var statuses = filter.status ? (Array.isArray(filter.status) ? filter.status : [filter.status]) : null;
    var query = String(filter.query || '').toLowerCase();
    return Database.read('PROJECTS').filter(function (project) {
      if (statuses && statuses.indexOf(project.Status) < 0) return false;
      if (filter.ownerId && project.Project_Owner_ID !== filter.ownerId) return false;
      if (filter.responsibilityId && String(project.Responsibility_ID || '') !== String(filter.responsibilityId)) return false;
      if (filter.unassigned && String(project.Responsibility_ID || '')) return false;
      if (filter.activeOnly && !Eligibility.projectContributesWorkload(project)) return false;
      if (query) {
        var haystack = [project.Project_ID, project.Project_Name, project.Description, project.Category].join(' ').toLowerCase();
        if (haystack.indexOf(query) < 0) return false;
      }
      return true;
    });
  }

  return {
    create: function (data) {
      var row = Object.assign({ Status: 'Planned' }, data);
      if (row.Original_Deadline) Domain.fail('Original deadline is set by project creation');
      row.Original_Deadline = row.Committed_Deadline || '';
      row.Last_Updated = Domain.now();
      return Domain.save('PROJECTS', null, row, validate);
    },
    update: function (id, patch) {
      var data = Object.assign({}, patch, {Last_Updated: Domain.now()});
      return Domain.save('PROJECTS', id, data, function (row, before) {
        if (row.Original_Deadline !== before.Original_Deadline) Domain.fail('Original deadline is immutable');
        validate(row);
      });
    },
    archive: function (id) {
      return Domain.save('PROJECTS', id, {Status: 'Archived', Archived_At: Domain.now(), Last_Updated: Domain.now()}, validate, 'ARCHIVE');
    },
    touch: touch,
    list: list
  };
})();
function createProject(data) { return Projects.create(data); }
function updateProject(id, patch) { return Projects.update(id, patch); }
function archiveProject(id) { return Projects.archive(id); }
function listProjects(filter) { return Projects.list(filter); }