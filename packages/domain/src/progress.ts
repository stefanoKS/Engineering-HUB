/**
 * Effort-weighted progress rollup.
 *
 * A known positive estimate is the weight. Unknown effort keeps a documented fallback weight of
 * 1 so unestimated work still moves the percentage, while the unknown count is reported
 * separately and never presented as real hours. A container task is organisation only: its
 * leaf work is already counted, so a parent and its children are never counted twice.
 */
import { buildIndex, isContainer } from './hierarchy';

export const UNKNOWN_WEIGHT = 1;

export type RollupTask = {
  taskId: string;
  status: string;
  progressPercent: number | null;
  estimatedHours: number | null;
  parentTaskId: string | null;
};

export type Rollup = {
  calculated: boolean;
  percent: number | null;
  tasks: number;
  unknown: number;
  zeroEstimate: number;
  weightTotal: number;
  weightDone: number;
  doneLeaves: number;
  cancelledLeaves: number;
  leaves: number;
  containers: number;
};

function clamp(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

export function taskPercent(task: RollupTask): number {
  if (task.status === 'Done') return 100;
  if (task.status === 'Cancelled') return 0;
  return clamp(task.progressPercent);
}

export function taskWeight(task: RollupTask): number {
  if (task.estimatedHours === null || task.estimatedHours === undefined) return UNKNOWN_WEIGHT;
  return task.estimatedHours > 0 ? task.estimatedHours : 0;
}

export function rollup(tasks: readonly RollupTask[]): Rollup {
  const index = buildIndex(
    tasks.map((task) => ({ id: task.taskId, parentId: task.parentTaskId }))
  );
  let weighted = 0;
  let weightTotal = 0;
  let percentTotal = 0;
  let counted = 0;
  let unknown = 0;
  let zeroEstimate = 0;
  let doneLeaves = 0;
  let cancelledLeaves = 0;
  let leaves = 0;
  let containers = 0;

  for (const task of tasks) {
    if (!task) continue;
    if (isContainer(task.taskId, index.children)) {
      containers += 1;
      continue;
    }
    leaves += 1;
    if (task.status === 'Cancelled') {
      cancelledLeaves += 1;
      continue;
    }
    if (task.status === 'Done') doneLeaves += 1;
    counted += 1;
    const value = taskPercent(task);
    const weight = taskWeight(task);
    if (task.estimatedHours === null || task.estimatedHours === undefined) unknown += 1;
    else if (weight === 0) zeroEstimate += 1;
    weightTotal += weight;
    weighted += weight * value;
    percentTotal += value;
  }

  if (!counted) {
    return {
      calculated: false,
      percent: null,
      tasks: 0,
      unknown,
      zeroEstimate,
      weightTotal: 0,
      weightDone: 0,
      doneLeaves,
      cancelledLeaves,
      leaves,
      containers
    };
  }
  const percent = weightTotal > 0 ? weighted / weightTotal : percentTotal / counted;
  return {
    calculated: true,
    percent: Math.round(percent * 100) / 100,
    tasks: counted,
    unknown,
    zeroEstimate,
    weightTotal,
    weightDone: weighted / 100,
    doneLeaves,
    cancelledLeaves,
    leaves,
    containers
  };
}

export function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    if (!id) continue;
    const list = result.get(id) ?? [];
    list.push(row);
    result.set(id, list);
  }
  return result;
}

/** Tasks of one subproject node plus every descendant node - each task counted once. */
export function subtreeTasks<T extends { subprojectId: string | null }>(
  subprojectId: string,
  children: Map<string, string[]>,
  tasksBySubproject: Map<string, T[]>
): T[] {
  const collected: T[] = [];
  const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    collected.push(...(tasksBySubproject.get(id) ?? []));
    for (const child of children.get(id) ?? []) walk(child);
  };
  walk(subprojectId);
  return collected;
}

/** Remaining effort is unknown, never zero, when no estimate exists. */
export function remainingHours(task: { estimatedHours: number | null; actualHours: number | null }): number | null {
  if (task.estimatedHours === null || task.estimatedHours === undefined) return null;
  const actual = task.actualHours ?? 0;
  return Math.max(0, task.estimatedHours - actual);
}
