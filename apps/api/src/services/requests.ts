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
  failClaim,
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
  lockRequest,
  updateTask
} from '@eh/db';
import {
  DomainError,
  applyTaskPlan,
  assertCompletableByDecision,
  assertReportable,
  createCalendar,
  effectiveEmailMode,
  evaluateStaleness,
  planDecision,
  requireRole,
  settingFlag,
  SETTING_KEYS,
  submissionSnapshot,
  validateSubmission,
  type TaskSnapshot
} from '@eh/domain';
import { audit, enqueueJob, requireConfirmation, requireTypedConfirmation, runIdempotent, type ServiceCtx } from './common';
import type { InboxSource } from '../inbox';
import { newId } from '@eh/db';

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

export async function queue(
  ctx: ServiceCtx,
  inbox: InboxSource,
  input: { includeDecided: boolean; import: boolean }
): Promise<{ items: TaskRequest[]; total: number; imported: ImportResult }> {
  requireRole(ctx.identity, 'MANAGER');
  const imported = input.import
    ? await importRequests(ctx, inbox)
    : { attempted: false, configured: inbox.configured, imported: 0, duplicates: 0, failed: 0, message: '' };
  const items = await listRequests(ctx.db, input.includeDecided);
  return { items, total: items.length, imported };
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
      ORDER BY p.project_name, t.due_date NULLS LAST, t.task_id
      LIMIT 2000`
  );
  return {
    contractVersion: '1.6',
    publishedAt: new Date().toISOString(),
    submissionEnabled,
    submissionClosedMessage: submissionEnabled ? '' : '現在、依頼の受付は停止しています',
    stale: false,
    tasks: rows.map((row) => ({
      taskId: row.task_id,
      taskName: row.task_name,
      projectId: row.project_id,
      projectName: row.project_name,
      responsibilityName: row.responsibility_name ?? '',
      status: row.status,
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
    }))
  };
}

/**
 * Employee submission is non-blocking and idempotent. The endpoint answers once the request is
 * durably stored; an unobservable outcome is reported as unknown by the client, never retried
 * automatically and never reported as success.
 */
export async function submitRequest(
  ctx: ServiceCtx,
  body: z.infer<typeof SubmitRequestBody>
): Promise<{ requestId: string; state: 'RECEIVED' | 'DUPLICATE'; requestType: string; taskId: string; submittedAt: string }> {
  const settings = await getSettings(ctx.db);
  if (!settingFlag(settings, SETTING_KEYS.REQUEST_SUBMISSION_ENABLED, false)) {
    throw new DomainError('REQUEST_SUBMISSION_CLOSED', 'Request submission is closed');
  }
  const task = await getTask(ctx.db, body.taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${body.taskId}`);
  const project = await getProject(ctx.db, task.projectId);
  if (!project || project.dashboardVisibility !== 'INTERNAL') {
    throw new DomainError('NOT_FOUND', 'This task is not published');
  }
  const childRow = await ctx.db.one<{ count: string }>(
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
  assertReportable(body.requestType, snapshot);
  validateSubmission({
    taskId: task.taskId,
    requestType: body.requestType,
    requestedDueDate: body.requestedDueDate,
    completionNote: body.completionNote,
    reason: body.reason
  });

  const result = await runIdempotent(
    ctx,
    { scope: 'employee.request', key: body.clientRequestId, request: body },
    async (tx) => {
      const existing = await getRequestByInboxId(tx, body.clientRequestId);
      if (existing) {
        return {
          requestId: existing.requestId,
          state: 'DUPLICATE' as const,
          requestType: existing.requestType,
          taskId: existing.taskId,
          submittedAt: existing.submittedAt
        };
      }
      const snap = submissionSnapshot(snapshot);
      const created = await insertRequest(tx, {
        requestId: newId('REQ'),
        requestType: body.requestType,
        taskId: task.taskId,
        projectId: task.projectId,
        requesterName: body.requesterName?.trim() || ctx.identity.name,
        originalDueDate: task.dueDate,
        requestedDueDate: body.requestedDueDate ?? null,
        reason: body.reason ?? '',
        explanation: body.explanation ?? '',
        completionNote: body.completionNote ?? '',
        taskRevisionAtSubmission: snap.taskRevisionAtSubmission,
        dueDateAtSubmission: snap.dueDateAtSubmission,
        snapshotVersion: snap.snapshotVersion,
        inboxRequestId: body.clientRequestId
      });
      await audit(tx, ctx, {
        entityType: 'TASK_REQUESTS',
        entityId: created.requestId,
        action: 'REQUEST_SUBMITTED',
        newValue: {
          taskId: task.taskId,
          requestType: body.requestType,
          requesterName: created.requesterName,
          snapshotVersion: snap.snapshotVersion
        }
      });
      await enqueueJob(tx, ctx, {
        kind: 'notification.request',
        dedupeKey: `request-submitted:${created.requestId}`,
        payload: { requestId: created.requestId, taskId: task.taskId }
      });
      return {
        requestId: created.requestId,
        state: 'RECEIVED' as const,
        requestType: created.requestType,
        taskId: created.taskId,
        submittedAt: created.submittedAt
      };
    }
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

/** A decision is claimed, applied and finalized in one transaction, at most once. */
export async function decideRequest(ctx: ServiceCtx, body: z.infer<typeof DecisionBody>): Promise<DecisionResult> {
  requireRole(ctx.identity, 'MANAGER');
  requireConfirmation(body.confirmed, 'A decision requires explicit confirmation');

  return ctx.db.transaction(async (tx) => {
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
    const claimed = await claimRequest(tx, body.requestId);
    if (!claimed) {
      throw new DomainError('DUPLICATE_DECISION', 'This request is no longer open for a decision');
    }
    const task = await getTask(tx, locked.taskId);
    if (!task) {
      await failClaim(tx, body.requestId, 'TASK_NOT_FOUND');
      throw new DomainError('NOT_FOUND', `Task not found: ${locked.taskId}`);
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
  const request = await getRequest(ctx.db, requestId);
  if (!request) throw new DomainError('NOT_FOUND', 'Request not found');
  return {
    requestId: request.requestId,
    state: request.status,
    requestType: request.requestType,
    taskId: request.taskId,
    submittedAt: request.submittedAt
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
