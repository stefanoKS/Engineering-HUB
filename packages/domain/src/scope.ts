/**
 * One counting policy for every manager-facing figure (V1.6.1 rules 89-90).
 *
 * - work item: a task without children; the only thing counted as work.
 * - container: a task with children; organisation only, never an extra unit of work.
 * - active work: an open work item whose project and whole subproject chain still work.
 * - open work: active work that is neither Done nor Cancelled.
 * - overdue: open work whose due date is before today.
 * - completed / cancelled: reported separately and never mixed into a workload figure.
 */
import { businessDate } from './time';
import { taskInActiveWork, type ProjectLike, type SubprojectLike } from './eligibility';
import { buildIndex, isContainer } from './hierarchy';

export type ScopeTask = {
  taskId: string;
  projectId: string;
  subprojectId: string | null;
  parentTaskId: string | null;
  status: string;
  dueDate: string | null;
  /** Present when the caller supplies a fuller row; never required for counting. */
  plannedStart?: string | null;
  progressPercent?: number | null;
  estimatedHours?: number | null;
};

export type ScopeCounts = {
  workItems: number;
  containers: number;
  activeWork: number;
  openWork: number;
  overdueWork: number;
  completedWork: number;
  cancelledWork: number;
};

export type TaskScope = {
  tasks: readonly ScopeTask[];
  leaves: ScopeTask[];
  containers: ScopeTask[];
  isContainer(taskId: string): boolean;
  inActiveWork(task: ScopeTask): boolean;
  counts(include?: (task: ScopeTask) => boolean, today?: string): ScopeCounts;
  countsBy(groupOf: (task: ScopeTask) => string, today?: string): Map<string, ScopeCounts>;
  upcoming(from: string, to: string, include?: (task: ScopeTask) => boolean): ScopeTask[];
  activeWork(): ScopeTask[];
};

export function emptyCounts(): ScopeCounts {
  return {
    workItems: 0,
    containers: 0,
    activeWork: 0,
    openWork: 0,
    overdueWork: 0,
    completedWork: 0,
    cancelledWork: 0
  };
}

export function createScope(
  tasks: readonly ScopeTask[],
  projects: ReadonlyMap<string, ProjectLike> | Record<string, ProjectLike>,
  subprojects: ReadonlyMap<string, SubprojectLike> | Record<string, SubprojectLike>,
  today: string = businessDate()
): TaskScope {
  const index = buildIndex(tasks.map((task) => ({ id: task.taskId, parentId: task.parentTaskId })));
  const containerFlags = new Map<string, boolean>();
  for (const task of tasks) containerFlags.set(task.taskId, isContainer(task.taskId, index.children));
  const isContainerTask = (taskId: string): boolean => containerFlags.get(taskId) === true;

  const inActiveWork = (task: ScopeTask): boolean => {
    if (!task || isContainerTask(task.taskId)) return false;
    return taskInActiveWork(
      {
        status: task.status,
        projectId: task.projectId,
        subprojectId: task.subprojectId,
        notificationEnabled: true
      },
      projects,
      subprojects
    );
  };

  const accumulate = (target: ScopeCounts, task: ScopeTask, day: string): void => {
    if (isContainerTask(task.taskId)) {
      target.containers += 1;
      return;
    }
    target.workItems += 1;
    if (task.status === 'Done') {
      target.completedWork += 1;
      return;
    }
    if (task.status === 'Cancelled') {
      target.cancelledWork += 1;
      return;
    }
    if (!inActiveWork(task)) return;
    target.activeWork += 1;
    target.openWork += 1;
    if (task.dueDate && task.dueDate < day) target.overdueWork += 1;
  };

  const leaves = tasks.filter((task) => !isContainerTask(task.taskId));
  const containers = tasks.filter((task) => isContainerTask(task.taskId));

  return {
    tasks,
    leaves,
    containers,
    isContainer: isContainerTask,
    inActiveWork,
    counts(include, day = today) {
      const target = emptyCounts();
      for (const task of tasks) {
        if (include && !include(task)) continue;
        accumulate(target, task, day);
      }
      return target;
    },
    countsBy(groupOf, day = today) {
      const result = new Map<string, ScopeCounts>();
      for (const task of tasks) {
        const key = String(groupOf(task) || '');
        const target = result.get(key) ?? emptyCounts();
        accumulate(target, task, day);
        result.set(key, target);
      }
      return result;
    },
    upcoming(from, to, include) {
      return leaves
        .filter((task) => {
          if (include && !include(task)) return false;
          if (!task.dueDate) return false;
          return task.dueDate >= from && task.dueDate <= to && inActiveWork(task);
        })
        .sort(
          (a, b) =>
            String(a.dueDate).localeCompare(String(b.dueDate)) || a.taskId.localeCompare(b.taskId)
        );
    },
    activeWork() {
      return leaves.filter(inActiveWork);
    }
  };
}
