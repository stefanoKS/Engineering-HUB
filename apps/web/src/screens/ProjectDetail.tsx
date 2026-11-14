/**
 * Project detail.
 *
 * The structure has two presentations built from the same authorized project read: an active table
 * (unfinished leaf work, with containers only as context and empty subprojects kept for creation)
 * and one collapsed completed section below it. Nesting comes only from the stored
 * `subprojects.parent_subproject_id`, `tasks.subproject_id` and `tasks.parent_task_id` - never from
 * names, visual order or a grouping heuristic.
 *
 * ADMIN and MANAGER edit and create in context; a MEMBER with a writable, visible division may edit
 * and recoverably remove tasks and subprojects, and a VIEWER stays read-only. Permanent erasure is
 * never offered here. Every row action still goes through the reviewed preflight, revision check,
 * confirmation and audit path; hiding a control is a usability decision, never authorization.
 */
import { MemberWorkEditor } from '../components/MemberWorkEditor';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProjectForm } from './Projects';
import { SubprojectForm } from './SubprojectForm';
import { TaskForm } from './TaskForm';
import type {
  Actor,
  Project,
  ProjectScheduleDisplay,
  Reference,
  ProgressRollup,
  Subproject,
  TaskSummary
} from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, Breadcrumbs, DescriptionText, EmptyState, ErrorBox, Menu, ProgressBar, Section } from '../components/ui';
import { TaskStatusBadge, WorkflowHint } from '../components/task-status';
import { TaskAssigneePicker } from '../components/TaskAssigneePicker';
import { isCancelledStatus, isCompletedStatus, isOpenStatus, projectColor, rollup } from '@eh/domain';
import { BackButton, takeCompletedTask, useRouteMemoryState } from '../state/navigation';
import { useBusinessDate } from '../state/business-date';
import { DeleteEntityDialog } from '../components/DeleteEntityDialog';
import { MemberSubprojectForm } from '../components/member-subproject-form';
import { MemberTaskForm } from '../components/member-task-form';
import { subprojectPath } from '../components/hierarchy';
import { DeadlineCell, deadlineStateOf } from '../components/deadline';
import { ConfirmDialog } from '../components/forms';
import { ScheduleBadge } from '../components/project-schedule';
import { capabilitiesOf } from '../state/capabilities';

/* ------------------------------------------------------------------ data shapes */

type ManagerDetail = {
  record: Project;
  progress: ProgressRollup;
  subprojects: (Subproject & { progress: ProgressRollup })[];
  tasks: TaskSummary[];
};

type ReadOnlyDetail = {
  record: {
    projectId: string;
    projectName: string;
    description: string;
    responsibilityName: string;
    projectOwnerName: string;
    status: Project['status'];
    schedule: ProjectScheduleDisplay;
    priority: Project['priority'];
    committedDeadline: string | null;
    progressPercent: number | null;
    health: string;
  };
  progress: ProgressRollup;
  subprojects: {
    subprojectId: string;
    subprojectName: string;
    description?: string;
    parentSubprojectId?: string | null;
    status: Subproject['status'];
    schedule: ProjectScheduleDisplay;
    deadline: string | null;
    depth: number;
    progress: ProgressRollup;
  }[];
  tasks: TaskSummary[];
};

type ViewModel = ReadOnlyDetail;

function toViewModel(detail: ManagerDetail | ReadOnlyDetail): ViewModel {
  if ('milestones' in detail) {
    return {
      record: detail.record,
      progress: detail.progress,
      subprojects: detail.subprojects,
      tasks: detail.tasks
    };
  }
  return detail;
}

/* ------------------------------------------------------------------ hierarchy model */

export type HierarchySubproject = {
  subprojectId: string;
  subprojectName: string;
  description?: string;
  parentSubprojectId: string | null;
  status: string;
  schedule: ProjectScheduleDisplay;
  deadline: string | null;
  depth: number;
  revision?: number | null;
};

/**
 * Leaf counts only. A container is organisation, never an extra unit of work, and `Cancelled`
 * work is reported separately from active and completed work - so it is never part of `total`.
 */
export type TaskCounts = { active: number; done: number; total: number };

export type TaskNode = { task: TaskSummary; children: TaskNode[]; counts: TaskCounts };

export type SubprojectNode = HierarchySubproject & {
  revision: number | null;
  /** The full visible task tree (including cancelled work when it is shown). */
  tasks: TaskNode[];
  /** The active presentation tree: unfinished leaves plus the containers that lead to them. */
  activeTasks: TaskNode[];
  /** The completed presentation tree: done leaves plus the containers that lead to them. */
  completedTasks: TaskNode[];
  children: SubprojectNode[];
  /** Canonical leaf counts for the whole visible bucket. */
  counts: TaskCounts;
  /** Leaf counts of the displayed (possibly filtered) active tree. */
  activeCounts: TaskCounts;
  /** Done leaves in the displayed (possibly filtered) completed tree. */
  completedCount: number;
};

export type CompletedGroup = {
  /** Stable key: `sub:<subproject_id>` or `direct`. */
  key: string;
  subprojectId: string | null;
  /** Stored subproject name, or an empty string for the project-direct group. */
  name: string;
  tasks: TaskNode[];
  count: number;
};

export type StructureFilter = { query?: string; assigneeId?: string };

export type ProjectHierarchy = {
  subprojects: SubprojectNode[];
  directTasks: TaskNode[];
  counts: TaskCounts;
  hiddenTasks: number;
  cancelledLeaves: number;
  filterActive: boolean;
  active: {
    subprojects: SubprojectNode[];
    directTasks: TaskNode[];
    directCounts: TaskCounts;
    showDirect: boolean;
    counts: TaskCounts;
  };
  completed: {
    /** Completed leaf work in the visible scope. */
    count: number;
    /** Completed leaf work that matches the current filter (equal to `count` without a filter). */
    matches: number;
    directTasks: TaskNode[];
    directCount: number;
    groups: CompletedGroup[];
  };
  matchedTasks: number;
};

const EMPTY_COUNTS: TaskCounts = { active: 0, done: 0, total: 0 };

function addCounts(left: TaskCounts, right: TaskCounts): TaskCounts {
  return {
    active: left.active + right.active,
    done: left.done + right.done,
    total: left.total + right.total
  };
}

/**
 * A container is organisation. The server marks it in `TaskSummary.container`; the structural
 * check keeps a container a container when its only children are hidden by the inactive-work
 * control (a stored `Done` on such a task never makes it completed work).
 */
function isOrganisational(node: TaskNode): boolean {
  return node.children.length > 0 || node.task.container === true;
}

function ownCount(task: TaskSummary): TaskCounts {
  if (isCompletedStatus(task.status)) return { active: 0, done: 1, total: 1 };
  if (isOpenStatus(task.status)) return { active: 1, done: 0, total: 1 };
  return EMPTY_COUNTS;
}

/** Leaf counts of a rendered tree. Containers and cancelled leaves contribute nothing. */
function countsOfNodes(nodes: readonly TaskNode[]): TaskCounts {
  let active = 0;
  let done = 0;
  const walk = (list: readonly TaskNode[]): void => {
    for (const node of list) {
      if (node.children.length > 0) {
        walk(node.children);
        continue;
      }
      if (node.task.container === true) continue;
      const own = ownCount(node.task);
      active += own.active;
      done += own.done;
    }
  };
  walk(nodes);
  return { active, done, total: active + done };
}

/** Displayed work rows in a tree, including cancelled work, for a filter summary. */
function countWorkRows(nodes: readonly TaskNode[]): number {
  let total = 0;
  const walk = (list: readonly TaskNode[]): void => {
    for (const node of list) {
      if (node.children.length > 0) walk(node.children);
      else if (node.task.container !== true) total += 1;
    }
  };
  walk(nodes);
  return total;
}

/**
 * Canonical leaf counts for one bucket.
 *
 * `rollup` is the same domain function the server uses for progress: it excludes containers and
 * counts each leaf exactly once, so a screen counter can never become a second definition of
 * "open" or "completed".
 */
function bucketCounts(tasks: readonly TaskSummary[]): { counts: TaskCounts; cancelled: number } {
  const value = rollup(
    tasks.map((task) => ({
      taskId: task.taskId,
      status: task.status,
      progressPercent: task.progressPercent ?? null,
      estimatedHours: null,
      parentTaskId: task.parentTaskId
    }))
  );
  const done = value.doneLeaves;
  const cancelled = value.cancelledLeaves;
  const active = Math.max(0, value.leaves - done - cancelled);
  return { counts: { active, done, total: active + done }, cancelled };
}

