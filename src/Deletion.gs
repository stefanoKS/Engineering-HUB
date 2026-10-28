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
 * - an empty dependency preflight,
 * - the exact typed confirmation `DELETE <id>`,
 * - a reason,
 * - a verified backup created in this operation,
 * - the script lock, and
 * - an immutable tombstone (`AUDIT_LOG` → `RECORD_DELETED`).
 *
 * V1.6.1 durable intent: Google Sheets has no transaction, so a removal can be interrupted
 * between the row deletion and the tombstone. The operation now writes
 * `RECORD_DELETE_PREPARED` (with the full row, reason, actor and backup) *before* the row is
 * removed, and reports success only after the tombstone was written. An identifier that was
 * prepared for removal is reserved even when no tombstone exists yet, and
 * `reconcile()` can finalize an interrupted removal - it only ever appends the missing
 * tombstone for a row that is verifiably gone, and never deletes anything itself.
 *
 * Cascading removal is not offered: a mistaken parent record with dependants must be cleared
 * child by child, so every removal is justified on its own. Archive the project instead.
 */
var Deletion = (function () {
  var TABLES = {
    PROJECTS: {key: 'Project_ID', name: 'Project_Name', label: 'プロジェクト', parents: []},
    SUBPROJECTS: {key: 'Subproject_ID', name: 'Subproject_Name', label: 'サブプロジェクト', parents: ['PROJECTS']},
    TASKS: {key: 'Task_ID', name: 'Task_Name', label: 'タスク', parents: ['PROJECTS', 'SUBPROJECTS']}
  };
  var CREATION_ACTIONS = ['CREATE', 'UI_PROJECT_CREATED', 'INITIALIZE'];
  var MAX_REASON = 240;
  var INTENT_ACTION = 'RECORD_DELETE_PREPARED';
  var TOMBSTONE_ACTION = 'RECORD_DELETED';
  var RECONCILE_CONFIRMATION = 'RECONCILE DELETIONS';

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
    // V1.6.1: nested work, confirmations, requests and deadline history all point at a task
    // without a declared schema reference. Removing a task that still owns one of them would
    // orphan an operational record, so they block the removal exactly like a declared one.
    if (table === 'TASKS') {
      refs.push({table: 'SCHEDULE_CONFIRMATIONS', field: 'Task_ID'});
      refs.push({table: 'TASK_REQUESTS', field: 'Task_ID'});
      refs.push({table: 'TASK_DEADLINE_HISTORY', field: 'Task_ID'});
    }
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

  /**
   * Reserved identifier lookup.
   *
   * V1.6.1: a *prepared* removal reserves the identifier too. An interrupted removal must
   * never let the same ID come back as a different record, whether or not the tombstone was
   * written yet.
   */
  function isDeletedId(table, id) {
    return Database.read('AUDIT_LOG').some(function (row) {
      var action = text(row.Action);
      if (action !== TOMBSTONE_ACTION && action !== INTENT_ACTION) return false;
      return text(row.Entity_Type) === table && text(row.Entity_ID) === text(id);
    });
  }

  function assertFreshId(table, id) {
    if (!id) return true;
    if (isDeletedId(table, id)) fail('削除済みのIDは再利用できません: ' + id);
    return true;
  }

  function snapshotOf(table, record) {
    var snapshot = {};
    Schema.tables[table].fields.forEach(function (field) {
      var value = record[field.name];
      snapshot[field.name] = value === undefined || value === null ? '' : value;
    });
    return snapshot;
  }

  function detail(row) {
    try {
      var parsed = JSON.parse(text(row.New_Value) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  /**
   * Removals that were prepared but never confirmed by a tombstone.
   *
   * This is a read-only report. It is the recovery entry point for an execution that stopped
   * between the row deletion and the tombstone write.
   */
  function pendingOperations() {
    var prepared = Object.create(null), order = [];
    Database.read('AUDIT_LOG').forEach(function (row) {
      var action = text(row.Action), key = text(row.Entity_Type) + '\u0000' + text(row.Entity_ID);
      if (action === INTENT_ACTION) {
        if (!prepared[key]) { prepared[key] = {table: text(row.Entity_Type), id: text(row.Entity_ID), at: '', actor: '', reason: '', backup: ''}; }
        if (order.indexOf(key) < 0) order.push(key);
        var info = detail(row);
        prepared[key].at = String(row.Timestamp || '');
        prepared[key].actor = text(row.Actor);
        prepared[key].reason = text(info.reason);
        prepared[key].backup = text(info.backup);
      } else if (action === TOMBSTONE_ACTION) {
        delete prepared[key];
      }
    });
    return order.filter(function (key) { return prepared[key]; }).map(function (key) { return prepared[key]; });
  }

  /**
   * Finalizes an interrupted removal.
   *
   * Only the missing tombstone is appended, and only for an identifier whose row is verified
   * to be gone. A row that still exists is reported back and left untouched: this function
   * never deletes data.
   */
  function reconcile(confirmation) {
    var admin = Access.requireAdmin();
    if (text(confirmation) !== RECONCILE_CONFIRMATION) {
      throw new Error('削除記録の確定には「' + RECONCILE_CONFIRMATION + '」の入力が必要です');
    }
    return Database.withLock(function () {
      var pending = pendingOperations(), confirmed = [], present = [], failed = [];
      pending.forEach(function (item) {
        if (!TABLES[item.table]) { failed.push({table: item.table, id: item.id, reason: 'UNKNOWN_TABLE'}); return; }
        if (Database.find(item.table, item.id)) { present.push({table: item.table, id: item.id}); return; }
        try {
          AuditLog.write(TOMBSTONE_ACTION, item.table, item.id, {
            reason: item.reason || 'reconciled', actor: admin.email, backup: item.backup,
            reconciled: true, preparedAt: item.at
          });
          confirmed.push({table: item.table, id: item.id});
        } catch (error) {
          failed.push({table: item.table, id: item.id, reason: String(error && error.message || error)});
        }
      });
      if (confirmed.length || present.length || failed.length) {
        AuditLog.write('DELETION_RECONCILED', 'AUDIT_LOG', '', {
          actor: admin.email, confirmed: confirmed.length, present: present.length, failed: failed.length
        });
      }
      return {confirmed: confirmed, rowPresent: present, failed: failed, pending: pending.length};
    });
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

  /**
   * Removes one record permanently.
   *
   * Order matters: preflight → backup → durable intent → row removal → tombstone. Success is
   * reported only when the tombstone exists; a tombstone failure raises an explicit
   * reconciliation error instead of returning a success that never happened.
   *
   * @param {string} table PROJECTS / SUBPROJECTS / TASKS
   * @param {string} id stable identifier
   * @param {object} options {reason, confirmation}
   */
  function remove(table, id, options) {
    options = options || {};
    var admin = Access.requireAdmin();
    var definition = spec(table);
    var reason = text(options.reason).slice(0, MAX_REASON);
    if (!reason) fail('削除には理由が必要です');
    if (text(options.confirmation) !== 'DELETE ' + text(id)) fail('削除には「DELETE ' + text(id) + '」の入力が必要です');
    if (options.cascade === true) {
      fail('依存関係のある記録は一括削除できません。子の記録を個別に削除してから実行するか、アーカイブしてください');
    }
    return Database.withLock(function () {
      var summary = preflight(table, id);
      if (!summary.deletable) {
        fail('安全に削除できません。依存関係を解消するかアーカイブしてください: ' +
          summary.blocking.map(function (item) { return item.code; }).join(', '));
      }
      var record = Database.find(table, id);
      var reference = Backup.create();
      var snapshot = snapshotOf(table, record);
      // The intent is written *before* the destructive step. If it cannot be recorded, the
      // removal is aborted while the data is still intact.
      try {
        AuditLog.write(INTENT_ACTION, table, text(id), {
          reason: reason, actor: admin.email, backup: reference, record: snapshot
        });
      } catch (error) {
        fail('削除の準備記録を書き込めないため中止しました（データは変更されていません）: ' + String(error && error.message || error));
      }
      removeRow(table, id);
      try {
        AuditLog.write(TOMBSTONE_ACTION, table, text(id), {
          reason: reason, actor: admin.email, backup: reference, record: snapshot
        });
      } catch (error) {
        // The row is gone; the identifier is already reserved by the intent row. The manager
        // must finish the record with the reconciliation entry point, never a retry here.
        throw new Error('レコードは削除されましたが、削除記録の確定に失敗しました。reconcileDeletions で確定してください: ' +
          String(error && error.message || error));
      }
      return {deleted: true, finalized: true, table: table, id: text(id), removed: 1, backup: reference,
        // The committed employee snapshot must be republished by a manager before it shows
        // the removal; publication is never triggered from a deletion.
        needsPublication: true};
    });
  }

  return {
    TABLES: TABLES,
    INTENT_ACTION: INTENT_ACTION,
    TOMBSTONE_ACTION: TOMBSTONE_ACTION,
    RECONCILE_CONFIRMATION: RECONCILE_CONFIRMATION,
    preflight: preflight,
    remove: remove,
    reconcile: reconcile,
    pendingOperations: pendingOperations,
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
function reconcileDeletions(confirmation) {
  Access.requireAdmin();
  return Deletion.reconcile(confirmation);
}
