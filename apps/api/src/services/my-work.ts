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
import type {
  CreateMyProjectBody,
  CreateMySubprojectBody,
  CreateMyTaskBody,
  MyWorkList,
  MyWorkProjectFilter,
  MyWorkProjectFormOptions,
  MyWorkProjectOptions,
  Project,
  Subproject
} from '@eh/contracts';
import { getProject, insertProject, insertSubproject, insertTask, getTask } from '@eh/db';
import {
  DomainError,
  businessDate,
  canCreateOwnProject,
  canCreateOwnTask,
  requireRole,
  taskScheduleStatus
} from '@eh/domain';
import { audit, enqueueJob, hashRequest, runIdempotent, type ServiceCtx } from './common';
import { assertProjectDeadlineWarnings, ensureActiveResponsibility } from './projects';
import { assertTaskPlacement, planTaskDeadline } from './tasks';

const PAGE_SIZE = 25;
export type MyWorkSection = 'active' | 'completed';

type MyWorkRow = {
  task_id: string;
  task_name: string;
  project_id: string;
  project_name: string;
  subproject_name: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  planned_start: string | null;
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
         t.status, t.priority, t.due_date, t.planned_start, t.progress_percent, t.actual_hours,
         t.creation_channel, t.completed_at, t.revision,
         EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.task_id AND c.deleted_at IS NULL) AS container,
         EXISTS (SELECT 1 FROM task_requests rp
                  WHERE rp.task_id = t.task_id
                    AND rp.status IN ('PENDING','PROCESSING')) AS pending_request,
         (SELECT rr.status FROM task_requests rr
           WHERE rr.task_id = t.task_id
             AND rr.request_type = 'COMPLETION_REPORT'
           ORDER BY rr.submitted_at DESC LIMIT 1) AS last_completion_status,
         (SELECT rq.status FROM task_requests rq
           WHERE rq.task_id = t.task_id AND rq.requester_member_id = $1
           ORDER BY rq.submitted_at DESC LIMIT 1) AS last_request_status,
         (SELECT rq.request_type FROM task_requests rq
           WHERE rq.task_id = t.task_id AND rq.requester_member_id = $1
           ORDER BY rq.submitted_at DESC LIMIT 1) AS last_request_type
    FROM tasks t
    JOIN projects p ON p.project_id = t.project_id
    LEFT JOIN subprojects s ON s.subproject_id = t.subproject_id`;

const OWN_WORK = `(t.owner_member_id = $1 OR EXISTS (
  SELECT 1 FROM task_assignees a WHERE a.task_id = t.task_id AND a.member_id = $1 AND a.removed_at IS NULL))`;

/** Archived and cancelled work is never active work, whatever the role of the reader. */
const ACTIVE_WORK = `t.deleted_at IS NULL AND t.status <> 'Cancelled'
  AND p.status <> 'Archived' AND p.archived_at IS NULL
  AND (t.subproject_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM subprojects sp WHERE sp.subproject_id = t.subproject_id AND sp.status = 'Archived'))`;

/**
 * One review state per task, whichever authorized person filed the report.
 *
 * A pending completion report is therefore visible to every assignee even when somebody else
 * submitted it, and a decision on the task is never reported twice.
 */
export function reviewStateOf(row: { pending_request: boolean; last_completion_status: string | null }) {
  if (row.pending_request) return 'PENDING' as const;
  const status = row.last_completion_status ?? '';
  if (['APPROVED', 'REJECTED', 'RETURNED', 'STALE'].includes(status)) {
    return status as 'APPROVED' | 'REJECTED' | 'RETURNED' | 'STALE';
  }
  return 'NONE' as const;
}

/**
 * The signed-in member's own work.
 *
 * The identity is always the verified session member, so a manager keeps a personal list beside
 * the departmental one, and a MEMBER, a MANAGER, an ADMIN and a VIEWER each see only their own
 * assignments. Nothing is filtered by a role or an identifier supplied by the browser.
 *
 * Every filter is resolved here, before LIMIT/OFFSET, so a matching total is never derived from
 * the visible page.
 */
export type MyWorkFilters = {
  query?: string;
  projectId?: string;
  overdue?: boolean;
  dueThisWeek?: boolean;
  awaitingReview?: boolean;
};

export async function listMyWork(
  ctx: ServiceCtx,
  page: number,
  section: MyWorkSection = 'active',
  filters: MyWorkFilters = {}
): Promise<MyWorkList> {
  requireRole(ctx.identity, 'VIEWER');
  const sectionWhere = section === 'completed' ? "t.status = 'Done'" : "t.status <> 'Done'";
  const order = section === 'completed'
    ? 't.completed_at DESC NULLS LAST, t.task_id ASC'
    : 't.due_date ASC NULLS LAST, t.task_id ASC';

  const params: unknown[] = [ctx.identity.memberId];
  const where: string[] = [];
  const query = (filters.query ?? '').trim();
  if (query) {
    params.push(`%${query}%`);
    where.push(`(t.task_name ILIKE $${params.length} OR p.project_name ILIKE $${params.length})`);
  }
  if (filters.projectId) {
    params.push(filters.projectId);
    where.push(`t.project_id = $${params.length}`);
  }
  if (filters.overdue) {
    params.push(businessDate());
    where.push(
      `(t.due_date IS NOT NULL AND t.due_date < $${params.length}::date AND t.status <> 'Done' AND t.status <> 'Cancelled')`
    );
  }
  if (filters.dueThisWeek) {
    params.push(businessDate());
    where.push(
      `(t.due_date IS NOT NULL AND t.due_date >= $${params.length}::date AND t.due_date < ($${params.length}::date + 7) AND t.status <> 'Done' AND t.status <> 'Cancelled')`
    );
  }
  if (filters.awaitingReview) {
    where.push(
      `EXISTS (SELECT 1 FROM task_requests rp
                WHERE rp.task_id = t.task_id AND rp.requester_member_id = $1
                  AND rp.status IN ('PENDING','PROCESSING'))`
    );
  }
  const filterWhere = where.length ? ` AND ${where.join(' AND ')}` : '';
  const pageParam = params.length + 1;
  params.push((page - 1) * PAGE_SIZE);

  const [rows, total, activeTotal, completedTotal, unfiltered] = await Promise.all([
    ctx.db.many<MyWorkRow>(
      `${MY_WORK_SELECT}
        WHERE ${ACTIVE_WORK} AND ${OWN_WORK} AND ${sectionWhere}${filterWhere}
        ORDER BY ${order}
        LIMIT ${PAGE_SIZE} OFFSET $${pageParam}`,
      params
    ),
    ctx.db.one<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM tasks t
         JOIN projects p ON p.project_id = t.project_id
        WHERE ${ACTIVE_WORK} AND ${OWN_WORK} AND ${sectionWhere}${filterWhere}`,
      params.slice(0, -1)
    ),
    ctx.db.one<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM tasks t
         JOIN projects p ON p.project_id = t.project_id
        WHERE ${ACTIVE_WORK} AND ${OWN_WORK} AND t.status <> 'Done'${filterWhere}`,
      params.slice(0, -1)
    ),
    ctx.db.one<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM tasks t
         JOIN projects p ON p.project_id = t.project_id
        WHERE ${ACTIVE_WORK} AND ${OWN_WORK} AND t.status = 'Done'${filterWhere}`,
      params.slice(0, -1)
    ),
    ctx.db.one<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM tasks t JOIN projects p ON p.project_id = t.project_id
        WHERE ${ACTIVE_WORK} AND ${OWN_WORK} AND t.status <> 'Done'`,
      [ctx.identity.memberId]
    )
  ]);
  return {
    total: Number(total?.count ?? 0),
    activeTotal: Number(activeTotal?.count ?? 0),
    completedTotal: Number(completedTotal?.count ?? 0),
    unfilteredActiveTotal: Number(unfiltered?.count ?? 0),
    items: rows.map((row) => {
      const schedule = taskScheduleStatus({
        status: row.status,
        plannedStart: row.planned_start,
        dueDate: row.due_date
      });
      return {
        container: row.container,
        taskId: row.task_id,
        taskName: row.task_name,
        projectId: row.project_id,
        projectName: row.project_name,
        subprojectName: row.subproject_name ?? '',
        status: row.status as MyWorkList['items'][number]['status'],
        displayStatus: schedule.state,
        scheduleMissing: schedule.missing,
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
      };
    })
  };
}

export const MY_WORK_PAGE_SIZE = PAGE_SIZE;

/**
 * The project filter for the member's own work.
 *
 * Paged and searchable on the server, so no silent row cap decides which projects a member can
 * reach. Only projects that really appear in the member's own work are selectable, and the
 * selected project stays readable when it is not on the current page.
 */
export async function listMyWorkProjectFilter(
  ctx: ServiceCtx,
  input: { query?: string; page: number; pageSize?: number; selectedId?: string }
): Promise<MyWorkProjectFilter> {
  requireRole(ctx.identity, 'VIEWER');
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100);
  const params: unknown[] = [ctx.identity.memberId];
  const where: string[] = [];
  const query = (input.query ?? '').trim().toLowerCase();
  if (query) {
    params.push(`%${query}%`);
    where.push(`lower(p.project_name) LIKE $${params.length}`);
  }
  const filterWhere = where.length ? ` AND ${where.join(' AND ')}` : '';
  const scope = `FROM tasks t JOIN projects p ON p.project_id = t.project_id
     WHERE ${ACTIVE_WORK} AND ${OWN_WORK}${filterWhere}`;
  const [totalRow, rows] = await Promise.all([
    ctx.db.one<{ count: string }>(`SELECT count(DISTINCT p.project_id)::text AS count ${scope}`, [...params]),
    ctx.db.many<{ project_id: string; project_name: string; responsibility_name: string | null; task_count: string }>(
      `SELECT p.project_id, p.project_name, r.name AS responsibility_name, count(*)::text AS task_count
         FROM tasks t
         JOIN projects p ON p.project_id = t.project_id
         LEFT JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
        WHERE ${ACTIVE_WORK} AND ${OWN_WORK}${filterWhere}
        GROUP BY p.project_id, p.project_name, r.name
        ORDER BY lower(p.project_name) ASC, p.project_id ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (input.page - 1) * pageSize]
    )
  ]);
  const selected = input.selectedId
    ? await ctx.db.one<{ project_id: string; project_name: string; responsibility_name: string | null; task_count: string }>(
        `SELECT p.project_id, p.project_name, r.name AS responsibility_name, count(*)::text AS task_count
           FROM tasks t
           JOIN projects p ON p.project_id = t.project_id
           LEFT JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
          WHERE ${ACTIVE_WORK} AND ${OWN_WORK} AND p.project_id = $2
          GROUP BY p.project_id, p.project_name, r.name`,
        [ctx.identity.memberId, input.selectedId]
      )
    : null;
  const map = (row: { project_id: string; project_name: string; responsibility_name: string | null; task_count: string }) => ({
    projectId: row.project_id,
    projectName: row.project_name,
    responsibilityName: row.responsibility_name ?? '',
    taskCount: Number(row.task_count ?? 0)
  });
  const total = Number(totalRow?.count ?? 0);
  return {
    items: rows.map(map),
    total,
    page: input.page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    selected: selected ? map(selected) : null
  };
}

