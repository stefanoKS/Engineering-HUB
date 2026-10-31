/**
 * Hierarchy rules.
 *
 * Subprojects nest at most four levels beneath a project and tasks at most three. Both limits
 * are defined here once. Cross-record invariants (self parent, cross-project parent,
 * cross-subproject task parent, cycle) are validated before a write and are also enforced by
 * PostgreSQL triggers, so a concurrent writer cannot slip a cycle in between validation and
 * update.
 */
import { DomainError } from './errors';

export const MAX_SUBPROJECT_DEPTH = 4;
export const MAX_TASK_DEPTH = 3;

export type ParentNode = { id: string; parentId: string | null; projectId?: string; subprojectId?: string | null };

export type HierarchyIndex = {
  parents: Map<string, string | null>;
  children: Map<string, string[]>;
  nodes: Map<string, ParentNode>;
};

export function buildIndex(nodes: readonly ParentNode[]): HierarchyIndex {
  const parents = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  const byId = new Map<string, ParentNode>();
  for (const node of nodes) {
    if (!node.id) continue;
    byId.set(node.id, node);
    parents.set(node.id, node.parentId || null);
  }
  for (const node of nodes) {
    const parentId = node.parentId || '';
    if (!parentId) continue;
    const list = children.get(parentId) ?? [];
    list.push(node.id);
    children.set(parentId, list);
  }
  return { parents, children, nodes: byId };
}

/** Level of a node: a root is 1, its child is 2. A cycle raises HIERARCHY_CYCLE. */
export function levelOf(id: string, parents: Map<string, string | null>): number {
  let level = 1;
  let current = parents.get(id) ?? null;
  const seen = new Set<string>([id]);
  let guard = 0;
  while (current) {
    if (seen.has(current)) throw new DomainError('HIERARCHY_CYCLE', 'The hierarchy links form a cycle');
    seen.add(current);
    level += 1;
    current = parents.get(current) ?? null;
    if (++guard > 64) throw new DomainError('HIERARCHY_CYCLE', 'The hierarchy walk exceeded a safe bound');
  }
  return level;
}

export function heightOf(id: string, children: Map<string, string[]>, trail: Set<string> = new Set()): number {
  if (trail.has(id)) throw new DomainError('HIERARCHY_CYCLE', 'The hierarchy links form a cycle');
  trail.add(id);
  let deepest = 0;
  for (const child of children.get(id) ?? []) {
    deepest = Math.max(deepest, heightOf(child, children, trail));
  }
  trail.delete(id);
  return deepest + 1;
}

export function descendantsOf(id: string, children: Map<string, string[]>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    result.push(next);
    stack.push(...(children.get(next) ?? []));
  }
  return result;
}

export function ancestorsOf(id: string, parents: Map<string, string | null>): string[] {
  const result: string[] = [];
  const seen = new Set<string>([id]);
  let current = parents.get(id) ?? null;
  while (current) {
    if (seen.has(current)) throw new DomainError('HIERARCHY_CYCLE', 'The hierarchy links form a cycle');
    seen.add(current);
    result.push(current);
    current = parents.get(current) ?? null;
  }
  return result;
}

export function isContainer(taskId: string, children: Map<string, string[]>): boolean {
  return (children.get(taskId) ?? []).length > 0;
}

export type SubprojectCandidate = {
  id: string | null;
  projectId: string;
  parentId: string | null;
};

/**
 * Validates a subproject placement against the whole tree (not just the immediate parent),
 * so a reparent never flattens or orphans a subtree.
 */
