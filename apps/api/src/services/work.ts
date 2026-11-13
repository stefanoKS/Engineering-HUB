import { canWriteDivision } from '@eh/domain';
/**
 * Read-only work browsing for every signed-in role.
 *
 * This module never mutates anything. It applies the documented visibility policy before a page is
 * cut: an employee-visible list contains only `INTERNAL` projects that are not archived, and an
 * explicit archived/cancelled history view is a manager capability. A guessed identifier answers
 * `404`, so a refused reader cannot even learn that a RESTRICTED record exists.
 */
import type { TaskDetail, WorkOverview, WorkProjectDetail, WorkProjectList } from '@eh/contracts';
import type { ProjectListQuery, TaskListQuery } from '@eh/contracts';
import {
  getProject,
  getSubproject,
  getTask,
  getTaskContext,
  listChildSummaries,
  listProjects,
  listSubprojects,
  listTaskAssignees,
  listTaskSummaries,
  listTaskSummariesForProject,
  listTaskTreeSummaries,
  listWorkResponsibilityOptions
} from '@eh/db';
import {
  DomainError,
  assertReadableDivision,
  canIncludeArchivedWork,
  canReadProjectVisibility,
  canSeeRestrictedWork,
  projectScheduleStatus,
  requireRole,
  rollup
} from '@eh/domain';
import type { z } from 'zod';
import type { ServiceCtx } from './common';
import { requestedDivision } from './divisions';
import { taskScope, type ReadCtx } from './views';

/** A read context plus the verified identity: one task-scope pass serves the whole request. */
export type WorkCtx = ServiceCtx & ReadCtx;

