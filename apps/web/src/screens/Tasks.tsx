/**
 * All Work — すべてのタスク.
 *
 * One list for every role. A manager gets the management endpoint (edit, approve, complete,
 * remove); a MEMBER and a VIEWER get the read-only endpoint and no mutation control at all. The
 * server decides which endpoint answers, and it also re-checks the role: hiding a button is never
 * the authorization.
 *
 * Paging, filtering and the expandable tree stay server-side; a child branch is fetched only when
 * a parent is opened.
 */
import { ProjectPicker } from '../components/ProjectPicker';
import { useEditorState } from '../state/editor';
/** Task list: server-side filtering and paging, narrow rows, one form for create and edit. */
import { Fragment, useState } from 'react';
import type { Actor, Reference, Task, TaskDetail, TaskSummary } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Pagination } from '../components/ui';
import { DeleteEntityDialog } from '../components/DeleteEntityDialog';
import { DeadlineCell } from '../components/deadline';
import { ConfirmDialog } from '../components/forms';
import { TaskForm } from './TaskForm';
import { MAX_TASK_DEPTH, projectColor } from '@eh/domain';
import { useRouteMemoryState } from '../state/navigation';

type Page = { items: TaskSummary[]; matchedTotal?: number; total: number; page: number; pageSize: number; totalPages: number };
type References = {
  responsibilities?: { id: string; name: string; status: string }[];
  members: { memberId: string; name: string; active: boolean; employeeId?: string; role?: string }[];
  skills: { skillId: string; skillName: string }[];
  subprojects: Reference[];
};

const DISPLAY_STATUSES = ['IN_PROGRESS', 'OVERDUE', 'DONE'] as const;
const NAVIGATION_FILTERS = ['workState', 'displayStatus', 'responsibilityId', 'unassigned'] as const;
type TaskSort = 'dueDate' | 'name' | 'project' | 'owner' | 'status' | 'priority' | 'updated';

export function taskNavigationFilters(search: string): {
  explicit: boolean;
  workState: '' | 'OPEN';
  displayStatus: '' | (typeof DISPLAY_STATUSES)[number];
  responsibilityId: string;
  unassigned: boolean;
} {
  const params = new URLSearchParams(search);
  const rawStatus = params.get('displayStatus') ?? '';
  return {
    explicit: NAVIGATION_FILTERS.some((key) => params.has(key)),
    workState: params.get('workState') === 'OPEN' ? 'OPEN' : '',
    displayStatus: DISPLAY_STATUSES.includes(rawStatus as (typeof DISPLAY_STATUSES)[number])
      ? (rawStatus as (typeof DISPLAY_STATUSES)[number])
      : '',
    responsibilityId: (params.get('responsibilityId') ?? '').slice(0, 64),
    unassigned: params.get('unassigned') === 'true'
  };
}

export function displayTone(status: TaskSummary['displayStatus']): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  switch (status) {
    case 'DONE':
      return 'ok';
    case 'OVERDUE':
      return 'danger';
    case 'CANCELLED':
      return 'neutral';
    default:
      return 'info';
  }
}

