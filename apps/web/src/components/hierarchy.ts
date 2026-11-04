/**
 * Shared hierarchy presentation helpers.
 *
 * A repeated name such as "Testing" must never be ambiguous in a selector, so every option shows
 * its full path. Only presentation lives here: stable IDs stay the submitted value and each
 * caller keeps its own role-specific authorization.
 */
import { MAX_SUBPROJECT_DEPTH, MAX_TASK_DEPTH } from '@eh/domain';

export type SubprojectNode = {
  subprojectId: string;
  subprojectName: string;
  parentSubprojectId?: string | null;
  depth: number;
};

export type TaskNode = {
  id: string;
  name: string;
  depth: number;
  parentTaskId?: string | null;
};

export const SUBPROJECT_DEPTH_LIMIT = MAX_SUBPROJECT_DEPTH;
export const TASK_DEPTH_LIMIT = MAX_TASK_DEPTH;

function pathOf<T>(
  nodes: T[],
  id: string,
  idOf: (node: T) => string,
  parentOf: (node: T) => string | null,
  nameOf: (node: T) => string
): string {
  const byId = new Map(nodes.map((node) => [idOf(node), node]));
  const names: string[] = [];
  const seen = new Set<string>();
  let node = byId.get(id);
  while (node && !seen.has(idOf(node))) {
    seen.add(idOf(node));
    names.unshift(nameOf(node));
    const parentId = parentOf(node);
    node = parentId ? byId.get(parentId) : undefined;
  }
  return names.join(' / ');
}

export function subprojectPath(nodes: SubprojectNode[], subprojectId: string): string {
  return pathOf(
    nodes,
    subprojectId,
    (node) => node.subprojectId,
    (node) => node.parentSubprojectId ?? null,
    (node) => node.subprojectName
  );
}

export function taskPath(nodes: TaskNode[], taskId: string): string {
  return pathOf(
    nodes,
    taskId,
    (node) => node.id,
    (node) => node.parentTaskId ?? null,
    (node) => node.name
  );
}

/** A parent option is offered only while it still has room for one more task level. */
export function taskCanHoldChild(node: Pick<TaskNode, 'depth'>): boolean {
  return node.depth < TASK_DEPTH_LIMIT;
}
