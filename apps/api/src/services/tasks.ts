/**
 * Task commands and the task detail read model.
 *
 * A task save is a partial patch: only the fields the manager addressed are written. A material
 * assignment change bumps `Assignment_Version` and clears the stored approval, a deadline change
 * requires confirmation and writes history, and `Status = Done` is refused here - it belongs to
 * the reviewed completion workflow.
 */
import type { z } from 'zod';
import type { CreateTaskBody, PatchTaskBody, Task, TaskDetail } from '@eh/contracts';
import {
  approveAssignment,
  confirmSchedule,
  countTaskChildren,
  getProject,
  getSubproject,
  getTask,
  insertDeadlineHistory,
  insertTask,
  listChildSummaries,
  listDeadlineHistory,
  listDependencyEdges,
  listHolidays,
  listScheduleConfirmations,
  listSubprojects,
  listTaskAssignees,
  listTaskNodes,
  setDependencies,
  setEffectiveAssignees,
  taskRecordsForDependencyCheck,
  updateTask,
  withdrawPendingCompletionRequests
} from '@eh/db';
import {
  DomainError,
  applyTaskPlan,
  assertDirectCompletionAllowed,
  assertNoDependencyCycle,
  assertNotDirectCompletion,
  assertOverrideAllowed,
  assignmentChanged,
  createCalendar,
  requireRole,
  validateTaskParent,
  type Identity
} from '@eh/domain';
import { audit, enqueueJob, requireConfirmation, runIdempotent, type ServiceCtx } from './common';

const WRITE_ROLES = 'MANAGER' as const;

/**
 * Placement validation shared by the manager create command and the member self-service
 * command: one implementation of the hierarchy, subproject and depth rules.
 */
export async function assertTaskPlacement(
  ctx: ServiceCtx,
  candidate: { id: string | null; projectId: string; subprojectId: string | null; parentTaskId: string | null }
): Promise<void> {
  const rows = await listTaskNodes(ctx.db);
  const nodes = rows.map((row) => ({
    id: row.task_id,
    parentId: row.parent_task_id,
    projectId: row.project_id,
    subprojectId: row.subproject_id
  }));
  validateTaskParent(candidate, nodes);

  if (candidate.subprojectId) {
    const subproject = await getSubproject(ctx.db, candidate.subprojectId);
    if (!subproject) throw new DomainError('HIERARCHY_INVALID', 'Unknown subproject');
    if (subproject.projectId !== candidate.projectId) {
      throw new DomainError('HIERARCHY_INVALID', 'The subproject belongs to another project');
    }
    const all = await listSubprojects(ctx.db, candidate.projectId);
    const byId = new Map(all.map((entry) => [entry.subprojectId, entry]));
    let node = byId.get(candidate.subprojectId);
    const seen = new Set<string>();
    while (node) {
      if (seen.has(node.subprojectId)) throw new DomainError('HIERARCHY_CYCLE', 'Subproject links form a cycle');
      seen.add(node.subprojectId);
      if (node.status === 'Archived') {
        throw new DomainError('HIERARCHY_INVALID', 'A task cannot be placed in an archived subproject');
      }
      node = node.parentSubprojectId ? byId.get(node.parentSubprojectId) : undefined;
    }
  }
}

async function assertMembersActive(ctx: ServiceCtx, memberIds: (string | null | undefined)[]): Promise<void> {
  for (const memberId of memberIds) {
    if (!memberId) continue;
    const row = await ctx.db.one<{ active: boolean }>('SELECT active FROM members WHERE member_id = $1', [memberId]);
    if (!row) throw new DomainError('VALIDATION_FAILED', `Unknown member: ${memberId}`);
    if (!row.active) throw new DomainError('VALIDATION_FAILED', 'A new assignment must name an active member');
  }
}