export function TasksScreen({
  actor,
  readOnly = false,
  routeSearch = ''
}: {
  actor: Actor;
  readOnly?: boolean;
  routeSearch?: string;
}): JSX.Element {
  const { t } = useI18n();
  const memoryKey = readOnly ? 'all-work:read' : 'all-work:manager';
  const navigation = taskNavigationFilters(routeSearch);
  const reset = { resetToInitial: navigation.explicit };
  const [projectId, setProjectId] = useRouteMemoryState(`${memoryKey}:project`, '', reset);
  const [responsibilityId, setResponsibilityId] = useRouteMemoryState(
    `${memoryKey}:responsibility`,
    navigation.unassigned ? '' : navigation.responsibilityId,
    reset
  );
  const [unassigned, setUnassigned] = useRouteMemoryState(`${memoryKey}:unassigned`, navigation.unassigned, reset);
  const [workState, setWorkState] = useRouteMemoryState(`${memoryKey}:workState`, navigation.workState, reset);
  const [displayStatus, setDisplayStatus] = useRouteMemoryState(
    `${memoryKey}:status`,
    navigation.workState ? '' : navigation.displayStatus,
    reset
  );
  const [query, setQuery] = useRouteMemoryState(`${memoryKey}:query`, '', reset);
  const [includeInactive, setIncludeInactive] = useRouteMemoryState(`${memoryKey}:inactive`, false, reset);
  const [page, setPage] = useRouteMemoryState(`${memoryKey}:page`, 1, reset);
  const [sort, setSort] = useRouteMemoryState<TaskSort>(`${memoryKey}:sort`, 'dueDate', reset);
  const [direction, setDirection] = useRouteMemoryState<'asc' | 'desc'>(`${memoryKey}:direction`, 'asc', reset);
  const [expanded, setExpanded] = useRouteMemoryState<Set<string>>(`${memoryKey}:expanded`, () => new Set());
  const toggle = (id: string): void => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [editing, setEditing, loadEditor, editorError, editorLoading] = useEditorState<{ mode: 'create' } | { mode: 'edit'; detail: TaskDetail } | null>(null);
  const [action, setAction] = useState<{ kind: 'override' | 'complete'; task: TaskSummary } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskSummary | null>(null);

  const endpoint = readOnly ? '/api/work/tasks' : '/api/manager/tasks';
  const keyPrefix = readOnly ? 'work/tasks' : keys.tasks;
  const references = useQuery<References>(keys.references, () =>
    readOnly
      ? api
          .get<{ responsibilities: { responsibilityId: string; name: string }[] }>(
            '/api/work/projects?page=1&pageSize=1'
          )
          .then((result) => ({
            responsibilities: result.responsibilities.map((entry) => ({
              id: entry.responsibilityId,
              name: entry.name,
              status: 'Active'
            })),
            members: [],
            skills: [],
            subprojects: []
          }))
      : api.get<References>('/api/manager/references')
  );
  const filters = {
    projectId,
    responsibilityId,
    unassigned,
    workState,
    displayStatus,
    query,
    includeInactive,
    sort,
    direction,
    page
  };
  const listKey = `${keyPrefix}${queryString({ ...filters, tree: true })}`;
  const list = useQuery<Page>(listKey, () =>
    api.get<Page>(
      `${endpoint}${queryString({ ...filters, pageSize: 25, tree: true })}`
    )
  );
  const canManage = !readOnly && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
  const setSortOrder = (next: TaskSort): void => {
    setDirection(next === sort ? (direction === 'asc' ? 'desc' : 'asc') : 'asc');
    setSort(next);
    setPage(1);
  };
  const sortHeader = (key: TaskSort, text: string): JSX.Element => (
    <button type="button" className="table-sort" onClick={() => setSortOrder(key)} aria-label={`${text}: ${t('workload.sort.toggle')}`}>
      {text} {sort === key ? <span aria-hidden="true">{direction === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  );

  async function openEdit(summary: TaskSummary): Promise<void> {
    await loadEditor(async () => ({ mode: 'edit', detail: await api.get<TaskDetail>(`/api/manager/tasks/${summary.taskId}`) }));
  }

  async function startDelete(summary: TaskSummary): Promise<void> {
    setDeleteTarget(summary);
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2>{t('nav.allWork')}</h2>
          <p className="muted small">{readOnly ? t('allWork.intro') : t('allWork.managerIntro')}</p>
        </div>
        <div className="filters">
          <ProjectPicker scope={readOnly ? 'read' : 'manager'} value={projectId} onChange={id => { setProjectId(id); setPage(1); }} />
          <select
            value={unassigned ? '__unassigned__' : responsibilityId}
            onChange={(event) => {
              const value = event.target.value;
              setUnassigned(value === '__unassigned__');
              setResponsibilityId(value === '__unassigned__' ? '' : value);
              setProjectId('');
              setPage(1);
            }}
            aria-label={t('filter.responsibility')}
          >
            <option value="">{t('filter.all')}</option>
            {(references.data?.responsibilities ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
            <option value="__unassigned__">{t('overview.unassigned')}</option>
          </select>
          <select
            value={workState || displayStatus}
            onChange={(event) => {
              const value = event.target.value;
              setWorkState(value === 'OPEN' ? 'OPEN' : '');
              setDisplayStatus(
                value !== 'OPEN' && DISPLAY_STATUSES.includes(value as (typeof DISPLAY_STATUSES)[number])
                  ? (value as (typeof DISPLAY_STATUSES)[number])
                  : ''
              );
              setPage(1);
            }}
            aria-label={t('column.status')}
          >
            <option value="">{t('filter.all')}</option>
            <option value="OPEN">{t('overview.openWork')}</option>
            {DISPLAY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`taskStatus.${value}`)}
              </option>
            ))}
          </select>
          <input
            placeholder={t('filter.query')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
          {canManage ? (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => {
                  setIncludeInactive(event.target.checked);
                  setPage(1);
                }}
              />
              {t('tasks.includeInactive')}
            </label>
          ) : null}
          {canManage ? (
            <button type="button" className="button" onClick={() => setEditing({ mode: 'create' })}>
              {t('tasks.new')}
            </button>
          ) : null}
        </div>
      </div>

      {editorLoading && <p role="status">{t('state.loading')}</p>}
      <ErrorBox error={editorError} />
      <ErrorBox error={list.error} onRetry={() => list.refresh()} />

      {!list.data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : list.data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{sortHeader('name', t('column.name'))}</th>
              <th>{sortHeader('project', t('nav.projects'))}</th>
              <th>{sortHeader('owner', t('column.owner'))}</th>
              <th>{sortHeader('status', t('column.status'))}</th>
              <th>{sortHeader('dueDate', t('column.deadline'))}</th>
              {canManage ? <th>{t('column.actions')}</th> : null}
            </tr>
          </thead>
          <tbody>
            <TaskTreeRows
              items={list.data.items}
              actor={actor}
              readOnly={readOnly}
              expanded={expanded}
              toggle={toggle}
              filters={filters}
              endpoint={endpoint}
              keyPrefix={keyPrefix}
              openEdit={openEdit}
              setAction={setAction}
              startDelete={startDelete}
            />
          </tbody>
        </table>
      )}

      {list.data ? <p className="muted small">{t('allWork.scope', { n: list.data.items.length, total: list.data.matchedTotal ?? list.data.total })}</p> : null}
      {list.data ? (
        <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onChange={setPage} />
      ) : null}

      {editing ? (
        <TaskForm
          task={editing.mode === 'edit' ? editing.detail.record : undefined}
          detail={editing.mode === 'edit' ? editing.detail : undefined}
          context={
            editing.mode === 'edit'
              ? {
                  projectName: editing.detail.context.projectName,
                  subprojectPath: editing.detail.context.subprojects.map((entry) => entry.subprojectName).join(' / ')
                }
              : undefined
          }
          references={references.data}
          onClose={() => setEditing(null)}
          onSaved={(task: Task) => {
            setEditing(null);
            void task;
          }}
        />
      ) : null}

      {action ? (
        <ConfirmDialog
          title={
            action.kind === 'complete'
                  ? t('tasks.completeDirectTitle')
                  : t('tasks.override')
          }
          message={action.kind === 'complete' ? t('tasks.completeDirectBody') : action.task.taskName}
          confirmText={action.kind === 'override' ? `COMPLETE ${action.task.taskId}` : undefined}
          reasonRequired={action.kind === 'override'}
          destructive={action.kind === 'override'}
          onCancel={() => setAction(null)}
          onConfirm={async ({ confirmation, reason }) => {
            if (action.kind === 'complete') {
              await api.post(`/api/manager/tasks/${action.task.taskId}/complete`, {
                revision: action.task.revision,
                confirmed: true,
                note: reason || undefined
              });
            } else {
              await api.post(`/api/manager/tasks/${action.task.taskId}/override-complete`, {
                revision: action.task.revision,
                reason,
                confirmation
              });
            }
            setAction(null);
            queryCache.invalidate([
              keys.tasks,
              keys.task(action.task.taskId),
              keys.taskIndex,
              keys.overview,
              keys.project(action.task.projectId),
              keys.myWork,
              keys.parentOptions,
              keys.timeline
            ]);
          }}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteEntityDialog
          entityType="TASKS"
          entityId={deleteTarget.taskId}
          entityName={deleteTarget.taskName}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            const removed = deleteTarget;
            setDeleteTarget(null);
            queryCache.invalidate([
              keys.tasks,
              keys.task(removed.taskId),
              keys.taskIndex,
              keys.overview,
              keys.project(removed.projectId),
              keys.myWork,
              keys.workload,
              keys.employee,
              keys.parentOptions,
              keys.timeline,
              'work/tasks',
              'work/project/',
              'work/projects'
            ]);
          }}
        />
      ) : null}
    </div>
  );
}

