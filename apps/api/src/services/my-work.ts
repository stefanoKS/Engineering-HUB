/**
 * Member self-service work.
 *
 * A member files work for themselves only. This is a deliberately separate service from the
 * manager task command: the owner is the verified session, the status starts as Not Started with
 * no progress, the hierarchy parent is never accepted from the browser, and no assignee, project or
 * completion power exists here. Lowering the manager command's authorization instead would have
 * granted all of that at once.
 */
import type { z } from 'zod';
import type { CreateMyTaskBody, MyWorkList, MyWorkProjectOptions } from '@eh/contracts';
import { getProject, insertTask, listSubprojects, updateTask, getTask } from '@eh/db';
import { DomainError, requireRole, taskInActiveWork } from '@eh/domain';
import { audit, enqueueJob, hashRequest, runIdempotent, type ServiceCtx } from './common';
import { assertTaskPlacement, planTaskDeadline } from './tasks';

const PAGE_SIZE = 25;

type MyWorkRow = {
  task_id: string;
  task_name: string;
  project_id: string;
  project_name: string;
  subproject_name: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  progress_percent: number | null;
  actual_hours: number | null;
  creation_channel: 'LEGACY' | 'MANAGER' | 'MEMBER' | null;
  completed_at: string | null;
  revision: number;
  container: boolean;
  pending_request: boolean;
  last_completion_status: string | null;
  last_request_status: string | null;
  last_request_type: string | null;
};

const MY_WORK_SELECT = `
  SELECT t.task_id, t.task_name, t.project_id, p.project_name,
         s.subproject_name,
         t.status, t.priority, t.due_date, t.progress_percent, t.actual_hours,
         t.creation_channel, t.completed_at, t.revision,
         EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.task_id AND c.deleted_at IS NULL) AS container,
         EXISTS (SELECT 1 FROM task_requests rp
                  WHERE rp.task_id = t.task_id AND rp.status IN ('PENDING','PROCESSING')) AS pending_request,
         (SELECT rr.status FROM task_requests rr
           WHERE rr.task_id = t.task_id AND rr.request_type = 'COMPLETION_REPORT'
           ORDER BY rr.submitted_at DESC LIMIT 1) AS last_completion_status,
         (SELECT rq.status FROM task_requests rq
           WHERE rq.task_id = t.task_id ORDER BY rq.submitted_at DESC LIMIT 1) AS last_request_status,
         (SELECT rq.request_type FROM task_requests rq
           WHERE rq.task_id = t.task_id ORDER BY rq.submitted_at DESC LIMIT 1) AS last_request_type
    FROM tasks t
    JOIN projects p ON p.project_id = t.project_id
    LEFT JOIN subprojects s ON s.subproject_id = t.subproject_id`;

const OWN_WORK = `(t.owner_member_id = $1 OR EXISTS (
  SELECT 1 FROM task_assignees a WHERE a.task_id = t.task_id AND a.member_id = $1 AND a.removed_at IS NULL))`;

/** A compact review state for the member: what happened to the last completion report. */
export function reviewStateOf(row: { pending_request: boolean; last_completion_status: string | null }) {
  if (row.pending_request) return 'PENDING' as const;
  const status = row.last_completion_status ?? '';
  if (['APPROVED', 'REJECTED', 'RETURNED', 'STALE'].includes(status)) {
    return status as 'APPROVED' | 'REJECTED' | 'RETURNED' | 'STALE';
  }
  return 'NONE' as const;
}

