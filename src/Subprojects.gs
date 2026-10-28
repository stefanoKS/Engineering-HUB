/**
 * Project > subproject > nested subproject > task.
 *
 * The hierarchy is bounded: at most four subproject levels beneath a project
 * (V1.6; the pre-V1.6 limit of two is kept as a historical fact in the checkgates).
 * A blank Parent_Subproject_ID is a root subproject, so every pre-V1.4 row keeps its
 * meaning and existing two-level data stays valid.
 * Reparenting validates the whole affected subtree instead of silently flattening it.
 *
 * Archiving a subproject never touches its children or tasks: the eligibility rules
 * decide whether archived work still contributes to active-work calculations.
 */
var Subprojects = (function () {
  var MAX_DEPTH = 4;
  // Kept for older call sites; the supported limit is MAX_DEPTH.
  var MAX_LEVEL = MAX_DEPTH;

  function fail(message) { Domain.fail(message); }

  function parentOf(row) { return String(row.Parent_Subproject_ID || ''); }

  function parentMap(rows) {
    var map = Object.create(null);
    (rows || Database.read('SUBPROJECTS')).forEach(function (row) {
      map[row.Subproject_ID] = parentOf(row);
    });
    return map;
  }

  function childrenMap(rows) {
    var map = Object.create(null);
    (rows || Database.read('SUBPROJECTS')).forEach(function (row) {
      var parent = parentOf(row);
      if (!parent) return;
      if (!map[parent]) map[parent] = [];
      map[parent].push(row.Subproject_ID);
    });
    return map;
  }

  /** 1 = root subproject, 2 = nested subproject. Throws on a cycle. */
  function levelOf(id, parents) {
    var level = 1, seen = Object.create(null), cursor = id;
    while (parents[cursor]) {
      if (seen[cursor] || level > 10) throw new Error('サブプロジェクトの階層が循環しています');
      seen[cursor] = true;
      cursor = parents[cursor];
      level++;
    }
    return level;
  }

  /**
   * Deepest nesting below a node; 0 means the node has no children.
   *
   * The walk is path-bounded: malformed data that forms a cycle raises the documented error
   * instead of recursing forever.
   */
  function heightOf(id, children, trail) {
    var path = trail || Object.create(null);
    if (path[id]) throw new Error('サブプロジェクトの階層が循環しています');
    path[id] = true;
    var kids = children[id] || [];
    var deepest = 0;
    kids.forEach(function (kid) { deepest = Math.max(deepest, heightOf(kid, children, path)); });
    delete path[id];
    return kids.length ? deepest + 1 : 0;
  }

  function descendants(id, rows) {
    var children = childrenMap(rows);
    var out = [], seen = Object.create(null);
    (function walk(node) {
      (children[node] || []).forEach(function (kid) {
        if (seen[kid]) return;
        seen[kid] = true;
        out.push(kid);
        walk(kid);
      });
    }(id));
    return out;
  }

  function hasDescendants(id) { return descendants(id).length > 0; }

  /**
   * True when the node or any ancestor is archived.
   *
   * Used for explicit operations such as a task move, so work is never placed inside an
   * archived branch by accident. A cycle or an over-long chain is treated as unsafe, which
   * keeps malformed data from looping.
   */
  function archivedChain(subprojectId, index) {
    var rows = index;
    if (!rows) {
      rows = Object.create(null);
      Database.read('SUBPROJECTS').forEach(function (row) { rows[String(row.Subproject_ID)] = row; });
    }
    var cursor = String(subprojectId === undefined || subprojectId === null ? '' : subprojectId);
    var seen = Object.create(null), guard = 0;
    while (cursor) {
      var node = rows[cursor];
      if (!node) return false;
      if (seen[cursor]) return true;
      seen[cursor] = true;
      if (node.Status === 'Archived') return true;
      cursor = String(node.Parent_Subproject_ID || '');
      if (guard++ > 10) return true;
    }
    return false;
  }

  /**
   * Validates the hierarchy for a candidate row. The stored parent of the row being
   * written is replaced by the candidate value first, so a reparent is checked before
   * anything is saved and the whole affected subtree is considered.
   */
  function validateHierarchy(row) {
    var rows = Database.read('SUBPROJECTS');
    var parents = parentMap(rows);
    var children = childrenMap(rows);
    var id = row.Subproject_ID;
    var parentId = parentOf(row);

    if (parentId && parentId === id) fail('サブプロジェクトを自身の親にはできません');

    if (parentId) {
      var parent = null;
      rows.forEach(function (item) { if (item.Subproject_ID === parentId) parent = item; });
      if (!parent) fail('親サブプロジェクトが見つかりません: ' + parentId);
      if (String(parent.Project_ID) !== String(row.Project_ID)) {
        fail('親と子のサブプロジェクトは同じプロジェクトに属している必要があります');
      }
    }

    var simulated = Object.create(null);
    Object.keys(parents).forEach(function (key) { simulated[key] = parents[key]; });
    if (id) simulated[id] = parentId;
    else simulated.__new__ = parentId;
    var level = levelOf(id || '__new__', simulated);
    var height = id ? heightOf(id, children) : 0;
    if (level + height > MAX_DEPTH) fail('サブプロジェクトの階層は' + MAX_DEPTH + '階層までです');
    return {level: level, height: height};
  }

  function validate(row, before) {
    Domain.required('PROJECTS', row.Project_ID);
    Domain.dates(row);
    if (row.Owner_ID) Domain.required('MEMBERS', row.Owner_ID);
    if (before && before.Project_ID !== row.Project_ID) {
      ['TASKS', 'ISSUES', 'MILESTONES'].forEach(function (table) {
        if (Database.read(table).some(function (child) { return child.Subproject_ID === row.Subproject_ID; })) {
          fail('紐づくレコードがあるサブプロジェクトは移動できません');
        }
      });
      if (parentOf(row)) fail('他のプロジェクトへ移動するサブプロジェクトはルート階層にしてください');
    }
    validateHierarchy(row);
  }

  function confirmed(options) { return !!options && options.confirmed === true; }

  return {
    MAX_DEPTH: MAX_DEPTH,
    MAX_LEVEL: MAX_DEPTH,
    levelOf: levelOf,
    heightOf: heightOf,
    descendants: descendants,
    hasDescendants: hasDescendants,
    archivedChain: archivedChain,
    parentMap: parentMap,
    childrenMap: childrenMap,
    validateHierarchy: validateHierarchy,

    create: function (data) {
      return Domain.save('SUBPROJECTS', null,
        Object.assign({ Status: 'Planned', Parent_Subproject_ID: '', Last_Updated: Domain.now() }, data),
        validate, null, function (row) { Projects.touch(row.Project_ID); });
    },

    update: function (id, patch) {
      return Domain.save('SUBPROJECTS', id, Object.assign({ Last_Updated: Domain.now() }, patch), validate, null,
        function (row, before) {
          if (before && before.Project_ID !== row.Project_ID) Projects.touch(before.Project_ID);
          Projects.touch(row.Project_ID);
        });
    },

    /** Reparenting is a separate, audited operation that changes only Parent_Subproject_ID. */
    reparent: function (id, parentId, options) {
      var row = Domain.required('SUBPROJECTS', id);
      var target = String(parentId === undefined || parentId === null ? '' : parentId).trim();
      if (target === parentOf(row)) return row;
      if (!confirmed(options)) fail('階層の変更には確認が必要です');
      var previous = parentOf(row);
      var result = Domain.save('SUBPROJECTS', id, {Parent_Subproject_ID: target, Last_Updated: Domain.now()},
        validate, 'REPARENT', function (updated) { Projects.touch(updated.Project_ID); });
      AuditLog.write('SUBPROJECT_REPARENTED', 'SUBPROJECT', id, {previousParent: previous, newParent: target});
      return result;
    },

    archive: function (id) {
      return Domain.save('SUBPROJECTS', id, {Status: 'Archived', Last_Updated: Domain.now()}, validate, 'ARCHIVE');
    },

    reactivate: function (id) {
      var row = Domain.required('SUBPROJECTS', id);
      if (row.Status !== 'Archived') fail('アーカイブされたサブプロジェクトのみ再開できます');
      return Domain.save('SUBPROJECTS', id, {Status: 'Active', Last_Updated: Domain.now()}, validate, 'REACTIVATE');
    },

    /**
     * Explicitly moves one task to another node of the same project.
     *
     * Nothing else is rewritten: the task keeps its owner, dates, duration, progress,
     * assignment version, approvals and request history.
     */
    moveTask: function (taskId, subprojectId, options) {
      var current = Access.requireManager();
      var task = Access.requireTaskWrite(taskId, current.email).task;
      var target = String(subprojectId === undefined || subprojectId === null ? '' : subprojectId).trim();
      if (target) {
        var destination = Domain.required('SUBPROJECTS', target);
        if (String(destination.Project_ID) !== String(task.Project_ID)) {
          fail('タスクは同じプロジェクト内でのみ移動できます');
        }
        // The whole ancestor chain matters: a child of an archived parent is archived too.
        if (archivedChain(target)) fail('アーカイブされたサブプロジェクトへは移動できません');
      }
      if (target === String(task.Subproject_ID || '')) return task;
      if (!confirmed(options)) fail('タスクの移動には確認が必要です');
      var updated = Tasks.update(taskId, {Subproject_ID: target});
      AuditLog.write('TASK_MOVED', 'TASK', taskId,
        {previousSubproject: String(task.Subproject_ID || ''), newSubproject: target});
      return updated;
    }
  };
})();
/* Global entrypoints re-check the verified role before any hierarchy write. */
function createSubproject(data) {
  Access.requireManager();
  return Subprojects.create(data);
}
function updateSubproject(id, patch) {
  Access.requireSubprojectWrite(id);
  return Subprojects.update(id, patch);
}
function reparentSubproject(id, parentId, options) {
  Access.requireSubprojectWrite(id);
  return Subprojects.reparent(id, parentId, options);
}
function archiveSubproject(id) {
  Access.requireSubprojectWrite(id);
  return Subprojects.archive(id);
}
function reactivateSubproject(id) {
  Access.requireSubprojectWrite(id);
  return Subprojects.reactivate(id);
}
function moveTaskToSubproject(taskId, subprojectId, options) {
  return Subprojects.moveTask(taskId, subprojectId, options);
}