/**
 * Project and subproject commands.
 *
 * A write is one transaction that also records its audit evidence and any outbox work. The
 * deadline and status rules stay server-side: a committed deadline change needs explicit
 * confirmation, a non-working deadline needs acknowledgement, and a project can only be
 * Completed when every task is done.
 */
import type { z } from 'zod';
import type { Project, Subproject } from '@eh/contracts';
import type { CreateProjectBody, CreateSubprojectBody, PatchProjectBody, PatchSubprojectBody } from '@eh/contracts';
import {
  archiveProject,
  getProject,
  getSubproject,
  insertProject,
  insertSubproject,
  listHolidays,
  listSubprojects,
  listTaskSummariesForProject,
  updateProject,
  updateSubproject
} from '@eh/db';
import {
  DomainError,
  assertDeadlineChangeConfirmed,
  assertProjectCompletable,
  assertProjectCreationStatus,
  assertProjectLifecycleChange,
  assertWarningsAcknowledged,
  businessDate,
  planningWarnings,
  requireRole
} from '@eh/domain';
import { audit, requireConfirmation, runIdempotent, type ServiceCtx } from './common';

const WRITE_ROLES = 'MANAGER' as const;

function assertScheduleOrder(start: string | null | undefined, finish: string | null | undefined): void {
  if (start && finish && start > finish) {
    throw new DomainError('VALIDATION_FAILED', 'Start date must be on or before finish date');
  }
}

export async function ensureActiveResponsibility(ctx: ServiceCtx, responsibilityId: string): Promise<void> {
  const row = await ctx.db.one<{ status: string; name: string }>(
    'SELECT status, name FROM responsibilities WHERE responsibility_id = $1',
    [responsibilityId]
  );
  if (!row) throw new DomainError('RESPONSIBILITY_REQUIRED', 'A responsibility is required for a new project');
  if (row.status !== 'Active') {
    throw new DomainError('RESPONSIBILITY_REQUIRED', 'A project must belong to an active responsibility');
  }
}

async function ensureMember(ctx: ServiceCtx, memberId: string | null | undefined): Promise<void> {
  if (!memberId) return;
  const row = await ctx.db.one<{ active: boolean }>('SELECT active FROM members WHERE member_id = $1', [memberId]);
  if (!row) throw new DomainError('VALIDATION_FAILED', `Unknown member: ${memberId}`);
  if (!row.active) throw new DomainError('VALIDATION_FAILED', 'A new assignment must name an active member');
}

async function deadlineGate(
  ctx: ServiceCtx,
  deadline: string | null | undefined,
  duration: { value?: number | null; unit?: string | null; basis?: string | null } | undefined,
  acknowledge: boolean | undefined
): Promise<void> {
  if (!deadline) return;
  const holidays = await listHolidays(ctx.db);
  const warnings = planningWarnings(
    {
      deadline,
      today: businessDate(),
      durationValue: duration?.value ?? null,
      durationUnit: (duration?.unit as 'DAY' | 'WEEK' | null) ?? null,
      durationBasis: (duration?.basis as 'WORKING_DAYS' | 'CALENDAR_DAYS' | null) ?? null,
      holidays
    },
    undefined
  );
  assertWarningsAcknowledged(warnings, acknowledge === true);
}

/**
 * The deadline warning gate for member self-service creation.
 *
 * A non-working deadline is never moved automatically: the caller must acknowledge the warning,
 * exactly as the manager project form does.
 */
export async function assertProjectDeadlineWarnings(
  ctx: ServiceCtx,
  deadline: string | null | undefined,
  acknowledge: boolean | undefined
): Promise<void> {
  await deadlineGate(ctx, deadline, undefined, acknowledge);
}

