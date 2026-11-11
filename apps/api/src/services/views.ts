/**
 * Read models for the manager screens.
 *
 * Each view is assembled from a bounded number of queries memoized for one request, so a screen
 * never pays for a second full-table read and the whole task table never reaches the browser.
 */
import type { FastifyRequest } from 'fastify';
import type { Database } from '@eh/db';
import {
  compactTaskIndex,
  listAllProjects,
  listAllTasksForScope,
  listAudit,
  listDivisions,
  listTaskSummaries,
  listMembers,
  memberDivisionNames,
  memberWorkDivisionIds,
  listPendingRequests,
  listResponsibilities,
  listSkills,
  listSubprojects,
  listTaskSummariesForMember,
  listTaskSummariesForProject
} from '@eh/db';
import type {
  Actor,
  Bootstrap,
  Overview,
  ProjectSummary,
  ResponsibilityCard,
  TaskRequest
} from '@eh/contracts';
import { API_VERSION, APP_VERSION, DB_SCHEMA_VERSION } from '@eh/contracts';
import {
  businessDate,
  assertReadableDivision,
  createScope,
  deadlineState,
  projectScheduleStatus,
  readableDivisionIds,
  rollup,
  scopedDivisionIds,
  type DivisionScope,
  type Identity,
  type SubprojectLike
} from '@eh/domain';
import { divisionReferences } from './divisions';

export type ReadCtx = {
  db: Database;
  cache: Map<string, Promise<unknown>>;
  today: string;
  /** The division scope of the caller, resolved once per request. */
  divisions: DivisionScope;
};

export function readCtx(request: FastifyRequest): ReadCtx {
  return {
    db: request.state.db,
    cache: request.state.cache,
    today: businessDate(),
    divisions: request.state.divisions
  };
}

export function memo<T>(ctx: ReadCtx, key: string, load: () => Promise<T>): Promise<T> {
  const existing = ctx.cache.get(key);
  if (existing) return existing as Promise<T>;
  const promise = load();
  ctx.cache.set(key, promise as Promise<unknown>);
  return promise;
}

export const PROJECT_INDEX_LIMIT = 500;
export const TASK_INDEX_LIMIT = 2000;

export function directory(ctx: ReadCtx) {
  return memo(ctx, 'directory', async () => {
    // One read per table per request, each already restricted to the caller's divisions.
    const divisionIds = readableDivisionIds(ctx.divisions);
    const [responsibilities, members, skills, subprojects, projects] = await Promise.all([
      listResponsibilities(ctx.db, { divisionIds }),
      listMembers(ctx.db, { includeInactive: true, limit: 1000 }),
      listSkills(ctx.db),
      listSubprojects(ctx.db, undefined, divisionIds),
      listAllProjects(ctx.db, 2000, divisionIds)
    ]);
    return { responsibilities, members, skills, subprojects, projects };
  });
}

export function taskScope(ctx: ReadCtx) {
  return memo(ctx, 'scope', async () => {
    const [dir, tasks] = await Promise.all([
      directory(ctx),
      listAllTasksForScope(ctx.db, 20000, readableDivisionIds(ctx.divisions))
    ]);
    const projects = new Map<string, { status: string; notificationEnabled: boolean }>();
    for (const project of dir.projects) {
      projects.set(project.projectId, {
        status: project.status,
        notificationEnabled: project.notificationEnabled
      });
    }
    const subprojects = new Map<string, SubprojectLike>();
    for (const subproject of dir.subprojects) {
      subprojects.set(subproject.subprojectId, {
        subprojectId: subproject.subprojectId,
        projectId: subproject.projectId,
        parentSubprojectId: subproject.parentSubprojectId,
        status: subproject.status
      });
    }
    const scope = createScope(tasks, projects, subprojects, ctx.today);
    return { scope, tasks, dir };
  });
}

/**
 * The divisions a screen may offer, resolved in the caller's scope. "All divisions" is expressed by
 * the scope flag, never by a browser-supplied list, so a division created later is included for an
 * account that may oversee every division.
 */
async function listDivisionsWithScope(ctx: ReadCtx): Promise<Bootstrap['divisions']> {
  // Retired divisions stay readable so history stays reachable; `writable` still excludes them.
  const divisions = await listDivisions(ctx.db, { includeRetired: true });
  const { readable, writable } = divisionReferences(ctx.divisions, divisions);
  const defaultDivisionId = writable[0]?.divisionId ?? readable[0]?.divisionId ?? null;
  return {
    readable,
    writable,
    allDivisions: ctx.divisions.manageAll || ctx.divisions.overseeAll,
    defaultDivisionId
  };
}

