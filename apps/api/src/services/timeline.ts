/**
 * Read-only timeline projection.
 *
 * The timeline answers "when is this planned and when is it due?" - never "how much work is
 * left?". It therefore reuses the one counting rule (`taskScope`) and the existing visibility
 * policy, adds no write path and derives nothing that is stored back on a record:
 *
 * - a plan (`plannedStart` / `forecastEnd` / `plannedEnd`) stays a plan;
 * - a `deadline` stays a commitment and is rendered as a separate marker;
 * - `completedAt` stays the recorded completion;
 * - a `childRange` is a display span computed here from dated descendants inside the authorized
 *   filter, labelled as such and never counted as extra work.
 *
 * No date is ever invented from `createdAt`, today or an effort figure.
 */
import type {
  ProjectAttention,
  ProjectAttentionBucket,
  ProjectAttentionFilter,
  TimelineChildRange,
  TimelineProjectBranch,
  TimelineProjectPage,
  TimelineProjectRow,
  TimelineSubprojectRow,
  TimelineTaskRow
} from '@eh/contracts';
import {
  getProject,
  listProjects,
  listSubprojects,
  listTaskSummariesForProject,
  listWorkResponsibilityOptions
} from '@eh/db';
import {
  DomainError,
  assertReadableDivision,
  canIncludeArchivedWork,
  canSeeRestrictedWork,
  createScope,
  projectScheduleStatus,
  readableDivisionIds,
  requireRole,
  taskScheduleStatus
} from '@eh/domain';
import { taskScope } from './views';
import type { WorkCtx } from './work';

type Range = { start: string | null; end: string | null; dated: number; total: number };
type DisplaySchedule = {
  scheduleStart: string | null;
  scheduleFinish: string | null;
  dateState: 'RANGE' | 'FINISH_ONLY' | 'START_ONLY' | 'UNDATED' | 'INVALID';
  dateSource: 'EXPLICIT' | 'DERIVED' | 'NONE';
};

function emptyRange(): Range {
  return { start: null, end: null, dated: 0, total: 0 };
}

/** Adds one record that either carries usable dates or exists only in the undated section. */
function addRecord(target: Range, start: string | null, end: string | null, dated: boolean): Range {
  if (start && (!target.start || start < target.start)) target.start = start;
  if (end && (!target.end || end > target.end)) target.end = end;
  if (dated) target.dated += 1;
  target.total += 1;
  return target;
}

function addRange(target: Range, other: Range): Range {
  if (other.start && (!target.start || other.start < target.start)) target.start = other.start;
  if (other.end && (!target.end || other.end > target.end)) target.end = other.end;
  target.dated += other.dated;
  target.total += other.total;
  return target;
}

function toChildRange(range: Range): TimelineChildRange {
  return { start: range.start, end: range.end, datedItems: range.dated, totalItems: range.total };
}

function explicitSchedule(start: string | null, finish: string | null): DisplaySchedule {
  if (start && finish && start > finish) {
    return { scheduleStart: null, scheduleFinish: null, dateState: 'INVALID', dateSource: 'EXPLICIT' };
  }
  if (start && finish) {
    return { scheduleStart: start, scheduleFinish: finish, dateState: 'RANGE', dateSource: 'EXPLICIT' };
  }
  if (finish) {
    return { scheduleStart: finish, scheduleFinish: finish, dateState: 'FINISH_ONLY', dateSource: 'EXPLICIT' };
  }
  if (start) {
    return { scheduleStart: null, scheduleFinish: null, dateState: 'START_ONLY', dateSource: 'EXPLICIT' };
  }
  return { scheduleStart: null, scheduleFinish: null, dateState: 'UNDATED', dateSource: 'NONE' };
}

function derivedSchedule(range: Range): DisplaySchedule {
  if (!range.start || !range.end) {
    return { scheduleStart: null, scheduleFinish: null, dateState: 'UNDATED', dateSource: 'NONE' };
  }
  return {
    scheduleStart: range.start,
    scheduleFinish: range.end,
    dateState: range.start === range.end ? 'FINISH_ONLY' : 'RANGE',
    dateSource: 'DERIVED'
  };
}