function activeTree(nodes: readonly TaskNode[], includeInactive: boolean): TaskNode[] {
  const result: TaskNode[] = [];
  for (const node of nodes) {
    const children = activeTree(node.children, includeInactive);
    if (isOrganisational(node)) {
      if (children.length > 0) {
        result.push({ task: node.task, children, counts: countsOfNodes(children) });
      }
      continue;
    }
    // A completed leaf belongs to the completed presentation; a cancelled leaf is not completed
    // work and honours the existing inactive-work control.
    if (isCompletedStatus(node.task.status)) continue;
    if (isCancelledStatus(node.task.status) && !includeInactive) continue;
    result.push({ task: node.task, children: [], counts: ownCount(node.task) });
  }
  return result;
}

function completedTree(nodes: readonly TaskNode[]): TaskNode[] {
  const result: TaskNode[] = [];
  for (const node of nodes) {
    const children = completedTree(node.children);
    if (isOrganisational(node)) {
      if (children.length > 0) {
        result.push({ task: node.task, children, counts: countsOfNodes(children) });
      }
      continue;
    }
    // Only the authoritative `Done` status is completed. A container's stored status is never
    // read here, and progress = 100 % is never inferred as completion.
    if (isCompletedStatus(node.task.status)) {
      result.push({ task: node.task, children: [], counts: ownCount(node.task) });
    }
  }
  return result;
}

/** Keeps the matches and the containers that lead to them; a container itself never matches. */
function filterTree(nodes: readonly TaskNode[], match: (task: TaskSummary) => boolean): TaskNode[] {
  const result: TaskNode[] = [];
  for (const node of nodes) {
    const children = filterTree(node.children, match);
    if (isOrganisational(node)) {
      if (children.length > 0) {
        result.push({ task: node.task, children, counts: countsOfNodes(children) });
      }
      continue;
    }
    if (match(node.task)) {
      result.push({ task: node.task, children: [], counts: ownCount(node.task) });
    }
  }
  return result;
}

/** The first displayed work leaf, used to reveal a group rather than its heading. */
export function firstLeafTaskId(nodes: readonly TaskNode[]): string | null {
  for (const node of nodes) {
    if (node.children.length === 0 && node.task.container !== true) return node.task.taskId;
    const child = firstLeafTaskId(node.children);
    if (child) return child;
  }
  return null;
}

/**
 * Resolves a task in the authorized project model, with the presentation it belongs to and the
 * expansion keys its row needs. Stable IDs only: no index, no rendered order and no name match.
 * A task whose row is filtered out is not found here, which is what makes the caller clear the
 * filters deliberately instead of silently showing nothing.
 */
export type TaskLocation = {
  presentation: 'active' | 'completed';
  /** Group and ancestor task keys that must be open for the row to be rendered. */
  expandKeys: string[];
};

function findTask(
  nodes: readonly TaskNode[],
  taskId: string,
  ancestors: readonly string[]
): string[] | null {
  for (const node of nodes) {
    if (node.task.taskId === taskId) return [...ancestors];
    const found = findTask(node.children, taskId, [...ancestors, `task:${node.task.taskId}`]);
    if (found) return found;
  }
  return null;
}

export function locateTask(hierarchy: ProjectHierarchy, taskId: string): TaskLocation | null {
  const active = (): TaskLocation | null => {
    for (const subproject of hierarchy.active.subprojects) {
      const keys = findTask(subproject.activeTasks, taskId, []);
      if (keys) return { presentation: 'active', expandKeys: [`sub:${subproject.subprojectId}`, ...keys] };
    }
    const direct = findTask(hierarchy.active.directTasks, taskId, []);
    if (direct) return { presentation: 'active', expandKeys: ['direct', ...direct] };
    return null;
  };
  const completed = (): TaskLocation | null => {
    for (const group of hierarchy.completed.groups) {
      if (findTask(group.tasks, taskId, [])) return { presentation: 'completed', expandKeys: [] };
    }
    return null;
  };
  const completedIn = (nodes: readonly TaskNode[]): boolean =>
    nodes.some(
      (node) =>
        (node.task.taskId === taskId && isCompletedStatus(node.task.status)) ||
        completedIn(node.children)
    );
  // A completed leaf belongs to the completed presentation; everything else is looked up in the
  // active one first, so a container that appears as context in both is revealed where it works.
  const done = completedIn(hierarchy.directTasks) || hierarchy.subprojects.some((subproject) => completedIn(subproject.tasks));
  return done ? completed() ?? active() : active() ?? completed();
}

/**
 * Builds the render model.
 *
 * A task is placed only by its stored `subproject_id`; a task whose subproject is hidden (archived
 * ancestor) is hidden with it instead of being moved to the project-direct section. The model keeps
 * the full visible tree, the active tree (unfinished work) and the completed tree (done work)
 * separately: a leaf appears in exactly one of them, while a container may appear in both as
 * context. Nothing is moved, archived, deleted or reparented.
 */
export function buildProjectHierarchy(input: {
  subprojects: readonly HierarchySubproject[];
  tasks: readonly TaskSummary[];
  includeInactive: boolean;
  filter?: StructureFilter;
}): ProjectHierarchy {
  const byId = new Map(input.subprojects.map((subproject) => [subproject.subprojectId, subproject]));
  const ancestorArchived = (subprojectId: string): boolean => {
    let current: HierarchySubproject | undefined = byId.get(subprojectId);
    let guard = 0;
    while (current) {
      if (current.status === 'Archived') return true;
      current = current.parentSubprojectId ? byId.get(current.parentSubprojectId) : undefined;
      if (++guard > 20) return true;
    }
    return false;
  };
  const visibleSubprojects = input.includeInactive
    ? [...input.subprojects]
    : input.subprojects.filter((subproject) => !ancestorArchived(subproject.subprojectId));
  const visibleSubprojectIds = new Set(visibleSubprojects.map((subproject) => subproject.subprojectId));

  let hiddenTasks = 0;
  const buckets = new Map<string, TaskSummary[]>();
  for (const task of input.tasks) {
    if (task.subprojectId && !visibleSubprojectIds.has(task.subprojectId)) {
      // Never silently reassign a subproject's task to the project-direct bucket.
      hiddenTasks += 1;
      continue;
    }
    if (!input.includeInactive && isCancelledStatus(task.status)) hiddenTasks += 1;
    // Cancelled work stays in the bucket even while it is hidden, so canonical container
    // detection and the rollup still see the whole shape of the branch.
    const key = task.subprojectId ?? '__direct__';
    const list = buckets.get(key) ?? [];
    list.push(task);
    buckets.set(key, list);
  }

  const buildTaskTree = (list: readonly TaskSummary[]): TaskNode[] => {
    const ids = new Set(list.map((task) => task.taskId));
    const byParent = new Map<string, TaskSummary[]>();
    const roots: TaskSummary[] = [];
    for (const task of list) {
      const parentId = task.parentTaskId && ids.has(task.parentTaskId) ? task.parentTaskId : null;
      if (!parentId) {
        roots.push(task);
        continue;
      }
      const siblings = byParent.get(parentId) ?? [];
      siblings.push(task);
      byParent.set(parentId, siblings);
    }
    const build = (task: TaskSummary, guard: number): TaskNode => {
      const children = guard > 8 ? [] : (byParent.get(task.taskId) ?? []).map((child) => build(child, guard + 1));
      const node: TaskNode = { task, children, counts: EMPTY_COUNTS };
      node.counts = isOrganisational(node) ? countsOfNodes(children) : ownCount(task);
      return node;
    };
    return roots.map((task) => build(task, 0));
  };

  const query = (input.filter?.query ?? '').trim().toLocaleLowerCase();
  const assigneeId = input.filter?.assigneeId ?? '';
  const filterActive = !!(query || assigneeId);
  const matches = (task: TaskSummary): boolean => {
    if (task.container) return false;
    if (query && !task.taskName.toLocaleLowerCase().includes(query)) return false;
    if (assigneeId) {
      const ids =
        Array.isArray(task.assigneeIds) && task.assigneeIds.length > 0
          ? task.assigneeIds
          : task.ownerMemberId
            ? [task.ownerMemberId]
            : [];
      if (!ids.includes(assigneeId)) return false;
    }
    return true;
  };

  const buildBucket = (key: string) => {
    const all = buckets.get(key) ?? [];
    const display = input.includeInactive ? all : all.filter((task) => !isCancelledStatus(task.status));
    const tree = buildTaskTree(display);
    const { counts, cancelled } = bucketCounts(all);
    const activeBase = activeTree(tree, input.includeInactive);
    const completedBase = completedTree(tree);
    return {
      tree,
      counts,
      cancelled,
      activeTasks: filterActive ? filterTree(activeBase, matches) : activeBase,
      completedTasks: filterActive ? filterTree(completedBase, matches) : completedBase
    };
  };

  const byName = (a: HierarchySubproject, b: HierarchySubproject): number =>
    a.subprojectName.localeCompare(b.subprojectName, 'ja') || a.subprojectId.localeCompare(b.subprojectId);

  let cancelledLeaves = 0;
  const subprojects: SubprojectNode[] = visibleSubprojects
    .slice()
    .sort(byName)
    .map((subproject) => {
      const bucket = buildBucket(subproject.subprojectId);
      cancelledLeaves += bucket.cancelled;
      return {
        ...subproject,
        revision: subproject.revision ?? null,
        tasks: bucket.tree,
        activeTasks: bucket.activeTasks,
        completedTasks: bucket.completedTasks,
        children: [],
        counts: bucket.counts,
        activeCounts: countsOfNodes(bucket.activeTasks),
        completedCount: countsOfNodes(bucket.completedTasks).done
      };
    });
  // Legacy parent links remain stored for archival eligibility, but normal navigation is flat.
  const direct = buildBucket('__direct__');
  cancelledLeaves += direct.cancelled;

  const counts = addCounts(
    subprojects.reduce((total, node) => addCounts(total, node.counts), EMPTY_COUNTS),
    direct.counts
  );

  const activeSubprojects = subprojects.filter((node) =>
    filterActive
      ? node.activeTasks.length > 0
      : node.activeTasks.length > 0 || node.completedTasks.length === 0
  );
  const directActive = direct.activeTasks;
  const directActiveCounts = countsOfNodes(directActive);
  const showDirect = filterActive
    ? directActive.length > 0
    : directActive.length > 0 || subprojects.length > 0 || direct.tree.length > 0;

  const completedGroups: CompletedGroup[] = [];
  for (const node of subprojects) {
    const completedCount = countsOfNodes(node.completedTasks).done;
    if (completedCount > 0) {
      completedGroups.push({
        key: `sub:${node.subprojectId}`,
        subprojectId: node.subprojectId,
        name: node.subprojectName,
        tasks: node.completedTasks,
        count: completedCount
      });
    }
  }
  const directCompletedCount = countsOfNodes(direct.completedTasks).done;
  if (directCompletedCount > 0) {
    completedGroups.push({
      key: 'direct',
      subprojectId: null,
      name: '',
      tasks: direct.completedTasks,
      count: directCompletedCount
    });
  }

  const activeCounts = addCounts(
    activeSubprojects.reduce((total, node) => addCounts(total, node.activeCounts), EMPTY_COUNTS),
    directActiveCounts
  );
  const completedMatches = completedGroups.reduce((total, group) => total + group.count, 0);
  const matchedTasks =
    countWorkRows(activeSubprojects.flatMap((node) => node.activeTasks)) +
    countWorkRows(directActive) +
    completedMatches;

  return {
    subprojects,
    directTasks: direct.tree,
    counts,
    hiddenTasks,
    cancelledLeaves,
    filterActive,
    active: {
      subprojects: activeSubprojects,
      directTasks: directActive,
      directCounts: directActiveCounts,
      showDirect,
      counts: activeCounts
    },
    completed: {
      count: counts.done,
      matches: completedMatches,
      directTasks: direct.completedTasks,
      directCount: directCompletedCount,
      groups: completedGroups
    },
    matchedTasks
  };
}

