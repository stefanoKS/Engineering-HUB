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
  canIncludeArchivedWork,
  canSeeRestrictedWork,
  displayTaskStatus,
  requireRole
} from '@eh/domain';
import { taskScope } from './views';
import type { WorkCtx } from './work';

type Range = { start: string | null; end: string | null; dated: number; total: number };

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

/** A task's usable display dates, keeping the stored meaning of each field. */
function taskDates(task: { plannedStart: string | null; dueDate: string | null }): {
  start: string | null;
  end: string | null;
  dated: boolean;
} {
  return {
    start: task.plannedStart ?? task.dueDate,
    end: task.dueDate ?? task.plannedStart,
    dated: !!task.plannedStart || !!task.dueDate
  };
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

type ChildAggregate = { project_id: string; start: string | null; end: string | null; dated: string; total: string };

/**
 * One aggregate per project for the dated descendants of the page that was just read.
 *
 * The aggregate covers the whole authorized scope of those projects, never a rendered page, so a
 * summary span cannot change when the reader scrolls or changes the page size.
 */
async function descendantRanges(ctx: WorkCtx, projectIds: string[]): Promise<Map<string, Range>> {
  const ranges = new Map<string, Range>();
  if (projectIds.length === 0) return ranges;
  const [taskRows, subprojectRows] = await Promise.all([
    ctx.db.many<ChildAggregate>(
      `SELECT t.project_id,
              min(COALESCE(t.planned_start, t.due_date)) AS start,
              max(COALESCE(t.due_date, t.planned_start)) AS end,
              count(*) FILTER (WHERE t.planned_start IS NOT NULL OR t.due_date IS NOT NULL)::text AS dated,
              count(*)::text AS total
         FROM tasks t
        WHERE t.deleted_at IS NULL AND t.status <> 'Cancelled' AND t.project_id = ANY($1::text[])
        GROUP BY t.project_id`,
      [projectIds]
    ),
    ctx.db.many<ChildAggregate>(
      `SELECT s.project_id,
              min(COALESCE(s.planned_start, s.deadline)) AS start,
              max(COALESCE(s.planned_end, s.deadline)) AS end,
              count(*) FILTER (WHERE s.planned_start IS NOT NULL OR s.deadline IS NOT NULL
                                  OR s.planned_end IS NOT NULL)::text AS dated,
              count(*)::text AS total
         FROM subprojects s
        WHERE s.deleted_at IS NULL AND s.status <> 'Archived' AND s.project_id = ANY($1::text[])
        GROUP BY s.project_id`,
      [projectIds]
    )
  ]);
  for (const row of [...taskRows, ...subprojectRows]) {
    const range = ranges.get(row.project_id) ?? emptyRange();
    if (row.start && (!range.start || row.start < range.start)) range.start = row.start;
    if (row.end && (!range.end || row.end > range.end)) range.end = row.end;
    range.dated += Number(row.dated ?? 0);
    range.total += Number(row.total ?? 0);
    ranges.set(row.project_id, range);
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
    query?: string;
    page: number;
    pageSize?: number;
    includeArchived?: boolean;
  }
): Promise<TimelineProjectPage> {
  requireRole(ctx.identity, 'VIEWER');
  const manager = canSeeRestrictedWork(ctx.identity);
  if (input.includeArchived && !canIncludeArchivedWork(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Archived work is restricted to managers');
  }
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 100);
  const [page, responsibilities, loaded] = await Promise.all([
    listProjects(
      ctx.db,
      {
        query: input.query,
        queryProjectNameOnly: true,
        responsibilityId: input.responsibilityId,
        internalOnly: !manager,
        includeArchived: input.includeArchived === true ? undefined : false,
        sort: 'deadline',
        direction: 'asc'
      },
      input.page,
      pageSize
    ),
    listWorkResponsibilityOptions(ctx.db, !manager),
    taskScope(ctx)
  ]);
  const ranges = await descendantRanges(
    ctx,
    page.items.map((project) => project.projectId)
  );
  const counts = loaded.scope.countsBy((task) => task.projectId, ctx.today);
  const items: TimelineProjectRow[] = page.items.map((project) => {
    const range = ranges.get(project.projectId) ?? emptyRange();
    return {
      projectId: project.projectId,
      projectName: project.projectName,
      responsibilityId: project.responsibilityId,
      responsibilityName: project.responsibilityName ?? '',
      status: project.status,
      plannedStart: project.plannedStart,
      forecastEnd: project.forecastEnd,
      committedDeadline: project.committedDeadline,
      progressPercent: project.progressPercent,
      openWork: counts.get(project.projectId)?.openWork ?? 0,
      completedWork: counts.get(project.projectId)?.completedWork ?? 0,
      childRange: toChildRange(range),
      undated: !project.plannedStart && !project.forecastEnd && !project.committedDeadline && range.dated === 0
    };
  });
  return {
    items,
    total: page.total,
    page: input.page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(page.total / pageSize)),
    responsibilities
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
  options: { includeCompleted?: boolean; subprojectId?: string } = {}
): Promise<TimelineProjectBranch> {
  requireRole(ctx.identity, 'VIEWER');
  const project = await getProject(ctx.db, projectId);
  if (!project || !projectVisibleTo(ctx, project)) {
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
  const visibleTasks = allTasks
    .filter((task) => !task.subprojectId || visibleSubprojectIds.has(task.subprojectId))
    .filter((task) => !selectedSubproject || (!!task.subprojectId && descendants.has(task.subprojectId)))
    .filter((task) => manager || task.status !== 'Cancelled')
    .filter((task) => options.includeCompleted !== false || task.status !== 'Done');
  const tasks = visibleTasks;

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
    if (task) {
      const dates = taskDates(task);
      addRecord(range, dates.start, dates.end, dates.dated);
    }
    for (const childId of childrenOf.get(taskId) ?? []) {
      addRange(range, rangeOfTask(childId, seen));
    }
    taskRanges.set(taskId, range);
    return range;
  };

  const subprojectChildren = new Map<string, string[]>();
  for (const subproject of scopedSubprojects) {
    const parent = subproject.parentSubprojectId ?? '';
    subprojectChildren.set(parent, [...(subprojectChildren.get(parent) ?? []), subproject.subprojectId]);
  }
  const rangeOfSubproject = (subprojectId: string, seen = new Set<string>()): Range => {
    const range = emptyRange();
    if (seen.has(subprojectId)) return range;
    seen.add(subprojectId);
    const subproject = allById.get(subprojectId);
    if (subproject) {
      const start = subproject.plannedStart ?? subproject.deadline;
      const end = subproject.plannedEnd ?? subproject.deadline;
      addRecord(range, start, end, !!start || !!end);
    }
    for (const task of tasks) {
      if (task.subprojectId !== subprojectId) continue;
      const parent = task.parentTaskId ? byId.get(task.parentTaskId) : undefined;
      // Only a task-tree root belongs directly to this subproject. Its descendants are added by
      // rangeOfTask once, preventing container children from being counted repeatedly.
      if (parent && parent.subprojectId === subprojectId) continue;
      addRange(range, rangeOfTask(task.taskId));
    }
    for (const childId of subprojectChildren.get(subprojectId) ?? []) {
      addRange(range, rangeOfSubproject(childId, seen));
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
  for (const subproject of visibleSubprojects) {
    if (subproject.parentSubprojectId && allById.has(subproject.parentSubprojectId)) continue;
    addRange(childRange, rangeOfSubproject(subproject.subprojectId));
  }
  for (const task of tasks) {
    if (task.subprojectId) continue;
    if (task.parentTaskId && byId.has(task.parentTaskId)) continue;
    addRange(childRange, rangeOfTask(task.taskId));
  }

  const projectRow: TimelineProjectRow = {
    projectId: project.projectId,
    projectName: project.projectName,
    responsibilityId: project.responsibilityId,
    responsibilityName: project.responsibilityName ?? '',
    status: project.status,
    plannedStart: project.plannedStart,
    forecastEnd: project.forecastEnd,
    committedDeadline: project.committedDeadline,
    progressPercent: project.progressPercent,
    openWork: counts?.openWork ?? 0,
    completedWork: counts?.completedWork ?? 0,
    childRange: toChildRange(childRange),
    undated:
      !project.plannedStart &&
      !project.forecastEnd &&
      !project.committedDeadline &&
      childRange.dated === 0
  };

  const subprojects: TimelineSubprojectRow[] = scopedSubprojects.map((subproject) => {
    const range = rangeOfSubproject(subproject.subprojectId);
    return {
      subprojectId: subproject.subprojectId,
      projectId: subproject.projectId,
      parentSubprojectId: subproject.parentSubprojectId,
      subprojectName: subproject.subprojectName,
      status: subproject.status,
      plannedStart: subproject.plannedStart,
      plannedEnd: subproject.plannedEnd,
      deadline: subproject.deadline,
      depth: subproject.depth,
      childRange: toChildRange(range),
      undated: range.dated === 0
    };
  });

  const taskRows: TimelineTaskRow[] = tasks.map((task) => ({
    taskId: task.taskId,
    projectId: task.projectId,
    subprojectId: task.subprojectId,
    parentTaskId: task.parentTaskId,
    taskName: task.taskName,
    status: task.status,
    displayStatus: displayTaskStatus({ status: task.status, dueDate: task.dueDate }, ctx.today),
    plannedStart: task.plannedStart,
    dueDate: task.dueDate,
    completedAt: completedAt.get(task.taskId) ?? null,
    container: task.container,
    depth: task.depth,
    progressPercent: task.progressPercent,
    childRange: toChildRange(rangeOfTask(task.taskId)),
    undated: !task.plannedStart && !task.dueDate,
    inconsistent: !!task.plannedStart && !!task.dueDate && task.plannedStart > task.dueDate
  }));

  return {
    project: projectRow,
    subprojects,
    tasks: taskRows,
    truncated: false,
    taskTotal: visibleTasks.length
  };
}