export type WorkPage = {
  items: Awaited<ReturnType<typeof listTaskSummaries>>['items'];
  matchedTotal?: number;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export const WORK_PROJECT_PAGE_SIZE = 25;

/**
 * One bounded page of active work.
 *
 * The scope is resolved on the server before paging; completed, cancelled, archived and deleted
 * work is hidden by default and only an explicit filter brings it back.
 */
export async function listActiveWork(
  ctx: WorkCtx,
  query: z.infer<typeof TaskListQuery>
): Promise<WorkPage> {
  requireRole(ctx.identity, 'VIEWER');
  if (query.includeInactive && !canIncludeArchivedWork(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Archived and cancelled history is restricted to managers');
  }
  const manager = canSeeRestrictedWork(ctx.identity);
  const filters = {
    projectId: query.projectId,
    subprojectId: query.subprojectId,
    responsibilityId: query.responsibilityId,
    divisionIds: requestedDivision(ctx, query.divisionId),
    unassigned: query.unassigned,
    status: query.status,
    workState: query.workState,
    displayStatus: query.displayStatus,
    today: ctx.today,
    ownerMemberId: query.ownerMemberId,
    assigneeMemberId: query.assigneeMemberId,
    query: query.query,
    containerOnly: query.containerOnly,
    overdueOnly: query.overdueOnly,
    includeInactive: query.includeInactive,
    internalOnly: !manager,
    sort: query.sort,
    direction: query.direction
  };
  const result =
    query.tree === 'true'
      ? await listTaskTreeSummaries(ctx.db, filters, query.treeParentId, query.page, query.pageSize)
      : await listTaskSummaries(ctx.db, filters, query.page, query.pageSize);
  const matchedTotal =
    'matchedTotal' in result ? (result as { matchedTotal: number }).matchedTotal : undefined;
  return {
    items: result.items,
    ...(matchedTotal === undefined ? {} : { matchedTotal }),
    total: result.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(result.total / query.pageSize)
  };
}

/** True when this reader may see the project under the documented visibility policy. */
function projectVisibleToReader(
  ctx: ServiceCtx,
  project: { status: string; dashboardVisibility: string; archivedAt: string | null }
): boolean {
  if (canSeeRestrictedWork(ctx.identity)) return true;
  return (
    canReadProjectVisibility(ctx.identity, project.dashboardVisibility) &&
    project.status !== 'Archived' &&
    !project.archivedAt
  );
}

/**
 * Task detail for a non-manager reader.
 *
 * Workflow history, notifications, acceptance criteria, internal notes and schedule
 * confirmations stay manager-only; the reader still sees the task, its assignees and its
 * children. A RESTRICTED or archived project, and an unknown identifier, are both `404`.
 */
export async function readOnlyTaskDetail(ctx: ServiceCtx, taskId: string): Promise<TaskDetail> {
  requireRole(ctx.identity, 'VIEWER');
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  const project = await getProject(ctx.db, task.projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  // A division refusal answers exactly like an unknown identifier, so a guessed ID cannot confirm
  // that work exists outside the caller's divisions.
  assertReadableDivision(ctx.divisions, project.divisionId);
  if (!projectVisibleToReader(ctx, project)) {
    throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  }
  if (!canSeeRestrictedWork(ctx.identity) && task.subprojectId) {
    const subproject = await getSubproject(ctx.db, task.subprojectId);
    if (subproject?.status === 'Archived') throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
    if (subproject && subproject.projectId !== project.projectId) {
      throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
    }
  }
  const [children, assignees, context, depthRow] = await Promise.all([
    listChildSummaries(ctx.db, taskId),
    listTaskAssignees(ctx.db, taskId),
    getTaskContext(ctx.db, task.projectId, task.subprojectId),
    ctx.db.one<{ depth: number }>('SELECT eh_task_depth($1) AS depth', [taskId])
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
      .filter((row) => !row.removed_at && row.member_id !== task.ownerMemberId)
      .map((row) => ({
        memberId: row.member_id,
        name: row.name,
        active: row.active,
        assignedAt: row.assigned_at,
        assignedBy: row.assigned_by,
        primary: false
      }))
  ];
  return {
    canWrite: canWriteDivision(ctx.divisions, project.divisionId),
    record: {
      // Explicit allowlist: no recorded effort, duration, notification, note or audit-adjacent value
      // is copied from the stored row into a read-only response.
      taskId: task.taskId,
      projectId: task.projectId,
      subprojectId: task.subprojectId,
      parentTaskId: task.parentTaskId,
      taskName: task.taskName,
      description: task.description,
      ownerMemberId: task.ownerMemberId,
      ownerName: task.ownerName,
      status: task.status,
      displayStatus: task.displayStatus,
      scheduleMissing: task.scheduleMissing,
      priority: task.priority,
      plannedStart: null,
      dueDate: task.dueDate,
      estimatedHours: null,
      actualHours: null,
      progressPercent: null,
      dependencyIds: [],
      acceptanceCriteria: '',
      nextAction: '',
      requiredSkillId: task.requiredSkillId,
      requiredSkillLevel: task.requiredSkillLevel,
      assignmentVersion: task.assignmentVersion,
      assignmentApprovedAt: null,
      notificationEnabled: false,
      notificationBaseline: '',
      publicNote: '',
      plannedDurationValue: null,
      plannedDurationUnit: null,
      plannedDurationBasis: null,
      plannedStartSource: null,
      completedAt: task.completedAt,
      createdByMemberId: null,
      creationChannel: 'LEGACY',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      revision: task.revision
    },
    context: context ?? { projectId: task.projectId, projectName: project.projectName, subprojects: [] },
    assignees: effective,
    additionalAssigneeIds: effective.filter((row) => !row.primary).map((row) => row.memberId),
    assigneeIds: effective.map((row) => row.memberId),
    assigneeHistory: [],
    confirmations: [],
    deadlineHistory: [],
    children,
    depth: Number(depthRow?.depth ?? 1)
  };
}

/**
 * Paginated project options for the read-only screens.
 *
 * MEMBER and VIEWER see only `INTERNAL`, non-archived projects; the projection omits internal
 * notes, notification settings and the dashboard summary. Open and completed counts come from the
 * one `TaskScope` pass, so a card never counts a raw task row or a container. The filters, the
 * sort and the paging are resolved on the server before a page is cut, and a grouped heading
 * carries the real authorized total instead of the visible page size.
 */
export async function listWorkProjects(
  ctx: WorkCtx,
  input: {
    query?: string;
    responsibilityId?: string;
    divisionId?: string;
    unassigned?: boolean;
    schedule?: NonNullable<z.infer<typeof ProjectListQuery>['schedule']>;
    sort?: NonNullable<z.infer<typeof ProjectListQuery>['sort']>;
    direction?: 'asc' | 'desc';
    page: number;
    pageSize?: number;
  }
): Promise<WorkProjectList> {
  requireRole(ctx.identity, 'VIEWER');
  const manager = canSeeRestrictedWork(ctx.identity);
  const pageSize = Math.min(Math.max(input.pageSize ?? WORK_PROJECT_PAGE_SIZE, 1), 100);
  const divisionFilter = requestedDivision(ctx, input.divisionId);
  const [page, responsibilities, scope] = await Promise.all([
    listProjects(
      ctx.db,
      {
        query: input.query,
        queryProjectNameOnly: true,
        responsibilityId: input.responsibilityId,
        unassigned: input.unassigned === true,
        schedule: input.schedule,
        internalOnly: !manager,
        divisionIds: divisionFilter,
        includeArchived: manager ? undefined : false,
        sort: input.sort ?? 'name',
        direction: input.direction ?? 'asc'
      },
      input.page,
      pageSize,
      ctx.today
    ),
    listWorkResponsibilityOptions(ctx.db, !manager, divisionFilter),
    taskScope(ctx).then((loaded) => loaded.scope)
  ]);
  const counts = scope.countsBy((task) => task.projectId, ctx.today);
  return {
    items: page.items.map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      description: project.description,
      divisionName: project.divisionName,
      responsibilityId: project.responsibilityId,
      responsibilityName: project.responsibilityName,
      projectOwnerName: project.projectOwnerName,
      status: project.status,
      schedule: project.schedule,
      priority: project.priority,
      committedDeadline: project.committedDeadline,
      progressPercent: project.progressPercent,
      health: project.health,
      activeTaskCount: counts.get(project.projectId)?.openWork ?? 0,
      overdueTaskCount: counts.get(project.projectId)?.overdueWork ?? 0,
      completedTaskCount: counts.get(project.projectId)?.completedWork ?? 0
    })),
    responsibilities,
    groupTotals: page.groupTotals.map((total) => ({
      responsibilityId: total.responsibilityId,
      total: total.total
    })),
    total: page.total,
    page: input.page,
    pageSize,
    totalPages: Math.ceil(page.total / pageSize)
  };
}

function isoAddDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The member overview: one authorized snapshot of the work a MEMBER or VIEWER may read.
 *
 * The visibility policy and the responsibility filter are applied before every aggregate, list
 * and top-N cut: only `INTERNAL`, non-archived projects and subproject branches survive. Every
 * count comes from the same `TaskScope` pass the manager screens use, so leaf work is counted
 * once, a container is never an extra unit of work, and completed or cancelled work never mixes
 * into an open or overdue figure. Manager-only decisions, notes and private project fields are
 * absent from the payload rather than filtered afterwards in the browser.
 */
export async function workOverview(
  ctx: WorkCtx,
  input: { responsibilityId?: string; divisionId?: string; upcomingDays: 7 | 14 | 30 }
): Promise<WorkOverview> {
  requireRole(ctx.identity, 'VIEWER');
  const manager = canSeeRestrictedWork(ctx.identity);
  // Every aggregate, list and top-N cut below is resolved inside this scope.
  const divisionIds = requestedDivision(ctx, input.divisionId);
  const [{ dir, scope }, responsibilityOptions] = await Promise.all([
    taskScope(ctx),
    listWorkResponsibilityOptions(ctx.db, !manager, divisionIds)
  ]);
  const visibleProjectIds = new Set(
    dir.projects
      .filter((project) => !input.divisionId || project.divisionId === input.divisionId)
      .filter(
        (project) =>
          manager ||
          (canReadProjectVisibility(ctx.identity, project.dashboardVisibility) &&
            project.status !== 'Archived' &&
            !project.archivedAt)
      )
      .map((project) => project.projectId)
  );
  const responsibilityOfProject = new Map<string, string | null>(
    dir.projects.map((project) => [project.projectId, project.responsibilityId])
  );
  const subprojectById = new Map(dir.subprojects.map((entry) => [entry.subprojectId, entry]));
  const ancestorArchived = (subprojectId: string): boolean => {
    let current = subprojectById.get(subprojectId);
    const seen = new Set<string>();
    let guard = 0;
    while (current) {
      if (seen.has(current.subprojectId)) return true;
      seen.add(current.subprojectId);
      if (current.status === 'Archived') return true;
      if (guard++ > 20) return true;
      current = current.parentSubprojectId ? subprojectById.get(current.parentSubprojectId) : undefined;
    }
    return false;
  };
  const inScope = (task: { projectId: string; subprojectId: string | null }): boolean => {
    if (!visibleProjectIds.has(task.projectId)) return false;
    if (
      input.responsibilityId &&
      (responsibilityOfProject.get(task.projectId) ?? null) !== input.responsibilityId
    ) {
      return false;
    }
    if (task.subprojectId && ancestorArchived(task.subprojectId)) return false;
    return true;
  };

  const upcomingTo = isoAddDays(ctx.today, input.upcomingDays - 1);
  const [upcomingPage, overduePage] = await Promise.all([
    listTaskSummaries(
      ctx.db,
      {
        responsibilityId: input.responsibilityId,
        internalOnly: !manager,
        divisionIds,
        workState: 'OPEN',
        dueFrom: ctx.today,
        dueTo: upcomingTo,
        sort: 'dueDate',
        direction: 'asc',
        today: ctx.today
      },
      1,
      20
    ),
    listTaskSummaries(
      ctx.db,
      {
        responsibilityId: input.responsibilityId,
        internalOnly: !manager,
        divisionIds,
        displayStatus: 'OVERDUE',
        sort: 'dueDate',
        direction: 'asc',
        today: ctx.today
      },
      1,
      10
    )
  ]);

  const responsibilities: WorkOverview['responsibilities'] = (input.responsibilityId
    ? responsibilityOptions.filter((option) => option.responsibilityId === input.responsibilityId)
    : responsibilityOptions
  )
    .map((option) => {
      const projectIds = new Set(
        [...visibleProjectIds].filter(
          (projectId) => (responsibilityOfProject.get(projectId) ?? null) === option.responsibilityId
        )
      );
      const inArea = (task: { projectId: string; subprojectId: string | null }): boolean =>
        inScope(task) && projectIds.has(task.projectId);
      const areaCounts = scope.counts(inArea, ctx.today);
      const areaTasks = scope.tasks
        .filter(inArea)
        .map((task) => ({
          taskId: task.taskId,
          status: task.status,
          progressPercent: task.progressPercent ?? null,
          estimatedHours: task.estimatedHours ?? null,
          parentTaskId: task.parentTaskId
        }));
      const source = dir.responsibilities.find(
        (entry) => entry.responsibilityId === option.responsibilityId
      );
      return {
        responsibilityId: option.responsibilityId,
        name: option.name,
        color: source?.color ?? '',
        status: (source?.status ?? 'Active') as WorkOverview['responsibilities'][number]['status'],
        projectCount: projectIds.size,
        openWork: areaCounts.openWork,
        overdueWork: areaCounts.overdueWork,
        completedWork: areaCounts.completedWork,
        containers: areaCounts.containers,
        progressPercent: rollup(areaTasks).percent
      };
    })
    .filter((card) => card.projectCount > 0)
    .sort((left, right) => left.name.localeCompare(right.name, 'ja'));

  return {
    scope: {
      responsibilityId: input.responsibilityId ?? '',
      label:
        responsibilityOptions.find((entry) => entry.responsibilityId === input.responsibilityId)?.name ??
        ''
    },
    counts: scope.counts(inScope, ctx.today),
    upcomingWindow: { days: input.upcomingDays, from: ctx.today, to: upcomingTo },
    overdue: overduePage.items,
    overdueTotal: overduePage.total,
    upcoming: upcomingPage.items,
    upcomingTotal: upcomingPage.total,
    responsibilities,
    options: responsibilityOptions,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Project detail for MEMBER and VIEWER.
 *
 * The record is rebuilt from an explicit allowlist; milestones, phases, the dashboard summary and
 * notification settings never leave the server. Completed and cancelled tasks are excluded from
 * this default view, matching the All Work list.
 */
export async function readOnlyProjectDetail(ctx: WorkCtx, projectId: string): Promise<WorkProjectDetail> {
  requireRole(ctx.identity, 'VIEWER');
  const project = await getProject(ctx.db, projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  assertReadableDivision(ctx.divisions, project.divisionId);
  if (!projectVisibleToReader(ctx, project)) {
    throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  }
  const manager = canSeeRestrictedWork(ctx.identity);
  const [tasks, allSubprojects, scope] = await Promise.all([
    listTaskSummariesForProject(ctx.db, projectId),
    listSubprojects(ctx.db, projectId),
    taskScope(ctx).then((loaded) => loaded.scope)
  ]);
  const counts = scope.countsBy((task) => task.projectId, ctx.today).get(projectId);
  const allById = new Map(allSubprojects.map((subproject) => [subproject.subprojectId, subproject]));
  const ancestorArchived = (subprojectId: string): boolean => {
    let current = allById.get(subprojectId);
    let guard = 0;
    while (current) {
      if (current.status === 'Archived') return true;
      current = current.parentSubprojectId ? allById.get(current.parentSubprojectId) : undefined;
      if (++guard > 20) return true;
    }
    return false;
  };
  // Descendant eligibility follows the whole ancestor chain, so an archived parent hides its
  // children instead of leaving an orphaned branch.
  const visibleSubprojects = allSubprojects.filter((subproject) => manager || !ancestorArchived(subproject.subprojectId));
  const visibleSubprojectIds = new Set(visibleSubprojects.map((subproject) => subproject.subprojectId));
  // Completed work inside a visible project stays part of that project's record, so a reader can
  // see the real completed count. Cancelled work and the tasks of an archived branch are withheld
  // from a non-manager: the hierarchy must not receive a task it is not allowed to show.
  const visibleTasks = tasks.filter((task) => {
    if (task.subprojectId && !visibleSubprojectIds.has(task.subprojectId)) return false;
    return manager || task.status !== 'Cancelled';
  });

  const rollupOf = (tasksForRollup: typeof tasks) => {
    const value = rollup(
      tasksForRollup.map((task) => ({
        taskId: task.taskId,
        status: task.status,
        progressPercent: task.progressPercent ?? null,
        estimatedHours: null,
        parentTaskId: task.parentTaskId
      }))
    );
    return { ...value, unknownEffort: value.unknown };
  };

  const childrenOf = new Map<string, string[]>();
  for (const subproject of visibleSubprojects) {
    const parent = subproject.parentSubprojectId ?? '';
    const list = childrenOf.get(parent) ?? [];
    list.push(subproject.subprojectId);
    childrenOf.set(parent, list);
  }
  const subtreeIds = (subprojectId: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(subprojectId)) return seen;
    seen.add(subprojectId);
    for (const child of childrenOf.get(subprojectId) ?? []) subtreeIds(child, seen);
    return seen;
  };
  const subtrees = new Map(
    visibleSubprojects.map((subproject) => [subproject.subprojectId, subtreeIds(subproject.subprojectId)])
  );

  return {
    canWrite: canWriteDivision(ctx.divisions, project.divisionId),
    record: {
      projectId: project.projectId,
      projectName: project.projectName,
      description: project.description,
      divisionName: project.divisionName,
      responsibilityId: project.responsibilityId,
      responsibilityName: project.responsibilityName,
      projectOwnerName: project.projectOwnerName,
      status: project.status,
      schedule: project.schedule,
      priority: project.priority,
      committedDeadline: project.committedDeadline,
      progressPercent: project.progressPercent,
      health: project.health,
      activeTaskCount: counts?.openWork ?? 0,
      overdueTaskCount: counts?.overdueWork ?? 0,
      completedTaskCount: counts?.completedWork ?? 0
    },
    progress: rollupOf(visibleTasks),
    subprojects: visibleSubprojects.map((subproject) => ({
      subprojectId: subproject.subprojectId,
      subprojectName: subproject.subprojectName,
      description: subproject.description,
      parentSubprojectId: subproject.parentSubprojectId,
      status: subproject.status,
      schedule: projectScheduleStatus(
        {
          status: subproject.status,
          plannedStart: subproject.plannedStart,
          committedDeadline: subproject.deadline
        },
        ctx.today
      ),
      deadline: subproject.deadline,
      depth: subproject.depth,
      progress: rollupOf(
        visibleTasks.filter(
          (task) => !!task.subprojectId && (subtrees.get(subproject.subprojectId)?.has(task.subprojectId) ?? false)
        )
      )
    })),
    tasks: visibleTasks
  };
}