async function assertDependencies(ctx: ServiceCtx, taskId: string, projectId: string, dependencyIds: string[]): Promise<void> {
  if (!dependencyIds.length) return;
  const unique = [...new Set(dependencyIds)];
  if (unique.includes(taskId)) {
    throw new DomainError('DEPENDENCY_CYCLE', 'A task cannot depend on itself');
  }
  const rows = await taskRecordsForDependencyCheck(ctx.db, unique);
  const missing = unique.filter((id) => !rows.some((row) => row.task_id === id));
  if (missing.length) {
    throw new DomainError('DEPENDENCY_INVALID', 'Unknown dependency task', { missing });
  }
  const edges = await listDependencyEdges(ctx.db);
  const proposed = [
    ...edges.filter((edge) => edge.task_id !== taskId).map((edge) => ({ taskId: edge.task_id, dependsOnId: edge.depends_on_task_id })),
    ...unique.map((id) => ({ taskId: taskId, dependsOnId: id }))
  ];
  assertNoDependencyCycle(proposed, taskId);
  void projectId;
}

/**
 * Resolves the schedule of a task from its deadline and optional duration.
 *
 * A deadline alone is a complete schedule: when no duration is supplied the stored start is
 * kept, no artificial start is derived and no business-calendar acknowledgement is required. A
 * Saturday, Sunday or public holiday is a valid deadline.
 */
export async function planTaskDeadline(
  ctx: ServiceCtx,
  input: {
    deadline: string | null | undefined;
    durationValue: number | null | undefined;
    durationUnit: string | null | undefined;
    durationBasis: string | null | undefined;
    acknowledge?: boolean | undefined;
    milestones?: { name: string; targetDate: string | null }[];
  }
): Promise<{ plannedStart: string | null; plannedStartSource: 'DERIVED' | 'LEGACY' | 'MANUAL' | null }> {
  if (!input.deadline) return { plannedStart: null, plannedStartSource: null };
  const holidays = await listHolidays(ctx.db);
  const applied = applyTaskPlan(
    {
      dueDate: input.deadline,
      plannedDurationValue: input.durationValue ?? null,
      plannedDurationUnit: (input.durationUnit as 'DAY' | 'WEEK' | null) ?? null,
      plannedDurationBasis: (input.durationBasis as 'WORKING_DAYS' | 'CALENDAR_DAYS' | null) ?? null,
      plannedStart: null,
      plannedStartSource: null
    },
    createCalendar(holidays)
  );
  return { plannedStart: applied.plannedStart, plannedStartSource: applied.plannedStartSource };
}

export type EffectiveAssignment = { ownerMemberId: string | null; assigneeIds: string[] };

/**
 * One effective assignment from a unified selection.
 *
 * The current primary owner is kept when it is still selected, so an ordinary edit never moves
 * ownership. Otherwise the deterministic replacement is the lowest member ID in the selection,
 * which makes the result independent of selection or rendering order. The owner is never
 * duplicated among the additional assignees.
 */
export function resolveEffectiveAssignment(
  selectedIds: readonly string[],
  currentOwnerId: string | null | undefined
): EffectiveAssignment {
  const selected = [...new Set(selectedIds.filter(Boolean))].sort();
  if (!selected.length) return { ownerMemberId: null, assigneeIds: [] };
  const owner = currentOwnerId && selected.includes(currentOwnerId) ? currentOwnerId : selected[0]!;
  return { ownerMemberId: owner, assigneeIds: selected.filter((memberId) => memberId !== owner) };
}

function effectiveAssigneesOf(task: Task, assignees: { member_id: string; removed_at: string | null }[]): EffectiveAssignment {
  return {
    ownerMemberId: task.ownerMemberId,
    assigneeIds: assignees
      .filter((row) => !row.removed_at && row.member_id !== task.ownerMemberId)
      .map((row) => row.member_id)
  };
}

