/**
 * Project detail.
 *
 * One expandable hierarchy: a subproject is a header, its tasks sit immediately beneath it, nested
 * subprojects follow, and project-direct tasks live in their own section. Nesting comes only from
 * `subprojects.parent_subproject_id`, `tasks.subproject_id` and `tasks.parent_task_id` - never from
 * names, visual order or a grouping heuristic.
 *
 * MANAGER and ADMIN edit and create in context. Only ADMIN gets an administrative-removal control,
 * and it always goes through the reviewed preflight; MANAGER, MEMBER and VIEWER never see it. A MEMBER or
 * VIEWER reads the narrow `/api/work/projects/:id` projection with no actions at all.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProjectForm } from './Projects';
import { SubprojectForm } from './SubprojectForm';
import { TaskForm } from './TaskForm';
import type { Actor, DeletionPreflight, Project, Reference, ProgressRollup, Subproject, TaskSummary } from '@eh/contracts';
import { api, ApiFailure } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Modal, ProgressBar, Section, statusTone } from '../components/ui';
import { displayTone } from './Tasks';
import { projectColor } from '@eh/domain';
import { BackButton, useRouteMemoryState } from '../state/navigation';

/* ------------------------------------------------------------------ data shapes */

type ManagerDetail = {
  record: Project;
  progress: ProgressRollup;
  subprojects: (Subproject & { progress: ProgressRollup })[];
  tasks: TaskSummary[];
  milestones: {
    milestone_id: string;
    milestone_name: string;
    target_date: string | null;
    actual_date: string | null;
    status: string;
  }[];
  phases: {
    project_phase_id: string;
    phase_name: string;
    planned_start: string | null;
    planned_end: string | null;
    status: string;
  }[];
};

type ReadOnlyDetail = {
  record: {
    projectId: string;
    projectName: string;
    responsibilityName: string;
    projectOwnerName: string;
    status: Project['status'];
    priority: Project['priority'];
    committedDeadline: string | null;
    progressPercent: number | null;
    health: string;
  };
  progress: ProgressRollup;
  subprojects: {
    subprojectId: string;
    subprojectName: string;
    parentSubprojectId?: string | null;
    status: Subproject['status'];
    deadline: string | null;
    depth: number;
    progress: ProgressRollup;
  }[];
  tasks: TaskSummary[];
};

type ViewModel = ReadOnlyDetail & { milestones?: ManagerDetail['milestones']; phases?: ManagerDetail['phases'] };

function toViewModel(detail: ManagerDetail | ReadOnlyDetail): ViewModel {
  if ('milestones' in detail) {
    return {
      record: detail.record,
      progress: detail.progress,
      subprojects: detail.subprojects,
      tasks: detail.tasks,
      milestones: detail.milestones,
      phases: detail.phases
    };
  }
  return detail;
}

/* ------------------------------------------------------------------ hierarchy model */

export type HierarchySubproject = {
  subprojectId: string;
  subprojectName: string;
  parentSubprojectId: string | null;
  status: string;
  deadline: string | null;
  depth: number;
  revision?: number | null;
};

export type TaskCounts = { active: number; done: number; total: number };

export type TaskNode = { task: TaskSummary; children: TaskNode[]; counts: TaskCounts };

export type SubprojectNode = HierarchySubproject & {
  revision: number | null;
  tasks: TaskNode[];
  children: SubprojectNode[];
  counts: TaskCounts;
};

export type ProjectHierarchy = {
  subprojects: SubprojectNode[];
  directTasks: TaskNode[];
  counts: TaskCounts;
  hiddenTasks: number;
};

const EMPTY_COUNTS: TaskCounts = { active: 0, done: 0, total: 0 };

function addCounts(left: TaskCounts, right: TaskCounts): TaskCounts {
  return {
    active: left.active + right.active,
    done: left.done + right.done,
    total: left.total + right.total
  };
}

function countsOfNodes(nodes: readonly TaskNode[]): TaskCounts {
  return nodes.reduce((total, node) => addCounts(total, node.counts), EMPTY_COUNTS);
}

