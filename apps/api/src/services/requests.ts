/**
 * Employee requests and manager decisions.
 *
 * Submission writes the durable request directly (V2 has no spreadsheet inbox in the normal
 * path). An import from a transition inbox stays available, idempotent on the permanent inbox
 * request ID. A decision is one transaction and is applied at most once.
 */
import type { z } from 'zod';
import type { DecisionBody, SubmitRequestBody, TaskRequest } from '@eh/contracts';
import {
  claimRequest,
  finalizeRequest,
  getProject,
  getRequest,
  getRequestByInboxId,
  getSettings,
  getTask,
  hasPendingRequest,
  insertDeadlineHistory,
  insertRequest,
  listHolidays,
  listRequests,
  listSubprojects,
  lockRequest,
  updateTask
} from '@eh/db';
import {
  DomainError,
  applyTaskPlan,
  assertCompletableByDecision,
  assertCompletionDecisionRole,
  assertReadableDivision,
  assertReportable,
  assertWritableDivision,
  canReadProjectVisibility,
  canReportCompletion,
  canRequestDeadlineChange,
  canSeeRestrictedWork,
  createCalendar,
  readableDivisionIds,
  scopedDivisionIds,
  taskScheduleStatus,
  effectiveEmailMode,
  evaluateStaleness,
  planDecision,
  requireRole,
  settingFlag,
  SETTING_KEYS,
  submissionBlockReasons,
  submissionRefusal,
  submissionSnapshot,
  validateSubmission,
  type Identity,
  type SubmissionAssessment,
  type SubmissionBlockReason,
  type TaskSnapshot
} from '@eh/domain';
import { audit, enqueueJob, requireConfirmation, requireTypedConfirmation, runIdempotent, type ServiceCtx } from './common';
import type { InboxSource } from '../inbox';
import { newId } from '@eh/db';
import { lockDivisionMutation, reauthorizeInTransaction } from './divisions';
import type { Transaction } from '@eh/db';

export type ImportResult = {
  attempted: boolean;
  configured: boolean;
  imported: number;
  duplicates: number;
  failed: number;
  message: string;
};

/**
 * Imports new inbox rows idempotently. A failed row is a warning: already imported requests stay
 * visible and the result never claims success.
 */
export async function importRequests(ctx: ServiceCtx, inbox: InboxSource): Promise<ImportResult> {
  if (!inbox.configured) {
    return {
      attempted: false,
      configured: false,
      imported: 0,
      duplicates: 0,
      failed: 0,
      message: 'The request inbox is not configured; submissions arrive in the application directly'
    };
  }
  let rows;
  try {
    rows = await inbox.list();
  } catch (error) {
    return {
      attempted: true,
      configured: true,
      imported: 0,
      duplicates: 0,
      failed: 0,
      message: `The request inbox could not be read: ${(error as Error).message}`
    };
  }
  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  for (const row of rows) {
    const existing = await getRequestByInboxId(ctx.db, row.inboxRequestId);
    if (existing) {
      duplicates += 1;
      continue;
    }
    const task = await getTask(ctx.db, row.taskId);
    if (!task) {
      failed += 1;
      continue;
    }
    const childCount = await ctx.db.one<{ count: string }>(
      'SELECT count(*)::text AS count FROM tasks WHERE parent_task_id = $1 AND deleted_at IS NULL',
      [task.taskId]
    );
    try {
      assertReportable(row.requestType, {
        taskId: task.taskId,
        revision: task.revision,
        dueDate: task.dueDate,
        status: task.status,
        container: Number(childCount?.count ?? 0) > 0
      });
    } catch {
      failed += 1;
      continue;
    }
    try {
      await insertRequest(ctx.db, {
        requestId: row.inboxRequestId,
        requestType: row.requestType,
        taskId: task.taskId,
        projectId: task.projectId,
        requesterName: row.requesterName,
        originalDueDate: task.dueDate,
        requestedDueDate: row.requestedDueDate,
        reason: row.reason,
        explanation: row.explanation,
        completionNote: row.completionNote,
        taskRevisionAtSubmission: String(task.revision),
        dueDateAtSubmission: task.dueDate,
        snapshotVersion: row.snapshotVersion || `rev:${task.revision}`,
        inboxRequestId: row.inboxRequestId
      });
      imported += 1;
    } catch {
      failed += 1;
    }
  }
  const message = failed
    ? `Imported ${imported} request(s); ${failed} row(s) could not be imported and stay in the inbox`
    : `Imported ${imported} request(s)`;
  return { attempted: true, configured: true, imported, duplicates, failed, message };
}