/* ------------------------------------------------------------------ icons */

function FolderIcon(): JSX.Element {
  return (
    <svg className="tree-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}

function TasksIcon(): JSX.Element {
  return (
    <svg className="tree-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 5h16v3H4zm0 6h16v3H4zm0 6h10v3H4z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

/* ------------------------------------------------------------------ hierarchy section */

type HierarchyProps = {
  hierarchy: ProjectHierarchy;
  canManage: boolean;
  canEditSubproject?: boolean;
  canRemoveRecord: boolean;
  /** Creation is a separate capability: a MEMBER creates new work but never edits a record. */
  canCreateTask: boolean;
  canCreateSubproject: boolean;
  includeInactive: boolean;
  onToggleInactive: (value: boolean) => void;
  onNewTask: (subprojectId: string | null) => void;
  onNewSubproject: () => void;
  onEditSubproject: (subproject: SubprojectNode) => void;
  onDelete: (entityType: 'TASKS' | 'SUBPROJECTS', entityId: string, entityName: string) => void;
  /**
   * Expansion state is owned by the screen so a data refresh (which unmounts the tree while the
   * new detail loads) cannot reset it. Standalone renders fall back to local state.
   */
  collapsed?: Set<string>;
  onToggle?: (key: string) => void;
  /** Expands the listed keys. Used only by an explicit reveal request. */
  onExpand?: (keys: string[]) => void;
  /** Task-name search. Controlled by the screen so it survives a language change. */
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  /** Stable member id. Controlled for the same reason. */
  assigneeId?: string;
  onAssigneeChange?: (value: string) => void;
  completedOpen?: boolean;
  onCompletedOpenChange?: (open: boolean) => void;
  /** A task confirmed as completed elsewhere; shown once with a reveal action. */
  completionNotice?: { taskId: string; taskName: string } | null;
  onCompletionNoticeDismiss?: () => void;
  /** `?task=<id>`: reveal a completed task's context, or scroll to an active one. */
  focusTaskId?: string;
};

type FlatRow =
  | {
      kind: 'group';
      key: string;
      name: string;
      level: number;
      open: boolean;
      node: SubprojectNode | null;
      direct: boolean;
      active: number;
      done: number;
    }
  | { kind: 'description'; key: string; level: number; text: string; groupKey: string }
  | { kind: 'completedGroup'; key: string; name: string; count: number; firstTaskId: string | null; direct: boolean }
  | { kind: 'task'; key: string; node: TaskNode; level: number; open: boolean }
  | { kind: 'empty'; key: string; level: number; text: string };

export function ProjectHierarchy(props: HierarchyProps): JSX.Element {
  const { t } = useI18n();
  const { hierarchy, canManage, canRemoveRecord, canCreateTask, canCreateSubproject } = props;
  const canEditSubproject = props.canEditSubproject ?? canManage;
  const [localCollapsed, setLocalCollapsed] = useState<Set<string>>(() => new Set());
  const collapsed = props.collapsed ?? localCollapsed;

  // Expansion is keyed by stable IDs, so a save or a delete keeps every other branch as left.
  // While a filter is active, matching branches start expanded but a toggle changes a temporary
  // filter-scoped set; no keystroke writes the persistent expansion state.
  const [filterCollapsed, setFilterCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = useCallback(
    (key: string) => {
      if (hierarchy.filterActive) {
        setFilterCollapsed((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        return;
      }
      if (props.onToggle) {
        props.onToggle(key);
        return;
      }
      setLocalCollapsed((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [hierarchy.filterActive, props.onToggle]
  );
  const isOpen = useCallback(
    (key: string): boolean =>
      hierarchy.filterActive ? !filterCollapsed.has(key) : !collapsed.has(key),
    [hierarchy.filterActive, filterCollapsed, collapsed]
  );
  useEffect(() => {
    if (hierarchy.filterActive) return;
    setFilterCollapsed((current) => (current.size > 0 ? new Set() : current));
  }, [hierarchy.filterActive]);

  const [localQuery, setLocalQuery] = useState('');
  const [localAssignee, setLocalAssignee] = useState('');
  const [localCompletedOpen, setLocalCompletedOpen] = useState(false);
  const query = props.searchQuery ?? localQuery;
  const assigneeId = props.assigneeId ?? localAssignee;
  const completedOpen = props.completedOpen ?? localCompletedOpen;
  const filtersEnabled = typeof props.onSearchQueryChange === 'function';
  const setQuery = useCallback(
    (value: string) => {
      if (props.onSearchQueryChange) props.onSearchQueryChange(value);
      else setLocalQuery(value);
    },
    [props.onSearchQueryChange]
  );
  const setAssignee = useCallback(
    (value: string) => {
      if (props.onAssigneeChange) props.onAssigneeChange(value);
      else setLocalAssignee(value);
    },
    [props.onAssigneeChange]
  );
  const setCompletedOpen = useCallback(
    (value: boolean) => {
      if (props.onCompletedOpenChange) props.onCompletedOpenChange(value);
      else setLocalCompletedOpen(value);
    },
    [props.onCompletedOpenChange]
  );

  const clearFilters = useCallback(() => {
    setQuery('');
    setAssignee('');
  }, [setQuery, setAssignee]);

  /**
   * One reveal operation, shared by the completion notice, a completed-count button and
   * `?task=<id>`. It resolves the row through stable IDs, opens the presentation it belongs to,
   * expands the ancestors it needs, clears a filter that would hide it (with a notice), and only
   * then scrolls and focuses the rendered row. A background refresh never requests a reveal, so it
   * can never steal focus.
   */
  const [revealRequest, setRevealRequest] = useState<{ taskId: string; clearedFilters: boolean } | null>(null);
  const [revealMessage, setRevealMessage] = useState<'' | 'filters' | 'missing'>('');
  // The expansion side of a request runs once per request; the focus retry may restart on a
  // re-render, but it never re-applies state and therefore can never loop.
  const revealApplied = useRef('');
  const requestReveal = useCallback((taskId: string) => {
    revealApplied.current = '';
    setRevealMessage('');
    setRevealRequest({ taskId, clearedFilters: false });
  }, []);
  const expandKeys = props.onExpand;
  const expandForReveal = useCallback(
    (keys: string[]) => {
      if (keys.length === 0) return;
      if (hierarchy.filterActive) {
        // Filter mode starts expanded; a reveal clears the temporary collapses it needs.
        setFilterCollapsed((current) => {
          const next = new Set(current);
          let changed = false;
          for (const key of keys) if (next.delete(key)) changed = true;
          return changed ? next : current;
        });
        return;
      }
      if (expandKeys) {
        expandKeys(keys);
        return;
      }
      setLocalCollapsed((current) => {
        const next = new Set(current);
        let changed = false;
        for (const key of keys) if (next.delete(key)) changed = true;
        return changed ? next : current;
      });
    },
    [hierarchy.filterActive, expandKeys]
  );
  useEffect(() => {
    if (!revealRequest) return undefined;
    const location = locateTask(hierarchy, revealRequest.taskId);
    if (!location) {
      if (hierarchy.filterActive && !revealRequest.clearedFilters) {
        clearFilters();
        setRevealMessage('filters');
        setRevealRequest({ taskId: revealRequest.taskId, clearedFilters: true });
        return undefined;
      }
      if (!hierarchy.filterActive) {
        setRevealMessage('missing');
        setRevealRequest(null);
      }
      return undefined;
    }
    const appliedKey = `${revealRequest.taskId}|${revealRequest.clearedFilters}`;
    if (revealApplied.current !== appliedKey) {
      revealApplied.current = appliedKey;
      if (location.presentation === 'completed') setCompletedOpen(true);
      expandForReveal(location.expandKeys);
    }
    let frame = 0;
    let tries = 0;
    const tick = (): void => {
      const target = document.getElementById(
        `hierarchy-${location.presentation}-${revealRequest.taskId}`
      );
      if (target) {
        target.scrollIntoView?.({ block: 'center' });
        target.focus?.({ preventScroll: true });
        setRevealRequest(null);
        return;
      }
      if (++tries > 30) {
        setRevealRequest(null);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [revealRequest, hierarchy, clearFilters, expandForReveal, setCompletedOpen]);

  // A completed-count button reveals the group heading itself rather than guessing a row.
  const [groupReveal, setGroupReveal] = useState<string | null>(null);
  const revealGroup = useCallback(
    (key: string) => {
      setCompletedOpen(true);
      setGroupReveal(key);
    },
    [setCompletedOpen]
  );
  useEffect(() => {
    if (!groupReveal) return undefined;
    let frame = 0;
    let tries = 0;
    const tick = (): void => {
      const target = document.getElementById(`hierarchy-completed-group-${groupReveal}`);
      if (target) {
        target.scrollIntoView?.({ block: 'center' });
        target.focus?.({ preventScroll: true });
        setGroupReveal(null);
        return;
      }
      if (++tries > 30) {
        setGroupReveal(null);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [groupReveal]);

  // A route that names a task reveals its context once per addressed task id. A later refresh of
  // the same project has the same id and therefore never re-steals focus.
  const deepLinkRevealed = useRef('');
  useEffect(() => {
    const taskId = props.focusTaskId;
    if (!taskId || deepLinkRevealed.current === taskId) return;
    deepLinkRevealed.current = taskId;
    requestReveal(taskId);
  }, [props.focusTaskId, requestReveal]);

  const activeFilters = !!(query || assigneeId);
  const isEmpty = hierarchy.subprojects.length === 0 && hierarchy.directTasks.length === 0;
  // "No matches" is a filtered non-empty project; a genuinely empty project says so instead.
  const noMatches = hierarchy.filterActive && hierarchy.matchedTasks === 0 && !isEmpty;
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(() => new Set());
  const panelId = useRef(`hierarchy-completed-${Math.random().toString(36).slice(2)}`);

  const pushTasks = (out: FlatRow[], nodes: readonly TaskNode[], level: number): void => {
    for (const node of nodes) {
      const key = `task:${node.task.taskId}`;
      const open = isOpen(key);
      out.push({ kind: 'task', key, node, level, open });
      if (node.children.length > 0 && open) pushTasks(out, node.children, level + 1);
    }
  };

  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const node of hierarchy.active.subprojects) {
      const key = `sub:${node.subprojectId}`;
      const open = isOpen(key);
      out.push({
        kind: 'group',
        key,
        name: node.subprojectName,
        level: 1,
        open,
        node,
        direct: false,
        active: node.activeCounts.active,
        done: node.completedCount
      });
      const description = (node.description ?? '').trim();
      if (description) out.push({ kind: 'description', key: `desc:${key}`, level: 1, text: description, groupKey: key });
      if (!open) continue;
      if (node.activeTasks.length === 0) {
        out.push({ kind: 'empty', key: `empty:${node.subprojectId}`, level: 2, text: t('hierarchy.emptySubproject') });
      } else {
        pushTasks(out, node.activeTasks, 2);
      }
    }
    if (hierarchy.active.showDirect) {
      const key = 'direct';
      const open = isOpen(key);
      out.push({
        kind: 'group',
        key,
        name: t('hierarchy.directTasks'),
        level: 1,
        open,
        node: null,
        direct: true,
        active: hierarchy.active.directCounts.active,
        done: hierarchy.completed.directCount
      });
      if (open) {
        if (hierarchy.active.directTasks.length === 0) {
          out.push({ kind: 'empty', key: 'empty:direct', level: 2, text: t('hierarchy.emptyDirect') });
        } else {
          pushTasks(out, hierarchy.active.directTasks, 2);
        }
      }
    }
    return out;
  }, [hierarchy, collapsed, isOpen, t]);

  const completedRows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const group of hierarchy.completed.groups) {
      out.push({
        kind: 'completedGroup',
        key: group.key,
        name: group.name || t('hierarchy.directTasks'),
        count: group.count,
        firstTaskId: firstLeafTaskId(group.tasks),
        direct: group.subprojectId === null
      });
      pushTasks(out, group.tasks, 2);
    }
    return out;
  }, [hierarchy, collapsed, isOpen, t]);

  const revealNotice = (): void => {
    const notice = props.completionNotice;
    if (!notice) return;
    requestReveal(notice.taskId);
    props.onCompletionNoticeDismiss?.();
  };

  return (
    <Section
      title={t('hierarchy.title')}
      actions={
        // Scoped so the checkbox label, the count phrase and the buttons share one centre line
        // without changing how the other section headers lay out their own actions.
        <div className="hierarchy-toolbar">
          {canManage ? (
            <label className="checkbox inline-checkbox">
              <input
                type="checkbox"
                checked={props.includeInactive}
                onChange={(event) => props.onToggleInactive(event.target.checked)}
              />
              {t('hierarchy.showInactive')}
            </label>
          ) : null}
          <span className="hierarchy-counts muted small">
            {t('hierarchy.counts', { active: hierarchy.counts.active, done: hierarchy.counts.done })}
          </span>
          {canCreateTask || canCreateSubproject ? (
            <div className="hierarchy-toolbar-buttons">
              {canCreateSubproject ? (
                <button type="button" className="button secondary" onClick={props.onNewSubproject}>
                  {t('subprojects.new')}
                </button>
              ) : null}
              {canCreateTask ? (
                <button type="button" className="button" onClick={() => props.onNewTask(null)}>
                  {t('tasks.new')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      }
    >
      {props.completionNotice ? (
        <div className="banner ok hierarchy-completion-notice" role="status" aria-live="polite">
          <span>{t('hierarchy.completedNotice', { name: props.completionNotice.taskName })}</span>
          <button type="button" className="link-button" onClick={revealNotice}>
            {t('hierarchy.completedNoticeAction')}
          </button>
        </div>
      ) : null}
      {revealMessage === 'filters' ? (
        <div className="banner info hierarchy-reveal-notice" role="status">
          {t('hierarchy.filtersCleared')}
        </div>
      ) : null}
      {revealMessage === 'missing' ? (
        <div className="banner warning hierarchy-reveal-notice" role="status">
          {t('hierarchy.taskUnavailable')}
        </div>
      ) : null}

      {filtersEnabled ? (
        <div className="hierarchy-filters" role="search" aria-label={t('hierarchy.filterLabel')}>
          <label className="field grow search-field">
            <span className="field-label">{t('myWork.filter.task')}</span>
            <input
              type="search"
              aria-label={t('myWork.filter.task')}
              placeholder={t('myWork.filter.task')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="field hierarchy-assignee-filter">
            <span className="field-label">{t('tasks.assigneeFilter')}</span>
            <TaskAssigneePicker value={assigneeId} onChange={setAssignee} />
          </span>
          {activeFilters ? (
            <button type="button" className="link-button" onClick={clearFilters}>
              {t('hierarchy.clearFilters')}
            </button>
          ) : null}
        </div>
      ) : null}

      {hierarchy.filterActive ? (
        <p className="hierarchy-filter-summary muted small" role="status" aria-live="polite">
          {t('hierarchy.filterSummary', {
            matched: hierarchy.matchedTasks,
            active: hierarchy.active.counts.active,
            done: hierarchy.completed.matches,
            total: hierarchy.counts.total
          })}
        </p>
      ) : null}
      {hierarchy.hiddenTasks > 0 ? (
        <p className="muted small">{t('hierarchy.hiddenTasks', { n: hierarchy.hiddenTasks })}</p>
      ) : null}

      {isEmpty ? <EmptyState text={t('hierarchy.empty')} /> : null}
      {noMatches ? (
        <div className="empty hierarchy-no-match" role="status">
          <p>{t('hierarchy.noMatches')}</p>
          <button type="button" className="link-button" onClick={clearFilters}>
            {t('hierarchy.clearFilters')}
          </button>
        </div>
      ) : null}
      {!isEmpty && !noMatches && rows.length === 0 ? (
        <p className="muted small">
          {hierarchy.filterActive ? t('hierarchy.noActiveMatches') : t('hierarchy.noActiveTasks')}
        </p>
      ) : null}
      {!isEmpty && !noMatches && rows.length > 0 ? (
        <HierarchyTable
          rows={rows}
          presentation="active"
          completed={false}
          expandedDescriptions={expandedDescriptions}
          onToggleDescription={(key) =>
            setExpandedDescriptions((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          onRevealGroup={revealGroup}
          onRevealTask={requestReveal}
          toggle={toggle}
          canEditSubproject={canEditSubproject}
          canCreateTask={canCreateTask}
          canRemoveRecord={canRemoveRecord}
          onNewTask={props.onNewTask}
          onEditSubproject={props.onEditSubproject}
          onDelete={props.onDelete}
        />
      ) : null}

      {hierarchy.completed.count > 0 ? (
        <section className="hierarchy-completed" aria-label={t('hierarchy.completedSection')}>
          <button
            type="button"
            className="hierarchy-completed-toggle"
            aria-expanded={completedOpen}
            aria-controls={panelId.current}
            onClick={() => setCompletedOpen(!completedOpen)}
          >
            <span aria-hidden="true">{completedOpen ? '▼' : '▶'}</span>
            <span>
              {hierarchy.filterActive
                ? t('hierarchy.completedMatches', {
                    n: hierarchy.completed.matches,
                    total: hierarchy.completed.count
                  })
                : t('hierarchy.completedHeading', { n: hierarchy.completed.count })}
            </span>
          </button>
          {hierarchy.filterActive && !completedOpen ? (
            <span className="hierarchy-completed-hint">
              {t('hierarchy.completedMatchHint', { n: hierarchy.completed.matches })}
              <button type="button" className="link-button" onClick={() => setCompletedOpen(true)}>
                {t('hierarchy.showCompleted')}
              </button>
            </span>
          ) : null}
          <div id={panelId.current} hidden={!completedOpen}>
            {completedOpen ? (
              hierarchy.completed.groups.length === 0 ? (
                <p className="muted small">{t('hierarchy.noCompletedMatches')}</p>
              ) : (
                <HierarchyTable
                  rows={completedRows}
                  presentation="completed"
                  completed
                  expandedDescriptions={expandedDescriptions}
                  onToggleDescription={() => undefined}
                  onRevealGroup={revealGroup}
                  onRevealTask={requestReveal}
                  toggle={toggle}
                  canEditSubproject={false}
                  canCreateTask={false}
                  canRemoveRecord={false}
                  onNewTask={() => undefined}
                  onEditSubproject={() => undefined}
                  onDelete={() => undefined}
                />
              )
            ) : null}
          </div>
        </section>
      ) : null}
    </Section>
  );
}

function HierarchyTable({
  rows,
  presentation,
  completed,
  expandedDescriptions,
  onToggleDescription,
  onRevealGroup,
  onRevealTask,
  toggle,
  canEditSubproject,
  canCreateTask,
  canRemoveRecord,
  onNewTask,
  onEditSubproject,
  onDelete
}: {
  rows: readonly FlatRow[];
  presentation: 'active' | 'completed';
  completed: boolean;
  expandedDescriptions: Set<string>;
  onToggleDescription: (key: string) => void;
  onRevealGroup: (key: string) => void;
  onRevealTask: (taskId: string) => void;
  toggle: (key: string) => void;
  canEditSubproject: boolean;
  canCreateTask: boolean;
  canRemoveRecord: boolean;
  onNewTask: (subprojectId: string | null) => void;
  onEditSubproject: (subproject: SubprojectNode) => void;
  onDelete: (entityType: 'TASKS' | 'SUBPROJECTS', entityId: string, entityName: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <table className={`hierarchy-table${completed ? ' hierarchy-table-completed' : ''}`} aria-label={t('hierarchy.columnsLabel')}>
      <colgroup>
        <col className="hierarchy-col-name" />
        <col className="hierarchy-col-assignee" />
        <col className="hierarchy-col-due" />
        <col className="hierarchy-col-status" />
        <col className="hierarchy-col-actions" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{t('hierarchy.columnTask')}</th>
          <th scope="col">{t('hierarchy.columnAssignee')}</th>
          <th scope="col">{t('hierarchy.columnDue')}</th>
          <th scope="col">{t('hierarchy.columnStatus')}</th>
          <th scope="col" className="visually-hidden">
            {t('hierarchy.columnActions')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          if (row.kind === 'group') {
            return (
              <GroupRow
                key={row.key}
                row={row}
                presentation={presentation}
                toggle={toggle}
                canEditSubproject={canEditSubproject}
                canCreateTask={canCreateTask}
                canRemoveRecord={canRemoveRecord}
                onNewTask={onNewTask}
                onEditSubproject={onEditSubproject}
                onDelete={onDelete}
                onRevealGroup={onRevealGroup}
              />
            );
          }
          if (row.kind === 'description') {
            const expanded = expandedDescriptions.has(row.groupKey);
            return (
              <tr className="hierarchy-description-row" key={row.key}>
                <td colSpan={5} style={{ ['--level' as string]: row.level }}>
                  <div className="hierarchy-description">
                    <p className={expanded ? 'description-text' : 'description-preview'}>{row.text}</p>
                    <button
                      type="button"
                      className="link-button"
                      aria-expanded={expanded}
                      onClick={() => onToggleDescription(row.groupKey)}
                    >
                      {t(expanded ? 'subprojects.hideDetails' : 'subprojects.details')}
                    </button>
                  </div>
                </td>
              </tr>
            );
          }
          if (row.kind === 'completedGroup') {
            return (
              <CompletedGroupRow
                key={row.key}
                row={row}
                onRevealGroup={onRevealGroup}
                onRevealTask={onRevealTask}
              />
            );
          }
          if (row.kind === 'task') {
            return (
              <TaskRow
                key={row.key}
                row={row}
                presentation={presentation}
                toggle={toggle}
                canRemoveRecord={canRemoveRecord}
                onDelete={onDelete}
              />
            );
          }
          return (
            <tr className="hierarchy-empty-row" key={row.key}>
              <td colSpan={5} className="hierarchy-empty muted small" style={{ ['--level' as string]: row.level }}>
                {row.text}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function GroupRow({
  row,
  presentation,
  toggle,
  canEditSubproject,
  canCreateTask,
  canRemoveRecord,
  onNewTask,
  onEditSubproject,
  onDelete,
  onRevealGroup
}: {
  row: Extract<FlatRow, { kind: 'group' }>;
  presentation: 'active' | 'completed';
  toggle: (key: string) => void;
  canEditSubproject: boolean;
  canCreateTask: boolean;
  canRemoveRecord: boolean;
  onNewTask: (subprojectId: string | null) => void;
  onEditSubproject: (subproject: SubprojectNode) => void;
  onDelete: (entityType: 'TASKS' | 'SUBPROJECTS', entityId: string, entityName: string) => void;
  onRevealGroup: (key: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const name = row.name;
  // A missing schedule boundary is a quiet value on a subproject header, exactly as it is on a
  // task row; the derived schedule badge already states the condition.
  const quietDates =
    !!row.node && row.node.schedule?.missing !== undefined && row.node.schedule.missing !== 'NONE';
  return (
    <tr
      className={`hierarchy-group-row${row.direct ? ' is-direct hierarchy-direct' : ''}`}
      id={`hierarchy-${presentation}-group-${row.key}`}
      tabIndex={-1}
      style={{ ['--level' as string]: row.level }}
    >
      <th scope="rowgroup" colSpan={5}>
        <div className="hierarchy-group-inner">
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={row.open}
            aria-label={t(row.open ? 'hierarchy.collapse' : 'hierarchy.expand', { name })}
            onClick={() => toggle(row.key)}
          >
            {row.open ? '▾' : '▸'}
          </button>
          <span className="tree-icon-slot">{row.direct ? <TasksIcon /> : <FolderIcon />}</span>
          <span className="hierarchy-name">{name}</span>
          {row.node ? <ScheduleBadge schedule={row.node.schedule} /> : null}
          {row.node?.deadline ? (
            quietDates ? (
              <span className="muted small hierarchy-dates-quiet">{row.node.deadline}</span>
            ) : (
              <DeadlineCell dueDate={row.node.deadline} state={deadlineStateOf(row.node.schedule)} showLabel={false} />
            )
          ) : quietDates ? (
            <span className="muted small hierarchy-dates-quiet">{t('common.unset')}</span>
          ) : null}
          <span className="hierarchy-counts" aria-label={t('hierarchy.counts', { active: row.active, done: row.done })}>
            <span>{t('hierarchy.activeCount', { n: row.active })}</span>
            <span aria-hidden="true"> · </span>
            {row.done > 0 ? (
              <button
                type="button"
                className="hierarchy-count-link"
                aria-label={t('hierarchy.showCompletedGroup', { name, n: row.done })}
                onClick={() => onRevealGroup(row.key)}
              >
                {t('hierarchy.doneCount', { n: row.done })}
              </button>
            ) : (
              <span>{t('hierarchy.doneCount', { n: 0 })}</span>
            )}
          </span>
          <span className="hierarchy-actions">
            {canCreateTask ? (
              <button type="button" className="link-button" onClick={() => onNewTask(row.node?.subprojectId ?? null)}>
                {t('tasks.new')}
              </button>
            ) : null}
            {row.node && (canEditSubproject || canRemoveRecord) ? (
              <Menu
                label="⋯"
                ariaLabel={t('hierarchy.subprojectMenu', { name })}
                className="row-menu"
              >
                {(close) => (
                  <>
                    {canEditSubproject ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        onClick={() => {
                          close();
                          onEditSubproject(row.node!);
                        }}
                      >
                        {t('action.edit')}
                      </button>
                    ) : null}
                    {canRemoveRecord ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="menu-item danger"
                        onClick={() => {
                          close();
                          onDelete('SUBPROJECTS', row.node!.subprojectId, row.node!.subprojectName);
                        }}
                      >
                        {t('hierarchy.removeRecord')}
                      </button>
                    ) : null}
                  </>
                )}
              </Menu>
            ) : null}
          </span>
        </div>
      </th>
    </tr>
  );
}

function CompletedGroupRow({
  row,
  onRevealGroup,
  onRevealTask
}: {
  row: Extract<FlatRow, { kind: 'completedGroup' }>;
  onRevealGroup: (key: string) => void;
  onRevealTask: (taskId: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <tr
      className="hierarchy-group-row hierarchy-group-row-completed"
      id={`hierarchy-completed-group-${row.key}`}
      tabIndex={-1}
    >
      <th scope="rowgroup" colSpan={5}>
        <div className="hierarchy-group-inner">
          <span className="tree-icon-slot">{row.direct ? <TasksIcon /> : <FolderIcon />}</span>
          <span className="hierarchy-name">{row.name}</span>
          <span className="hierarchy-counts">{t('hierarchy.doneCount', { n: row.count })}</span>
          <span className="hierarchy-actions">
            <button
              type="button"
              className="link-button"
              onClick={() =>
                row.firstTaskId ? onRevealTask(row.firstTaskId) : onRevealGroup(row.key)
              }
            >
              {t('hierarchy.showCompleted')}
            </button>
          </span>
        </div>
      </th>
    </tr>
  );
}

function TaskRow({
  row,
  presentation,
  toggle,
  canRemoveRecord,
  onDelete
}: {
  row: Extract<FlatRow, { kind: 'task' }>;
  presentation: 'active' | 'completed';
  toggle: (key: string) => void;
  canRemoveRecord: boolean;
  onDelete: (entityType: 'TASKS' | 'SUBPROJECTS', entityId: string, entityName: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const { task, children } = row.node;
  const hasChildren = children.length > 0;
  const assignees = Array.isArray(task.assigneeNames) && task.assigneeNames.length
    ? task.assigneeNames.join(', ')
    : task.ownerName;
  // A repeated "dates not set" badge is noise in a long list. The missing schedule stays readable
  // as quiet text, and the due-date cell still says 未設定.
  const quietStatus = task.displayStatus === 'DATES_NOT_SET' || task.displayStatus === 'START_NOT_SET';
  return (
    <tr
      className={`hierarchy-task-row${isCompletedStatus(task.status) ? ' is-done' : ''}`}
      // A container can be context in both presentations, so the presentation is part of the id.
      id={`hierarchy-${presentation}-${task.taskId}`}
      tabIndex={-1}
      style={{ ['--level' as string]: row.level }}
    >
      <th scope="row" className="hierarchy-cell-name">
        <span className="hierarchy-level">
          {hasChildren ? (
            <button
              type="button"
              className="tree-toggle"
              aria-expanded={row.open}
              aria-label={t(row.open ? 'hierarchy.collapse' : 'hierarchy.expand', { name: task.taskName })}
              onClick={() => toggle(row.key)}
            >
              {row.open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="tree-spacer" aria-hidden="true" />
          )}
          <a className="hierarchy-name task-link" href={`#/task/${task.taskId}`}>
            {task.taskName}
          </a>
          {task.container ? <Badge>{t('hierarchy.container')}</Badge> : null}
          {task.reviewState === 'PENDING' ? <Badge tone="warn">{t('tasks.review')}</Badge> : null}
        </span>
        <WorkflowHint status={task.status} />
      </th>
      <td className="hierarchy-cell-assignee">
        <span className="hierarchy-assignees" title={assignees || undefined}>
          {assignees || t('common.unset')}
        </span>
      </td>
      <td className="hierarchy-cell-due">
        <DeadlineCell dueDate={task.dueDate} state={task.displayStatus} showLabel={false} showStateBadge={false} />
      </td>
      <td className="hierarchy-cell-status">
        {task.container ? (
          // A container is organisation. Its stored Done status is never shown as completed work.
          <span className="muted small">{t('hierarchy.containerDerived')}</span>
        ) : quietStatus ? (
          <span className="muted small">{t(`taskStatus.${task.displayStatus}`)}</span>
        ) : (
          <TaskStatusBadge state={task.displayStatus} missing={task.scheduleMissing} />
        )}
      </td>
      <td className="hierarchy-cell-actions">
        {canRemoveRecord ? (
          <Menu
            label="⋯"
            ariaLabel={t('hierarchy.taskMenu', { name: task.taskName })}
            className="row-menu"
            align="end"
          >
            {(close) => (
              <>
                <a className="menu-item" role="menuitem" href={`#/task/${task.taskId}`} onClick={close}>
                  {t('action.open')}
                </a>
                <div className="menu-separator" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item danger"
                  onClick={() => {
                    close();
                    onDelete('TASKS', task.taskId, task.taskName);
                  }}
                >
                  {t('hierarchy.removeRecord')}
                </button>
              </>
            )}
          </Menu>
        ) : null}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ screen */

export function ProjectDetailScreen({
  actor,
  projectId,
  readOnly = false,
  routeSearch = ''
}: {
  actor: Actor;
  projectId: string;
  readOnly?: boolean;
  /** The hash query string, used to reveal an explicitly addressed task. */
  routeSearch?: string;
}): JSX.Element {
  const { t, label } = useI18n();
  const endpoint = readOnly ? `/api/work/projects/${projectId}` : `/api/manager/projects/${projectId}`;
  // The manager detail shares the `manager/projects` prefix so any project save invalidates it;
  // the read-only projection gets its own key and never collides with the picker payload.
  const cacheKey = readOnly ? `work/project/${projectId}` : keys.project(projectId);
  // The derived schedule badge depends on today; the Tokyo date re-reads it after midnight.
  const today = useBusinessDate();
  const detail = useQuery<ManagerDetail | ReadOnlyDetail>(`${cacheKey}:${today}`, () =>
    api.get<ManagerDetail | ReadOnlyDetail>(endpoint)
  );
  const capabilities = capabilitiesOf(actor);
  // Creation and management are separate capabilities: a MEMBER files new work from this page but
  // never edits, archives, deletes or changes the lifecycle of an existing record. Management is
  // additionally resolved per record: this project's division must allow a write for this account.
  const recordWritable = (detail.data as { canWrite?: boolean } | undefined)?.canWrite !== false;
  const canManage = !readOnly && capabilities.canEdit && recordWritable;
  // Recoverable removal of a task or subproject follows the record's division, never the shell's
  // selected division. Permanent erasure is not offered here at all.
  const canMemberEdit = actor.role === "MEMBER" && (detail.data as { canWrite?: boolean } | undefined)?.canWrite === true;
  const canRemoveRecord = capabilities.canRecoverDelete && (canMemberEdit || (!readOnly && recordWritable));
  // A destination is required for creation: the account must be able to write in this division.
  const canCreateTask = (capabilities.canCreateTask || canManage) && recordWritable;
  const canCreateSubproject = (capabilities.canCreateSubproject || canManage) && recordWritable;
  const [memberTaskSubproject, setMemberTaskSubproject] = useState<string | null | undefined>(undefined);
  const [memberSubproject, setMemberSubproject] = useState(false);
  const [editProject, setEditProject] = useState(false);
  const [editingSubproject, setEditingSubproject] = useState<Subproject | null>(null);
  const [newSubprojectParent, setNewSubprojectParent] = useState<string | null | undefined>(undefined);
  const [newTaskSubproject, setNewTaskSubproject] = useState<string | null | undefined>(undefined);
  const [includeInactive, setIncludeInactive] = useRouteMemoryState(`project:${projectId}:inactive`, false);
  const [collapsed, setCollapsed] = useRouteMemoryState<Set<string>>(
    `project:${projectId}:collapsed`,
    () => new Set()
  );
  // Search, filter and disclosure state live in page memory only, keyed by the stable project id.
  // A data refresh or a language change therefore keeps them; nothing is persisted in the browser.
  const [taskQuery, setTaskQuery] = useRouteMemoryState(`project:${projectId}:task-query`, '');
  const [assigneeId, setAssigneeId] = useRouteMemoryState(`project:${projectId}:assignee`, '');
  const [completedOpen, setCompletedOpen] = useRouteMemoryState(`project:${projectId}:completed`, false);
  const [completionNotice, setCompletionNotice] = useState<{ taskId: string; taskName: string } | null>(null);
  useEffect(() => {
    const pending = takeCompletedTask(projectId);
    if (pending) setCompletionNotice(pending);
  }, [projectId]);
  const toggleCollapsed = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const expandKeys = useCallback((keysToExpand: string[]) => {
    setCollapsed((current) => {
      const next = new Set(current);
      let changed = false;
      for (const key of keysToExpand) {
        if (next.delete(key)) changed = true;
      }
      return changed ? next : current;
    });
  }, []);
  const [deleteTarget, setDeleteTarget] = useState<{
    entityType: 'TASKS' | 'SUBPROJECTS';
    entityId: string;
    entityName: string;
  } | null>(null);
  const [notice, setNotice] = useState('');
  /** An explicit, confirmed lifecycle decision - never an ordinary edit. */
  const [statusChange, setStatusChange] = useState<'Completed' | 'Cancelled' | 'Active' | null>(null);

  const references = useQuery<{
    responsibilities: Reference[];
    subprojects: Reference[];
    skills: { skillId: string; skillName: string }[];
    members: { memberId: string; name: string; active: boolean; employeeId?: string }[];
  }>(keys.references, () =>
    canManage
      ? api.get('/api/manager/references')
      : Promise.resolve({ responsibilities: [], subprojects: [], skills: [], members: [] })
  );

  const refresh = useCallback((): void => {
    queryCache.invalidate([
      cacheKey,
      keys.project(projectId),
      keys.projects,
      keys.timeline,
      keys.references,
      keys.tasks,
      keys.overview,
      keys.taskIndex,
      keys.myWork,
      keys.workload,
      keys.employee,
      keys.workProjects,
      keys.workOverview,
      keys.myProjects,
      // A removal or restoration changes which records an ADMIN can recover.
      keys.deletedRecords,
      // The read-only projection and the employee lists show the same records.
      'work/tasks',
      'work/project/',
      'work/projects'
    ]);
  }, [cacheKey, projectId]);

  const hierarchy = useMemo(() => {
    if (!detail.data) return null;
    const source = toViewModel(detail.data);
    return buildProjectHierarchy({
      subprojects: source.subprojects.map((subproject) => ({
        subprojectId: subproject.subprojectId,
        subprojectName: subproject.subprojectName,
        description: subproject.description ?? '',
        parentSubprojectId: subproject.parentSubprojectId ?? null,
        status: subproject.status,
        schedule: subproject.schedule,
        deadline: subproject.deadline,
        depth: subproject.depth,
        revision: (subproject as Subproject).revision
      })),
      tasks: source.tasks,
      includeInactive,
      filter: { query: taskQuery, assigneeId }
    });
  }, [detail.data, includeInactive, taskQuery, assigneeId]);

  // `?task=<id>` is an explicit address of one record: a completed one opens the completed
  // section, an active one is scrolled to in place. The value is a stable task id, never an index.
  const focusTaskId = useMemo(() => {
    const params = new URLSearchParams(routeSearch);
    return params.get('task') ?? '';
  }, [routeSearch]);

  if (detail.error) return <ErrorBox error={detail.error} onRetry={() => detail.refresh()} />;
  if (!detail.data || !hierarchy) return <p className="muted">{t('state.loading')}</p>;
  const view = toViewModel(detail.data);
  const { record } = view;
  /** The stored lifecycle fact decides which explicit actions are offered. */
  const storedStatus = record.status;

  const editTarget = (node: SubprojectNode): Subproject => {
    const source = view.subprojects.find((subproject) => subproject.subprojectId === node.subprojectId);
    return (source ?? (node as unknown as Subproject)) as Subproject;
  };

  return (
    <div className="screen project-detail-screen" style={{ ['--project-accent' as string]: projectColor(record.projectId) }}>
      <BackButton
        actor={actor}
        fallback="projects"
        disabled={
          editProject ||
          editingSubproject !== null ||
          newSubprojectParent !== undefined ||
          newTaskSubproject !== undefined ||
          memberSubproject ||
          memberTaskSubproject !== undefined ||
          deleteTarget !== null
        }      />
      <Breadcrumbs
        items={[
          { label: t('nav.projects'), href: '#/projects' },
          { label: record.projectName }
        ]}
      />
      <div className="page-heading">
        <h2>
          <span className="project-dot" style={{ background: projectColor(record.projectId) }} aria-hidden="true" />
          {record.projectName}
        </h2>
        <div className="compact-toolbar">
          {canManage ? (
            <button type="button" className="button secondary" onClick={() => setEditProject(true)}>
              {t('projects.edit')}
            </button>
          ) : null}
          <Menu label={t('action.more')}>
            {(close) => (
              <>
                <a className="menu-item" role="menuitem" href={`#/timeline/${record.projectId}`} onClick={close}>
                  {t('timeline.projectLink')}
                </a>
                {canCreateSubproject ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      setMemberSubproject(true);
                    }}
                  >
                    {t('myWork.newSubproject')}
                  </button>
                ) : null}                {canManage && storedStatus !== 'Completed' && storedStatus !== 'Archived' && storedStatus !== 'Cancelled' ? (
                  <>
                    <div className="menu-separator" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        close();
                        setStatusChange('Completed');
                      }}
                    >
                      {t('project.schedule.markCompleted')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        close();
                        setStatusChange('Cancelled');
                      }}
                    >
                      {t('project.schedule.cancel')}
                    </button>
                  </>
                ) : null}
                {canManage && storedStatus === 'Cancelled' ? (
                  <>
                    <div className="menu-separator" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        close();
                        setStatusChange('Active');
                      }}
                    >
                      {t('project.schedule.reactivate')}
                    </button>
                  </>
                ) : null}
              </>
            )}
          </Menu>
        </div>
      </div>

      <p className="muted small project-identity">
        {record.projectId} · {record.responsibilityName || t('overview.unassigned')} ·{' '}
        {record.projectOwnerName || t('common.unset')}
        {canManage ? (
          <Badge tone={(record as Project).dashboardVisibility === 'INTERNAL' ? 'ok' : 'neutral'}>
            {t(`visibility.${(record as Project).dashboardVisibility === 'INTERNAL' ? 'INTERNAL' : 'RESTRICTED'}`)}
          </Badge>
        ) : null}
      </p>

      {/* One compact summary: state, deadline, progress, owner and area on a single readable strip. */}
      <dl className="project-summary">
        <div>
          <dt>{t('column.status')}</dt>
          <dd>
            <ScheduleBadge schedule={record.schedule} />
          </dd>
        </div>
        <div>
          <dt>{t('column.deadline')}</dt>
          <dd>
            <DeadlineCell
              dueDate={record.committedDeadline}
              state={deadlineStateOf(record.schedule)}
              showLabel={false}
            />
          </dd>
        </div>
        <div className="project-summary-progress">
          <dt>{t('projects.progress')}</dt>
          <dd>
            <ProgressBar value={view.progress.percent} />
            {/* Weighted progress and the completed-task count are different facts, both stated. */}
            <span className="muted small">
              {t('projects.progressSummary', {
                percent: Math.round(view.progress.percent ?? 0),
                done: view.progress.doneLeaves,
                total: view.progress.leaves
              })}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t('projects.owner')}</dt>
          <dd>{record.projectOwnerName || t('common.unset')}</dd>
        </div>
        <div>
          <dt>{t('projects.priority')}</dt>
          <dd>{label('priority', record.priority)}</dd>
        </div>
      </dl>

      {notice ? (
        <div className="banner ok" role="status">
          {notice}
        </div>
      ) : null}


      {canCreateSubproject && memberSubproject ? (
        <MemberSubprojectForm
          fixedProjectId={projectId}
          projects={[
            {
              projectId,
              projectName: record.projectName,
              responsibilityName: record.responsibilityName ?? '',
              subprojects: view.subprojects.map((subproject) => ({
                subprojectId: subproject.subprojectId,
                subprojectName: subproject.subprojectName,
                parentSubprojectId: subproject.parentSubprojectId ?? null,
                depth: subproject.depth
              }))
            }
          ]}
          onClose={() => setMemberSubproject(false)}
          onCreated={() => {
            setMemberSubproject(false);
            setNotice(t('myWork.subprojectCreated'));
            refresh();
          }}
        />
      ) : null}

      {canCreateTask && memberTaskSubproject !== undefined ? (
        <MemberTaskForm
          projects={[
            {
              projectId,
              projectName: record.projectName,
              responsibilityName: record.responsibilityName ?? '',
              subprojects: view.subprojects.map((subproject) => ({
                subprojectId: subproject.subprojectId,
                subprojectName: subproject.subprojectName,
                parentSubprojectId: subproject.parentSubprojectId ?? null,
                depth: subproject.depth
              }))
            }
          ]}
          destination={{
            projectId,
            subprojectId: memberTaskSubproject,
            projectName: record.projectName,
            subprojectName: memberTaskSubproject
              ? view.subprojects.find((subproject) => subproject.subprojectId === memberTaskSubproject)?.subprojectName
              : undefined
          }}
          onClose={() => setMemberTaskSubproject(undefined)}
          onCreated={() => {
            setMemberTaskSubproject(undefined);
            setNotice(t('myWork.created'));
            refresh();
          }}
        />
      ) : null}

      <ProjectHierarchy
        hierarchy={hierarchy}
        canManage={canManage}
        canEditSubproject={canManage || canMemberEdit}
        canRemoveRecord={canRemoveRecord}
        canCreateTask={canCreateTask}
        canCreateSubproject={canCreateSubproject}
        includeInactive={includeInactive}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onExpand={expandKeys}
        onToggleInactive={(value) => setIncludeInactive(value)}
        onNewTask={(subprojectId) =>
          canManage ? setNewTaskSubproject(subprojectId) : setMemberTaskSubproject(subprojectId)
        }
        onNewSubproject={() => (canManage ? setNewSubprojectParent(null) : setMemberSubproject(true))}
        onEditSubproject={(node) => setEditingSubproject(editTarget(node))}
        onDelete={(entityType, entityId, entityName) => setDeleteTarget({ entityType, entityId, entityName })}
        searchQuery={taskQuery}
        onSearchQueryChange={setTaskQuery}
        assigneeId={assigneeId}
        onAssigneeChange={setAssigneeId}
        completedOpen={completedOpen}
        onCompletedOpenChange={setCompletedOpen}
        completionNotice={completionNotice}
        onCompletionNoticeDismiss={() => setCompletionNotice(null)}
        focusTaskId={focusTaskId}
      />

      <details className="disclosure">
        <summary>{t('project.schedule.title')}</summary>
        <div className="disclosure-body">
          <ScheduleBadge schedule={record.schedule} showDetail />
          <p className="muted small">{t('project.schedule.derivedHint')}</p>
        </div>
      </details>

      {record.description && record.description.trim() ? (
        <Section title={t('projects.description')}>
          <DescriptionText text={record.description} />
        </Section>
      ) : (
        <p className="muted small">
          <span className="field-label">{t('projects.description')}</span>{' '}
          <span>{t('common.noDescription')}</span>
        </p>
      )}

      <p className="muted small project-scope-counts">
        {/* The structure counters and the completed disclosure both come from the same leaf scan. */}
        {t('hierarchy.scopeCounts', {
          active: hierarchy.counts.active,
          done: hierarchy.counts.done,
          cancelled: hierarchy.cancelledLeaves
        })}
      </p>


      {editProject && canManage ? (
        <ProjectForm
          mode="edit"
          project={record as Project}
          references={references.data}
          onClose={() => setEditProject(false)}
          onSaved={() => {
            setEditProject(false);
            refresh();
          }}
        />
      ) : null}

      {editingSubproject && canMemberEdit ? <MemberWorkEditor kind="subprojects" id={editingSubproject.subprojectId} projectId={projectId} onClose={() => setEditingSubproject(null)} onSaved={() => { setEditingSubproject(null); refresh(); }} /> : null}
      {editingSubproject && canManage ? (
        <SubprojectForm
          projectId={projectId}
          projectName={record.projectName}
          item={editingSubproject}
          members={references.data?.members ?? []}
          onClose={() => setEditingSubproject(null)}
          onSaved={() => {
            setEditingSubproject(null);
            refresh();
          }}
        />
      ) : null}

      {newSubprojectParent !== undefined && canManage ? (
        <SubprojectForm
          projectId={projectId}
          projectName={record.projectName}
          members={references.data?.members ?? []}
          onClose={() => setNewSubprojectParent(undefined)}
          onSaved={() => {
            setNewSubprojectParent(undefined);
            refresh();
          }}
        />
      ) : null}

      {newTaskSubproject !== undefined && canManage ? (
        <TaskForm
          initialProjectId={projectId}
          initialSubprojectId={newTaskSubproject ?? undefined}
          context={{
            projectName: record.projectName,
            subprojectPath: newTaskSubproject ? subprojectPath(view.subprojects, newTaskSubproject) : ''
          }}
          references={references.data}
          onClose={() => setNewTaskSubproject(undefined)}
          onSaved={() => {
            setNewTaskSubproject(undefined);
            refresh();
          }}
        />
      ) : null}

      {deleteTarget && canRemoveRecord ? (
        <DeleteEntityDialog
          memberAction={actor.role === "MEMBER"}
          entityType={deleteTarget.entityType}
          entityId={deleteTarget.entityId}
          entityName={deleteTarget.entityName}
          context={detail.data?.record.projectName ?? projectId}
          canPurge={capabilities.canPurgeRecord}
          onClose={() => setDeleteTarget(null)}
          onRevealChildren={() => {
            const type = deleteTarget.entityType === 'TASKS' ? 'task' : 'sub';
            expandKeys([`${type}:${deleteTarget.entityId}`]);
            setDeleteTarget(null);
            // The expanded children render on the next frame; scroll to the row afterwards.
            window.setTimeout(() => {
              document.getElementById(`hierarchy-active-${deleteTarget.entityId}`)?.scrollIntoView?.({ block: 'center' });
            }, 0);
          }}
          onDeleted={() => {
            setDeleteTarget(null);
            setNotice(t('delete.done'));
            refresh();
          }}
        />
      ) : null}

      {statusChange && canManage ? (
        <ConfirmDialog
          title={
            statusChange === 'Completed'
              ? t('project.schedule.markCompletedTitle')
              : statusChange === 'Cancelled'
                ? t('project.schedule.cancelTitle')
                : t('project.schedule.reactivateTitle')
          }
          message={
            statusChange === 'Completed'
              ? t('project.schedule.markCompletedBody')
              : statusChange === 'Cancelled'
                ? t('project.schedule.cancelBody')
                : t('project.schedule.reactivateBody')
          }
          onCancel={() => setStatusChange(null)}
          onConfirm={async () => {
            const target = statusChange;
            await api.patch(`/api/manager/projects/${projectId}`, {
              revision: (record as Project).revision,
              status: target,
              // A terminal decision is explicit and confirmed, never an ordinary form save.
              confirmStatusChange: true
            });
            setStatusChange(null);
            setNotice(t('project.schedule.changed'));
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