export function actorDto(identity: Identity): Actor {  return {    memberId: identity.memberId,
    name: identity.name,
    email: identity.email,
    role: identity.role,
    active: identity.active,
    verified: identity.verified,
    selfServiceEnabled: true
  };
}

export function buildProjectSummary(
  project: {
    projectId: string;
    projectName: string;
    divisionId?: string | null;
    divisionName?: string;
    responsibilityId: string | null;
    responsibilityName: string;
    projectOwnerId: string | null;
    status: ProjectSummary['status'];
    priority: ProjectSummary['priority'];
    plannedStart?: string | null;
    committedDeadline: string | null;
    archivedAt?: string | null;
    progressPercent: number | null;
    health: string;
    nextAction: string;
    dashboardVisibility: ProjectSummary['dashboardVisibility'];
    revision: number;
  },
  counts: { openWork: number; overdueWork: number; containers: number },
  today: string
): ProjectSummary {
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    divisionId: project.divisionId ?? null,
    divisionName: project.divisionName ?? '',
    responsibilityId: project.responsibilityId,
    responsibilityName: project.responsibilityName,
    projectOwnerId: project.projectOwnerId,
    status: project.status,
    schedule: projectScheduleStatus(
      {
        status: project.status,
        plannedStart: project.plannedStart ?? null,
        committedDeadline: project.committedDeadline,
        archivedAt: project.archivedAt ?? null
      },
      today
    ),
    priority: project.priority,
    committedDeadline: project.committedDeadline,
    deadlineState: deadlineState(project.committedDeadline, project.status, today),
    progressPercent: project.progressPercent,
    health: project.health,
    nextAction: project.nextAction,
    dashboardVisibility: project.dashboardVisibility,
    containerCount: counts.containers,
    openWork: counts.openWork,
    overdueWork: counts.overdueWork,
    revision: project.revision
  };
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toRollupTasks(
  tasks: readonly {
    taskId: string;
    status: string;
    progressPercent?: number | null;
    estimatedHours?: number | null;
    parentTaskId: string | null;
  }[]
) {
  return tasks.map((task) => ({
    taskId: task.taskId,
    status: task.status,
    progressPercent: task.progressPercent ?? null,
    estimatedHours: task.estimatedHours ?? null,
    parentTaskId: task.parentTaskId
  }));
}