/** The SQL predicate for one request-scope; paired with the parameters below. */
function requestDivisionFilter(divisionIds: string[] | undefined): string {
  if (divisionIds === undefined) return '';
  if (!divisionIds.length) return 'AND false';
  return 'AND EXISTS (SELECT 1 FROM tasks t JOIN projects p ON p.project_id = t.project_id WHERE t.task_id = rq.task_id AND p.division_id = ANY($2::text[]))';
}

export async function queue(
  ctx: ServiceCtx,
  inbox: InboxSource,
  input: { includeDecided: boolean; import: boolean; divisionId?: string; page?: number; pageSize?: number }
): Promise<{ items: TaskRequest[]; total: number; page: number; pageSize: number; totalPages: number; imported: ImportResult }> {
  requireRole(ctx.identity, 'MANAGER');
  const imported = input.import
    ? await importRequests(ctx, inbox)
    : { attempted: false, configured: inbox.configured, imported: 0, duplicates: 0, failed: 0, message: '' };
  const pageSize = input.pageSize ?? 25;
  return ctx.db.transaction(async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    // One server-side scope for both the total and the page, so a paged request list can never
    // total or reach past the caller's divisions. A requested division narrows that scope and is
    // refused as NOT_FOUND when it is not authorized.
    const divisionIds = scopedDivisionIds(ctx.divisions, input.divisionId);
    const filter = requestDivisionFilter(divisionIds);
    const scopeParams = [input.includeDecided, ...(divisionIds && divisionIds.length ? [divisionIds] : [])];
    const count = await tx.one<{ total: string }>(
      `SELECT count(*)::text AS total FROM task_requests rq
        WHERE ($1::boolean OR rq.status IN ('PENDING','PROCESSING','STALE')) ${filter}`,
      scopeParams
    );
    const total = Number(count?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(input.page ?? 1, totalPages);
    const items = await listRequests(tx, input.includeDecided, page, pageSize, { divisionIds });
    return { items, total, page, pageSize, totalPages, imported };
  });
}

export type EmployeeTaskRow = {
  task_id: string;
  task_name: string;
  project_id: string;
  project_name: string;
  responsibility_name: string | null;
  responsibility_color: string | null;
  status: string;
  due_date: string | null;
  planned_start: string | null;
  owner_name: string | null;
  assignee_names: string[] | null;
  container: boolean;
  progress_percent: number | null;
  review_state: string;
  completed_at: string | null;
  pending_request: boolean;
  dashboard_visibility: string;
  task_revision: number;
};

/**
 * The employee view is a server-side scope, not a browser filter.
 *
 * A signed-in person sees the INTERNAL work of the divisions they may read. An account with no
 * grant therefore sees nothing instead of the whole company portfolio.
 */
function employeeDivisionFilter(ctx: ServiceCtx): string {
  const ids = readableDivisionIds(ctx.divisions);
  if (ids === undefined) return '';
  if (!ids.length) return 'AND false';
  return 'AND p.division_id = ANY($1::text[])';
}

function employeeDivisionParams(ctx: ServiceCtx): unknown[] {
  const ids = readableDivisionIds(ctx.divisions);
  return ids === undefined || !ids.length ? [] : [ids];
}