export async function listMyWork(ctx: ServiceCtx, page: number): Promise<MyWorkList> {
  requireRole(ctx.identity, 'MEMBER');
  const [rows, total] = await Promise.all([
    ctx.db.many<MyWorkRow>(
      `${MY_WORK_SELECT}
        WHERE t.deleted_at IS NULL AND ${OWN_WORK}
        ORDER BY t.due_date NULLS LAST, t.task_id
        LIMIT ${PAGE_SIZE} OFFSET $2`,
      [ctx.identity.memberId, (page - 1) * PAGE_SIZE]
    ),
    ctx.db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM tasks t WHERE t.deleted_at IS NULL AND ${OWN_WORK}`,
      [ctx.identity.memberId]
    )
  ]);
  return {
    total: Number(total?.count ?? 0),
    items: rows.map((row) => ({
      container: row.container,
      taskId: row.task_id,
      taskName: row.task_name,
      projectId: row.project_id,
      projectName: row.project_name,
      subprojectName: row.subproject_name ?? '',
      status: row.status as MyWorkList['items'][number]['status'],
      priority: row.priority,
      dueDate: row.due_date,
      progressPercent: row.progress_percent,
      actualHours: row.actual_hours,
      reviewState: reviewStateOf(row),
      lastRequestStatus: row.last_request_status ?? '',
      lastRequestType: row.last_request_type ?? '',
      pendingRequest: row.pending_request,
      creationChannel: row.creation_channel ?? 'LEGACY',
      completedAt: row.completed_at,
      revision: row.revision
    }))
  };
}

export const MY_WORK_PAGE_SIZE = PAGE_SIZE;

/** Active projects and non-archived subprojects a member may file work under. */
export async function myWorkProjectOptions(ctx: ServiceCtx): Promise<MyWorkProjectOptions> {
  requireRole(ctx.identity, 'MEMBER');
  const [projects, subprojects] = await Promise.all([
    ctx.db.many<{ project_id: string; project_name: string; responsibility_name: string | null }>(
      `SELECT p.project_id, p.project_name, r.name AS responsibility_name
         FROM projects p
         LEFT JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
        WHERE p.status = 'Active' AND p.archived_at IS NULL
        ORDER BY p.project_name
        LIMIT 500`
    ),
    ctx.db.many<{ subproject_id: string; subproject_name: string; project_id: string }>(
      `SELECT s.subproject_id, s.subproject_name, s.project_id
         FROM subprojects s
         JOIN projects p ON p.project_id = s.project_id
        WHERE s.deleted_at IS NULL AND s.status <> 'Archived'
          AND p.status = 'Active' AND p.archived_at IS NULL
        ORDER BY s.subproject_name
        LIMIT 2000`
    )
  ]);
  return {
    taskCreationEnabled: true,
    items: projects.map((project) => ({
      projectId: project.project_id,
      projectName: project.project_name,
      responsibilityName: project.responsibility_name ?? '',
      subprojects: subprojects
        .filter((entry) => entry.project_id === project.project_id)
        .map((entry) => ({ subprojectId: entry.subproject_id, subprojectName: entry.subproject_name }))
    }))
  };
}

/**
 * Progress and recorded effort on the member's own active leaf work.
 *
 * The own-task boundary is re-checked inside the transaction, so a browser-supplied task ID
 * cannot reach another member's record. `Done` stays refused: only the reviewed completion
 * workflow writes it.
 */
export async function updateMyWork(
  ctx: ServiceCtx,
  taskId: string,
  body: { revision: number; progressPercent: number; actualHours: number }
): Promise<{ saved: true }> {
  requireRole(ctx.identity, 'MEMBER');
  await ctx.db.transaction(async (tx) => {
    await tx.query('SELECT task_id FROM tasks WHERE task_id = $1 FOR UPDATE', [taskId]);
    const owned = await tx.one(
      `SELECT task_id FROM tasks WHERE task_id = $1 AND deleted_at IS NULL
         AND (owner_member_id = $2 OR EXISTS (
           SELECT 1 FROM task_assignees WHERE task_id = $1 AND member_id = $2 AND removed_at IS NULL))`,
      [taskId, ctx.identity.memberId]
    );
    if (!owned) throw new DomainError('AUTHORIZATION_DENIED', 'Only your assigned work can be updated');
    const task = await getTask(tx, taskId);
    if (!task) throw new DomainError('NOT_FOUND', 'Task not found');
    const project = await getProject(tx, task.projectId);
    const subprojects = await listSubprojects(tx);
    const container = await tx.one(
      'SELECT task_id FROM tasks WHERE parent_task_id = $1 AND deleted_at IS NULL LIMIT 1',
      [taskId]
    );
    const active = taskInActiveWork(
      task,
      new Map([[task.projectId, project ?? undefined]]),
      new Map(subprojects.map((entry) => [entry.subprojectId, entry]))
    );
    if (container || !active) throw new DomainError('INVALID_TRANSITION', 'Only active leaf work can be updated');
    const updated = await updateTask(
      tx,
      taskId,
      { progressPercent: body.progressPercent, actualHours: body.actualHours },
      body.revision
    );
    if (!updated) throw new DomainError('EDIT_CONFLICT', 'Reload the task before updating it');
    await audit(tx, ctx, {
      entityType: 'TASKS',
      entityId: taskId,
      action: 'EMPLOYEE_PROGRESS_UPDATED',
      newValue: body
    });
  });
  return { saved: true };
}

/**
 * Creates one task owned by the verified member.
 *
 * The status is `Not Started` and the progress is 0, so the record reaches the member's own list
 * and the manager's task list immediately. Creation itself needs no approval; completion still
 * goes through the reviewed request workflow.
 */
export async function createMyTask(
  ctx: ServiceCtx,
  body: z.infer<typeof CreateMyTaskBody>
): Promise<{ taskId: string; replayed: boolean }> {
  requireRole(ctx.identity, 'MEMBER');
  // This path exists for employees. A manager files work through the manager task form, which
  // carries assignment, hierarchy and scheduling controls this endpoint deliberately lacks.
  if (ctx.identity.role !== 'MEMBER') {
    throw new DomainError('AUTHORIZATION_DENIED', 'Member self-service creation is limited to the MEMBER role');
  }
  // Preserve retries from installations that used the old global scope, without exposing
  // another member's response or creating a second task after this application update.
  const legacy = await ctx.db.one<{ request_hash: string; status: string; response: { taskId?: string } | null }>(
    "SELECT request_hash, status, response FROM idempotency_keys WHERE scope = 'employee.task.create' AND key = $1",
    [body.idempotencyKey]
  );
  if (legacy) {
    const task = legacy.response?.taskId ? await getTask(ctx.db, legacy.response.taskId) : null;
    if (legacy.status !== 'COMPLETED' || legacy.request_hash !== hashRequest(body) || task?.createdByMemberId !== ctx.identity.memberId) {
      throw new DomainError('IDEMPOTENCY_REPLAY', 'This key cannot be reused; check the original operation');
    }
    return { taskId: task.taskId, replayed: true };
  }
  const project = await getProject(ctx.db, body.projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${body.projectId}`);
  if (project.status !== 'Active' || project.archivedAt) {
    throw new DomainError('INVALID_TRANSITION', 'Work can only be filed under an active project');
  }
  await assertTaskPlacement(ctx, {
    id: null,
    projectId: body.projectId,
    subprojectId: body.subprojectId ?? null,
    parentTaskId: null
  });
  const plan = await planTaskDeadline(ctx, {
    deadline: body.deadline,
    durationValue: null,
    durationUnit: null,
    durationBasis: null,
    acknowledge: body.acknowledgeNonWorking
  });

  const result = await runIdempotent(
    ctx,
    { scope: `employee.task.create:${ctx.identity.memberId}`, key: body.idempotencyKey, request: body },
    async (tx) => {
      const task = await insertTask(tx, {
        projectId: body.projectId,
        subprojectId: body.subprojectId ?? null,
        parentTaskId: null,
        taskName: body.taskName,
        description: body.description ?? '',
        ownerMemberId: ctx.identity.memberId,
        status: 'Not Started',
        priority: body.priority ?? 'Medium',
        plannedStart: plan.plannedStart,
        dueDate: body.deadline,
        progressPercent: 0,
        plannedStartSource: plan.plannedStartSource,
        createdByMemberId: ctx.identity.memberId,
        creationChannel: 'MEMBER'
      });
      await audit(tx, ctx, {
        entityType: 'TASKS',
        entityId: task.taskId,
        action: 'TASK_CREATED',
        newValue: {
          taskId: task.taskId,
          projectId: task.projectId,
          subprojectId: task.subprojectId,
          ownerMemberId: task.ownerMemberId,
          creationChannel: 'MEMBER'
        }
      });
      if (task.dueDate) {
        await enqueueJob(tx, ctx, {
          kind: 'calendar.task',
          dedupeKey: `calendar:${task.taskId}:${task.revision}`,
          payload: { taskId: task.taskId }
        });
      }
      return { taskId: task.taskId };
    }
  );
  return { taskId: result.data.taskId, replayed: result.replayed };
}
