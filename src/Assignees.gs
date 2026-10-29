/**
 * Additional assignees and additional responsibility members (V1.7).
 *
 * A task has exactly one primary assignee (`TASKS.Owner_Member_ID`) and any number of
 * additional assignees stored in `TASK_ASSIGNEES`. A responsibility has exactly one primary
 * owner (`RESPONSIBILITIES.Owner_Member_ID`) and any number of additional responsible members
 * stored in `RESPONSIBILITY_MEMBERS`.
 *
 * Rules this module owns:
 * - The primary column stays authoritative. The relationship tables never hold a copy of it,
 *   so the effective membership is always "primary owner plus the active relationship rows".
 * - Membership is a soft relationship: a removal stamps `Removed_At` instead of deleting the
 *   row, so historical attribution survives a later change.
 * - Membership is never authorization. An additional assignee, or an additional responsibility
 *   member, gains no manager capability; every entrypoint still checks `Access`/`Roles`.
 * - Every read is one indexed pass over the relationship table plus one over `MEMBERS`, cached
 *   for the execution by `Database.memo`, so a 3,000 task list never performs one Sheets read
 *   per task (docs/MANAGER_WEB_APP_PERFORMANCE.md).
 */
var Assignees = (function () {
  var ENTITIES = {
    TASK: {table: 'TASK_ASSIGNEES', key: 'Task_ID', parent: 'TASKS', primary: 'Owner_Member_ID',
      audit: 'TASK_ASSIGNEES_CHANGED', label: 'タスク担当者'},
    RESPONSIBILITY: {table: 'RESPONSIBILITY_MEMBERS', key: 'Responsibility_ID',
      parent: 'RESPONSIBILITIES', primary: 'Owner_Member_ID',
      audit: 'RESPONSIBILITY_MEMBERS_CHANGED', label: '担当領域メンバー'}
  };

  function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }

  function fail(message) { Domain.fail(message); }

  function spec(entity) {
    if (!ENTITIES[entity]) fail('Unknown membership entity: ' + entity);
    return ENTITIES[entity];
  }

  /**
   * One indexed pass over the relationship table and the member directory.
   *
   * `active[parentId]` holds the current additional members, `history[parentId]` holds every row
   * ever written (including removed ones), and `members` is the member directory needed to
   * resolve display names without another read.
   */
  function index(entity) {
    var definition = spec(entity);
    return Database.memo('memberships:' + definition.table, function () {
      var members = Object.create(null);
      Database.read('MEMBERS').forEach(function (row) {
        members[String(row.Member_ID)] = row;
      });
      var active = Object.create(null), history = Object.create(null);
      Database.read(definition.table).forEach(function (row) {
        var parentId = text(row[definition.key]), memberId = text(row.Member_ID);
        if (!parentId || !memberId) return;
        var entry = {
          assignmentId: text(row.Assignment_ID),
          memberId: memberId,
          name: text((members[memberId] || {}).Name),
          memberActive: (members[memberId] || {}).Active === true,
          assignedAt: text(row.Assigned_At),
          assignedBy: text(row.Assigned_By),
          removedAt: text(row.Removed_At),
          removedBy: text(row.Removed_By),
          current: !text(row.Removed_At)
        };
        (history[parentId] = history[parentId] || []).push(entry);
        if (entry.current) (active[parentId] = active[parentId] || []).push(entry);
      });
      return {active: active, history: history, members: members};
    });
  }

  function entryDto(entry) {
    return {memberId: entry.memberId, name: entry.name, memberActive: entry.memberActive,
      assignedAt: entry.assignedAt, assignedBy: entry.assignedBy};
  }

  /** Current additional members of one parent record, ordered as stored. */
  function list(entity, parentId) {
    return (index(entity).active[text(parentId)] || []).map(entryDto);
  }

  /** Current identifier-only view, used by the task and responsibility DTO builders. */
  function ids(entity, parentId) {
    return (index(entity).active[text(parentId)] || []).map(function (entry) { return entry.memberId; });
  }

  /**
   * Additional identifiers of one parent row, excluding the primary owner.
   *
   * A relationship row can outlive a primary-owner change (a member who was an additional
   * assignee later becomes the primary owner). The primary column stays authoritative, so the
   * duplicate is filtered out of every derived view and never rewritten behind the manager.
   */
  function additionalIds(entity, parent) {
    if (!parent) return [];
    var definition = spec(entity);
    var parentId = text(parent[Schema.tables[definition.parent].id]);
    var primary = text(parent[definition.primary]);
    return ids(entity, parentId).filter(function (id) { return id !== primary; });
  }

  /** Append-only relationship history of one parent record, newest removal information kept. */
  function history(entity, parentId) {
    return (index(entity).history[text(parentId)] || []).map(function (entry) {
      var dto = entryDto(entry);
      dto.removedAt = entry.removedAt;
      dto.removedBy = entry.removedBy;
      dto.current = entry.current;
      return dto;
    });
  }

  /** Primary plus additional members, resolved in one pass. */
  function effective(entity, parent) {
    if (!parent) return [];
    var definition = spec(entity);
    var parentId = text(parent[Schema.tables[definition.parent].id]);
    var primaryId = text(parent[definition.primary]);
    var members = index(entity).members, out = [], seen = Object.create(null);
    if (primaryId && members[primaryId]) {
      out.push({memberId: primaryId, name: text(members[primaryId].Name), primary: true});
      seen[primaryId] = true;
    }
    ids(entity, parentId).forEach(function (memberId) {
      if (seen[memberId]) return;
      seen[memberId] = true;
      out.push({memberId: memberId, name: text((members[memberId] || {}).Name), primary: false});
    });
    return out;
  }

  /** Display names only; this is the allowlist-safe shape used by lists and publication. */
  function names(entity, parent) {
    return effective(entity, parent).map(function (entry) { return entry.name; })
      .filter(function (name) { return !!name; });
  }

  function isAssigned(entity, parent, memberId) {
    var wanted = text(memberId);
    if (!wanted) return false;
    return effective(entity, parent).some(function (entry) { return entry.memberId === wanted; });
  }

  /**
   * Assignee resolver for the manager task index and the published snapshot: one indexed
   * build, then O(1) lookups per task. The returned list is primary-first and de-duplicated.
   */
  function taskAssignees() {
    var ownerIndex = index('TASK');
    return function (task) {
      var taskId = text(task && task.Task_ID);
      var primaryId = text(task && task.Owner_Member_ID);
      var out = [], seen = Object.create(null);
      if (primaryId && ownerIndex.members[primaryId]) {
        out.push({memberId: primaryId, name: text(ownerIndex.members[primaryId].Name), primary: true});
        seen[primaryId] = true;
      }
      (ownerIndex.active[taskId] || []).forEach(function (entry) {
        if (seen[entry.memberId]) return;
        seen[entry.memberId] = true;
        out.push({memberId: entry.memberId, name: entry.name, primary: false});
      });
      return out;
    };
  }

  /** Display names only; this is the allowlist-safe shape used by lists and publication. */
  function taskNames() {
    var resolve = taskAssignees();
    return function (task) {
      return resolve(task).map(function (entry) { return entry.name; })
        .filter(function (name) { return !!name; });
    };
  }

  /**
   * Normalizes a requested additional-member list.
   *
   * Blank entries are ignored, the primary owner is never duplicated, and a repeated member is
   * refused instead of being silently dropped, so a malformed browser payload is reported.
   */
  function normalize(requested, primaryId) {
    if (requested === undefined || requested === null) return [];
    var values = Array.isArray(requested) ? requested : String(requested).split(',');
    var out = [], seen = Object.create(null), primary = text(primaryId);
    values.forEach(function (value) {
      var id = text(value);
      if (!id) return;
      if (id === primary) return;
      if (seen[id]) fail('同じメンバーが重複しています: ' + id);
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  /** Read-only difference between the stored rows and a requested list. */
  function diff(entity, parentId, requested) {
    var definition = spec(entity);
    var parent = Database.find(definition.parent, parentId);
    var primary = parent ? text(parent[definition.primary]) : '';
    var wanted = normalize(requested, primary);
    var existing = parent ? additionalIds(entity, parent) : ids(entity, parentId);
    return {
      added: wanted.filter(function (id) { return existing.indexOf(id) < 0; }),
      removed: existing.filter(function (id) { return wanted.indexOf(id) < 0; }),
      unchanged: wanted.filter(function (id) { return existing.indexOf(id) >= 0; })
    };
  }

  /**
   * Validates a requested list before anything is written.
   *
   * Only *newly added* members must exist and be active: an existing additional assignee who was
   * deactivated later keeps the relationship, so an unrelated edit cannot fail because of them.
   * Returns the planned difference so the caller can decide whether the approval is invalidated.
   */
  function check(entity, parentId, requested) {
    var change = diff(entity, parentId, requested);
    var members = index(entity).members;
    change.added.forEach(function (id) {
      var member = members[id];
      if (!member) fail('メンバーが見つかりません: ' + id);
      if (member.Active !== true) fail('無効なメンバーは新しく割り当てできません: ' + (text(member.Name) || id));
    });
    return change;
  }

  /**
   * Applies an additional-member list.
   *
   * New assignments must name an existing, active member. An existing relationship is
   * reactivated instead of duplicated, and a removed relationship is kept for history. The
   * caller holds the script lock, and the whole change is recorded once in `AUDIT_LOG`.
   */
  function sync(entity, parentId, requested, actorEmail) {
    var definition = spec(entity);
    var parent = Database.find(definition.parent, parentId);
    if (!parent) fail('記録が見つかりません: ' + parentId);
    var snapshot = index(entity);
    var primary = text(parent[definition.primary]);
    var wanted = normalize(requested, primary);
    var parentKey = text(parentId);
    var current = (snapshot.active[parentKey] || []).filter(function (entry) {
      return entry.memberId !== primary;
    });
    var prior = (snapshot.history[parentKey] || []).slice();
    var currentIds = current.map(function (entry) { return entry.memberId; });
    var added = wanted.filter(function (id) { return currentIds.indexOf(id) < 0; });
    var removed = currentIds.filter(function (id) { return wanted.indexOf(id) < 0; });
    if (!added.length && !removed.length) return {added: [], removed: [], changed: false};
    var actor = text(actorEmail) || AuditLog.actor() || 'system';
    var stamp = Domain.now();
    added.forEach(function (id) {
      var member = snapshot.members[id];
      if (!member) fail('メンバーが見つかりません: ' + id);
      if (member.Active !== true) fail('無効なメンバーは新しく割り当てできません: ' + (text(member.Name) || id));
      var previous = prior.filter(function (entry) { return entry.memberId === id; })[0];
      if (previous && previous.assignmentId) {
        // Re-adding a former member reactivates the existing relationship row.
        Database.update(definition.table, previous.assignmentId,
          {Assigned_At: stamp, Assigned_By: actor, Removed_At: '', Removed_By: ''});
        return;
      }
      var row = {};
      row[definition.key] = parentKey;
      row.Member_ID = id;
      row.Assigned_At = stamp;
      row.Assigned_By = actor;
      row.Removed_At = '';
      row.Removed_By = '';
      Database.insert(definition.table, row);
    });
    removed.forEach(function (id) {
      var entry = current.filter(function (candidate) { return candidate.memberId === id; })[0];
      if (!entry || !entry.assignmentId) return;
      Database.update(definition.table, entry.assignmentId, {Removed_At: stamp, Removed_By: actor});
    });
    AuditLog.write(definition.audit, entity, parentKey,
      {added: added, removed: removed, primary: primary, label: definition.label});
    return {added: added, removed: removed, changed: true};
  }

  return {
    ENTITIES: ENTITIES,
    list: list,
    ids: ids,
    additionalIds: additionalIds,
    history: history,
    effective: effective,
    names: names,
    isAssigned: isAssigned,
    taskAssignees: taskAssignees,
    taskNames: taskNames,
    normalize: normalize,
    diff: diff,
    check: check,
    sync: sync
  };
}());