/** Employee view: only published (INTERNAL) projects, only allowlisted display fields. */
export async function employeeSnapshot(ctx: ServiceCtx) {
  const settings = await getSettings(ctx.db);
  const submissionEnabled = settingFlag(settings, SETTING_KEYS.REQUEST_SUBMISSION_ENABLED, false);
  const rows = await ctx.db.many<EmployeeTaskRow>(
    `SELECT t.task_id, t.task_name, t.project_id, p.project_name,
            r.name AS responsibility_name, r.color_hex AS responsibility_color,
            t.status, t.due_date, t.planned_start, owner.name AS owner_name,
            COALESCE((SELECT array_agg(am.name ORDER BY am.name)
                        FROM task_assignees ta JOIN members am ON am.member_id = ta.member_id
                       WHERE ta.task_id = t.task_id AND ta.removed_at IS NULL), '{}') AS assignee_names,
            EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.task_id) AS container,
            t.progress_percent,
            COALESCE((SELECT rr.status FROM task_requests rr
                       WHERE rr.task_id = t.task_id AND rr.request_type = 'COMPLETION_REPORT'
                       ORDER BY rr.submitted_at DESC LIMIT 1), '') AS review_state,
            t.completed_at,
            EXISTS (SELECT 1 FROM task_requests rp WHERE rp.task_id = t.task_id AND rp.status IN ('PENDING','PROCESSING')) AS pending_request,
            p.dashboard_visibility, t.revision AS task_revision
       FROM tasks t
       JOIN projects p ON p.project_id = t.project_id
       LEFT JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
       LEFT JOIN members owner ON owner.member_id = t.owner_member_id
      WHERE t.deleted_at IS NULL AND p.dashboard_visibility = 'INTERNAL' AND p.status <> 'Archived'
        ${employeeDivisionFilter(ctx)}
      ORDER BY p.project_name, t.due_date NULLS LAST, t.task_id
      LIMIT 2000`,
    employeeDivisionParams(ctx)
  );
  return {
    contractVersion: '1.6',
    publishedAt: new Date().toISOString(),
    submissionEnabled,
    submissionClosedMessage: submissionEnabled ? '' : '現在、依頼の受付は停止しています',
    stale: false,
    tasks: rows.map((row) => {
      const schedule = taskScheduleStatus({
        status: row.status,
        plannedStart: row.planned_start,
        dueDate: row.due_date
      });
      return {
        taskId: row.task_id,
        taskName: row.task_name,
        projectId: row.project_id,
        projectName: row.project_name,
        responsibilityName: row.responsibility_name ?? '',
        status: row.status,
        displayStatus: schedule.state,
        scheduleMissing: schedule.missing,
        dueDate: row.due_date,
        plannedStart: row.planned_start,
        ownerName: row.owner_name ?? '',
        assigneeNames: row.assignee_names ?? [],
        container: row.container,
        progressPercent: row.progress_percent,
        reviewState: row.review_state,
        completedAt: row.completed_at,
        pendingRequest: row.pending_request,
        projectAccent: row.responsibility_color ?? ''
      };
    })
  };
}

/**
 * One assessment shared by the reported capability and the submission itself.
 *
 * A completion report may be filed for work the reporter can reach even when they are not an
 * assignee; anything else keeps the assigned-MEMBER rule. A capability answer is never authority:
 * `submitRequest` re-reads this state inside its own request before writing.
 */
