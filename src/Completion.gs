/**
 * Task completion lifecycle (V1.6).
 *
 *   ASSIGNED / IN PROGRESS
 *        -> employee reports completion   (dashboard request inbox)
 *        -> PENDING MANAGER REVIEW        (TASK_REQUESTS, COMPLETION_REPORT)
 *        -> APPROVED  = Done / 100 %      (Requests.decide -> withApproval)
 *        -> RETURNED / REJECTED           (task keeps its previous state)
 *
 * The rule lives here, in one place, because five entrypoints used to be able to mark a
 * task done directly: Tasks.complete, Tasks.update, Ui.updateProgress, Ui.assignTask and
 * the manager web task form. Each of them now reaches this guard, so no ordinary edit and
 * no browser payload can bypass the review.
 *
 * Only these paths may write `Status = Done`:
 * - a manager decision on a completion report (Requests.decide),
 * - an ADMIN data-correction override with a reason and immutable audit evidence.
 *
 * Pre-existing completed rows are legacy records: reading or editing them is unchanged.
 */
var Completion = (function () {
  var DONE = 'Done';
  var APPROVAL_CONFIRMATION = 'OVERRIDE COMPLETION';
  var RECONCILE_CONFIRMATION = 'RECONCILE COMPLETIONS';
  var REASON_MAX = 240;
  // V1.6.2 append-only override journal in AUDIT_LOG. The task mutation cannot be made atomic
  // with its audit record, so the intent is written first and the final record carries the
  // same Operation_ID; reconciliation appends exactly the missing final record.
  var PREPARED_ACTION = 'COMPLETION_OVERRIDE_PREPARED';
  var FINAL_ACTION = 'COMPLETION_OVERRIDDEN';
  var RECONCILED_ACTION = 'COMPLETION_OVERRIDE_RECONCILED';

  // Execution-local flag. Apps Script runs one request per execution, so nothing leaks
  // between users; the script lock still serializes the actual write.
  var approvalDepth = 0;

  function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }

  function message(error) { return String(error && error.message ? error.message : error); }

  function fail(message) { Domain.fail(message); }

  function detail(row) {
    try {
      var parsed = JSON.parse(text(row.New_Value) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) { return {}; }
  }

  function withApproval(action) {
    approvalDepth++;
    try { return action(); } finally { approvalDepth--; }
  }

  function inApproval() { return approvalDepth > 0; }

  /**
   * Refuses any transition into Done that did not come from the approval or override path.
   * An unchanged Done row (a legacy record or a second save of an approved task) is allowed.
   */
  function guard(candidate, before) {
    if (!candidate || text(candidate.Status) !== DONE) return true;
    if (!before) fail('新規タスクを完了状態で作成することはできません。作業完了の報告と管理者承認で確定します');
    if (text(before.Status) === DONE) return true;
    if (inApproval()) return true;
    fail('タスクを完了にするには、作業者の完了報告と管理者の承認が必要です');
    return false;
  }

  /** True when the row is already Done without an approval record: a legacy completion. */
  function isLegacyCompletion(task) {
    if (!task || text(task.Status) !== DONE) return false;
    return Database.read('TASK_REQUESTS').every(function (request) {
      return !(text(request.Task_ID) === text(task.Task_ID) &&
        text(request.Request_Type) === 'COMPLETION_REPORT' && text(request.Status) === 'APPROVED');
    });
  }

  /** Open completion reports keyed by task ID; published as a state, never as request text. */
  function pendingByTask() { return Requests.pendingCompletionStates(); }

  /** Public per-task review state: '' | 'PENDING' | 'STALE'. */
  function reviewState(taskId, pending) {
    var index = pending || pendingByTask();
    return index[text(taskId)] || '';
  }

  /**
   * ADMIN-only data correction. It is deliberately distinct from the employee/manager
   * workflow: an exact confirmation, a required reason and its own audit action record it.
   *
   * V1.6.2: the durable preparation is written *before* the mutation. If it cannot be written
   * the correction is aborted while the task is still intact; if the final record cannot be
   * written the caller is told that `reconcileCompletionOverrides` must finish the record
   * instead of being shown a success that was never audited.
   */
  function override(taskId, reason, confirmation) {
    var admin = Access.requireAdmin();
    if (text(confirmation) !== APPROVAL_CONFIRMATION) fail('完了の直接修正には「' + APPROVAL_CONFIRMATION + '」の確認入力が必要です');
    var note = text(reason).slice(0, REASON_MAX);
    if (!note) fail('完了の直接修正には理由が必要です');
    return Database.withLock(function () {
      var task = Domain.required('TASKS', text(taskId));
      if (text(task.Status) === DONE && Number(task.Progress_Percent) === 100) return task;
      var operationId = Utilities.getUuid();
      try {
        AuditLog.write(PREPARED_ACTION, 'TASK', task.Task_ID, {
          operationId: operationId, actor: admin.email, reason: note,
          previousStatus: text(task.Status), previousProgress: Number(task.Progress_Percent)
        });
      } catch (error) {
        fail('完了の直接修正の準備記録を書き込めないため中止しました（タスクは変更されていません）: ' + message(error));
      }
      var updated = withApproval(function () {
        return Tasks.update(task.Task_ID, {Status: DONE, Progress_Percent: 100});
      });
      try {
        AuditLog.write(FINAL_ACTION, 'TASK', task.Task_ID, {
          operationId: operationId, actor: admin.email, reason: note,
          previousStatus: text(task.Status), previousProgress: Number(task.Progress_Percent)
        });
      } catch (error) {
        throw new Error('タスクは完了に更新されましたが、修正記録の確定に失敗しました。' +
          'reconcileCompletionOverrides で確定してください: ' + message(error));
      }
      return updated;
    });
  }

  /**
   * Override preparations whose final record was never written.
   *
   * Read-only. This is the recovery entry point for an execution that stopped between the
   * task update and the final audit record.
   */
  function pendingOperations() {
    var prepared = Object.create(null), order = [];
    Database.read('AUDIT_LOG').forEach(function (row) {
      if (text(row.Entity_Type) !== 'TASK') return;
      var action = text(row.Action);
      if (action !== PREPARED_ACTION && action !== FINAL_ACTION) return;
      var info = detail(row), operationId = text(info.operationId);
      if (!operationId) return;
      if (action === FINAL_ACTION) { delete prepared[operationId]; return; }
      if (!prepared[operationId]) {
        prepared[operationId] = {
          operationId: operationId, taskId: text(row.Entity_ID), at: String(row.Timestamp || ''),
          actor: text(info.actor) || text(row.Actor), reason: text(info.reason),
          previousStatus: text(info.previousStatus)
        };
        order.push(operationId);
      }
    });
    return order.filter(function (id) { return prepared[id]; }).map(function (id) { return prepared[id]; });
  }

  /** Appends only the missing final record, and only for a task verified as Done / 100 %. */
  function reconcileOverrides(confirmation) {
    var admin = Access.requireAdmin();
    if (text(confirmation) !== RECONCILE_CONFIRMATION) {
      throw new Error('完了修正記録の確定には「' + RECONCILE_CONFIRMATION + '」の入力が必要です');
    }
    return Database.withLock(function () {
      var pending = pendingOperations(), confirmed = [], notDone = [], failed = [];
      pending.forEach(function (item) {
        var task = Database.find('TASKS', item.taskId);
        if (!task) { failed.push({taskId: item.taskId, reason: 'TASK_NOT_FOUND'}); return; }
        if (text(task.Status) !== DONE || Number(task.Progress_Percent) !== 100) {
          notDone.push({taskId: item.taskId, status: text(task.Status)});
          return;
        }
        try {
          AuditLog.write(FINAL_ACTION, 'TASK', item.taskId, {
            operationId: item.operationId, actor: item.actor || admin.email, reason: item.reason || 'reconciled',
            previousStatus: item.previousStatus, preparedAt: item.at, reconciled: true, reconciledBy: admin.email
          });
          confirmed.push({taskId: item.taskId, operationId: item.operationId});
        } catch (error) {
          failed.push({taskId: item.taskId, reason: message(error)});
        }
      });
      var summaryRecorded = true;
      if (confirmed.length || notDone.length || failed.length) {
        try {
          AuditLog.write(RECONCILED_ACTION, 'AUDIT_LOG', '', {
            actor: admin.email, confirmed: confirmed.length, notDone: notDone.length, failed: failed.length
          });
        } catch (error) { summaryRecorded = false; }
      }
      return {confirmed: confirmed, notDone: notDone, failed: failed, pending: pending.length,
        summaryRecorded: summaryRecorded};
    });
  }

  return {
    APPROVAL_CONFIRMATION: APPROVAL_CONFIRMATION,
    RECONCILE_CONFIRMATION: RECONCILE_CONFIRMATION,
    FINAL_ACTION: FINAL_ACTION,
    guard: guard,
    withApproval: withApproval,
    inApproval: inApproval,
    isLegacyCompletion: isLegacyCompletion,
    pendingByTask: pendingByTask,
    reviewState: reviewState,
    override: override,
    pendingOperations: pendingOperations,
    reconcileOverrides: reconcileOverrides
  };
}());
function overrideTaskCompletion(taskId, reason, confirmation) {
  Access.requireAdmin();
  return Completion.override(taskId, reason, confirmation);
}
/* V1.6.2 recovery entry points: read-only preview and idempotent finalization. */
function previewCompletionOverrideReconciliation() {
  Access.requireAdmin();
  return {pending: Completion.pendingOperations()};
}
function reconcileCompletionOverrides(confirmation) {
  Access.requireAdmin();
  return Completion.reconcileOverrides(confirmation);
}