export async function createTask(
  ctx: ServiceCtx,
  body: z.infer<typeof CreateTaskBody>
): Promise<{ task: Task; replayed: boolean }> {
  requireRole(ctx.identity, WRITE_ROLES);
  const project = await getProject(ctx.db, body.projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${body.projectId}`);
  if (body.status === 'Done') {
    throw new DomainError('INVALID_TRANSITION', 'Done is written only by the reviewed completion workflow');
  }
  await assertTaskPlacement(ctx, {
    id: null,
    projectId: body.projectId,
    subprojectId: body.subprojectId ?? null,
    parentTaskId: body.parentTaskId ?? null
  });
  await assertMembersActive(ctx, [body.ownerMemberId, ...(body.assigneeIds ?? [])]);
  const assignment = resolveEffectiveAssignment(
    body.assigneeIds !== undefined
      ? body.assigneeIds
      : body.ownerMemberId
        ? [body.ownerMemberId]
        : [],
    body.ownerMemberId ?? null
  );
  const plan = await planTaskDeadline(ctx, {
    deadline: body.deadline,
    durationValue: body.plannedDurationValue,
    durationUnit: body.plannedDurationUnit,
    durationBasis: body.plannedDurationBasis
  });

  const result = await runIdempotent(
    ctx,
    { scope: 'task.create', key: body.idempotencyKey, request: body },
    async (tx) => {
      const task = await insertTask(tx, {
        projectId: body.projectId,
        subprojectId: body.subprojectId ?? null,
        parentTaskId: body.parentTaskId ?? null,
        taskName: body.taskName,
        description: body.description,
        ownerMemberId: assignment.ownerMemberId,
        status: body.status,
        priority: body.priority,
        plannedStart: plan.plannedStart,
        dueDate: body.deadline,
        estimatedHours: body.estimatedHours,
        actualHours: body.actualHours,
        progressPercent: body.progressPercent,
        acceptanceCriteria: body.acceptanceCriteria,
        nextAction: body.nextAction,
        requiredSkillId: body.requiredSkillId,
        requiredSkillLevel: body.requiredSkillLevel,
        notificationEnabled: body.notificationEnabled,
        publicNote: body.publicNote,
        plannedDurationValue: body.plannedDurationValue,
        plannedDurationUnit: body.plannedDurationUnit,
        plannedDurationBasis: body.plannedDurationBasis,
        plannedStartSource: plan.plannedStartSource,
        createdByMemberId: ctx.identity.memberId,
        creationChannel: 'MANAGER'
      });
      if (assignment.ownerMemberId || assignment.assigneeIds.length) {
        await setEffectiveAssignees(
          tx,
          task.taskId,
          [assignment.ownerMemberId, ...assignment.assigneeIds].filter((id): id is string => !!id),
          assignment.ownerMemberId,
          ctx.identity.email
        );
      }
      if (body.dependencyIds?.length) {
        await assertDependencies(ctx, task.taskId, body.projectId, body.dependencyIds);
        await setDependencies(tx, task.taskId, body.dependencyIds);
      }
      await audit(tx, ctx, {
        entityType: 'TASKS',
        entityId: task.taskId,
        action: 'TASK_CREATED',
        newValue: task
      });
      // The calendar handler needs a producer: a created task with a deadline is synchronised.
      if (task.dueDate) {
        await enqueueJob(tx, ctx, {
          kind: 'calendar.task',
          dedupeKey: `calendar:${task.taskId}:${task.revision}`,
          payload: { taskId: task.taskId }
        });
      }
      return task;
    }
  );
  return { task: result.data, replayed: result.replayed };
}

export async function patchTask(ctx: ServiceCtx, taskId: string, body: z.infer<typeof PatchTaskBody>): Promise<Task> {
  requireRole(ctx.identity, WRITE_ROLES);
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  if (body.revision !== task.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved', {
      expected: body.revision,
      stored: task.revision
    });
  }
  if (body.status !== undefined) assertNotDirectCompletion(task.status, body.status);

  const nextSubproject = body.subprojectId !== undefined ? body.subprojectId : task.subprojectId;
  const nextParent = body.parentTaskId !== undefined ? body.parentTaskId : task.parentTaskId;
  if (body.subprojectId !== undefined || body.parentTaskId !== undefined) {
    await assertTaskPlacement(ctx, {
      id: taskId,
      projectId: task.projectId,
      subprojectId: nextSubproject,
      parentTaskId: nextParent
    });
  }

  const currentAssignees = await listTaskAssignees(ctx.db, taskId);
  const currentShape = effectiveAssigneesOf(task, currentAssignees);
  const nextShape: EffectiveAssignment =
    body.assigneeIds !== undefined
      ? resolveEffectiveAssignment(body.assigneeIds, task.ownerMemberId)
      : body.ownerMemberId !== undefined
        ? resolveEffectiveAssignment([body.ownerMemberId, ...currentShape.assigneeIds].filter((id): id is string => !!id), body.ownerMemberId)
        : currentShape;
  const assignmentMoved = assignmentChanged(currentShape, nextShape);
  // Only a new assignment must name an active member; an existing relationship survives a later
  // deactivation and is never dropped by an unrelated edit.
  const alreadyAssigned = new Set(
    [currentShape.ownerMemberId, ...currentShape.assigneeIds].filter((id): id is string => !!id)
  );
  await assertMembersActive(
    ctx,
    [nextShape.ownerMemberId, ...nextShape.assigneeIds].filter(
      (id): id is string => !!id && !alreadyAssigned.has(id)
    )
  );

  const deadlineChanged = body.deadline !== undefined && (body.deadline ?? '') !== (task.dueDate ?? '');
  if (deadlineChanged && body.confirmDeadlineChange !== true) {
    throw new DomainError('CONFIRMATION_REQUIRED', 'A deadline change requires explicit confirmation', {
      previous: task.dueDate,
      next: body.deadline
    });
  }
  const plan =
    body.deadline !== undefined || body.plannedDurationValue !== undefined
      ? await planTaskDeadline(ctx, {
          deadline: body.deadline !== undefined ? body.deadline : task.dueDate,
          durationValue:
            body.plannedDurationValue !== undefined ? body.plannedDurationValue : task.plannedDurationValue,
          durationUnit: body.plannedDurationUnit !== undefined ? body.plannedDurationUnit : task.plannedDurationUnit,
          durationBasis:
            body.plannedDurationBasis !== undefined ? body.plannedDurationBasis : task.plannedDurationBasis
        })
      : null;

  if (body.dependencyIds) {
    await assertDependencies(ctx, taskId, task.projectId, body.dependencyIds);
  }

  const changes: Record<string, unknown> = {};
  const allowed = [
    'taskName',
    'description',
    'subprojectId',
    'parentTaskId',
    'ownerMemberId',
    'status',
    'priority',
    'estimatedHours',
    'actualHours',
    'progressPercent',
    'acceptanceCriteria',
    'nextAction',
    'requiredSkillId',
    'requiredSkillLevel',
    'notificationEnabled',
    'publicNote',
    'plannedDurationValue',
    'plannedDurationUnit',
    'plannedDurationBasis'
  ];
  for (const key of allowed) {
    const value = (body as Record<string, unknown>)[key];
    if (value !== undefined) changes[key] = value;
  }
  if (body.assigneeIds !== undefined || body.ownerMemberId !== undefined) {
    changes.ownerMemberId = nextShape.ownerMemberId;
  }
  if (body.deadline !== undefined) changes.dueDate = body.deadline;
  if (plan) {
    changes.plannedStart = plan.plannedStart;
    changes.plannedStartSource = plan.plannedStartSource;
  }
  if (assignmentMoved) {
    changes.assignmentVersion = task.assignmentVersion + 1;
    changes.assignmentApprovedAt = null;
  }
  if (!Object.keys(changes).length && !body.dependencyIds && body.assigneeIds === undefined) {
    return task;
  }

  const updated = await ctx.db.transaction(async (tx) => {
    const next = await updateTask(tx, taskId, changes, body.revision);
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    if (body.assigneeIds !== undefined || body.ownerMemberId !== undefined) {
      await setEffectiveAssignees(
        tx,
        taskId,
        [nextShape.ownerMemberId, ...nextShape.assigneeIds].filter((id): id is string => !!id),
        nextShape.ownerMemberId,
        ctx.identity.email
      );
    }
    if (body.dependencyIds !== undefined) {
      await setDependencies(tx, taskId, body.dependencyIds);
    }
    if (deadlineChanged) {
      await insertDeadlineHistory(tx, {
        taskId,
        requestId: null,
        previousDueDate: task.dueDate,
        newDueDate: body.deadline ?? null,
        previousPlannedStart: task.plannedStart,
        newPlannedStart: next.plannedStart,
        reason: 'Manager edit',
        changedBy: ctx.identity.email,
        source: 'MANAGER_EDIT'
      });
    }
    await audit(tx, ctx, {
      entityType: 'TASKS',
      entityId: taskId,
      action: assignmentMoved ? 'TASK_REASSIGNED' : 'TASK_UPDATED',
      previousValue: task,
      newValue: next
    });
    if (deadlineChanged || next.plannedStart !== task.plannedStart) {
      await enqueueJob(tx, ctx, {
        kind: 'calendar.task',
        dedupeKey: `calendar:${taskId}:${next.revision}`,
        payload: { taskId }
      });
    }
    return next;
  });
  return updated;
}

export async function approveAssignmentCommand(
  ctx: ServiceCtx,
  taskId: string,
  input: { revision: number; confirmed: true }
): Promise<Task> {
  requireRole(ctx.identity, WRITE_ROLES);
  requireConfirmation(input.confirmed, 'Approving an assignment requires explicit confirmation');
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  if (task.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    const next = await approveAssignment(tx, taskId, input.revision);
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'TASKS',
      entityId: taskId,
      action: 'ASSIGNMENT_APPROVED',
      previousValue: { assignmentVersion: task.assignmentVersion, assignmentApprovedAt: task.assignmentApprovedAt },
      newValue: { assignmentVersion: next.assignmentVersion, assignmentApprovedAt: next.assignmentApprovedAt }
    });
    if (next.notificationEnabled) {
      await enqueueJob(tx, ctx, {
        kind: 'notification.assignment',
        dedupeKey: `assignment:${taskId}:${next.assignmentVersion}`,
        payload: { taskId, assignmentVersion: next.assignmentVersion }
      });
    }
    return next;
  });
}

export async function confirmScheduleCommand(
  ctx: ServiceCtx,
  taskId: string,
  input: { revision: number; confirmed: true; notes?: string }
): Promise<Task> {
  requireRole(ctx.identity, WRITE_ROLES);
  requireConfirmation(input.confirmed, 'Confirming a schedule requires explicit confirmation');
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  if (task.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    await confirmSchedule(tx, taskId, {
      plannedStart: task.plannedStart,
      dueDate: task.dueDate,
      estimatedHours: task.estimatedHours,
      confirmedBy: ctx.identity.email,
      notes: input.notes ?? ''
    });
    await audit(tx, ctx, {
      entityType: 'TASKS',
      entityId: taskId,
      action: 'SCHEDULE_CONFIRMED',
      previousValue: { plannedStart: task.plannedStart, dueDate: task.dueDate },
      newValue: { plannedStart: task.plannedStart, dueDate: task.dueDate, notes: input.notes ?? '' }
    });
    return task;
  });
}

/**
 * A manager completes authorized work directly, without a prior request.
 *
 * One transaction: the single task update, the reconciliation of any pending completion report and
 * the audit record of who decided, in which role, when, and from which state. A pending request is
 * never left misleading and is never approved a second time.
 */
export async function completeTaskDirectly(
  ctx: ServiceCtx,
  taskId: string,
  input: { revision: number; confirmed: true; note?: string }
): Promise<Task> {
  requireRole(ctx.identity, WRITE_ROLES);
  requireConfirmation(input.confirmed, 'Completing a task requires explicit confirmation');
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  if (task.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved', {
      expected: input.revision,
      stored: task.revision
    });
  }
  const children = await countTaskChildren(ctx.db, taskId);
  assertDirectCompletionAllowed({
    actorRole: ctx.identity.role,
    task: {
      taskId,
      status: task.status,
      container: children > 0,
      assignmentApprovedAt: task.assignmentApprovedAt
    }
  });
  const completedAt = new Date().toISOString();
  return ctx.db.transaction(async (tx) => {
    const next = await updateTask(
      tx,
      taskId,
      { status: 'Done', progressPercent: 100, completedAt },
      input.revision
    );
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    const withdrawn = await withdrawPendingCompletionRequests(
      tx,
      taskId,
      ctx.identity.email,
      'The task was completed directly by a manager; this request is no longer needed'
    );
    for (const requestId of withdrawn) {
      await audit(tx, ctx, {
        entityType: 'TASK_REQUESTS',
        entityId: requestId,
        action: 'REQUEST_WITHDRAWN',
        previousValue: { status: 'PENDING' },
        newValue: { status: 'WITHDRAWN', reason: 'DIRECT_COMPLETION', taskId }
      });
    }
    await audit(tx, ctx, {
      entityType: 'TASKS',
      entityId: taskId,
      action: 'TASK_COMPLETED_DIRECT',
      previousValue: {
        status: task.status,
        progressPercent: task.progressPercent,
        completedAt: task.completedAt
      },
      newValue: {
        taskId,
        actorMemberId: ctx.identity.memberId,
        actorRole: ctx.identity.role,
        completedAt,
        completionSource: 'DIRECT',
        requestId: null,
        withdrawnRequestIds: withdrawn,
        status: next.status,
        progressPercent: next.progressPercent,
        note: input.note ?? ''
      }
    });
    return next;
  });
}

export async function overrideComplete(  ctx: ServiceCtx,
  taskId: string,
  input: { revision: number; reason: string; confirmation: string }
): Promise<Task> {
  requireRole(ctx.identity, 'ADMIN');
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  const children = await countTaskChildren(ctx.db, taskId);
  assertOverrideAllowed({
    task: {
      taskId,
      status: task.status,
      container: children > 0,
      assignmentApprovedAt: task.assignmentApprovedAt
    },
    reason: input.reason,
    confirmation: input.confirmation,
    actorRole: ctx.identity.role
  });
  if (task.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    const next = await updateTask(
      tx,
      taskId,
      { status: 'Done', progressPercent: 100, completedAt: new Date().toISOString() },
      input.revision
    );
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'TASKS',
      entityId: taskId,
      action: 'COMPLETION_OVERRIDDEN',
      previousValue: { status: task.status, progressPercent: task.progressPercent },
      newValue: { status: next.status, progressPercent: next.progressPercent, reason: input.reason }
    });
    return next;
  });
}

export async function taskDetail(ctx: ServiceCtx, taskId: string): Promise<TaskDetail> {
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  const [assignees, confirmations, deadlineHistory, children] = await Promise.all([
    listTaskAssignees(ctx.db, taskId),
    listScheduleConfirmations(ctx.db, taskId),
    listDeadlineHistory(ctx.db, taskId),
    listChildSummaries(ctx.db, taskId)
  ]);
  const effective = [
    ...(task.ownerMemberId
      ? [
          {
            memberId: task.ownerMemberId,
            name: task.ownerName,
            active: true,
            assignedAt: task.createdAt,
            assignedBy: '',
            primary: true
          }
        ]
      : []),
    ...assignees
      .filter((row) => !row.removed_at && !row.is_primary)
      .map((row) => ({
        memberId: row.member_id,
        name: row.name,
        active: row.active,
        assignedAt: row.assigned_at,
        assignedBy: row.assigned_by,
        primary: false
      }))
  ];
  const history = assignees
    .filter((row) => !!row.removed_at)
    .map((row) => ({
      memberId: row.member_id,
      name: row.name,
      active: row.active,
      assignedAt: row.assigned_at,
      assignedBy: row.assigned_by,
      primary: row.is_primary
    }));
  return {
    record: task,
    assignees: effective,
    additionalAssigneeIds: effective.filter((row) => !row.primary).map((row) => row.memberId),
    assigneeIds: effective.map((row) => row.memberId),
    assigneeHistory: history,
    confirmations,
    deadlineHistory,
    children
  };
}

export function assertManager(identity: Identity): void {
  requireRole(identity, WRITE_ROLES);
}