function isDone(status: string): boolean {
  return status === 'Done';
}

function isOpen(status: string): boolean {
  return status !== 'Done' && status !== 'Cancelled';
}

/**
 * Builds the render model.
 *
 * A task is placed only by its stored `subproject_id`; a task whose subproject is hidden (archived
 * ancestor) is hidden with it instead of being moved to the project-direct section. Completed work
 * stays visible on this page (it is part of the project record and is counted), while `Cancelled`
 * work and archived subprojects stay hidden unless the manager asks for them.
 */
export function buildProjectHierarchy(input: {
  subprojects: readonly HierarchySubproject[];
  tasks: readonly TaskSummary[];
  includeInactive: boolean;
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
    if (!input.includeInactive && task.status === 'Cancelled') {
      hiddenTasks += 1;
      continue;
    }
    const key = task.subprojectId ?? '__direct__';
    if (task.subprojectId) {
      if (!visibleSubprojectIds.has(task.subprojectId)) {
        // Never silently reassign a subproject's task to the project-direct bucket.
        hiddenTasks += 1;
        continue;
      }
    }
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
      const own: TaskCounts = { active: isOpen(task.status) ? 1 : 0, done: isDone(task.status) ? 1 : 0, total: 1 };
      return { task, children, counts: addCounts(own, countsOfNodes(children)) };
    };
    return roots.map((task) => build(task, 0));
  };

  const taskTreeOf = (subprojectId: string | null): TaskNode[] =>
    buildTaskTree(buckets.get(subprojectId ?? '__direct__') ?? []);

  const childMap = new Map<string, HierarchySubproject[]>();
  const roots: HierarchySubproject[] = [];
  for (const subproject of visibleSubprojects) {
    const parentId = subproject.parentSubprojectId;
    if (parentId && visibleSubprojectIds.has(parentId)) {
      const siblings = childMap.get(parentId) ?? [];
      siblings.push(subproject);
      childMap.set(parentId, siblings);
    } else {
      roots.push(subproject);
    }
  }
  const byName = (a: HierarchySubproject, b: HierarchySubproject): number =>
    a.subprojectName.localeCompare(b.subprojectName, 'ja') || a.subprojectId.localeCompare(b.subprojectId);

  const buildSubproject = (subproject: HierarchySubproject, guard: number): SubprojectNode => {
    const tasks = taskTreeOf(subproject.subprojectId);
    const children =
      guard > 20 ? [] : (childMap.get(subproject.subprojectId) ?? []).slice().sort(byName).map((child) => buildSubproject(child, guard + 1));
    const counts = children.reduce((total, child) => addCounts(total, child.counts), countsOfNodes(tasks));
    return {
      ...subproject,
      revision: subproject.revision ?? null,
      tasks,
      children,
      counts
    };
  };

  const subprojects = roots.slice().sort(byName).map((subproject) => buildSubproject(subproject, 0));
  const directTasks = taskTreeOf(null);
  return {
    subprojects,
    directTasks,
    counts: addCounts(
      subprojects.reduce((total, node) => addCounts(total, node.counts), EMPTY_COUNTS),
      countsOfNodes(directTasks)
    ),
    hiddenTasks
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

function TrashIcon(): JSX.Element {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1v-8h-1zm3 0v8h1v-8h-1z"
        fill="currentColor"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ hierarchy section */

type HierarchyProps = {
  hierarchy: ProjectHierarchy;
  canManage: boolean;
  canDelete: boolean;
  includeInactive: boolean;
  onToggleInactive: (value: boolean) => void;
  onNewTask: (subprojectId: string | null) => void;
  onNewSubproject: (parentSubprojectId: string | null) => void;
  onEditSubproject: (subproject: SubprojectNode) => void;
  onDelete: (entityType: 'TASKS' | 'SUBPROJECTS', entityId: string, entityName: string) => void;
  /**
   * Expansion state is owned by the screen so a data refresh (which unmounts the tree while the
   * new detail loads) cannot reset it. Standalone renders fall back to local state.
   */
  collapsed?: Set<string>;
  onToggle?: (key: string) => void;
};

export function ProjectHierarchy(props: HierarchyProps): JSX.Element {
  const { t } = useI18n();
  const { hierarchy, canManage, canDelete } = props;
  const [localCollapsed, setLocalCollapsed] = useState<Set<string>>(() => new Set());
  const collapsed = props.collapsed ?? localCollapsed;

  // Expansion is keyed by stable IDs, so a save or a delete keeps every other branch as left.
  const toggle = useCallback(
    (key: string) => {
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
    [props.onToggle]
  );

  const isEmpty = hierarchy.subprojects.length === 0 && hierarchy.directTasks.length === 0;

  return (
    <Section
      title={t('hierarchy.title')}
      actions={
        <>
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
          <span className="muted small">
            {t('hierarchy.counts', { active: hierarchy.counts.active, done: hierarchy.counts.done })}
          </span>
          {canManage ? (
            <>
              <button type="button" className="button secondary" onClick={() => props.onNewSubproject(null)}>
                {t('subprojects.new')}
              </button>
              <button type="button" className="button" onClick={() => props.onNewTask(null)}>
                {t('tasks.new')}
              </button>
            </>
          ) : null}
        </>
      }
    >
      {isEmpty ? <EmptyState text={t('hierarchy.empty')} /> : null}
      {hierarchy.hiddenTasks > 0 ? (
        <p className="muted small">{t('hierarchy.hiddenTasks', { n: hierarchy.hiddenTasks })}</p>
      ) : null}
      <ul className="hierarchy" role="list">
        {hierarchy.subprojects.map((node) => (
          <SubprojectItem
            key={node.subprojectId}
            node={node}
            level={1}
            collapsed={collapsed}
            onToggle={toggle}
            onEdit={props.onEditSubproject}
            onNewTask={props.onNewTask}
            onNewSubproject={props.onNewSubproject}
            onDelete={props.onDelete}
            canManage={canManage}
            canDelete={canDelete}
          />
        ))}
        <li className="hierarchy-direct">
          <div className="hierarchy-row hierarchy-row-direct">
            <button
              type="button"
              className="tree-toggle"
              aria-expanded={!collapsed.has('direct')}
              aria-label={t(collapsed.has('direct') ? 'hierarchy.expand' : 'hierarchy.collapse', {
                name: t('hierarchy.directTasks')
              })}
              onClick={() => toggle('direct')}
            >
              {collapsed.has('direct') ? '▸' : '▾'}
            </button>
            <span className="tree-icon-slot">
              <TasksIcon />
            </span>
            <span className="hierarchy-name">{t('hierarchy.directTasks')}</span>
            <span className="hierarchy-counts">
              {t('hierarchy.counts', {
                active: countsOfNodes(hierarchy.directTasks).active,
                done: countsOfNodes(hierarchy.directTasks).done
              })}
            </span>
            {canManage ? (
              <span className="hierarchy-actions">
                <button type="button" className="link-button" onClick={() => props.onNewTask(null)}>
                  {t('tasks.new')}
                </button>
              </span>
            ) : null}
          </div>
          {collapsed.has('direct') ? null : hierarchy.directTasks.length === 0 ? (
            <p className="hierarchy-empty muted small">{t('hierarchy.emptyDirect')}</p>
          ) : (
            <ul className="hierarchy-children" role="list">
              {hierarchy.directTasks.map((node) => (
                <TaskItem
                  key={node.task.taskId}
                  node={node}
                  level={2}
                  collapsed={collapsed}
                  onToggle={toggle}
                  onDelete={props.onDelete}
                  canDelete={canDelete}
                />
              ))}
            </ul>
          )}
        </li>
      </ul>
    </Section>
  );
}

function SubprojectItem({
  node,
  level,
  collapsed,
  onToggle,
  onEdit,
  onNewTask,
  onNewSubproject,
  onDelete,
  canManage,
  canDelete
}: {
  node: SubprojectNode;
  level: number;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  onEdit: (subproject: SubprojectNode) => void;
  onNewTask: (subprojectId: string | null) => void;
  onNewSubproject: (parentSubprojectId: string | null) => void;
  onDelete: (entityType: 'TASKS' | 'SUBPROJECTS', entityId: string, entityName: string) => void;
  canManage: boolean;
  canDelete: boolean;
}): JSX.Element {
  const { t, label } = useI18n();
  const key = `sub:${node.subprojectId}`;
  const open = !collapsed.has(key);
  return (
    <li className="hierarchy-node" id={`hierarchy-${node.subprojectId}`}>
      <div className="hierarchy-row hierarchy-row-subproject" style={{ ['--level' as string]: level }}>
        <button
          type="button"
          className="tree-toggle"
          aria-expanded={open}
          aria-label={t(open ? 'hierarchy.collapse' : 'hierarchy.expand', { name: node.subprojectName })}
          onClick={() => onToggle(key)}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="tree-icon-slot">
          <FolderIcon />
        </span>
        <span className="hierarchy-name">{node.subprojectName}</span>
        <Badge tone={statusTone(node.status)}>{label('project.status', node.status)}</Badge>
        {node.deadline ? <span className="muted small">{t('column.deadline')}: {node.deadline}</span> : null}
        <span className="hierarchy-counts">{t('hierarchy.counts', { active: node.counts.active, done: node.counts.done })}</span>
        {canManage ? (
          <span className="hierarchy-actions">
            <button type="button" className="link-button" onClick={() => onNewTask(node.subprojectId)}>
              {t('tasks.new')}
            </button>
            <button type="button" className="link-button" onClick={() => onNewSubproject(node.subprojectId)}>
              {t('hierarchy.newSubproject')}
            </button>
            <button type="button" className="link-button" onClick={() => onEdit(node)}>
              {t('action.edit')}
            </button>
            {canDelete ? (
              <button
                type="button"
                className="icon-button danger"
                aria-label={t('hierarchy.deleteSubproject', { name: node.subprojectName })}
                onClick={() => onDelete('SUBPROJECTS', node.subprojectId, node.subprojectName)}
              >
                <TrashIcon />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {open ? (
        node.tasks.length === 0 && node.children.length === 0 ? (
          <p className="hierarchy-empty muted small">{t('hierarchy.emptySubproject')}</p>
        ) : (
          <ul className="hierarchy-children" role="list">
            {node.tasks.map((task) => (
              <TaskItem
                key={task.task.taskId}
                node={task}
                level={level + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                onDelete={onDelete}
                canDelete={canDelete}
              />
            ))}
            {node.children.map((child) => (
              <SubprojectItem
                key={child.subprojectId}
                node={child}
                level={level + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                onEdit={onEdit}
                onNewTask={onNewTask}
                onNewSubproject={onNewSubproject}
                onDelete={onDelete}
                canManage={canManage}
                canDelete={canDelete}
              />
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

function TaskItem({
  node,
  level,
  collapsed,
  onToggle,
  onDelete,
  canDelete
}: {
  node: TaskNode;
  level: number;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  onDelete: (entityType: 'TASKS' | 'SUBPROJECTS', entityId: string, entityName: string) => void;
  canDelete: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const { task, children } = node;
  const key = `task:${task.taskId}`;
  const hasChildren = children.length > 0;
  const open = !collapsed.has(key);
  const assignees = task.assigneeNames.length ? task.assigneeNames.join(', ') : task.ownerName;
  return (
    <li className="hierarchy-node" id={`hierarchy-${task.taskId}`}>
      <div className="hierarchy-row hierarchy-row-task" style={{ ['--level' as string]: level }}>
        {hasChildren ? (
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={open}
            aria-label={t(open ? 'hierarchy.collapse' : 'hierarchy.expand', { name: task.taskName })}
            onClick={() => onToggle(key)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-spacer" aria-hidden="true" />
        )}
        <a className="hierarchy-name task-link" href={`#/task/${task.taskId}`}>
          {task.taskName}
        </a>
        {task.container ? <Badge>{t('hierarchy.container')}</Badge> : null}
        {task.reviewState === 'PENDING' ? <Badge tone="warn">{t('tasks.review')}</Badge> : null}
        <span className="hierarchy-assignees muted small">{assignees || t('common.unset')}</span>
        <span className="muted small">{task.dueDate ?? t('common.unset')}</span>
        <Badge tone={displayTone(task.displayStatus)}>{t(`taskStatus.${task.displayStatus}`)}</Badge>
        {canDelete ? (
          <button
            type="button"
            className="icon-button danger"
            aria-label={t('hierarchy.deleteTask', { name: task.taskName })}
            onClick={() => onDelete('TASKS', task.taskId, task.taskName)}
          >
            <TrashIcon />
          </button>
        ) : null}
      </div>
      {hasChildren && open ? (
        <ul className="hierarchy-children" role="list">
          {children.map((child) => (
            <TaskItem
              key={child.task.taskId}
              node={child}
              level={level + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onDelete={onDelete}
              canDelete={canDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ delete dialog */

const BLOCKER_LABELS: Record<string, string> = {
  HAS_DESCENDANTS: 'delete.blocker.HAS_DESCENDANTS',
  HAS_TASKS: 'delete.blocker.HAS_TASKS',
  AUDIT_HISTORY: 'delete.blocker.AUDIT_HISTORY',
  PUBLISHED: 'delete.blocker.PUBLISHED',
  RECORDED_EFFORT: 'delete.blocker.RECORDED_EFFORT',
  APPROVALS: 'delete.blocker.APPROVALS',
  REQUESTS: 'delete.blocker.REQUESTS',
  NOTIFICATIONS: 'delete.blocker.NOTIFICATIONS',
  DEADLINE_HISTORY: 'delete.blocker.DEADLINE_HISTORY',
  SCHEDULE_CONFIRMATIONS: 'delete.blocker.SCHEDULE_CONFIRMATIONS',
  ACTIVE_WORKFLOW: 'delete.blocker.ACTIVE_WORKFLOW',
  ARCHIVED_RECORD: 'delete.blocker.ARCHIVED_RECORD',
  DEPENDENCY_REFERENCED: 'delete.blocker.DEPENDENCY_REFERENCED',
  NOT_FOUND_OR_DELETED: 'delete.blocker.NOT_FOUND_OR_DELETED'
};

export function DeleteEntityDialog({
  entityType,
  entityId,
  entityName,
  onClose,
  onDeleted,
  onRevealChildren
}: {
  entityType: 'TASKS' | 'SUBPROJECTS';
  entityId: string;
  entityName: string;
  onClose: () => void;
  onDeleted: () => void;
  onRevealChildren?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [preflight, setPreflight] = useState<DeletionPreflight | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    let current = true;
    setPreflight(null);
    setLoadError(null);
    api
      .get<DeletionPreflight>(
        `/api/manager/removal/preflight?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`
      )
      .then((value) => {
        if (current) setPreflight(value);
      })
      .catch((error: unknown) => {
        if (current) setLoadError(error);
      });
    return () => {
      current = false;
    };
  }, [entityType, entityId]);

  const deletable = preflight?.deletable === true;
  const canSubmit = deletable && !!preflight && !busy;

  const submit = async (): Promise<void> => {
    if (!canSubmit || !preflight) return;
    setBusy(true);
    setFailure(null);
    try {
      const path = entityType === 'TASKS' ? 'tasks' : 'subprojects';
      await api.post(`/api/admin/${path}/${entityId}/remove`, {
        revision: preflight.revision,
        confirmed: true
      });
      onDeleted();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('delete.confirmTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </button>
          {onRevealChildren && preflight && !deletable ? (
            <button type="button" className="button secondary" onClick={onRevealChildren}>
              {t('delete.revealChildren')}
            </button>
          ) : null}
          <button
            type="button"
            className="button danger"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? t('state.saving') : t('delete.submit')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small">
          <span className="muted">{t('delete.target')}: </span>
          <strong>{entityName}</strong>
        </p>
        {!preflight && !loadError ? <p role="status">{t('delete.checking')}</p> : null}
        <ErrorBox error={loadError} />
        {preflight ? (
          deletable ? (
            <>
              <p>{t(entityType === 'TASKS' ? 'delete.confirmTask' : 'delete.confirmSubproject')}</p>
              <div className="banner info">{t('delete.allowed')}</div>
            </>
          ) : (
            <div className="banner warning">
              <strong>{t('delete.blocked')}</strong>
              <ul>
                {preflight.blockers.map((blocker) => (
                  <li key={blocker.code}>
                    {t(BLOCKER_LABELS[blocker.code] ?? 'delete.blocker.generic')}
                    <span className="muted small"> — {blocker.detail}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">{t('delete.blockedHint')}</p>
            </div>
          )
        ) : null}
        <ErrorBox error={failure} />
        {failure instanceof ApiFailure && failure.isConflict ? (
          <p className="muted small">{t('delete.staleRevision')}</p>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ screen */

export function ProjectDetailScreen({
  actor,
  projectId,
  readOnly = false
}: {
  actor: Actor;
  projectId: string;
  readOnly?: boolean;
}): JSX.Element {
  const { t, label } = useI18n();
  const endpoint = readOnly ? `/api/work/projects/${projectId}` : `/api/manager/projects/${projectId}`;
  // The manager detail shares the `manager/projects` prefix so any project save invalidates it;
  // the read-only projection gets its own key and never collides with the picker payload.
  const cacheKey = readOnly ? `work/project/${projectId}` : keys.project(projectId);
  const detail = useQuery<ManagerDetail | ReadOnlyDetail>(cacheKey, () => api.get<ManagerDetail | ReadOnlyDetail>(endpoint));
  const canManage = !readOnly && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
  const canDelete = !readOnly && actor.role === 'ADMIN';
  const [editProject, setEditProject] = useState(false);
  const [editingSubproject, setEditingSubproject] = useState<Subproject | null>(null);
  const [newSubprojectParent, setNewSubprojectParent] = useState<string | null | undefined>(undefined);
  const [newTaskSubproject, setNewTaskSubproject] = useState<string | null | undefined>(undefined);
  const [includeInactive, setIncludeInactive] = useRouteMemoryState(`project:${projectId}:inactive`, false);
  const [collapsed, setCollapsed] = useRouteMemoryState<Set<string>>(
    `project:${projectId}:collapsed`,
    () => new Set()
  );
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
      keys.references,
      keys.tasks,
      keys.overview,
      keys.taskIndex,
      keys.myWork,
      keys.workload,
      // The read-only projection and the employee lists show the same records.
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
        parentSubprojectId: subproject.parentSubprojectId ?? null,
        status: subproject.status,
        deadline: subproject.deadline,
        depth: subproject.depth,
        revision: (subproject as Subproject).revision
      })),
      tasks: source.tasks,
      includeInactive
    });
  }, [detail.data, includeInactive]);

  if (detail.error) return <ErrorBox error={detail.error} onRetry={() => detail.refresh()} />;
  if (!detail.data || !hierarchy) return <p className="muted">{t('state.loading')}</p>;
  const view = toViewModel(detail.data);
  const { record } = view;

  const editTarget = (node: SubprojectNode): Subproject => {
    const source = view.subprojects.find((subproject) => subproject.subprojectId === node.subprojectId);
    return (source ?? (node as unknown as Subproject)) as Subproject;
  };

  return (
    <div className="screen" style={{ ['--project-accent' as string]: projectColor(record.projectId) }}>
      <BackButton
        actor={actor}
        fallback={actor.role === 'ADMIN' || actor.role === 'MANAGER' ? 'projects' : 'all-work'}
        disabled={
          editProject ||
          editingSubproject !== null ||
          newSubprojectParent !== undefined ||
          newTaskSubproject !== undefined ||
          deleteTarget !== null
        }
      />
      <div className="screen-header">
        <div>
          <h2>
            <span className="project-dot" style={{ background: projectColor(record.projectId) }} aria-hidden="true" />
            {record.projectName}
          </h2>
          <p className="muted small">
            {record.projectId} · {record.responsibilityName || t('overview.unassigned')} ·{' '}
            {record.projectOwnerName || t('common.unset')}
          </p>
        </div>
        <div className="filters">
          {canManage && (
            <button type="button" className="button secondary" onClick={() => setEditProject(true)}>
              {t('projects.edit')}
            </button>
          )}
          <Badge tone={statusTone(record.status)}>{label('project.status', record.status)}</Badge>
          {canManage ? (
            <Badge tone={(record as Project).dashboardVisibility === 'INTERNAL' ? 'ok' : 'neutral'}>
              {(record as Project).dashboardVisibility}
            </Badge>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="banner ok" role="status">
          {notice}
        </div>
      ) : null}

      <Section title={t('projects.progress')}>
        <ProgressBar value={view.progress.percent} />
        <p className="muted small">
          {t('projects.tasks')}: {view.progress.leaves} · {t('overview.completed')}: {view.progress.doneLeaves}
        </p>
      </Section>

      <ProjectHierarchy
        hierarchy={hierarchy}
        canManage={canManage}
        canDelete={canDelete}
        includeInactive={includeInactive}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onToggleInactive={(value) => setIncludeInactive(value)}
        onNewTask={(subprojectId) => setNewTaskSubproject(subprojectId)}
        onNewSubproject={(parentSubprojectId) => setNewSubprojectParent(parentSubprojectId)}
        onEditSubproject={(node) => setEditingSubproject(editTarget(node))}
        onDelete={(entityType, entityId, entityName) => setDeleteTarget({ entityType, entityId, entityName })}
      />

      {canManage && view.milestones ? (
        <Section title={t('projects.milestones')}>
          {view.milestones.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="list">
              {view.milestones.map((milestone) => (
                <li key={milestone.milestone_id}>
                  {milestone.milestone_name} · {milestone.target_date ?? t('common.unset')} · {milestone.status}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {canManage && view.phases ? (
        <Section title={t('projects.phases')}>
          {view.phases.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="list">
              {view.phases.map((phase) => (
                <li key={phase.project_phase_id}>
                  {phase.phase_name} · {phase.planned_start ?? t('common.unset')} → {phase.planned_end ?? t('common.unset')} ·{' '}
                  <Badge tone={phase.status === 'PLANNED' ? 'ok' : 'warn'}>{phase.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

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

      {editingSubproject && canManage ? (
        <SubprojectForm
          projectId={projectId}
          item={editingSubproject}
          siblings={view.subprojects as unknown as Subproject[]}
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
          initialParentSubprojectId={newSubprojectParent}
          siblings={view.subprojects as unknown as Subproject[]}
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
          references={references.data}
          onClose={() => setNewTaskSubproject(undefined)}
          onSaved={() => {
            setNewTaskSubproject(undefined);
            refresh();
          }}
        />
      ) : null}

      {deleteTarget && canDelete ? (
        <DeleteEntityDialog
          entityType={deleteTarget.entityType}
          entityId={deleteTarget.entityId}
          entityName={deleteTarget.entityName}
          onClose={() => setDeleteTarget(null)}
          onRevealChildren={() => {
            const type = deleteTarget.entityType === 'TASKS' ? 'task' : 'sub';
            expandKeys([`${type}:${deleteTarget.entityId}`]);
            setDeleteTarget(null);
            // The expanded children render on the next frame; scroll to the row afterwards.
            window.setTimeout(() => {
              document.getElementById(`hierarchy-${deleteTarget.entityId}`)?.scrollIntoView?.({ block: 'center' });
            }, 0);
          }}
          onDeleted={() => {
            setDeleteTarget(null);
            setNotice(t('delete.done'));
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
