/**
 * Organizational responsibility areas (担当領域).
 *
 * A responsibility groups projects for the manager, but it is deliberately *not* a
 * permission boundary: owning one never grants access to the projects inside it, and
 * moving a project never changes its owner. See docs/RESPONSIBILITIES.md.
 *
 * Retirement is a status change, never a deletion. Associated projects, tasks, milestones
 * and history stay untouched and remain visible and actionable.
 */
var Responsibilities = (function () {
  var ACTIVE = 'Active';
  var RETIRED = 'Retired';
  var NAME_MAX = 60;
  var DESCRIPTION_MAX = 500;
  var TERMINAL_PROJECT = ['Completed', 'Cancelled', 'Archived'];

  function fail(message) { Domain.fail(message); }

  function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }

  function sameName(left, right) {
    return text(left).replace(/\s+/g, ' ').toLowerCase() === text(right).replace(/\s+/g, ' ').toLowerCase();
  }

  function orderValue(row) {
    var value = Number(row.Sort_Order);
    return isFinite(value) && row.Sort_Order !== '' && row.Sort_Order !== null ? value : Number.MAX_SAFE_INTEGER;
  }

  function compare(left, right) {
    var order = orderValue(left) - orderValue(right);
    if (order) return order;
    return String(left.Name || '').localeCompare(String(right.Name || ''), 'ja');
  }

  function all() { return Database.read('RESPONSIBILITIES').slice().sort(compare); }

  function find(id) { return id ? Database.find('RESPONSIBILITIES', id) || null : null; }

  function isRetired(row) { return !!row && row.Status === RETIRED; }

  function isActive(row) { return !!row && row.Status !== RETIRED; }

  function list(filter) {
    filter = filter || {};
    var query = text(filter.query).toLowerCase();
    return all().filter(function (row) {
      if (!filter.includeRetired && isRetired(row) && !filter.onlyRetired) return false;
      if (filter.onlyRetired && !isRetired(row)) return false;
      if (query && (text(row.Name) + ' ' + text(row.Description)).toLowerCase().indexOf(query) < 0) return false;
      return true;
    });
  }

  /** Active responsibilities are the only selectable destinations for new work. */
  function active() { return all().filter(isActive); }

  function requireName(value) {
    var name = text(value);
    if (!name) fail('担当領域名を入力してください');
    if (name.length > NAME_MAX) fail('担当領域名は' + NAME_MAX + '文字以内で入力してください');
    return name;
  }

  function requireUniqueName(row) {
    var clash = Database.read('RESPONSIBILITIES').filter(function (other) {
      return other.Responsibility_ID !== row.Responsibility_ID && isActive(other) && sameName(other.Name, row.Name);
    });
    if (clash.length) fail('同じ名前の担当領域がすでにあります');
  }

  function validate(row, before) {
    row.Name = requireName(row.Name);
    if (String(row.Description || '').length > DESCRIPTION_MAX) {
      fail('説明は' + DESCRIPTION_MAX + '文字以内で入力してください');
    }
    if (row.Status !== ACTIVE && row.Status !== RETIRED) fail('状態は Active または Retired を指定してください');
    if (row.Owner_Member_ID) Domain.required('MEMBERS', row.Owner_Member_ID);
    if (row.Retired_At && row.Status !== RETIRED) fail('Retired_At は退職（Retired）状態でのみ設定できます');
    // Only an active row can clash: a retired name stays reserved for its history.
    if (row.Status === ACTIVE) requireUniqueName(row);
  }

  function nextOrder() {
    var rows = Database.read('RESPONSIBILITIES');
    return rows.reduce(function (max, row) {
      var value = Number(row.Sort_Order);
      return isFinite(value) && row.Sort_Order !== '' && row.Sort_Order !== null ? Math.max(max, value) : max;
    }, -1) + 1;
  }

  function identity() { return Access.requireManager(); }

  /**
   * ADMIN administers every responsibility. A MANAGER may only administer a responsibility
   * they own; the policy itself lives in Access.gs so every entrypoint shares it.
   */
  function canManage(current, row) { return Access.canManageResponsibility(current, row); }

  function requireManage(current, row) {
    if (!canManage(current, row)) {
      fail('この担当領域を変更する権限がありません（ADMIN または担当領域の責任者が必要です）');
    }
    return row;
  }

  function create(data) {
    data = data || {};
    var current = identity();
    var owner = text(data.Owner_Member_ID) || current.memberId;
    if (!owner) fail('責任者を指定してください');
    // A manager creates only responsibilities they own; assigning another owner is ADMIN-only.
    if (owner !== current.memberId && current.role !== 'ADMIN') {
      fail('責任者の指定は ADMIN のみが変更できます');
    }
    var row = Object.assign({ Description: '' }, data, {
      Responsibility_ID: 'RESP_' + Utilities.getUuid(),
      Owner_Member_ID: owner,
      Status: ACTIVE,
      Retired_At: '',
      Sort_Order: data.Sort_Order === undefined ? nextOrder() : data.Sort_Order,
      Updated_At: Domain.now()
    });
    return Domain.save('RESPONSIBILITIES', null, row, validate, 'CREATE');
  }

  function update(id, patch) {
    var current = identity();
    var before = Domain.required('RESPONSIBILITIES', id);
    requireManage(current, before);
    patch = Object.assign({}, patch || {});
    delete patch.Responsibility_ID;
    if (Object.prototype.hasOwnProperty.call(patch, 'Owner_Member_ID') &&
        text(patch.Owner_Member_ID) !== text(before.Owner_Member_ID) && current.role !== 'ADMIN') {
      fail('担当領域の責任者変更は ADMIN のみが実行できます');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'Status')) {
      fail('状態の変更には retire / reactivate を使用してください');
    }
    if (!Object.keys(patch).length) fail('変更する項目がありません');
    patch.Updated_At = Domain.now();
    return Domain.save('RESPONSIBILITIES', id, patch, validate, 'UPDATE');
  }

  /** Reorders active responsibilities; every id in the list must be a live responsibility. */
  function reorder(orderedIds) {
    var current = identity();
    var ids = (orderedIds || []).map(text).filter(function (id) { return !!id; });
    if (!ids.length) fail('並び順を指定してください');
    return Database.withLock(function () {
      var rows = Database.read('RESPONSIBILITIES');
      var byId = Object.create(null);
      rows.forEach(function (row) { byId[row.Responsibility_ID] = row; });
      ids.forEach(function (id) {
        var row = byId[id];
        if (!row) fail('担当領域が見つかりません: ' + id);
        requireManage(current, row);
      });
      var next = 0;
      var changes = ids.map(function (id) {
        next += 1;
        return {id: id, patch: {Sort_Order: next, Updated_At: Domain.now()}};
      });
      // Untouched rows keep their relative order after the reordered block.
      var remaining = all().filter(function (row) { return ids.indexOf(row.Responsibility_ID) < 0; });
      remaining.forEach(function (row) {
        next += 1;
        changes.push({id: row.Responsibility_ID, patch: {Sort_Order: next, Updated_At: Domain.now()}});
      });
      Database.updateMany('RESPONSIBILITIES', changes);
      AuditLog.write('RESPONSIBILITY_REORDERED', 'RESPONSIBILITY', ids.join(','), {order: ids});
      return {reordered: ids.length};
    });
  }

  /** Retirement never deletes a project: it only stops new work from selecting the area. */
  function retire(id, options) {
    var current = identity();
    var row = Domain.required('RESPONSIBILITIES', id);
    requireManage(current, row);
    if (isRetired(row)) fail('この担当領域はすでに退職（Retired）です');
    if (!options || options.confirmed !== true) {
      fail('担当領域の退職には確認が必要です');
    }
    var affected = counts()[id];
    var result = Domain.save('RESPONSIBILITIES', id,
      {Status: RETIRED, Retired_At: Domain.now(), Updated_At: Domain.now()}, validate, 'RETIRE');
    return {responsibility: result, openProjects: affected ? affected.activeProjects : 0};
  }

  function reactivate(id) {
    var current = identity();
    var row = Domain.required('RESPONSIBILITIES', id);
    requireManage(current, row);
    if (!isRetired(row)) fail('この担当領域はすでに有効（Active）です');
    return Domain.save('RESPONSIBILITIES', id,
      {Status: ACTIVE, Retired_At: '', Updated_At: Domain.now()}, validate, 'REACTIVATE');
  }

  /**
   * Moves one project between responsibilities.
   *
   * Only Responsibility_ID changes (plus the update timestamp and the audit record); the
   * owner, deadline, original deadline, status, progress and every child record stay as-is.
   */
  function transferProject(projectId, responsibilityId, options) {
    options = options || {};
    var current = identity();
    Access.requireProjectWrite(projectId, current.email);
    var project = Database.find('PROJECTS', projectId);
    if (!project) fail('プロジェクトが見つかりません: ' + projectId);
    if (options.confirmed !== true) fail('担当領域の変更には確認が必要です');
    var beforeId = text(project.Responsibility_ID);
    var nextId = text(responsibilityId);
    if (nextId === beforeId) return {changed: false, project: project, previous: beforeId, next: nextId};
    var destination = null;
    if (nextId) {
      destination = Domain.required('RESPONSIBILITIES', nextId);
      if (isRetired(destination) && current.role !== 'ADMIN') {
        fail('退職した担当領域には移動できません（ADMIN のみ許可）');
      }
      if (isRetired(destination) && options.confirmRetired !== true) {
        fail('退職した担当領域への移動には追加の確認が必要です');
      }
    }
    var updated = Projects.update(projectId, {Responsibility_ID: nextId});
    AuditLog.write('RESPONSIBILITY_TRANSFERRED', 'PROJECT', projectId, {
      previousResponsibilityId: beforeId,
      newResponsibilityId: nextId,
      reason: text(options.reason).slice(0, 200),
      actor: current.email
    });
    return {changed: true, project: updated, previous: beforeId, next: nextId,
      previousName: beforeId ? (find(beforeId) || {}).Name || '' : '',
      nextName: destination ? destination.Name : ''};
  }

  /**
   * Per-responsibility project counts used by the manager list.
   *
   * "Active" here means any project that is still operational; terminal projects stay
   * counted in the total so a retired area never looks empty while it still holds work.
   */
  function counts() {
    var result = Object.create(null);
    Database.read('RESPONSIBILITIES').forEach(function (row) {
      result[row.Responsibility_ID] = {totalProjects: 0, activeProjects: 0, atRiskProjects: 0, needsReassignment: 0};
    });
    var retired = Object.create(null);
    Database.read('RESPONSIBILITIES').forEach(function (row) {
      if (isRetired(row)) retired[row.Responsibility_ID] = true;
    });
    Database.read('PROJECTS').forEach(function (project) {
      var id = text(project.Responsibility_ID);
      if (!id || !result[id]) return;
      var item = result[id];
      item.totalProjects++;
      if (TERMINAL_PROJECT.indexOf(project.Status) >= 0) return;
      item.activeProjects++;
      if (project.Health === 'RED' || project.Health === 'YELLOW') item.atRiskProjects++;
      if (retired[id]) item.needsReassignment++;
    });
    return result;
  }

  /** True when the project sits in a retired area and still needs a new destination. */
  function needsReassignment(project, retiredIndex) {
    if (!project || TERMINAL_PROJECT.indexOf(project.Status) >= 0) return false;
    var id = text(project.Responsibility_ID);
    if (!id) return false;
    var index = retiredIndex || retiredMap();
    return index[id] === true;
  }

  function retiredMap() {
    var map = Object.create(null);
    Database.read('RESPONSIBILITIES').forEach(function (row) {
      if (isRetired(row)) map[row.Responsibility_ID] = true;
    });
    return map;
  }

  return {
    ACTIVE: ACTIVE,
    RETIRED: RETIRED,
    NAME_MAX: NAME_MAX,
    all: all,
    active: active,
    list: list,
    find: find,
    isActive: isActive,
    isRetired: isRetired,
    canManage: canManage,
    create: create,
    update: update,
    reorder: reorder,
    retire: retire,
    reactivate: reactivate,
    transferProject: transferProject,
    counts: counts,
    needsReassignment: needsReassignment,
    retiredMap: retiredMap
  };
}());
function createResponsibility(data) { return Responsibilities.create(data); }
function updateResponsibility(id, patch) { return Responsibilities.update(id, patch); }
function retireResponsibility(id, options) { return Responsibilities.retire(id, options); }
function reactivateResponsibility(id) { return Responsibilities.reactivate(id); }
function reorderResponsibilities(ids) { return Responsibilities.reorder(ids); }
function transferProjectResponsibility(projectId, responsibilityId, options) {
  return Responsibilities.transferProject(projectId, responsibilityId, options);
}
function listResponsibilities(filter) { return Responsibilities.list(filter); }