type TreeProps = {
  actor: Actor;
  readOnly: boolean;
  endpoint: string;
  keyPrefix: string;
  expanded: Set<string>;
  toggle: (id: string) => void;
  filters: {
    projectId: string;
    responsibilityId: string;
    unassigned: boolean;
    workState: string;
    displayStatus: string;
    query: string;
    includeInactive: boolean;
    sort: TaskSort;
    direction: 'asc' | 'desc';
    page: number;
  };
  openEdit: (task: TaskSummary) => Promise<void>;
  startDelete: (task: TaskSummary) => Promise<void>;
  setAction: (action: { kind: 'override' | 'complete'; task: TaskSummary }) => void;
};

function TaskTreeRows(props: TreeProps & { items: TaskSummary[] }): JSX.Element {
  const { actor, readOnly, expanded, toggle, openEdit, startDelete, setAction } = props;
  const { t } = useI18n();
  const canManage = !readOnly && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
  const columnCount = canManage ? 6 : 5;
  return <>{props.items.map(task => <Fragment key={task.taskId}>
              <tr data-task-id={task.taskId} style={{ ['--project-accent' as string]: projectColor(task.projectId) }}>
                <td style={{ paddingLeft: `${12 + Math.max(0, task.depth - 1) * 24}px` }}>
                  {task.container ? <button type="button" className="link-button task-tree-toggle"
                    aria-expanded={expanded.has(task.taskId)}
                    aria-label={t(expanded.has(task.taskId) ? 'tasks.collapseBranch' : 'tasks.expandBranch', { name: task.taskName })}
                    onClick={() => toggle(task.taskId)}>{expanded.has(task.taskId) ? '▾' : '▸'}</button> : <span className="task-tree-spacer" />}
                  <span className="project-dot" style={{ background: projectColor(task.projectId) }} aria-hidden="true" />
                  <span>
                    <a href={`#/task/${task.taskId}`}>{task.taskName}</a>
                  </span>
                  {task.container ? <Badge>{t('request.container')}</Badge> : null}
                  {task.reviewState === 'PENDING' ? <Badge tone="warn">{t('tasks.review')}</Badge> : null}
                </td>
                <td className="muted small">{task.projectName}</td>
                <td>
                  {task.ownerName || t('common.unset')}
                  {task.assigneeNames.length ? <div className="muted small">{task.assigneeNames.join(', ')}</div> : null}
                </td>
                <td>
                  <Badge tone={displayTone(task.displayStatus)}>{t(`taskStatus.${task.displayStatus}`)}</Badge>
                </td>
                <td><DeadlineCell dueDate={task.dueDate} displayStatus={task.displayStatus} showLabel={false} /></td>
                {canManage ? (
                  <td className="actions">
                    <button type="button" className="link-button" onClick={() => void openEdit(task)}>
                      {t('action.edit')}
                    </button>
                    {!task.container && task.displayStatus !== 'DONE' && task.displayStatus !== 'CANCELLED' ? (
                      <button type="button" className="link-button" onClick={() => setAction({ kind: 'complete', task })}>
                        {t('tasks.completeDirect')}
                      </button>
                    ) : null}
                    {actor.role === 'ADMIN' ? (
                      <>
                        <button type="button" className="link-button" onClick={() => setAction({ kind: 'override', task })}>
                          {t('tasks.override')}
                        </button>
                        <button type="button" className="link-button danger" onClick={() => void startDelete(task)}>
                          {t('projects.delete')}
                        </button>
                      </>
                    ) : null}
                  </td>
                ) : null}
              </tr>
    {task.container && task.depth < MAX_TASK_DEPTH && expanded.has(task.taskId) ? <TaskChildren key={task.taskId + JSON.stringify(props.filters)} {...props} parent={task} columnCount={columnCount} /> : null}
  </Fragment>)}</>;
}

function TaskChildren(props: TreeProps & { parent: TaskSummary; columnCount: number }): JSX.Element {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const query = queryString({ ...props.filters, tree: true, treeParentId: props.parent.taskId, page, pageSize: 25 });
  const children = useQuery<Page>(props.keyPrefix + query, () => api.get<Page>(props.endpoint + query));
  return <>
    {children.data ? <TaskTreeRows {...props} items={children.data.items} /> : null}
    <tr><td colSpan={props.columnCount} className="task-tree-footer">
      <ErrorBox error={children.error} onRetry={children.refresh} />
      {!children.data && !children.error ? <span role="status">{t('state.loading')}</span> : null}
      {children.data ? <>
        <span className="muted small">{t('tasks.childScope', { name: props.parent.taskName, n: children.data.total })}</span>
        {children.data.totalPages > 1 ? <Pagination page={page} totalPages={children.data.totalPages} total={children.data.total} onChange={setPage} /> : null}
      </> : null}
    </td></tr>
  </>;
}
