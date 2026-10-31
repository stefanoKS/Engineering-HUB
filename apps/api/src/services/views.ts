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
  listDueWindowSummaries,
  listMembers,
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
import {
  businessDate,
  createScope,
  deadlineState,
  rollup,
  type Identity,
  type SubprojectLike
} from '@eh/domain';

export type ReadCtx = {
  db: Database;
  cache: Map<string, Promise<unknown>>;
  today: string;
};

export function readCtx(request: FastifyRequest): ReadCtx {
  return { db: request.state.db, cache: request.state.cache, today: businessDate() };
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
    const [responsibilities, members, skills, subprojects, projects] = await Promise.all([
      listResponsibilities(ctx.db),
      listMembers(ctx.db, { includeInactive: true, limit: 1000 }),
      listSkills(ctx.db),
      listSubprojects(ctx.db),
      listAllProjects(ctx.db, 2000)
    ]);
    return { responsibilities, members, skills, subprojects, projects };
  });
}

export function taskScope(ctx: ReadCtx) {
  return memo(ctx, 'scope', async () => {
    const [dir, tasks] = await Promise.all([directory(ctx), listAllTasksForScope(ctx.db)]);
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

export function actorDto(identity: Identity): Actor {  return {
    memberId: identity.memberId,
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
    responsibilityId: string | null;
    responsibilityName: string;
    projectOwnerId: string | null;
    status: ProjectSummary['status'];
    priority: ProjectSummary['priority'];
    committedDeadline: string | null;
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
    responsibilityId: project.responsibilityId,
    responsibilityName: project.responsibilityName,
    projectOwnerId: project.projectOwnerId,
    status: project.status,
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
  input: { responsibilityId?: string; unassigned?: boolean }
): Promise<Overview> {
  const { scope, dir } = await taskScope(ctx);
  const responsibilityOfProject = new Map<string, string | null>(
    dir.projects.map((project) => [project.projectId, project.responsibilityId])
  );
  const scopeFilter = (task: { projectId: string }): boolean => {
    const responsibilityId = responsibilityOfProject.get(task.projectId) ?? null;
    if (input.unassigned) return !responsibilityId;
    if (input.responsibilityId) return responsibilityId === input.responsibilityId;
    return true;
  };

  const counts = scope.counts(scopeFilter, ctx.today);

  const windowTasks = await listDueWindowSummaries(ctx.db, ctx.today, addDaysIso(ctx.today, 14), 200);
  const upcoming = windowTasks
    .filter((summary) => {
      const scopeTask = scope.tasks.find((task) => task.taskId === summary.taskId);
      return !!scopeTask && scopeFilter(scopeTask) && scope.inActiveWork(scopeTask);
    })
    .slice(0, 20);

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
    upcoming,
    responsibilities: cards,
    projects: visibleProjects,
    pendingRequests,
    generatedAt: new Date().toISOString()
  };
}

export async function buildBootstrap(ctx: ReadCtx, identity: Identity, environment: string): Promise<Bootstrap> {
  const dir = await directory(ctx);
  const { scope } = await taskScope(ctx);
  const index = await compactTaskIndex(ctx.db, TASK_INDEX_LIMIT);

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
      version: '2.0.0',
      apiVersion: '2.0.0',
      schemaVersion: 1,
      defaultLocale: 'ja',
      environment
    },
    references: {
      responsibilities: dir.responsibilities.map((responsibility) => ({
        id: responsibility.responsibilityId,
        name: responsibility.name,
        status: responsibility.status
      })),
      members: dir.members.map((member) => ({
        memberId: member.memberId,
        name: member.name,
        active: member.active,
        role: member.role
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
  const dir = await directory(ctx);
  const tasks = await listTaskSummariesForProject(ctx.db, project.projectId);
  const { scope } = await taskScope(ctx);
  const projectScopeTasks = scope.tasks.filter((task) => task.projectId === project.projectId);
  const progress = rollup(toRollupTasks(projectScopeTasks));
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
      progress: rollup(toRollupTasks(subtreeTasks(entry.subprojectId)))
    }));
  return { record: project, progress, subprojects, tasks };
}

/** One member's current and former work, with audit evidence for recorded activity. */
export async function buildMemberProfile(ctx: ReadCtx, member: import('@eh/contracts').Member) {
  const [{ current, previous }, activity] = await Promise.all([
    listTaskSummariesForMember(ctx.db, member.memberId),
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
      additionalCurrent: current.filter((task) => task.ownerMemberId !== member.memberId).length,
      historicalOnly: previous.filter((task) => task.ownerMemberId !== member.memberId).length,
      limitation: 'Ownership history is derived from relationship rows and audit evidence only',
      evidence: 'AUDIT_LOG'
    }
  };
}