/**
 * The responsibilities a MEMBER may choose when filing a new project.
 *
 * Only active responsibilities are eligible, and only their identity and label leave the server.
 * A manager reference payload is never reused for a member form.
 */
export async function myWorkProjectFormOptions(ctx: ServiceCtx): Promise<MyWorkProjectFormOptions> {
  if (!canCreateOwnProject(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Only a MEMBER files a project through self-service');
  }
  const rows = await ctx.db.many<{ responsibility_id: string; name: string }>(
    `SELECT responsibility_id, name
       FROM responsibilities
      WHERE status = 'Active'
      ORDER BY name, responsibility_id
      LIMIT 500`
  );
  return {
    projectCreationEnabled: true,
    responsibilities: rows.map((row) => ({ responsibilityId: row.responsibility_id, name: row.name }))
  };
}

/** Active projects and non-archived subprojects a member may file work under. */
export async function myWorkProjectOptions(ctx: ServiceCtx): Promise<MyWorkProjectOptions> {
  if (!canCreateOwnTask(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Only a MEMBER files a task through self-service');
  }
  const [projects, subprojects] = await Promise.all([
    ctx.db.many<{ project_id: string; project_name: string; responsibility_name: string | null }>(
      `SELECT p.project_id, p.project_name, r.name AS responsibility_name
         FROM projects p
         LEFT JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
        WHERE p.status = 'Active' AND p.archived_at IS NULL
        ORDER BY p.project_name
        LIMIT 500`
    ),
    ctx.db.many<{
      subproject_id: string;
      subproject_name: string;
      project_id: string;
      parent_subproject_id: string | null;
      depth: number;
    }>(
      `SELECT s.subproject_id, s.subproject_name, s.project_id, s.parent_subproject_id,
              eh_subproject_depth(s.subproject_id) AS depth
         FROM subprojects s
         JOIN projects p ON p.project_id = s.project_id
        WHERE s.deleted_at IS NULL AND s.status <> 'Archived'
          AND p.status = 'Active' AND p.archived_at IS NULL
        ORDER BY eh_subproject_depth(s.subproject_id), s.subproject_name
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
        .map((entry) => ({
          subprojectId: entry.subproject_id,
          subprojectName: entry.subproject_name,
          parentSubprojectId: entry.parent_subproject_id,
          depth: Number(entry.depth) || 1
        }))
    }))
  };
}

/**
 * A MEMBER no longer edits progress or recorded effort.
 *
 * The only way for a member to finish work is the reviewed completion request, so no callable
 * path exists that lets a member rewrite progress, hours or a stored status.
 */

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
  if (!canCreateOwnTask(ctx.identity)) {
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
    durationBasis: null
  });
  const plannedStart = body.plannedStart ?? plan.plannedStart;
  if (plannedStart && plannedStart > body.deadline) {
    throw new DomainError('VALIDATION_FAILED', 'Start date must be on or before finish date');
  }

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
        plannedStart,
        dueDate: body.deadline,
        progressPercent: 0,
        plannedStartSource: body.plannedStart ? 'MANUAL' : plan.plannedStartSource,
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

/**
 * Creates one project filed by the verified member.
 *
 * A MEMBER creates new work from the project screens; creation is not an approval step. The owner
 * is the verified session, the lifecycle starts `Active`, the visibility is `INTERNAL` and the
 * responsibility must be active. A retried idempotency key returns the project it created instead
 * of a duplicate, and the audit row names the member creation channel.
 */
export async function createMyProject(
  ctx: ServiceCtx,
  body: z.infer<typeof CreateMyProjectBody>
): Promise<{ project: Project; replayed: boolean }> {
  requireRole(ctx.identity, 'MEMBER');
  if (!canCreateOwnProject(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Member self-service creation is limited to the MEMBER role');
  }
  const projectName = body.projectName.trim();
  if (!projectName) throw new DomainError('VALIDATION_FAILED', 'A project name is required');
  await ensureActiveResponsibility(ctx, body.responsibilityId);
  if (body.plannedStart && body.committedDeadline && body.plannedStart > body.committedDeadline) {
    throw new DomainError('VALIDATION_FAILED', 'Start date must be on or before finish date');
  }
  await assertProjectDeadlineWarnings(ctx, body.committedDeadline, body.acknowledgeNonWorking);

  const result = await runIdempotent(
    ctx,
    { scope: `employee.project.create:${ctx.identity.memberId}`, key: body.idempotencyKey, request: body },
    async (tx) => {
      const project = await insertProject(tx, {
        projectName,
        description: body.description ?? '',
        responsibilityId: body.responsibilityId,
        projectOwnerId: ctx.identity.memberId,
        status: 'Active',
        priority: body.priority ?? 'Medium',
        plannedStart: body.plannedStart ?? null,
        committedDeadline: body.committedDeadline ?? null,
        originalDeadline: body.committedDeadline ?? null,
        // The authorized V2 default for new work; a member never supplies a visibility.
        dashboardVisibility: 'INTERNAL'
      });
      await audit(tx, ctx, {
        entityType: 'PROJECTS',
        entityId: project.projectId,
        action: 'PROJECT_CREATED',
        newValue: {
          projectId: project.projectId,
          projectName: project.projectName,
          responsibilityId: project.responsibilityId,
          projectOwnerId: project.projectOwnerId,
          status: project.status,
          dashboardVisibility: project.dashboardVisibility,
          creationChannel: 'MEMBER'
        }
      });
      return project;
    }
  );
  return { project: result.data, replayed: result.replayed };
}

/**
 * A MEMBER files a subproject immediately, with no approval step.
 *
 * The owner is the verified member, the status is `Active` and the hierarchy is validated against
 * the whole project tree, so a member can never place work across a project boundary, under an
 * archived ancestor or beyond the four-level nesting policy. A retry with the same key returns the
 * subproject it created instead of a duplicate.
 */
export async function createMySubproject(
  ctx: ServiceCtx,
  body: z.infer<typeof CreateMySubprojectBody>
): Promise<{ subproject: Subproject; replayed: boolean }> {
  requireRole(ctx.identity, 'MEMBER');
  if (!canCreateOwnTask(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Member self-service creation is limited to the MEMBER role');
  }
  const subprojectName = body.subprojectName.trim();
  if (!subprojectName) throw new DomainError('VALIDATION_FAILED', 'A subproject name is required');

  const project = await getProject(ctx.db, body.projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${body.projectId}`);
  if (project.status !== 'Active' || project.archivedAt) {
    throw new DomainError('INVALID_TRANSITION', 'A subproject can only be filed under an active project');
  }

  const parentSubprojectId = body.parentSubprojectId ?? null;
  if (parentSubprojectId) {
    throw new DomainError('HIERARCHY_INVALID', 'New subprojects must be direct children of their project');
  }

  const result = await runIdempotent(
    ctx,
    { scope: `employee.subproject.create:${ctx.identity.memberId}`, key: body.idempotencyKey, request: body },
    async (tx) => {
      const subproject = await insertSubproject(tx, {
        projectId: body.projectId,
        parentSubprojectId: null,
        subprojectName,
        description: body.description ?? '',
        ownerId: ctx.identity.memberId,
        status: 'Active',
        deadline: body.deadline ?? null,
        estimatedHours: null,
        nextAction: ''
      });
      await audit(tx, ctx, {
        entityType: 'SUBPROJECTS',
        entityId: subproject.subprojectId,
        action: 'SUBPROJECT_CREATED',
        newValue: {
          subprojectId: subproject.subprojectId,
          projectId: subproject.projectId,
          parentSubprojectId: subproject.parentSubprojectId,
          ownerId: subproject.ownerId,
          createdAt: subproject.createdAt,
          creationChannel: 'MEMBER'
        }
      });
      return subproject;
    }
  );
  return { subproject: result.data, replayed: result.replayed };
}