function rangeOfSchedules(schedules: Iterable<DisplaySchedule>): Range {
  const range = emptyRange();
  for (const schedule of schedules) {
    if (!schedule.scheduleStart || !schedule.scheduleFinish) continue;
    addRecord(range, schedule.scheduleStart, schedule.scheduleFinish, true);
  }
  return range;
}

function fitRange(range: Range): { start: string; end: string } | null {
  return range.start && range.end ? { start: range.start, end: range.end } : null;
}

function projectVisibleTo(
  ctx: WorkCtx,
  project: { status: string; dashboardVisibility: string; archivedAt: string | null }
): boolean {
  if (canSeeRestrictedWork(ctx.identity)) return true;
  return (
    String(project.dashboardVisibility ?? '').toUpperCase() === 'INTERNAL' &&
    project.status !== 'Archived' &&
    !project.archivedAt
  );
}

/**
 * One aggregate per project for the dated descendants of the page that was just read.
 *
 * The aggregate covers the whole authorized scope of those projects, never a rendered page, so a
 * summary span cannot change when the reader scrolls or changes the page size.
 */
function descendantRanges(
  tasks: readonly {
    taskId: string; projectId: string; subprojectId: string | null; parentTaskId: string | null;
    plannedStart: string | null; dueDate: string | null; status: string;
  }[],
  subprojects: readonly { subprojectId: string; parentSubprojectId: string | null; status: string }[],
  includeCompleted: boolean
): Map<string, Range> {
  const allById = new Map(tasks.map((task) => [task.taskId, task]));
  const subprojectById = new Map(subprojects.map((subproject) => [subproject.subprojectId, subproject]));
  const archived = (subprojectId: string | null): boolean => {
    const seen = new Set<string>();
    let current = subprojectId ? subprojectById.get(subprojectId) : undefined;
    while (current) {
      if (seen.has(current.subprojectId) || current.status === 'Archived') return true;
      seen.add(current.subprojectId);
      current = current.parentSubprojectId ? subprojectById.get(current.parentSubprojectId) : undefined;
    }
    return false;
  };
  const childIds = new Set(tasks.filter((task) => task.parentTaskId && allById.has(task.parentTaskId)).map((task) => task.parentTaskId as string));
  const ranges = new Map<string, Range>();
  for (const task of tasks) {
    if (childIds.has(task.taskId) || task.status === 'Cancelled' || (!includeCompleted && task.status === 'Done') || archived(task.subprojectId)) continue;
    const range = ranges.get(task.projectId) ?? emptyRange();
    const schedule = explicitSchedule(task.plannedStart, task.dueDate);
    if (schedule.scheduleStart && schedule.scheduleFinish) {
      addRecord(range, schedule.scheduleStart, schedule.scheduleFinish, true);
    } else {
      range.total += 1;
    }
    ranges.set(task.projectId, range);
  }
  return ranges;
}

/**
 * Project-level rows for the timeline.
 *
 * The scope is resolved on the server before paging, so an active responsibility filter and the
 * visible total are never derived from the returned page.
 */