export async function buildOverview(
  ctx: ReadCtx,
  input: { responsibilityId?: string; divisionId?: string; unassigned?: boolean; upcomingDays: 7 | 14 | 30 }
): Promise<Overview> {
  const { scope, dir } = await taskScope(ctx);
  // The same narrowing rule as every list: an unauthorized division is refused, never silently
  // applied to the aggregate figure, the cards or paged sections.
  const divisionIds = scopedDivisionIds(ctx.divisions, input.divisionId);
  const responsibilityOfProject = new Map<string, string | null>(
    dir.projects.map((project) => [project.projectId, project.responsibilityId])
  );
  const scopeFilter = (task: { projectId: string }): boolean => {
    const responsibilityId = responsibilityOfProject.get(task.projectId) ?? null;
    if (input.unassigned) return !responsibilityId;
    if (input.responsibilityId) return responsibilityId === input.responsibilityId;
    return true;
  };

  const activeHistoryFilter = (task: { projectId: string; subprojectId: string | null }): boolean => {
    const project = dir.projects.find((entry) => entry.projectId === task.projectId);
    if (!project || project.status === 'Archived') return false;
    let subprojectId = task.subprojectId;
    const seen = new Set<string>();
    while (subprojectId) {
      if (seen.has(subprojectId)) return false;
      seen.add(subprojectId);
      const subproject = dir.subprojects.find((entry) => entry.subprojectId === subprojectId);
      if (!subproject || subproject.status === 'Archived') return false;
      subprojectId = subproject.parentSubprojectId;
    }
    return true;
  };
  const counts = scope.counts(
    (task) => scopeFilter(task) && activeHistoryFilter(task),
    ctx.today
  );
  const commonFilters = {
    responsibilityId: input.responsibilityId,
    unassigned: input.unassigned,
    divisionIds,
    today: ctx.today
  };
  const upcomingTo = addDaysIso(ctx.today, input.upcomingDays - 1);
  const [upcomingPage, overduePage] = await Promise.all([
    listTaskSummaries(
      ctx.db,
      {
        ...commonFilters,
        workState: 'OPEN',
        dueFrom: ctx.today,
        dueTo: upcomingTo,
        sort: 'dueDate',
        direction: 'asc'
      },
      1,
      20
    ),
    listTaskSummaries(
      ctx.db,
      {
        ...commonFilters,
        displayStatus: 'OVERDUE',
        sort: 'dueDate',
        direction: 'asc'
      },
      1,
      10
    )
  ]);

  const cards: ResponsibilityCard[] = dir.responsibilities.map((responsibility) => {
    const projectIds = new Set(
      dir.projects
        .filter((project) => project.responsibilityId === responsibility.responsibilityId)
        .map((project) => project.projectId)
    );
    const countsForArea = scope.counts((task) => projectIds.has(task.projectId), ctx.today);
    const areaTasks = scope.tasks
      .filter((task) => projectIds.has(task.projectId))
      .map((task) => ({
        taskId: task.taskId,
        status: task.status,
        progressPercent: task.progressPercent ?? null,
        estimatedHours: task.estimatedHours ?? null,
        parentTaskId: task.parentTaskId
      }));
    return {
      responsibilityId: responsibility.responsibilityId,
      name: responsibility.name,
      color: responsibility.color,
      ownerName: responsibility.ownerName,
      status: responsibility.status,
      projectCount: projectIds.size,
      openWork: countsForArea.openWork,
      overdueWork: countsForArea.overdueWork,
      completedWork: countsForArea.completedWork,
      cancelledWork: countsForArea.cancelledWork,
      containers: countsForArea.containers,
      progressPercent: rollup(areaTasks).percent
    };
  });

  const visibleProjects = dir.projects
    .filter((project) =>
      input.unassigned
        ? !project.responsibilityId
        : input.responsibilityId
          ? project.responsibilityId === input.responsibilityId
          : true
    )
    .slice(0, 50)
    .map((project) =>
      buildProjectSummary(
        project,
        scope.counts((task) => task.projectId === project.projectId, ctx.today),
        ctx.today
      )
    );

  const pendingRequests: TaskRequest[] = await listPendingRequests(ctx.db, 20);

  return {
    scope: {
      responsibilityId: input.responsibilityId ?? '',
      unassigned: input.unassigned === true,
      label: input.unassigned
        ? '未分類'
        : dir.responsibilities.find((entry) => entry.responsibilityId === input.responsibilityId)?.name ?? ''
    },
    counts,
    upcomingWindow: { days: input.upcomingDays, from: ctx.today, to: upcomingTo },
    overdue: overduePage.items,
    overdueTotal: overduePage.total,
    upcoming: upcomingPage.items,
    upcomingTotal: upcomingPage.total,
    responsibilities: cards,
    projects: visibleProjects,
    pendingRequests,
    generatedAt: new Date().toISOString()
  };
}

export async function buildBootstrap(ctx: ReadCtx, identity: Identity, environment: string): Promise<Bootstrap> {
  const dir = await directory(ctx);
  const { scope } = await taskScope(ctx);
  const index = await compactTaskIndex(ctx.db, TASK_INDEX_LIMIT, readableDivisionIds(ctx.divisions));
  const divisions = await listDivisionsWithScope(ctx);
  const memberDivisions = await memberDivisionNames(
    ctx.db,
    dir.members.map((member) => member.memberId)
  );
  const memberWork = await memberWorkDivisionIds(
    ctx.db,
    dir.members.map((member) => member.memberId)
  );

  const projects = dir.projects
    .slice(0, PROJECT_INDEX_LIMIT)
    .map((project) =>
      buildProjectSummary(
        project,
        scope.counts((task) => task.projectId === project.projectId, ctx.today),
        ctx.today
      )
    );

  return {
    actor: actorDto(identity),
    app: {
      version: APP_VERSION,
      apiVersion: API_VERSION,
      schemaVersion: DB_SCHEMA_VERSION,
      defaultLocale: 'ja',
      environment
    },
    divisions,
    references: {
      responsibilities: dir.responsibilities.map((responsibility) => ({
        id: responsibility.responsibilityId,
        name: responsibility.name,
        status: responsibility.status,
        divisionId: responsibility.divisionId ?? null
      })),
      members: dir.members.map((member) => ({
        memberId: member.memberId,
        name: member.name,
        active: member.active,
        role: member.role,
        employeeId: member.employeeId,
        divisionNames: memberDivisions.get(member.memberId) ?? [],
        workDivisionIds: memberWork.get(member.memberId) ?? []
      })),
      skills: dir.skills,
      subprojects: dir.subprojects.map((subproject) => ({
        id: subproject.subprojectId,
        name: subproject.subprojectName,
        status: subproject.status,
        parentId: subproject.parentSubprojectId
      }))
    },
    projects,
    projectLimit: PROJECT_INDEX_LIMIT,
    taskIndex: index.entries.map((entry) => ({
      ...entry,
      status: entry.status as Bootstrap['taskIndex'][number]['status']
    })),
    taskIndexComplete: index.entries.length >= index.total,
    taskTotal: index.total,
    taskIndexLimit: TASK_INDEX_LIMIT
  };
}