async function assessSubmission(
  ctx: ServiceCtx,
  task: { taskId: string; projectId: string; subprojectId: string | null; status: string; ownerMemberId: string | null },
  project: { status: string; dashboardVisibility: string; archivedAt: string | null },
  requestType: 'COMPLETION_REPORT' | 'DEADLINE_CHANGE',
  submissionEnabled: boolean
): Promise<SubmissionAssessment> {
  const [assignment, childRow, pendingRow, subprojects] = await Promise.all([
    ctx.db.one<{ assigned: boolean }>(
      `SELECT (owner_member_id = $2 OR EXISTS (
                 SELECT 1 FROM task_assignees a
                  WHERE a.task_id = $1 AND a.member_id = $2 AND a.removed_at IS NULL)) AS assigned
         FROM tasks WHERE task_id = $1`,
      [task.taskId, ctx.identity.memberId]
    ),
    ctx.db.one<{ count: string }>(
      'SELECT count(*)::text AS count FROM tasks WHERE parent_task_id = $1 AND deleted_at IS NULL',
      [task.taskId]
    ),
    ctx.db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_requests
        WHERE task_id = $1 AND request_type = 'COMPLETION_REPORT' AND status IN ('PENDING','PROCESSING')`,
      [task.taskId]
    ),
    task.subprojectId
      ? listSubprojects(ctx.db, task.projectId)
      : Promise.resolve([])
  ]);
  const assigned = !!assignment?.assigned;
  const subprojectArchived = (() => {
    if (!task.subprojectId) return false;
    const byId = new Map(subprojects.map((entry) => [entry.subprojectId, entry]));
    let node = byId.get(task.subprojectId);
    const seen = new Set<string>();
    let guard = 0;
    while (node) {
      if (seen.has(node.subprojectId)) return true;
      seen.add(node.subprojectId);
      if (node.status === 'Archived') return true;
      if (guard++ > 20) return true;
      node = node.parentSubprojectId ? byId.get(node.parentSubprojectId) : undefined;
    }
    return false;
  })();
  // An assignment already gives the member access to their own work; otherwise the project has to
  // be readable under the documented visibility policy. Reporting never widens visibility.
  const visible =
    assigned ||
    canSeeRestrictedWork(ctx.identity) ||
    canReadProjectVisibility(ctx.identity, project.dashboardVisibility);
  return {
    requestType,
    mayReportCompletion: canReportCompletion(ctx.identity),
    mayRequestDeadlineChange: canRequestDeadlineChange(ctx.identity),
    assigned,
    visible,
    submissionEnabled,
    pending: Number(pendingRow?.count ?? 0) > 0,
    task: {
      status: task.status,
      container: Number(childRow?.count ?? 0) > 0,
      archived: project.status === 'Archived' || !!project.archivedAt || subprojectArchived
    }
  };
}

function refusalFor(reason: SubmissionBlockReason): DomainError {
  const refusal = submissionRefusal(reason);
  const messages: Record<SubmissionBlockReason, string> = {
    ROLE: 'This account may not file this request',
    NOT_VISIBLE: 'This task is not visible to you',
    ARCHIVED: 'Archived work cannot be reported',
    NOT_ASSIGNED: 'Only your assigned work can be requested',
    CONTAINER: 'A task with children is organisation only; its completion is derived from leaf work',
    COMPLETED: 'This task is already complete',
    CANCELLED: 'This task is cancelled',
    PENDING: 'A completion report for this task is already pending',
    SUBMISSION_DISABLED: 'Request submission is closed'
  };
  if (reason === 'NOT_VISIBLE') {
    // An unreadable task answers like an unknown one, so a refusal never confirms that it exists.
    return new DomainError('NOT_FOUND', `Task not found`, { reason });
  }
  return new DomainError(refusal.code, messages[reason], { reason });
}

/**
 * The completion-report capability for one task, derived on the server.
 *
 * A failed or missing answer is never treated as "allowed": the action stays unavailable until an
 * eligible answer arrives, and the submission re-checks everything anyway.
 */
export async function reportEligibility(
  ctx: ServiceCtx,
  taskId: string
): Promise<{ taskId: string; eligible: boolean; reasons: SubmissionBlockReason[]; submissionEnabled: boolean; reporterName: string }> {
  requireRole(ctx.identity, 'VIEWER');
  const settings = await getSettings(ctx.db);
  const submissionEnabled = settingFlag(settings, SETTING_KEYS.REQUEST_SUBMISSION_ENABLED, false);
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  const project = await getProject(ctx.db, task.projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  assertReadableDivision(ctx.divisions, project.divisionId);
  const assessment = await assessSubmission(ctx, task, project, 'COMPLETION_REPORT', submissionEnabled);
  if (!assessment.visible && !canSeeRestrictedWork(ctx.identity)) {
    // An unreadable task answers like an unknown one, so a refusal never confirms that it exists.
    throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  }
  const reasons = submissionBlockReasons(assessment);
  return {
    taskId: task.taskId,
    eligible: reasons.length === 0,
    reasons,
    submissionEnabled,
    reporterName: ctx.identity.name
  };
}

/**
 * Employee submission is non-blocking and idempotent. The endpoint answers once the request is
 * durably stored; an unobservable outcome is reported as unknown by the client, never retried
 * automatically and never reported as success.
 *
 * The reporter is the verified session: a browser-supplied name, member ID or role is ignored.
 */
export async function submitRequest(
  ctx: ServiceCtx,
  body: z.infer<typeof SubmitRequestBody>
): Promise<{ requestId: string; state: 'RECEIVED' | 'DUPLICATE'; requestType: string; taskId: string; submittedAt: string }> {
  requireRole(ctx.identity, 'VIEWER');
  const settings = await getSettings(ctx.db);
  const submissionEnabled = settingFlag(settings, SETTING_KEYS.REQUEST_SUBMISSION_ENABLED, false);
  const task = await getTask(ctx.db, body.taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${body.taskId}`);
  const project = await getProject(ctx.db, task.projectId);
  if (!project) {
    throw new DomainError('NOT_FOUND', 'Project not found');
  }
  // A request may only be filed for work the caller may read in their own divisions.
  assertReadableDivision(ctx.divisions, project.divisionId);
  // A key owned by another person answers as unknown before any eligibility or idempotency work,
  // so a foreign receipt can neither be read nor replayed. A key of my own replays its answer.
  const receipt = await getRequestByInboxId(ctx.db, body.clientRequestId);
  if (receipt && receipt.requesterMemberId !== ctx.identity.memberId) {
    throw new DomainError('NOT_FOUND', 'Request not found');
  }
  const assessment = receipt
    ? null
    : await assessSubmission(ctx, task, project, body.requestType, submissionEnabled);
  if (assessment) {
    const reasons = submissionBlockReasons(assessment);
    const firstReason = reasons[0];
    if (firstReason) throw refusalFor(firstReason);
  }
  const snapshot: TaskSnapshot = {
    taskId: task.taskId,
    revision: task.revision,
    dueDate: task.dueDate,
    status: task.status,
    container: assessment?.task.container ?? false
  };
  assertReportable(body.requestType, snapshot);
  validateSubmission({
    taskId: task.taskId,
    requestType: body.requestType,
    requestedDueDate: body.requestedDueDate,
    completionNote: body.completionNote,
    reason: body.reason
  });

  // The access check a replayed submission must still pass: the file operation is never repeated,
  // but the stored receipt is only returned to a reader who may still read the task's division.
  const authorizeSubmission = async (tx: Transaction): Promise<void> => {
    const fresh = await reauthorizeInTransaction(tx, ctx);
    requireRole(fresh.identity, 'VIEWER');
    const scoped = await tx.one<{ division_id: string | null }>(
      'SELECT p.division_id FROM tasks t JOIN projects p ON p.project_id = t.project_id WHERE t.task_id = $1',
      [task.taskId]
    );
    assertReadableDivision(fresh.scope, scoped?.division_id ?? null);
  };
  const result = await runIdempotent(
    ctx,
    { scope: `employee.request:${ctx.identity.memberId}`, key: body.clientRequestId, request: body },
    async (tx) => {
      await lockDivisionMutation(tx);
      const existing = await getRequestByInboxId(tx, body.clientRequestId);
      if (existing) {
        if (existing.requesterMemberId !== ctx.identity.memberId) {
          throw new DomainError('NOT_FOUND', 'Request not found');
        }
        return {
          requestId: existing.requestId,
          state: 'DUPLICATE' as const,
          requestType: existing.requestType,
          taskId: existing.taskId,
          submittedAt: existing.submittedAt
        };
      }
      const snap = submissionSnapshot(snapshot);
      // The caller's readable divisions are re-read through the transaction handle, so a grant
      // revoked while the form was open cannot be used to file a request.
      await authorizeSubmission(tx);
      const created = await insertRequest(tx, {
        requestId: newId('REQ'),
        requestType: body.requestType,
        taskId: task.taskId,
        projectId: task.projectId,
        requesterName: ctx.identity.name,
        originalDueDate: task.dueDate,
        requestedDueDate: body.requestedDueDate ?? null,
        reason: body.reason ?? '',
        explanation: body.explanation ?? '',
        completionNote: body.completionNote ?? '',
        taskRevisionAtSubmission: snap.taskRevisionAtSubmission,
        dueDateAtSubmission: snap.dueDateAtSubmission,
        snapshotVersion: snap.snapshotVersion,
        inboxRequestId: body.clientRequestId,
        requesterMemberId: ctx.identity.memberId
      });
      await audit(tx, ctx, {
        entityType: 'TASK_REQUESTS',
        entityId: created.requestId,
        action: 'REQUEST_SUBMITTED',
        newValue: {
          taskId: task.taskId,
          requestType: body.requestType,
          // The reporter is the verified session, recorded beside the assignment it does not own.
          requesterName: created.requesterName,
          requesterMemberId: ctx.identity.memberId,
          reporterRole: ctx.identity.role,
          reporterIsAssignee: assessment?.assigned ?? false,
          taskOwnerMemberId: task.ownerMemberId,
          snapshotVersion: snap.snapshotVersion
        }
      });
      await enqueueJob(tx, ctx, {
        kind: 'notification.request',
        dedupeKey: `request-submitted:${created.requestId}`,
        payload: { requestId: created.requestId, taskId: task.taskId, requestType: created.requestType }
      });
      return {
        requestId: created.requestId,
        state: 'RECEIVED' as const,
        requestType: created.requestType,
        taskId: created.taskId,
        submittedAt: created.submittedAt
      };
    },
    { authorize: authorizeSubmission }
  );
  return result.data;
}

export type DecisionResult = {
  request: TaskRequest;
  applied: boolean;
  stale: boolean;
  taskStatus: string;
  dueDate: string | null;
};

/**
 * A decision re-reads the division inside the decision transaction.
 *
 * A grant removed a moment ago therefore cannot be used by a decision that was already prepared.
 * It returns the re-read identity, so the caller's role decision (for example the completion
 * decision role) is taken from the stored row rather than from the session snapshot.
 */
async function assertDecidableDivision(
  tx: Transaction,
  ctx: ServiceCtx,
  projectId: string
): Promise<Identity> {
  const row = await tx.one<{ division_id: string | null }>('SELECT division_id FROM projects WHERE project_id = $1', [
    projectId
  ]);
  // The actor's current authority is re-read inside the decision transaction; the request-level
  // scope is only a pre-check.
  const fresh = await reauthorizeInTransaction(tx, ctx);
  requireRole(fresh.identity, 'MANAGER');
  assertWritableDivision(fresh.scope, row?.division_id ?? null);
  return fresh.identity;
}

/** A decision is claimed, applied and finalized in one transaction, at most once. */
export async function decideRequest(ctx: ServiceCtx, body: z.infer<typeof DecisionBody>): Promise<DecisionResult> {
  requireRole(ctx.identity, 'MANAGER');
  requireConfirmation(body.confirmed, 'A decision requires explicit confirmation');

  return ctx.db.transaction(async (tx) => {
    // The decision takes the same lock order as every other division-scoped write before it reads
    // authority, so a role or membership change cannot land between the check and the claim.
    await lockDivisionMutation(tx);
    const locked = await lockRequest(tx, body.requestId);
    if (!locked) throw new DomainError('NOT_FOUND', `Request not found: ${body.requestId}`);
    if (locked.revision !== body.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload the queue; this request changed since you loaded it');
    }
    if (locked.status === 'APPROVED' || locked.status === 'REJECTED' || locked.status === 'RETURNED') {
      throw new DomainError('DUPLICATE_DECISION', 'This request has already been decided', {
        status: locked.status
      });
    }
    const task = await getTask(tx, locked.taskId);
    if (!task) {
      throw new DomainError('NOT_FOUND', `Task not found: ${locked.taskId}`);
    }
    // The decision is a task write: it needs management access in the task's division. The check
    // runs inside the decision transaction, before the request is claimed.
    const decider = await assertDecidableDivision(tx, ctx, task.projectId);
    // Refused before the request is claimed, so a refusal never leaves a request PROCESSING.
    if (body.decision === 'APPROVE' && locked.requestType === 'COMPLETION_REPORT') {
      assertCompletionDecisionRole({ actorRole: decider.role });
    }
    const claimed = await claimRequest(tx, body.requestId);
    if (!claimed) {
      throw new DomainError('DUPLICATE_DECISION', 'This request is no longer open for a decision');
    }
    const childRow = await tx.one<{ count: string }>(
      'SELECT count(*)::text AS count FROM tasks WHERE parent_task_id = $1 AND deleted_at IS NULL',
      [task.taskId]
    );
    const snapshot: TaskSnapshot = {
      taskId: task.taskId,
      revision: task.revision,
      dueDate: task.dueDate,
      status: task.status,
      container: Number(childRow?.count ?? 0) > 0
    };

    const stale = evaluateStaleness(
      {
        status: locked.status,
        requestType: locked.requestType,
        taskRevisionAtSubmission: locked.taskRevisionAtSubmission,
        dueDateAtSubmission: locked.dueDateAtSubmission
      },
      snapshot
    );
    if (stale.stale) {
      await finalizeRequest(tx, {
        requestId: body.requestId,
        status: 'STALE',
        reviewer: ctx.identity.email,
        note: body.note ?? '',
        staleReason: stale.reason
      });
      await audit(tx, ctx, {
        entityType: 'TASK_REQUESTS',
        entityId: body.requestId,
        action: 'REQUEST_STALE',
        previousValue: { status: locked.status },
        newValue: { status: 'STALE', reason: stale.reason }
      });
      const after = await getRequest(tx, body.requestId);
      return {
        request: after ?? locked,
        applied: false,
        stale: true,
        taskStatus: task.status,
        dueDate: task.dueDate
      };
    }

    const outcome = planDecision(
      {
        requestId: locked.requestId,
        requestType: locked.requestType,
        status: 'PROCESSING',
        taskId: locked.taskId,
        requestedDueDate: locked.requestedDueDate,
        taskRevisionAtSubmission: locked.taskRevisionAtSubmission,
        dueDateAtSubmission: locked.dueDateAtSubmission
      },
      body.decision,
      snapshot
    );

    let taskStatus = task.status;
    let dueDate = task.dueDate;

    if (outcome.taskEffect === 'COMPLETED') {
      assertCompletableByDecision({
        taskId: task.taskId,
        status: task.status,
        container: snapshot.container,
        assignmentApprovedAt: task.assignmentApprovedAt
      });
      const next = await updateTask(
        tx,
        task.taskId,
        { status: 'Done', progressPercent: 100, completedAt: new Date().toISOString() },
        task.revision
      );
      if (!next) throw new DomainError('EDIT_CONFLICT', 'The task changed while the decision was applied');
      taskStatus = next.status;
      dueDate = next.dueDate;
      await audit(tx, ctx, {
        entityType: 'TASKS',
        entityId: task.taskId,
        action: 'TASK_COMPLETED',
        previousValue: { status: task.status, progressPercent: task.progressPercent },
        newValue: { status: next.status, progressPercent: next.progressPercent, requestId: body.requestId }
      });
    }

    if (outcome.taskEffect === 'DEADLINE_CHANGED') {
      const holidays = await listHolidays(tx);
      const calendar = createCalendar(holidays);
      const plan = applyTaskPlan(
        {
          dueDate: outcome.dueDate,
          plannedDurationValue: task.plannedDurationValue,
          plannedDurationUnit: task.plannedDurationUnit,
          plannedDurationBasis: task.plannedDurationBasis,
          plannedStart: task.plannedStart,
          plannedStartSource: task.plannedStartSource
        },
        calendar
      );
      const next = await updateTask(
        tx,
        task.taskId,
        {
          dueDate: outcome.dueDate,
          plannedStart: plan.plannedStart,
          plannedStartSource: plan.plannedStartSource
        },
        task.revision
      );
      if (!next) throw new DomainError('EDIT_CONFLICT', 'The task changed while the decision was applied');
      await insertDeadlineHistory(tx, {
        taskId: task.taskId,
        requestId: body.requestId,
        previousDueDate: task.dueDate,
        newDueDate: outcome.dueDate,
        previousPlannedStart: task.plannedStart,
        newPlannedStart: next.plannedStart,
        reason: locked.reason || body.note || '',
        changedBy: ctx.identity.email,
        source: 'REQUEST_APPROVED'
      });
      await audit(tx, ctx, {
        entityType: 'TASKS',
        entityId: task.taskId,
        action: 'TASK_DEADLINE_CHANGED',
        previousValue: { dueDate: task.dueDate, plannedStart: task.plannedStart },
        newValue: { dueDate: next.dueDate, plannedStart: next.plannedStart, requestId: body.requestId }
      });
      taskStatus = next.status;
      dueDate = next.dueDate;
    }

    await finalizeRequest(tx, {
      requestId: body.requestId,
      status: outcome.requestStatus as 'APPROVED' | 'REJECTED' | 'RETURNED',
      reviewer: ctx.identity.email,
      note: body.note ?? '',
      acceptedCompletionAt: outcome.completionRequired ? new Date().toISOString() : null
    });
    await audit(tx, ctx, {
      entityType: 'TASK_REQUESTS',
      entityId: body.requestId,
      action: outcome.auditAction,
      previousValue: { status: locked.status },
      newValue: { status: outcome.requestStatus, decision: body.decision, note: body.note ?? '' }
    });
    await enqueueJob(tx, ctx, {
      kind: 'notification.request-decision',
      dedupeKey: `request-decision:${body.requestId}`,
      payload: { requestId: body.requestId, taskId: task.taskId, decision: outcome.requestStatus }
    });
    if (outcome.taskEffect === 'DEADLINE_CHANGED') {
      // The deadline switch is independent of the decision notice; the worker enforces it.
      await enqueueJob(tx, ctx, {
        kind: 'notification.task',
        dedupeKey: `deadline-change:${body.requestId}`,
        payload: {
          taskId: task.taskId,
          notificationKind: 'DEADLINE_CHANGE',
          bucket: `request:${body.requestId}`,
          requestId: body.requestId
        }
      });
    }

    const after = await getRequest(tx, body.requestId);
    return {
      request: after ?? locked,
      applied: outcome.taskEffect !== 'NONE',
      stale: false,
      taskStatus,
      dueDate
    };
  });
}

/** Receipt lookup for the employee view: state only, never manager data. */
export async function requestReceipt(
  ctx: ServiceCtx,
  requestId: string
): Promise<{ requestId: string; state: string; requestType: string; taskId: string; submittedAt: string }> {
  requireRole(ctx.identity, 'VIEWER');
  const request = await getRequest(ctx.db, requestId);
  if (!request) throw new DomainError('NOT_FOUND', 'Request not found');
  const manager = ctx.identity.role === 'ADMIN' || ctx.identity.role === 'MANAGER';
  if (!manager && request.requesterMemberId !== ctx.identity.memberId) {
    // An unrelated member must not learn that this receipt exists.
    throw new DomainError('NOT_FOUND', 'Request not found');
  }
  return {
    requestId: request.requestId,
    state: request.status,
    requestType: request.requestType,
    taskId: request.taskId,
    submittedAt: request.submittedAt
  };
}

/**
 * The member's own request history.
 *
 * It is filtered by the verified identity, so one member never sees another member's
 * submission, and it carries state only: no reviewer address and no manager-only note.
 */
export async function myRequests(ctx: ServiceCtx, limit = 50): Promise<{  items: {
    requestId: string;
    requestType: string;
    taskId: string;
    taskName: string;
    projectName: string;
    status: string;
    submittedAt: string;
    decidedAt: string | null;
    decisionNote: string;
    staleReason: string;
    revision: number;
  }[];
  submissionEnabled: boolean;
}> {
  requireRole(ctx.identity, 'VIEWER');
  const settings = await getSettings(ctx.db);
  const rows = await ctx.db.many<{
    request_id: string;
    request_type: string;
    task_id: string;
    task_name: string | null;
    project_name: string | null;
    status: string;
    submitted_at: string;
    decided_at: string | null;
    decision_note: string;
    stale_reason: string;
    revision: number;
  }>(
    `SELECT r.request_id, r.request_type, r.task_id, t.task_name, p.project_name, r.status,
            r.submitted_at, r.decided_at, r.decision_note, r.stale_reason, r.revision
       FROM task_requests r
       LEFT JOIN tasks t ON t.task_id = r.task_id
       LEFT JOIN projects p ON p.project_id = t.project_id
      WHERE r.requester_member_id = $1
      ORDER BY r.submitted_at DESC, r.request_id DESC
      LIMIT $2`,
    [ctx.identity.memberId, Math.min(Math.max(limit, 1), 100)]
  );
  return {
    submissionEnabled: settingFlag(settings, SETTING_KEYS.REQUEST_SUBMISSION_ENABLED, false),
    items: rows.map((row) => ({
      requestId: row.request_id,
      requestType: row.request_type,
      taskId: row.task_id,
      taskName: row.task_name ?? '',
      projectName: row.project_name ?? '',
      status: row.status,
      submittedAt: row.submitted_at,
      decidedAt: row.decided_at,
      decisionNote: row.decision_note,
      staleReason: row.stale_reason,
      revision: row.revision
    }))
  };
}

export async function pendingCount(ctx: ServiceCtx, taskId: string): Promise<boolean> {
  return hasPendingRequest(ctx.db, taskId);
}

export function requireAdminRole(ctx: ServiceCtx): void {
  requireRole(ctx.identity, 'ADMIN');
}

export async function effectiveMode(ctx: ServiceCtx): Promise<string> {
  return effectiveEmailMode(await getSettings(ctx.db));
}

export function typedConfirmation(supplied: string, expected: string): void {
  requireTypedConfirmation(supplied, expected);
}