export async function timelineProjects(
  ctx: WorkCtx,
  input: {
    responsibilityId?: string;
    /** The narrowed division filter; `undefined` means the whole readable scope. */
    divisionIds?: readonly string[];
    query?: string;
    page: number;
    pageSize?: number;
    includeArchived?: boolean;
    includeCompleted?: boolean;
  }
): Promise<TimelineProjectPage> {
  requireRole(ctx.identity, 'VIEWER');
  const manager = canSeeRestrictedWork(ctx.identity);
  if (input.includeArchived && !canIncludeArchivedWork(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Archived work is restricted to managers');
  }
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100);
  // The caller's requested division has already been narrowed against the resolved scope; the
  // default remains the whole readable scope.
  const divisionIds = input.divisionIds ?? readableDivisionIds(ctx.divisions);
  const [page, responsibilities, loaded] = await Promise.all([
    listProjects(
      ctx.db,
      {
        query: input.query,
        queryProjectNameOnly: true,
        responsibilityId: input.responsibilityId,
        internalOnly: !manager,
        divisionIds,
        includeArchived: input.includeArchived === true ? undefined : false,
        sort: 'deadline',
        direction: 'asc'
      },
      input.page,
      pageSize,
      ctx.today
    ),
    listWorkResponsibilityOptions(ctx.db, !manager, divisionIds),
    taskScope(ctx)
  ]);
  const ranges = descendantRanges(loaded.tasks, loaded.dir.subprojects, input.includeCompleted !== false);
  const counts = loaded.scope.countsBy((task) => task.projectId, ctx.today);
  const items: TimelineProjectRow[] = page.items.map((project) => {
    const range = ranges.get(project.projectId) ?? emptyRange();
    const schedule = project.plannedStart || project.committedDeadline
      ? explicitSchedule(project.plannedStart, project.committedDeadline)
      : derivedSchedule(range);
    return {
      projectId: project.projectId,
      projectName: project.projectName,
      responsibilityId: project.responsibilityId,
      responsibilityName: project.responsibilityName ?? '',
      status: project.status,
      schedule: project.schedule,
      plannedStart: project.plannedStart,
      forecastEnd: project.forecastEnd,
      committedDeadline: project.committedDeadline,
      progressPercent: project.progressPercent,
      openWork: counts.get(project.projectId)?.openWork ?? 0,
      completedWork: counts.get(project.projectId)?.completedWork ?? 0,
      childRange: toChildRange(range),
      undated: schedule.dateState === 'UNDATED',
      ...schedule
    };
  });
  const scopeProjects = loaded.dir.projects.filter((project) =>
    projectVisibleTo(ctx, project) &&
    (input.includeArchived === true || (project.status !== 'Archived' && !project.archivedAt)) &&
    (!input.responsibilityId || project.responsibilityId === input.responsibilityId) &&
    (!input.query || project.projectName.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()))
  );
  return {
    items,
    total: page.total,
    page: input.page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(page.total / pageSize)),
    responsibilities,
    fitRange: fitRange(
      rangeOfSchedules(
        scopeProjects.map((project) => {
          const range = ranges.get(project.projectId) ?? emptyRange();
          return project.plannedStart || project.committedDeadline
            ? explicitSchedule(project.plannedStart, project.committedDeadline)
            : derivedSchedule(range);
        })
      )
    )
  };
}

/**
 * One project branch: its subprojects and tasks, with the hierarchy the timeline draws.
 *
 * Only allowlisted fields leave the server. Completed work stays part of the branch (a timeline
 * that hid it would misreport the plan); cancelled work and archived branches stay hidden from a
 * non-manager, matching every other read-only screen.
 */
