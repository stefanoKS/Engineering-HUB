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
  var REASON_MAX = 240;

  // Execution-local flag. Apps Script runs one request per execution, so nothing leaks
  // between users; the script lock still serializes the actual write.
  var approvalDepth = 0;

  function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }

  function fail(message) { Domain.fail(message); }

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
   */
  function override(taskId, reason, confirmation) {
    var admin = Access.requireAdmin();
    if (text(confirmation) !== APPROVAL_CONFIRMATION) fail('完了の直接修正には「' + APPROVAL_CONFIRMATION + '」の確認入力が必要です');
    var note = text(reason).slice(0, REASON_MAX);
    if (!note) fail('完了の直接修正には理由が必要です');
    return Database.withLock(function () {
      var task = Domain.required('TASKS', text(taskId));
      if (text(task.Status) === DONE && Number(task.Progress_Percent) === 100) return task;
      var updated = withApproval(function () {
        return Tasks.update(task.Task_ID, {Status: DONE, Progress_Percent: 100});
      });
      AuditLog.write('COMPLETION_OVERRIDDEN', 'TASK', task.Task_ID, {
        actor: admin.email, reason: note, previousStatus: text(task.Status),
        previousProgress: Number(task.Progress_Percent)
      });
      return updated;
    });
  }

  return {
    APPROVAL_CONFIRMATION: APPROVAL_CONFIRMATION,
    guard: guard,
    withApproval: withApproval,
    inApproval: inApproval,
    isLegacyCompletion: isLegacyCompletion,
    pendingByTask: pendingByTask,
    reviewState: reviewState,
    override: override
  };
}());
function overrideTaskCompletion(taskId, reason, confirmation) {
  Access.requireAdmin();
  return Completion.override(taskId, reason, confirmation);
}