/** Project detail: the record, its rollup, descendants and its task summaries. */
export async function buildProjectDetail(ctx: ReadCtx, project: import('@eh/contracts').Project) {
  assertReadableDivision(ctx.divisions, project.divisionId);
  const dir = await directory(ctx);
  const tasks = await listTaskSummariesForProject(ctx.db, project.projectId);
  const { scope } = await taskScope(ctx);
  const projectScopeTasks = scope.tasks.filter((task) => task.projectId === project.projectId);
  const rawProgress = rollup(toRollupTasks(projectScopeTasks));
  const progress = { ...rawProgress, unknownEffort: rawProgress.unknown };
  const children = new Map<string, string[]>();
  for (const subproject of dir.subprojects.filter((entry) => entry.projectId === project.projectId)) {
    const parent = subproject.parentSubprojectId ?? '';
    const list = children.get(parent) ?? [];
    list.push(subproject.subprojectId);
    children.set(parent, list);
  }
  const tasksBySubproject = new Map<string, typeof projectScopeTasks>();
  for (const scopeTask of projectScopeTasks) {
    if (!scopeTask.subprojectId) continue;
    const list = tasksBySubproject.get(scopeTask.subprojectId) ?? [];
    list.push(scopeTask);
    tasksBySubproject.set(scopeTask.subprojectId, list);
  }
  const subtreeTasks = (subprojectId: string, seen = new Set<string>()): typeof projectScopeTasks => {
    if (seen.has(subprojectId)) return [];
    seen.add(subprojectId);
    return [
      ...(tasksBySubproject.get(subprojectId) ?? []),
      ...(children.get(subprojectId) ?? []).flatMap((child) => subtreeTasks(child, seen))
    ];
  };
  const subprojects = dir.subprojects
    .filter((entry) => entry.projectId === project.projectId)
    .map((entry) => ({
      ...entry,
      progress: (() => { const value = rollup(toRollupTasks(subtreeTasks(entry.subprojectId))); return { ...value, unknownEffort: value.unknown }; })()
    }));
  return { record: project, progress, subprojects, tasks };
}

/** One member's current and former work, with audit evidence for recorded activity. */
export async function buildMemberProfile(ctx: ReadCtx, member: import('@eh/contracts').Member) {
  const [{ current, previous, previousHidden }, activity] = await Promise.all([
    // Both lists are read in the caller's divisions; a former assignment elsewhere is counted,
    // never described.
    listTaskSummariesForMember(ctx.db, member.memberId, {
      currentDivisionIds: readableDivisionIds(ctx.divisions)
    }),
    listAudit(ctx.db, { limit: 50 })
  ]);
  const ownActivity = activity.filter((entry) => entry.actor === member.email);
  return {
    member: {
      memberId: member.memberId,
      name: member.name,
      active: member.active,
      role: member.role,
      email: member.email,
      department: member.department,
      position: member.position,
      weeklyCapacityHours: member.weeklyCapacityHours
    },
    current,
    previous,
    activity: ownActivity,
    ownership: {
      current: current.length,
      previous: previous.length,
      previousHidden,
      additionalCurrent: current.filter((task) => task.ownerMemberId !== member.memberId).length,
      historicalOnly: previous.filter((task) => task.ownerMemberId !== member.memberId).length,
      limitation:
        'Ownership history is derived from relationship rows and audit evidence only; former work in a division you may not read is counted but not described',
      evidence: 'AUDIT_LOG'
    }
  };
}
