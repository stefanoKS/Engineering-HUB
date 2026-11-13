import { MemberWorkEditor } from '../components/MemberWorkEditor';
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
import { useCallback, useMemo, useState } from 'react';
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
import { projectColor } from '@eh/domain';
import { BackButton, useRouteMemoryState } from '../state/navigation';
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

  const byName = (a: HierarchySubproject, b: HierarchySubproject): number =>
    a.subprojectName.localeCompare(b.subprojectName, 'ja') || a.subprojectId.localeCompare(b.subprojectId);

  const buildSubproject = (subproject: HierarchySubproject): SubprojectNode => {
    const tasks = taskTreeOf(subproject.subprojectId);
    const children: SubprojectNode[] = [];
    const counts = countsOfNodes(tasks);
    return {
      ...subproject,
      revision: subproject.revision ?? null,
      tasks,
      children,
      counts
    };
  };

  // Legacy parent links remain stored for archival eligibility, but normal navigation is flat.
  const subprojects = visibleSubprojects.slice().sort(byName).map(buildSubproject);
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
};

export function ProjectHierarchy(props: HierarchyProps): JSX.Element {
  const { t } = useI18n();
  const { hierarchy, canManage, canRemoveRecord, canCreateTask, canCreateSubproject } = props;
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
      {isEmpty ? <EmptyState text={t('hierarchy.empty')} /> : null}
      {hierarchy.hiddenTasks > 0 ? (
        <p className="muted small">{t('hierarchy.hiddenTasks', { n: hierarchy.hiddenTasks })}</p>
      ) : null}
      {isEmpty ? null : (
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
            onDelete={props.onDelete}
            canManage={props.canEditSubproject ?? canManage}
            canCreateTask={canCreateTask}
            canRemoveRecord={canRemoveRecord}
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
            {canCreateTask ? (
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
                  canRemoveRecord={canRemoveRecord}
                />
              ))}
            </ul>
          )}
        </li>
      </ul>
      )}
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
  onDelete,
  canManage,
  canCreateTask,
  canRemoveRecord
}: {
  node: SubprojectNode;
  level: number;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  onEdit: (subproject: SubprojectNode) => void;
  onNewTask: (subprojectId: string | null) => void;
  onDelete: (entityType: 'TASKS' | 'SUBPROJECTS', entityId: string, entityName: string) => void;
  canManage: boolean;
  canCreateTask: boolean;
  canRemoveRecord: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const key = `sub:${node.subprojectId}`;
  const open = !collapsed.has(key);
  const description = (node.description ?? '').trim();
  const [expanded, setExpanded] = useState(false);
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
        <ScheduleBadge schedule={node.schedule} />
        {node.deadline ? (
          <DeadlineCell dueDate={node.deadline} state={deadlineStateOf(node.schedule)} showLabel={false} />
        ) : null}
        <span className="hierarchy-counts">{t('hierarchy.counts', { active: node.counts.active, done: node.counts.done })}</span>
        {canManage || canCreateTask ? (
          <span className="hierarchy-actions">
            {canCreateTask ? (
              <button type="button" className="link-button" onClick={() => onNewTask(node.subprojectId)}>
                {t('tasks.new')}
              </button>
            ) : null}
            {canManage ? (
              <button type="button" className="link-button" onClick={() => onEdit(node)}>
                {t('action.edit')}
              </button>
            ) : null}
            {canRemoveRecord ? (
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
      {description ? (
        <div className="hierarchy-description" style={{ ['--level' as string]: level }}>
          <p className={expanded ? 'description-text' : 'description-preview'}>{description}</p>
          <button
            type="button"
            className="link-button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {t(expanded ? 'subprojects.hideDetails' : 'subprojects.details')}
          </button>
        </div>
      ) : null}
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
                canRemoveRecord={canRemoveRecord}
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
                onDelete={onDelete}
                canManage={canManage}
                canCreateTask={canCreateTask}
                canRemoveRecord={canRemoveRecord}
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
  canRemoveRecord
}: {
  node: TaskNode;
  level: number;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  onDelete: (entityType: 'TASKS' | 'SUBPROJECTS', entityId: string, entityName: string) => void;
  canRemoveRecord: boolean;
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
        <DeadlineCell dueDate={task.dueDate} state={task.displayStatus} showLabel={false} />
        <TaskStatusBadge state={task.displayStatus} missing={task.scheduleMissing} showDetail />
        <WorkflowHint status={task.status} />
        {canRemoveRecord ? (
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
              canRemoveRecord={canRemoveRecord}
            />
          ))}
        </ul>
      ) : null}
    </li>
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
      includeInactive
    });
  }, [detail.data, includeInactive]);

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
    <div className="screen" style={{ ['--project-accent' as string]: projectColor(record.projectId) }}>
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
          {canCreateTask ? (
            <button type="button" className="button" onClick={() => setMemberTaskSubproject(null)}>
              {t('myWork.newTask')}
            </button>
          ) : null}
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
        <div>
          <dt>{t('projects.progress')}</dt>
          <dd>
            <ProgressBar value={view.progress.percent} />
            <span className="muted small">
              {view.progress.doneLeaves}/{view.progress.leaves}
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
        onToggleInactive={(value) => setIncludeInactive(value)}
        onNewTask={(subprojectId) =>
          canManage ? setNewTaskSubproject(subprojectId) : setMemberTaskSubproject(subprojectId)
        }
        onNewSubproject={() => (canManage ? setNewSubprojectParent(null) : setMemberSubproject(true))}
        onEditSubproject={(node) => setEditingSubproject(editTarget(node))}
        onDelete={(entityType, entityId, entityName) => setDeleteTarget({ entityType, entityId, entityName })}
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

      <Section title={t('projects.progress')}>
        <ProgressBar value={view.progress.percent} />
        <p className="muted small">
          {t('projects.tasks')}: {view.progress.leaves} · {t('overview.completed')}: {view.progress.doneLeaves}
        </p>
      </Section>


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
