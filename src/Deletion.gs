/**
 * Narrow, ADMIN-only removal of mistaken records (V1.6).
 *
 * V1.6 deliberately introduces one exception to the older "never delete operational data"
 * rule (see AGENTS.md rule 78): a freshly created project, subproject or task that was
 * entered by mistake may be removed permanently, but only when it carries no meaningful
 * operational history and no side effect anywhere else.
 *
 * The default stays non-destructive: archive. Permanent deletion requires
 * - ADMIN authorization,
 * - an empty dependency preflight (or a cascade whose every descendant passes the same
 *   checks on its own),
 * - the exact typed confirmation `DELETE <id>`,
 * - a reason,
 * - a verified backup created in this operation,
 * - the script lock, and
 * - an immutable tombstone (`AUDIT_LOG` → `RECORD_DELETED`).
 *
 * Creation-only audit rows may remain as evidence that the identifier once existed.
 * Google Sheets has no multi-row transaction, so the row is removed first and the
 * tombstone written afterwards; a tombstone failure is reported, never hidden.
 */
var Deletion = (function () {
  var TABLES = {
    PROJECTS: {key: 'Project_ID', name: 'Project_Name', label: 'プロジェクト', parents: []},
    SUBPROJECTS: {key: 'Subproject_ID', name: 'Subproject_Name', label: 'サブプロジェクト', parents: ['PROJECTS']},
    TASKS: {key: 'Task_ID', name: 'Task_Name', label: 'タスク', parents: ['PROJECTS', 'SUBPROJECTS']}
  };
  var CREATION_ACTIONS = ['CREATE', 'UI_PROJECT_CREATED', 'INITIALIZE'];
  var MAX_REASON = 240;

  function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }

  function fail(message) { Domain.fail(message); }

  function spec(table) {
    if (!TABLES[table]) fail('このテーブルは削除の対象外です: ' + table);
    return TABLES[table];
  }

  /** Every declared reference to `table` anywhere in the schema, plus the undeclared ones. */
  function referencingTables(table) {
    var refs = [];
    Object.keys(Schema.tables).forEach(function (name) {
      Schema.tables[name].fields.forEach(function (field) {
        if (field.ref === table) refs.push({table: name, field: field.name});
      });
    });
    // Notification history carries a Task_ID without a declared reference.
    if (table === 'TASKS') refs.push({table: 'NOTIFICATION_LOG', field: 'Task_ID'});
    return refs;
  }

  function auditHistory(table, id) {
    return Database.read('AUDIT_LOG').filter(function (row) {
      return text(row.Entity_Type) === table && text(row.Entity_ID) === id;
    });
  }

  /**
   * Read-only dependency summary. Every entry is a reason the record may not be removed
   * permanently; an empty list means the record is a safe mistaken entry.
   */
  function preflight(table, id) {
    var definition = spec(table);
    var record = Database.find(table, id);
    if (!record) fail('記録が見つかりません: ' + id);
    var blocking = [];
    referencingTables(table).forEach(function (reference) {
      if (reference.table === table && reference.field === definition.key) return;
      var matches = Database.read(reference.table).filter(function (row) {
        return text(row[reference.field]) === text(id);
      });
      if (matches.length) {
        blocking.push({code: 'REFERENCE', table: reference.table, field: reference.field,
          count: matches.length, ids: matches.map(function (row) { return row[Schema.tables[reference.table].id]; })});
      }
    });
    if (table === 'TASKS') {
      // Dependencies are a comma separated list, so a dangling one would be invisible otherwise.
      var dependents = Database.read('TASKS').filter(function (row) {
        return String(row.Dependency_IDs || '').split(',').map(text).indexOf(text(id)) >= 0;
      });
      if (dependents.length) {
        blocking.push({code: 'REFERENCE', table: 'TASKS', field: 'Dependency_IDs', count: dependents.length,
          ids: dependents.map(function (row) { return row.Task_ID; })});
      }
    }
    var history = auditHistory(table, id);
    var learned = history.filter(function (row) { return CREATION_ACTIONS.indexOf(text(row.Action)) < 0; });
    if (learned.length) blocking.push({code: 'AUDIT_HISTORY', count: learned.length});
    if (table === 'TASKS') {
      if (Number(record.Actual_Hours) > 0) blocking.push({code: 'RECORDED_EFFORT', count: 1});
      if (Number(record.Progress_Percent) > 0) blocking.push({code: 'RECORDED_PROGRESS', count: 1});
      if (text(record.Status) === 'Done' || text(record.Completed_At)) blocking.push({code: 'COMPLETED_WORK', count: 1});
      if (text(record.Assignment_Approved_At)) blocking.push({code: 'ASSIGNMENT_APPROVED', count: 1});
      if (text(record.Deleted_At)) blocking.push({code: 'ALREADY_DELETED', count: 1});
    }
    if (table === 'PROJECTS') {
      if (text(record.Status) === 'Archived') blocking.push({code: 'ARCHIVED_RECORD', count: 1});
      if (text(record.Dashboard_Visibility) === 'INTERNAL') blocking.push({code: 'PUBLISHED_VISIBILITY', count: 1});
    }
    return {
      table: table, id: text(id), label: definition.label,
      name: text(record[definition.name]),
      blocked: blocking.length > 0,
      blocking: blocking,
      deletable: blocking.length === 0
    };
  }

  /** Blocking entries that still matter when `removing` (a set of IDs) is deleted together. */
  function blockingOutside(blocking, removing) {
    return (blocking || []).filter(function (item) {
      if (item.code !== 'REFERENCE' || !item.ids) return true;
      return item.ids.some(function (id) { return !removing[String(id)]; });
    });
  }

  /** Immutable tombstone lookup: an identifier that was removed may never be reused. */
  function isDeletedId(table, id) {
    return Database.read('AUDIT_LOG').some(function (row) {
      return text(row.Action) === 'RECORD_DELETED' && text(row.Entity_Type) === table && text(row.Entity_ID) === text(id);
    });
  }

  function assertFreshId(table, id) {
    if (!id) return true;
    if (isDeletedId(table, id)) fail('削除済みのIDは再利用できません: ' + id);
    return true;
  }

  /** Physical row removal. The ID column must still match so a shifted sheet is never hit. */
  function removeRow(table, id) {
    var definition = spec(table);
    var sheet = Database.book().getSheetByName(table);
    if (!sheet) fail('シートが見つかりません: ' + table);
    var values = sheet.getDataRange().getValues();
    var headers = values[0] || [];
    var idColumn = headers.indexOf(definition.key);
    if (idColumn < 0) fail('ID 列が見つかりません: ' + table);
    var index = -1;
    for (var row = 1; row < values.length; row++) {
      if (text(values[row][idColumn]) === text(id)) { index = row; break; }
    }
    if (index < 0) fail('記録が見つかりません: ' + id);
    sheet.deleteRow(index + 1);
    return true;
  }

  /** Descendants in deepest-first order, so a cascade never orphans a child. */
  function descendants(table, id) {
    if (table === 'PROJECTS') {
      var parents = Subprojects.parentMap();
      var taskIndex = TaskTree.buildIndex(Database.read('TASKS'));
      var subprojects = Database.read('SUBPROJECTS').filter(function (row) { return text(row.Project_ID) === text(id); })
        .map(function (row) { return {table: 'SUBPROJECTS', id: row.Subproject_ID, depth: Subprojects.levelOf(row.Subproject_ID, parents)}; })
        .sort(function (a, b) { return b.depth - a.depth; });
      var tasks = Database.read('TASKS').filter(function (row) { return text(row.Project_ID) === text(id); })
        .map(function (row) { return {table: 'TASKS', id: row.Task_ID, depth: TaskTree.levelOf(row.Task_ID, taskIndex)}; })
        .sort(function (a, b) { return b.depth - a.depth; });
      return subprojects.concat(tasks);
    }
    if (table === 'SUBPROJECTS') {
      var map = Subprojects.parentMap();
      var nested = Subprojects.descendants(id).map(function (childId) {
        return {table: 'SUBPROJECTS', id: childId, depth: Subprojects.levelOf(childId, map)};
      }).sort(function (a, b) { return b.depth - a.depth; });
      var owned = Database.read('TASKS').filter(function (row) { return text(row.Subproject_ID) === text(id); })
        .map(function (row) { return {table: 'TASKS', id: row.Task_ID, depth: 99}; });
      return nested.concat(owned);
    }
    var index = TaskTree.buildIndex(Database.read('TASKS'));
    function collect(taskId) {
      var out = [];
      (index.children[text(taskId)] || []).forEach(function (childId) {
        out = out.concat(collect(childId));
        out.push({table: 'TASKS', id: childId, depth: TaskTree.levelOf(childId, index)});
      });
      return out;
    }
    return collect(id).sort(function (a, b) { return b.depth - a.depth; });
  }

  /**
   * Removes one record permanently.
   *
   * @param {string} table PROJECTS / SUBPROJECTS / TASKS
   * @param {string} id stable identifier
   * @param {object} options {reason, confirmation, cascade}
   */
  function remove(table, id, options) {
    options = options || {};
    var admin = Access.requireAdmin();
    var definition = spec(table);
    var reason = text(options.reason).slice(0, MAX_REASON);
    if (!reason) fail('削除には理由が必要です');
    if (text(options.confirmation) !== 'DELETE ' + text(id)) fail('削除には「DELETE ' + text(id) + '」の入力が必要です');
    return Database.withLock(function () {
      var summary = preflight(table, id);
      var queue = descendants(table, id);
      var removing = Object.create(null);
      removing[text(id)] = true;
      queue.forEach(function (child) { removing[text(child.id)] = true; });
      if (!summary.deletable) {
        if (options.cascade !== true) {
          fail('安全に削除できません。依存関係を解消するかアーカイブしてください: ' +
            summary.blocking.map(function (item) { return item.code; }).join(', '));
        }
        // Cascading only removes references between records that all disappear together; any
        // remaining history on the root or on a descendant still refuses the whole operation.
        var rootBlocking = blockingOutside(summary.blocking, removing);
        if (rootBlocking.length) {
          fail('安全に削除できません。依存関係を解消するかアーカイブしてください: ' +
            rootBlocking.map(function (item) { return item.code; }).join(', '));
        }
        queue.forEach(function (child) {
          var childSummary = preflight(child.table, child.id);
          var childBlocking = blockingOutside(childSummary.blocking, removing);
          if (childBlocking.length) {
            fail('子孫レコードに履歴があるため削除できません: ' + child.table + ' ' + child.id + ' (' +
              childBlocking.map(function (item) { return item.code; }).join(', ') + ')');
          }
        });
      }
      var reference = Backup.create();
      queue.concat([{table: table, id: text(id), depth: 0}]).forEach(function (item) {
        var record = Database.find(item.table, item.id);
        var snapshot = {};
        Schema.tables[item.table].fields.forEach(function (field) {
          var value = record[field.name];
          snapshot[field.name] = value === undefined || value === null ? '' : value;
        });
        removeRow(item.table, item.id);
        try {
          AuditLog.write('RECORD_DELETED', item.table, item.id, {
            reason: reason, actor: admin.email, backup: reference, record: snapshot
          });
        } catch (error) {
          console.error('Tombstone write failed for ' + item.table + ' ' + item.id + ': ' + error.message);
        }
      });
      return {deleted: true, table: table, id: text(id), removed: queue.length + 1, backup: reference,
        // The committed employee snapshot must be republished by a manager before it shows
        // the removal; publication is never triggered from a deletion.
        needsPublication: true};
    });
  }

  return {
    TABLES: TABLES,
    preflight: preflight,
    remove: remove,
    isDeletedId: isDeletedId,
    assertFreshId: assertFreshId
  };
}());
function preflightRecordDeletion(table, id) {
  Access.requireAdmin();
  return Deletion.preflight(table, id);
}
function deleteRecord(table, id, options) {
  Access.requireAdmin();
  return Deletion.remove(table, id, options);
}