export async function timelineBranch(
  ctx: WorkCtx,
  projectId: string,
  options: {
    includeCompleted?: boolean;
    subprojectId?: string;
    /** The narrowed division scope of the request; the project must belong to it. */
    divisionIds?: readonly string[];
  } = {}
): Promise<TimelineProjectBranch> {
  requireRole(ctx.identity, 'VIEWER');
  const project = await getProject(ctx.db, projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  assertReadableDivision(ctx.divisions, project.divisionId);
  // A selected division narrows the read: a readable project from another division must not be
  // shown under the wrong division label. A blank (unmapped) project is ADMIN-only, so a
  // division-scoped request never reaches it.
  if (options.divisionIds && !(project.divisionId && options.divisionIds.includes(project.divisionId))) {
    throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  }
  if (!projectVisibleTo(ctx, project)) {
    throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  }
  const manager = canSeeRestrictedWork(ctx.identity);
  const [allSubprojects, allTasks, loaded] = await Promise.all([
    listSubprojects(ctx.db, projectId),
    listTaskSummariesForProject(ctx.db, projectId),
    taskScope(ctx)
  ]);
  const allById = new Map(allSubprojects.map((subproject) => [subproject.subprojectId, subproject]));
  const archivedBranch = (subprojectId: string | null): boolean => {
    if (!subprojectId) return false;
    let node = allById.get(subprojectId);
    const seen = new Set<string>();
    let guard = 0;
    while (node) {
      if (seen.has(node.subprojectId)) return true;
      seen.add(node.subprojectId);
      if (node.status === 'Archived') return true;
      if (guard++ > 20) return true;
      node = node.parentSubprojectId ? allById.get(node.parentSubprojectId) : undefined;
    }
    return false;
  };
  const visibleSubprojects = allSubprojects.filter(
    (subproject) => manager || !archivedBranch(subproject.subprojectId)
  );
  const selectedSubproject = options.subprojectId
    ? visibleSubprojects.find((subproject) => subproject.subprojectId === options.subprojectId)
    : undefined;
  if (options.subprojectId && !selectedSubproject) {
    throw new DomainError('NOT_FOUND', `Subproject not found in project: ${options.subprojectId}`);
  }
  const descendants = new Set<string>();
  if (selectedSubproject) {
    const childrenByParent = new Map<string, string[]>();
    for (const subproject of visibleSubprojects) {
      if (!subproject.parentSubprojectId) continue;
      childrenByParent.set(subproject.parentSubprojectId, [
        ...(childrenByParent.get(subproject.parentSubprojectId) ?? []),
        subproject.subprojectId
      ]);
    }
    const pending = [selectedSubproject.subprojectId];
    while (pending.length) {
      const current = pending.pop()!;
      if (descendants.has(current)) continue;
      descendants.add(current);
      pending.push(...(childrenByParent.get(current) ?? []));
    }
  }
  const scopedSubprojects = selectedSubproject
    ? visibleSubprojects.filter((subproject) => descendants.has(subproject.subprojectId))
    : visibleSubprojects;
  const visibleSubprojectIds = new Set(visibleSubprojects.map((subproject) => subproject.subprojectId));
  const baseTasks = allTasks
    .filter((task) => !task.subprojectId || visibleSubprojectIds.has(task.subprojectId))
    .filter((task) => !selectedSubproject || (!!task.subprojectId && descendants.has(task.subprojectId)))
    .filter((task) => manager || task.status !== 'Cancelled');
  /**
   * Hiding completed work never removes a container that explains unfinished children. A container
   * is organisation, so its stored `Done` status is irrelevant while any descendant is still open;
   * a completed leaf (and a container whose whole subtree is completed) is what the control hides.
   */
  const childrenByParent = new Map<string, string[]>();
  for (const task of baseTasks) {
    if (!task.parentTaskId) continue;
    childrenByParent.set(task.parentTaskId, [...(childrenByParent.get(task.parentTaskId) ?? []), task.taskId]);
  }
  const byTaskId = new Map(baseTasks.map((task) => [task.taskId, task]));
  const unfinishedMemo = new Map<string, boolean>();
  const hasUnfinishedDescendant = (taskId: string, seen = new Set<string>()): boolean => {
    const cached = unfinishedMemo.get(taskId);
    if (cached !== undefined) return cached;
    if (seen.has(taskId)) return false;
    seen.add(taskId);
    let found = false;
    for (const childId of childrenByParent.get(taskId) ?? []) {
      const child = byTaskId.get(childId);
      if (!child) continue;
      if (child.status !== 'Done' || hasUnfinishedDescendant(childId, seen)) {
        found = true;
        break;
      }
    }
    unfinishedMemo.set(taskId, found);
    return found;
  };
  const visibleTasks =
    options.includeCompleted === false
      ? baseTasks.filter((task) => task.status !== 'Done' || hasUnfinishedDescendant(task.taskId))
      : baseTasks;
  const tasks = visibleTasks;

  const allChildrenOf = new Map<string, string[]>();
  const allTaskIds = new Set(allTasks.map((task) => task.taskId));
  for (const task of allTasks) {
    if (!task.parentTaskId || !allTaskIds.has(task.parentTaskId)) continue;
    allChildrenOf.set(task.parentTaskId, [...(allChildrenOf.get(task.parentTaskId) ?? []), task.taskId]);
  }
  const childrenOf = new Map<string, string[]>();
  for (const task of tasks) {
    const parent = task.parentTaskId ?? '';
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), task.taskId]);
  }
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const taskRanges = new Map<string, Range>();
  const rangeOfTask = (taskId: string, seen = new Set<string>()): Range => {
    const cached = taskRanges.get(taskId);
    if (cached) return cached;
    const range = emptyRange();
    if (seen.has(taskId)) return range;
    seen.add(taskId);
    const task = byId.get(taskId);
    // A task that has children is a container. Its stored schedule is never an additional work
    // item; only eligible descendant leaf schedules define its display range.
    if (task && !(allChildrenOf.get(taskId)?.length)) {
      const schedule = explicitSchedule(task.plannedStart, task.dueDate);
      if (schedule.scheduleStart && schedule.scheduleFinish) {
        addRecord(range, schedule.scheduleStart, schedule.scheduleFinish, true);
      } else {
        range.total += 1;
      }
    }
    for (const childId of childrenOf.get(taskId) ?? []) {
      addRange(range, rangeOfTask(childId, seen));
    }
    taskRanges.set(taskId, range);
    return range;
  };

  const rangeOfSubproject = (subprojectId: string, seen = new Set<string>()): Range => {
    const range = emptyRange();
    if (seen.has(subprojectId)) return range;
    seen.add(subprojectId);
    for (const task of tasks) {
      if (task.subprojectId !== subprojectId) continue;
      if (allChildrenOf.get(task.taskId)?.length) continue;
      const schedule = explicitSchedule(task.plannedStart, task.dueDate);
      if (schedule.scheduleStart && schedule.scheduleFinish) {
        addRecord(range, schedule.scheduleStart, schedule.scheduleFinish, true);
      } else {
        range.total += 1;
      }
    }
    return range;
  };

  const counts = loaded.scope.countsBy((task) => task.projectId, ctx.today).get(projectId);
  const completedRows = await ctx.db.many<{ task_id: string; completed_at: string | null }>(
    `SELECT task_id, completed_at FROM tasks
      WHERE project_id = $1 AND deleted_at IS NULL AND completed_at IS NOT NULL`,
    [projectId]
  );
  const completedAt = new Map(completedRows.map((row) => [row.task_id, row.completed_at]));
  const childRange = emptyRange();
  for (const task of tasks) {
    if (allChildrenOf.get(task.taskId)?.length) continue;
    const schedule = explicitSchedule(task.plannedStart, task.dueDate);
    if (schedule.scheduleStart && schedule.scheduleFinish) {
      addRecord(childRange, schedule.scheduleStart, schedule.scheduleFinish, true);
    } else {
      childRange.total += 1;
    }
  }

  const projectSchedule = project.plannedStart || project.committedDeadline
    ? explicitSchedule(project.plannedStart, project.committedDeadline)
    : derivedSchedule(childRange);
  const projectRow: TimelineProjectRow = {
    projectId: project.projectId,
    projectName: project.projectName,
    responsibilityId: project.responsibilityId,
    responsibilityName: project.responsibilityName ?? '',
    status: project.status,
    schedule: project.schedule,
    plannedStart: project.plannedStart,
    forecastEnd: project.forecastEnd,
    committedDeadline: project.committedDeadline,
    progressPercent: project.progressPercent,
    openWork: counts?.openWork ?? 0,
    completedWork: counts?.completedWork ?? 0,
    childRange: toChildRange(childRange),
    undated: projectSchedule.dateState === 'UNDATED',
    ...projectSchedule
  };

  const subprojects: TimelineSubprojectRow[] = scopedSubprojects.map((subproject) => {
    const range = rangeOfSubproject(subproject.subprojectId);
    const schedule = derivedSchedule(range);
    return {
      subprojectId: subproject.subprojectId,
      projectId: subproject.projectId,
      parentSubprojectId: subproject.parentSubprojectId,
      subprojectName: subproject.subprojectName,
      status: subproject.status,
      schedule: projectScheduleStatus(
        {
          status: subproject.status,
          plannedStart: subproject.plannedStart,
          committedDeadline: subproject.deadline
        },
        ctx.today
      ),
      plannedStart: subproject.plannedStart,
      plannedEnd: subproject.plannedEnd,
      deadline: subproject.deadline,
      depth: subproject.depth,
      childRange: toChildRange(range),
      undated: schedule.dateState === 'UNDATED',
      ...schedule
    };
  });

  const taskRows: TimelineTaskRow[] = tasks.map((task) => {
    const schedule = allChildrenOf.get(task.taskId)?.length
      ? derivedSchedule(rangeOfTask(task.taskId))
      : explicitSchedule(task.plannedStart, task.dueDate);
    const display = taskScheduleStatus(
      { status: task.status, plannedStart: task.plannedStart, dueDate: task.dueDate },
      ctx.today
    );
    return {
    taskId: task.taskId,
    projectId: task.projectId,
    subprojectId: task.subprojectId,
    parentTaskId: task.parentTaskId,
    taskName: task.taskName,
    status: task.status,
    displayStatus: display.state,
    scheduleMissing: display.missing,
    plannedStart: task.plannedStart,
    dueDate: task.dueDate,
    completedAt: completedAt.get(task.taskId) ?? null,
    assigneeNames: task.assigneeNames ?? [],
    reviewState: task.reviewState,
    container: !!allChildrenOf.get(task.taskId)?.length,
    depth: task.depth,
    progressPercent: task.progressPercent,
    childRange: toChildRange(rangeOfTask(task.taskId)),
    undated: schedule.dateState === 'UNDATED',
    inconsistent: schedule.dateState === 'INVALID',
    ...schedule
  };
  });

  return {
    project: projectRow,
    subprojects,
    tasks: taskRows,
    truncated: false,
    taskTotal: visibleTasks.length,
    fitRange: fitRange(rangeOfSchedules([projectSchedule, ...subprojects, ...taskRows]))
  };
}