export async function createProject(
  ctx: ServiceCtx,
  body: z.infer<typeof CreateProjectBody>
): Promise<{ project: Project; replayed: boolean }> {
  requireRole(ctx.identity, WRITE_ROLES);
  assertProjectCreationStatus(body.status);
  await ensureActiveResponsibility(ctx, body.responsibilityId);
  if (body.projectOwnerId) await ensureMember(ctx, body.projectOwnerId);
  assertScheduleOrder(body.plannedStart, body.committedDeadline);
  await deadlineGate(ctx, body.committedDeadline, undefined, true);

  const result = await runIdempotent(
    ctx,
    { scope: 'project.create', key: body.idempotencyKey, request: body },
    async (tx) => {
      const project = await insertProject(tx, {
        projectName: body.projectName,
        description: body.description,
        category: body.category,
        responsibilityId: body.responsibilityId,
        projectOwnerId: body.projectOwnerId ?? ctx.identity.memberId,
        // Schedule progress is derived, so a new project starts as an explicit, non-terminal
        // record; only completion, cancellation and archive change the stored lifecycle.
        status: body.status ?? 'Active',
        priority: body.priority,
        plannedStart: body.plannedStart,
        forecastEnd: body.forecastEnd,
        committedDeadline: body.committedDeadline,
        originalDeadline: body.originalDeadline ?? body.committedDeadline,
        nextMilestone: body.nextMilestone,
        nextAction: body.nextAction,
        notificationEnabled: body.notificationEnabled,
        // V2 default: a new project is INTERNAL, so it is eligible for internal visibility under
        // the existing access and publication rules. An explicit RESTRICTED is still respected.
        dashboardVisibility: body.dashboardVisibility ?? 'INTERNAL',
        dashboardSummary: body.dashboardSummary
      });
      await audit(tx, ctx, {
        entityType: 'PROJECTS',
        entityId: project.projectId,
        action: 'PROJECT_CREATED',
        newValue: project
      });
      return project;
    }
  );
  return { project: result.data, replayed: result.replayed };
}

export async function patchProject(
  ctx: ServiceCtx,
  projectId: string,
  body: z.infer<typeof PatchProjectBody>
): Promise<Project> {
  requireRole(ctx.identity, WRITE_ROLES);
  const project = await getProject(ctx.db, projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  if (body.revision !== project.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved', {
      expected: body.revision,
      stored: project.revision
    });
  }
  if (body.responsibilityId !== undefined && body.responsibilityId !== null) {
    await ensureActiveResponsibility(ctx, body.responsibilityId);
  }
  if (body.projectOwnerId) await ensureMember(ctx, body.projectOwnerId);
  if (body.plannedStart !== undefined || body.committedDeadline !== undefined) {
    assertScheduleOrder(
      body.plannedStart !== undefined ? body.plannedStart : project.plannedStart,
      body.committedDeadline !== undefined ? body.committedDeadline : project.committedDeadline
    );
  }
  assertDeadlineChangeConfirmed(project.committedDeadline, body.committedDeadline, body.confirmDeadlineChange === true);
  await deadlineGate(ctx, body.committedDeadline, undefined, body.acknowledgeNonWorking);

  if (body.status !== undefined && body.status !== project.status) {
    assertProjectLifecycleChange(project.status, body.status);
    requireConfirmation(
      body.confirmStatusChange === true,
      'Completing, cancelling or reactivating a project requires explicit confirmation'
    );
  }

  if (body.status === 'Completed') {
    const tasks = await listTaskSummariesForProject(ctx.db, projectId);
    assertProjectCompletable(tasks.map((task) => ({ taskId: task.taskId, status: task.status })));
  }

  const changes: Record<string, unknown> = {};
  const allowed = [
    'projectName',
    'description',
    'category',
    'responsibilityId',
    'projectOwnerId',
    'status',
    'priority',
    'plannedStart',
    'forecastEnd',
    'committedDeadline',
    'nextMilestone',
    'nextAction',
    'notificationEnabled',
    'dashboardVisibility',
    'dashboardSummary'
  ];
  for (const key of allowed) {
    const value = (body as Record<string, unknown>)[key];
    if (value !== undefined) changes[key] = value;
  }
  if (!Object.keys(changes).length) return project;

  const updated = await ctx.db.transaction(async (tx) => {
    const next = await updateProject(tx, projectId, changes, body.revision);
    if (!next) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }
    await audit(tx, ctx, {
      entityType: 'PROJECTS',
      entityId: projectId,
      action: 'PROJECT_UPDATED',
      previousValue: project,
      newValue: next
    });
    return next;
  });
  return updated;
}

export async function archiveProjectCommand(
  ctx: ServiceCtx,
  projectId: string,
  input: { revision: number; confirmed: true; reason?: string }
): Promise<Project> {
  requireRole(ctx.identity, WRITE_ROLES);
  requireConfirmation(input.confirmed, 'Archiving a project requires explicit confirmation');
  const project = await getProject(ctx.db, projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  if (project.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    const archived = await archiveProject(tx, projectId, input.revision);
    if (!archived) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'PROJECTS',
      entityId: projectId,
      action: 'PROJECT_ARCHIVED',
      previousValue: project,
      newValue: archived
    });
    return archived;
  });
}

/* ---------------------------- subprojects -------------------------------- */