export function validateSubprojectParent(
  candidate: SubprojectCandidate,
  nodes: readonly ParentNode[]
): { level: number; height: number } {
  const rows = nodes.map((node) => ({
    ...node,
    projectId: node.projectId,
    parentId: node.parentId
  }));
  const id = candidate.id || '__new__';
  const simulated = new Map<string, string | null>();
  for (const row of rows) simulated.set(row.id, row.parentId);
  simulated.set(id, candidate.parentId);

  const byId = new Map(rows.map((row) => [row.id, row]));
  if (candidate.parentId) {
    if (candidate.parentId === candidate.id) {
      throw new DomainError('HIERARCHY_INVALID', 'A subproject cannot be its own parent');
    }
    const parent = byId.get(candidate.parentId);
    if (!parent) throw new DomainError('HIERARCHY_INVALID', `Parent subproject not found: ${candidate.parentId}`);
    if (parent.projectId !== candidate.projectId) {
      throw new DomainError('HIERARCHY_INVALID', 'Parent and child subprojects must belong to the same project');
    }
  }
  const index = buildIndex(
    rows
      .filter((row) => row.id !== (candidate.id ?? ''))
      .concat([{ id, parentId: candidate.parentId, projectId: candidate.projectId }])
  );
  const level = levelOf(id, index.parents);
  const height = candidate.id ? heightOf(candidate.id, index.children) : 1;
  if (level > MAX_SUBPROJECT_DEPTH) {
    throw new DomainError('HIERARCHY_DEPTH', `Subprojects are limited to ${MAX_SUBPROJECT_DEPTH} levels`);
  }
  if (level + height - 1 > MAX_SUBPROJECT_DEPTH) {
    throw new DomainError('HIERARCHY_DEPTH', `Subprojects are limited to ${MAX_SUBPROJECT_DEPTH} levels`);
  }
  return { level, height };
}

export type TaskCandidate = {
  id: string | null;
  projectId: string;
  subprojectId: string | null;
  parentTaskId: string | null;
};

export function validateTaskParent(
  candidate: TaskCandidate,
  nodes: readonly ParentNode[]
): { level: number; height: number } {
  const rows = nodes.map((node) => ({
    ...node,
    projectId: node.projectId,
    subprojectId: node.subprojectId ?? null,
    parentId: node.parentId
  }));
  const id = candidate.id || '__new__';
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (candidate.parentTaskId) {
    if (candidate.parentTaskId === candidate.id) {
      throw new DomainError('HIERARCHY_INVALID', 'A task cannot be its own parent');
    }
    const parent = byId.get(candidate.parentTaskId);
    if (!parent) throw new DomainError('HIERARCHY_INVALID', `Parent task not found: ${candidate.parentTaskId}`);
    if (parent.projectId !== candidate.projectId) {
      throw new DomainError('HIERARCHY_INVALID', 'Parent and child tasks must belong to the same project');
    }
    const parentSubproject = parent.subprojectId ?? null;
    if (parentSubproject !== (candidate.subprojectId ?? null)) {
      throw new DomainError('HIERARCHY_INVALID', 'Parent and child tasks must belong to the same subproject');
    }
  }
  const index = buildIndex(
    rows
      .filter((row) => row.id !== (candidate.id ?? ''))
      .concat([
        {
          id,
          parentId: candidate.parentTaskId,
          projectId: candidate.projectId,
          subprojectId: candidate.subprojectId
        }
      ])
  );
  const level = levelOf(id, index.parents);
  const height = candidate.id ? heightOf(candidate.id, index.children) : 1;
  if (level > MAX_TASK_DEPTH) {
    throw new DomainError('HIERARCHY_DEPTH', `Tasks are limited to ${MAX_TASK_DEPTH} levels`);
  }
  if (level + height - 1 > MAX_TASK_DEPTH) {
    throw new DomainError('HIERARCHY_DEPTH', `Tasks are limited to ${MAX_TASK_DEPTH} levels`);
  }
  return { level, height };
}

export type DependencyEdge = { taskId: string; dependsOnId: string };

/** A dependency graph must stay acyclic: sequencing is not organisation. */
export function assertNoDependencyCycle(edges: readonly DependencyEdge[], focusTaskId?: string): void {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.taskId || !edge.dependsOnId) continue;
    if (edge.taskId === edge.dependsOnId) {
      throw new DomainError('DEPENDENCY_CYCLE', 'A task cannot depend on itself');
    }
    const list = graph.get(edge.taskId) ?? [];
    list.push(edge.dependsOnId);
    graph.set(edge.taskId, list);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (node: string): void => {
    const current = state.get(node);
    if (current === 'done') return;
    if (current === 'visiting') {
      throw new DomainError('DEPENDENCY_CYCLE', `Dependency cycle detected${focusTaskId ? ` at ${focusTaskId}` : ''}`);
    }
    state.set(node, 'visiting');
    for (const next of graph.get(node) ?? []) visit(next);
    state.set(node, 'done');
  };
  for (const node of graph.keys()) visit(node);
}