/** Seven Tokyo business dates including today: today through today + 6. */
export const ATTENTION_DUE_SOON_DAYS = 7;

function addCalendarDays(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Project-level attention counts and the matching work.
 *
 * The authorized project scope is resolved first (division, visibility, archived branch), then one
 * in-memory scope scan answers every bucket, so a count never depends on a page, an expanded folder
 * or the chart's visible period. Only leaf work is matched: a container is organisation, and its
 * ancestors are returned as context so a filtered view can still explain where a match lives.
 */
export async function projectAttention(
  ctx: WorkCtx,
  projectId: string,
  options: { divisionIds?: readonly string[] } = {}
): Promise<ProjectAttention> {
  requireRole(ctx.identity, 'VIEWER');
  const project = await getProject(ctx.db, projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  assertReadableDivision(ctx.divisions, project.divisionId);
  if (options.divisionIds && !(project.divisionId && options.divisionIds.includes(project.divisionId))) {
    throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  }
  if (!projectVisibleTo(ctx, project)) {
    throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  }
  const manager = canSeeRestrictedWork(ctx.identity);
  const [allTasks, allSubprojects] = await Promise.all([
    listTaskSummariesForProject(ctx.db, projectId),
    listSubprojects(ctx.db, projectId)
  ]);
  const subprojectById = new Map(allSubprojects.map((subproject) => [subproject.subprojectId, subproject]));
  const archivedBranch = (subprojectId: string | null): boolean => {
    if (!subprojectId) return false;
    let node = subprojectById.get(subprojectId);
    const seen = new Set<string>();
    let guard = 0;
    while (node) {
      if (seen.has(node.subprojectId) || node.status === 'Archived' || guard++ > 20) return true;
      seen.add(node.subprojectId);
      node = node.parentSubprojectId ? subprojectById.get(node.parentSubprojectId) : undefined;
    }
    return false;
  };
  const tasks = allTasks.filter((task) => {
    if (task.subprojectId && (manager ? false : archivedBranch(task.subprojectId))) return false;
    if (!manager && task.status === 'Cancelled') return false;
    return true;
  });
  const scope = createScope(
    tasks,
    new Map([[project.projectId, { status: project.status }]]),
    new Map(
      allSubprojects.map((subproject) => [
        subproject.subprojectId,
        {
          subprojectId: subproject.subprojectId,
          projectId: subproject.projectId,
          parentSubprojectId: subproject.parentSubprojectId,
          status: subproject.status
        }
      ])
    ),
    ctx.today
  );
  const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
  const leaves = tasks.filter((task) => !scope.isContainer(task.taskId));
  const dueSoonFrom = ctx.today;
  const dueSoonTo = addCalendarDays(ctx.today, ATTENTION_DUE_SOON_DAYS - 1);
  const active = leaves.filter((task) => scope.inActiveWork(task));
  const open = (task: (typeof active)[number]): boolean => scope.inActiveWork(task);
  const definitions: Record<Exclude<ProjectAttentionFilter, 'ALL'>, (task: (typeof active)[number]) => boolean> = {
    OVERDUE: (task) => open(task) && !!task.dueDate && task.dueDate < ctx.today,
    DUE_SOON: (task) =>
      open(task) && !!task.dueDate && task.dueDate >= dueSoonFrom && task.dueDate <= dueSoonTo,
    REVIEW: (task) => open(task) && task.reviewState === 'PENDING',
    MISSING_DATES: (task) =>
      open(task) && (!task.dueDate || !task.plannedStart || task.plannedStart > task.dueDate)
  };
  const contextOf = (task: (typeof active)[number]): { taskIds: string[]; subprojectIds: string[] } => {
    const taskIds: string[] = [];
    let parentId = task.parentTaskId;
    let guard = 0;
    while (parentId && tasksById.has(parentId) && guard++ < 8) {
      taskIds.push(parentId);
      parentId = tasksById.get(parentId)?.parentTaskId ?? null;
    }
    const subprojectIds: string[] = [];
    let subprojectId = task.subprojectId;
    guard = 0;
    while (subprojectId && guard++ < 24) {
      subprojectIds.push(subprojectId);
      subprojectId = subprojectById.get(subprojectId)?.parentSubprojectId ?? null;
    }
    return { taskIds, subprojectIds };
  };
  const bucket = (key: ProjectAttentionFilter): ProjectAttentionBucket => {
    if (key === 'ALL') {
      return { key, count: active.length, taskIds: [], contextTaskIds: [], contextSubprojectIds: [] };
    }
    const matches = active.filter(definitions[key]);
    const contextTaskIds = new Set<string>();
    const contextSubprojectIds = new Set<string>();
    for (const task of matches) {
      const context = contextOf(task);
      for (const id of context.taskIds) contextTaskIds.add(id);
      for (const id of context.subprojectIds) contextSubprojectIds.add(id);
    }
    return {
      key,
      count: matches.length,
      taskIds: matches.map((task) => task.taskId),
      contextTaskIds: [...contextTaskIds],
      contextSubprojectIds: [...contextSubprojectIds]
    };
  };
  return {
    projectId,
    today: ctx.today,
    dueSoon: { from: dueSoonFrom, to: dueSoonTo },
    includesOutsideChart: true,
    buckets: (['ALL', 'OVERDUE', 'DUE_SOON', 'REVIEW', 'MISSING_DATES'] as const).map(bucket)
  };
}