export async function createSubproject(
  ctx: ServiceCtx,
  body: z.infer<typeof CreateSubprojectBody>
): Promise<{ subproject: Subproject; replayed: boolean }> {
  requireRole(ctx.identity, WRITE_ROLES);
  const project = await getProject(ctx.db, body.projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${body.projectId}`);
  if (body.parentSubprojectId) {
    throw new DomainError('HIERARCHY_INVALID', 'New subprojects must be direct children of their project');
  }
  if (body.ownerId) await ensureMember(ctx, body.ownerId);
  assertScheduleOrder(body.plannedStart, body.deadline);

  const result = await runIdempotent(
    ctx,
    { scope: 'subproject.create', key: body.idempotencyKey, request: body },
    async (tx) => {
      const subproject = await insertSubproject(tx, {
        projectId: body.projectId,
        parentSubprojectId: null,
        subprojectName: body.subprojectName,
        description: body.description,
        ownerId: body.ownerId,
        status: body.status,
        plannedStart: body.plannedStart,
        plannedEnd: body.plannedEnd,
        deadline: body.deadline,
        estimatedHours: body.estimatedHours,
        nextAction: body.nextAction
      });
      await audit(tx, ctx, {
        entityType: 'SUBPROJECTS',
        entityId: subproject.subprojectId,
        action: 'SUBPROJECT_CREATED',
        newValue: subproject
      });
      return subproject;
    }
  );
  return { subproject: result.data, replayed: result.replayed };
}

export async function patchSubproject(
  ctx: ServiceCtx,
  subprojectId: string,
  body: z.infer<typeof PatchSubprojectBody>
): Promise<Subproject> {
  requireRole(ctx.identity, WRITE_ROLES);
  const subproject = await getSubproject(ctx.db, subprojectId);
  if (!subproject) throw new DomainError('NOT_FOUND', `Subproject not found: ${subprojectId}`);
  if (body.revision !== subproject.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  if (body.ownerId) await ensureMember(ctx, body.ownerId);
  if (body.parentSubprojectId !== undefined && body.parentSubprojectId !== subproject.parentSubprojectId) {
    throw new DomainError('HIERARCHY_INVALID', 'Subproject nesting is retained only for legacy records');
  }
  if (body.plannedStart !== undefined || body.deadline !== undefined || body.plannedEnd !== undefined) {
    assertScheduleOrder(
      body.plannedStart !== undefined ? body.plannedStart : subproject.plannedStart,
      body.deadline !== undefined ? body.deadline : subproject.deadline
    );
  }
  if (body.projectId && body.projectId !== subproject.projectId) {
    const children = await listSubprojects(ctx.db, subproject.projectId);
    const hasChildren = children.some((entry) => entry.parentSubprojectId === subprojectId);
    if (hasChildren || body.parentSubprojectId) {
      throw new DomainError(
        'HIERARCHY_INVALID',
        'A subproject with descendants or a parent cannot move to another project'
      );
    }
  }
  assertDeadlineChangeConfirmed(subproject.deadline, body.deadline, body.confirmDeadlineChange === true);

  const changes: Record<string, unknown> = {};
  const allowed = [
    'projectId',
    'subprojectName',
    'description',
    'ownerId',
    'status',
    'plannedStart',
    'plannedEnd',
    'deadline',
    'estimatedHours',
    'nextAction'
  ];
  for (const key of allowed) {
    const value = (body as Record<string, unknown>)[key];
    if (value !== undefined) changes[key] = value;
  }
  if (!Object.keys(changes).length) return subproject;

  return ctx.db.transaction(async (tx) => {
    const next = await updateSubproject(tx, subprojectId, changes, body.revision);
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'SUBPROJECTS',
      entityId: subprojectId,
      action: 'SUBPROJECT_UPDATED',
      previousValue: subproject,
      newValue: next
    });
    return next;
  });
}

export async function setSubprojectStatus(
  ctx: ServiceCtx,
  subprojectId: string,
  input: { revision: number; confirmed: true; status: 'Archived' | 'Active'; reason?: string }
): Promise<Subproject> {
  requireRole(ctx.identity, WRITE_ROLES);
  requireConfirmation(input.confirmed, 'Changing a subproject status requires explicit confirmation');
  const subproject = await getSubproject(ctx.db, subprojectId);
  if (!subproject) throw new DomainError('NOT_FOUND', `Subproject not found: ${subprojectId}`);
  if (subproject.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    const next = await updateSubproject(tx, subprojectId, { status: input.status }, input.revision);
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'SUBPROJECTS',
      entityId: subprojectId,
      action: input.status === 'Archived' ? 'SUBPROJECT_ARCHIVED' : 'SUBPROJECT_REACTIVATED',
      previousValue: subproject,
      newValue: next
    });
    return next;
  });
}
