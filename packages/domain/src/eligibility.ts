/**
 * One ancestor-aware policy for "is this work still operational?".
 * Active work, reminders, reports and published aggregates all call these helpers, so archived
 * ancestors never leak into a workload figure while history stays intact.
 */
import { isOpenTaskStatus, isReminderEligibleStatus, isWorkloadProjectStatus } from './taxonomy';
import { MAX_SUBPROJECT_DEPTH } from './hierarchy';

export type ProjectLike = { status: string; notificationEnabled?: boolean } | undefined;
export type TaskLike = {
  status: string;
  projectId: string;
  subprojectId: string | null;
  notificationEnabled: boolean;
};
export type SubprojectLike = { subprojectId: string; projectId: string; parentSubprojectId: string | null; status: string };

export function projectOpen(project: ProjectLike): boolean {
  return !!project && isWorkloadProjectStatus(project.status);
}

export function projectContributesWorkload(project: ProjectLike): boolean {
  return !!project && isWorkloadProjectStatus(project.status);
}

export function projectArchived(project: ProjectLike): boolean {
  return !!project && project.status === 'Archived';
}

export function projectCompleted(project: ProjectLike): boolean {
  return !!project && project.status === 'Completed';
}

export function taskOpen(task: { status: string } | undefined): boolean {
  return !!task && isOpenTaskStatus(task.status);
}

export function subprojectOpen(subproject: SubprojectLike | undefined): boolean {
  return !subproject || isWorkloadProjectStatus(subproject.status);
}

/**
 * Returns false when a node is missing, belongs to another project, sits beneath a non-working
 * ancestor, or when the stored links form a cycle or point at a missing parent. A bounded walk
 * (four levels plus headroom) is the guard against malformed data, never an assumption.
 */
export function subprojectInActiveWork(
  subprojectId: string | null | undefined,
  projectId: string | null | undefined,
  subprojects: ReadonlyMap<string, SubprojectLike> | Record<string, SubprojectLike>
): boolean {
  const id = String(subprojectId ?? '');
  if (!id) return true;
  const lookup = (key: string): SubprojectLike | undefined =>
    subprojects instanceof Map ? subprojects.get(key) : (subprojects as Record<string, SubprojectLike>)[key];

  let node = lookup(id);
  const seen = new Set<string>();
  let guard = 0;
  const limit = MAX_SUBPROJECT_DEPTH + 2;
  while (node) {
    const key = node.subprojectId;
    if (seen.has(key)) return false;
    seen.add(key);
    if (projectId !== null && projectId !== undefined && String(node.projectId) !== String(projectId)) {
      return false;
    }
    if (!subprojectOpen(node)) return false;
    const parentId = String(node.parentSubprojectId ?? '');
    if (!parentId) return true;
    if (guard++ > limit) return false;
    node = lookup(parentId);
  }
  // A missing parent means the stored hierarchy is broken; treat the branch as inactive.
  return false;
}

export function projectNotificationsAllowed(project: ProjectLike): boolean {
  return !project || project.notificationEnabled !== false;
}

export function taskNotificationsAllowed(task: { notificationEnabled: boolean } | undefined): boolean {
  return !!task && task.notificationEnabled === true;
}

export function taskInActiveWork(
  task: TaskLike | undefined,
  projects: ReadonlyMap<string, ProjectLike> | Record<string, ProjectLike>,
  subprojects: ReadonlyMap<string, SubprojectLike> | Record<string, SubprojectLike>
): boolean {
  if (!task || !taskOpen(task)) return false;
  const project =
    projects instanceof Map
      ? projects.get(task.projectId)
      : (projects as Record<string, ProjectLike>)[task.projectId];
  if (!projectContributesWorkload(project)) return false;
  return subprojectInActiveWork(task.subprojectId, task.projectId, subprojects);
}

export function taskNotifiable(
  task: TaskLike | undefined,
  project: ProjectLike,
  subprojects: ReadonlyMap<string, SubprojectLike> | Record<string, SubprojectLike>
): boolean {
  if (!task) return false;
  if (!taskNotificationsAllowed(task)) return false;
  if (!projectOpen(project)) return false;
  if (!isReminderEligibleStatus(task.status)) return false;
  return subprojectInActiveWork(task.subprojectId, task.projectId, subprojects);
}
