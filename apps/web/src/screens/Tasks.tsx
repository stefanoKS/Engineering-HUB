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
import { TaskAssigneePicker } from '../components/TaskAssigneePicker';
import { useEditorState } from '../state/editor';
/** Task list: server-side filtering and paging, narrow rows, one form for create and edit. */
import { Fragment, useState } from 'react';
import type { Actor, Reference, Task, TaskDetail, TaskSummary } from '@eh/contracts';
import { api, queryString, ApiFailure } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { commitMutation } from '../state/mutation';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Menu, Pagination } from '../components/ui';
import { DeleteEntityDialog } from '../components/DeleteEntityDialog';
import { DeadlineCell } from '../components/deadline';
import { TaskStatusBadge, WorkflowHint, taskStatusTone } from '../components/task-status';
import { ConfirmDialog, type ReloadOutcome } from '../components/forms';
import { TaskForm } from './TaskForm';
import { MAX_TASK_DEPTH, projectColor } from '@eh/domain';
import { useRouteMemoryState } from '../state/navigation';
import { useDivisionScope } from '../state/division';
import { useDivisionTransition } from '../state/scope';
import { capabilitiesOf, canEditRecord, hasWritableDestination } from '../state/capabilities';
import { DebouncedSearchInput } from '../components/search-input';

type Page = { items: TaskSummary[]; matchedTotal?: number; total: number; page: number; pageSize: number; totalPages: number };
/**
 * The authoritative fields a completion confirmation needs. It is rebuilt from the record-by-id
 * read after a conflict, so a second confirmation never resubmits a superseded revision.
 */
type TaskActionTarget = {
  taskId: string;
  taskName: string;
  projectId: string;
  revision: number;
  status: TaskSummary['status'];
  container: boolean;
};
type References = {
  responsibilities?: { id: string; name: string; status: string }[];
  members: { memberId: string; name: string; active: boolean; employeeId?: string; role?: string }[];
  skills: { skillId: string; skillName: string }[];
  subprojects: Reference[];
};

/** Every displayed schedule state a manager can filter by; the server resolves them. */
const DISPLAY_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'OVERDUE',
  'START_NOT_SET',
  'DATES_NOT_SET',
  'INVALID_DATES',
  'DONE',
  'CANCELLED'
] as const;
const NAVIGATION_FILTERS = ['workState', 'displayStatus', 'responsibilityId', 'unassigned'] as const;
type TaskSort = 'dueDate' | 'name' | 'project' | 'owner' | 'status' | 'priority' | 'updated';

export function taskNavigationFilters(search: string): {
  explicit: boolean;
  workState: '' | 'OPEN';
  displayStatus: '' | (typeof DISPLAY_STATUSES)[number];
  responsibilityId: string;
  unassigned: boolean;
  dueFrom: string;
  dueTo: string;
} {
  const params = new URLSearchParams(search);
  const rawStatus = params.get('displayStatus') ?? '';
  const date = (value: string | null): string => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value! : '');
  return {
    explicit: NAVIGATION_FILTERS.some((key) => params.has(key)) || params.has('dueFrom') || params.has('dueTo'),
    workState: params.get('workState') === 'OPEN' ? 'OPEN' : '',
    displayStatus: DISPLAY_STATUSES.includes(rawStatus as (typeof DISPLAY_STATUSES)[number])
      ? (rawStatus as (typeof DISPLAY_STATUSES)[number])
      : '',
    responsibilityId: (params.get('responsibilityId') ?? '').slice(0, 64),
    unassigned: params.get('unassigned') === 'true',
    dueFrom: date(params.get('dueFrom')),
    dueTo: date(params.get('dueTo'))
  };
}

export function displayTone(status: TaskSummary['displayStatus']): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  return taskStatusTone(status);
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
  const { selected: selectedDivision } = useDivisionScope();
  const memoryKey = readOnly ? 'all-work:read' : 'all-work:manager';
  const navigation = taskNavigationFilters(routeSearch);
  const reset = { resetToInitial: navigation.explicit };
  const [projectId, setProjectId] = useRouteMemoryState(`${memoryKey}:project`, '', reset);
  const [assigneeMemberId, setAssigneeMemberId] = useRouteMemoryState(`${memoryKey}:assignee`, '', reset);
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
  // A drilldown from the overview carries its deadline window, so the list answers the same
  // question the card counted. The window is applied on the server before paging and totals.
  const [dueFrom, setDueFrom] = useRouteMemoryState(`${memoryKey}:dueFrom`, navigation.dueFrom, reset);
  const [dueTo, setDueTo] = useRouteMemoryState(`${memoryKey}:dueTo`, navigation.dueTo, reset);
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
  // The scope-transition policy: a division change starts the list again at page 1 and drops every
  // selection the new scope cannot be shown to contain. The sort order and the search text are
  // independent of the scope and survive; a selection that a still-loading reference read has not
  // yet confirmed is not evidence of incompatibility on its own.
  useDivisionTransition(() => {
    setPage(1);
    setExpanded(new Set());
    setProjectId('');
    setResponsibilityId('');
    setUnassigned(false);
    setAssigneeMemberId('');
  });
  const [editing, setEditing, loadEditor, editorError, editorLoading] = useEditorState<{ mode: 'create' } | { mode: 'edit'; detail: TaskDetail } | null>(null);
  const [action, setAction] = useState<{ kind: 'override' | 'complete'; task: TaskActionTarget } | null>(null);
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
    assigneeMemberId,
    responsibilityId,
    unassigned,
    workState,
    displayStatus,
    query,
    includeInactive,
    sort,
    direction,
    page,
    dueFrom,
    dueTo,
    // The division switch narrows the server-resolved scope; it never widens it.
    divisionId: selectedDivision ?? undefined
  };
  const listKey = `${keyPrefix}${queryString({ ...filters, tree: true })}`;
  const list = useQuery<Page>(listKey, () =>
    api.get<Page>(
      `${endpoint}${queryString({ ...filters, pageSize: 25, tree: true })}`
    )
  );
  const canManage = !readOnly && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
  const divisionScope = useDivisionScope();
  // A new task needs a destination this account may write in; a role on its own is not one.
  const canCreate = canManage && hasWritableDestination(divisionScope);
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
  // `aria-sort` belongs on the header cell, so a screen reader announces the sorted column.
  const sortProps = (key: TaskSort): { 'aria-sort'?: 'ascending' | 'descending' | 'none' } => ({
    'aria-sort': sort === key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
  });

  async function openEdit(summary: TaskSummary): Promise<void> {
    await loadEditor(async () => ({ mode: 'edit', detail: await api.get<TaskDetail>(`/api/manager/tasks/${summary.taskId}`) }));
  }

  async function startDelete(summary: TaskSummary): Promise<void> {
    setDeleteTarget(summary);
  }

  /**
   * Re-reads the selected task by id after a conflict and replaces the revision the dialog will
   * submit. The row may have moved off the current page, so the list is never the source here.
   */
  async function reloadTaskAction(taskId: string): Promise<ReloadOutcome> {
    try {
      const detail = await api.get<TaskDetail>(`/api/manager/tasks/${taskId}`);
      const fresh: TaskActionTarget = {
        taskId: detail.record.taskId,
        taskName: detail.record.taskName,
        projectId: detail.record.projectId,
        revision: detail.record.revision,
        status: detail.record.status,
        // A task with children is a work container; it is never completed directly.
        container: detail.children.length > 0
      };
      if (detail.canWrite === false) {
        return { status: 'ineligible', message: t('capability.readOnlyRecordHelp') };
      }
      if (fresh.status === 'Done' || fresh.status === 'Cancelled') {
        return { status: 'ineligible', message: t('requests.decideAlreadySettled') };
      }
      if (fresh.container) {
        return { status: 'ineligible', message: t('tasks.containerCannotComplete') };
      }
      setAction((current) => (current && current.task.taskId === taskId ? { ...current, task: fresh } : current));
      return { status: 'fresh' };
    } catch (failure) {
      const code = failure instanceof ApiFailure ? failure.code : '';
      return {
        status: 'failed',
        message: code === 'NOT_FOUND' ? t('tasks.actionUnavailable') : t('common.error')
      };
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2>{t('nav.allWork')}</h2>
          <p className="muted small">{readOnly ? t('allWork.intro') : t('allWork.managerIntro')}</p>
        </div>
        {canCreate ? (
          <button type="button" className="button" onClick={() => setEditing({ mode: 'create' })}>
            {t('tasks.new')}
          </button>
        ) : canManage ? (
          <p className="muted small">{t('capability.noWritableDestination')}</p>
        ) : null}
      </div>

      <div className="compact-toolbar">
        <div className="field">
          <span className="field-label">{t('nav.projects')}</span>
          <ProjectPicker
            scope={readOnly ? 'read' : 'manager'}
            value={projectId}
            emptyLabel={t('filter.allProjects')}
            onChange={id => { setProjectId(id); setPage(1); }}
          />
        </div>
        <div className="field">
          <span className="field-label">{t('tasks.assigneeFilter')}</span>
          <TaskAssigneePicker value={assigneeMemberId} onChange={id => {
            setAssigneeMemberId(id);
            setPage(1);
            setExpanded(new Set());
          }} />
        </div>
        <label className="field">
          <span className="field-label">{t('filter.responsibility')}</span>
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
        </label>
        <label className="field">
          <span className="field-label">{t('column.status')}</span>
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
        </label>
        <DebouncedSearchInput
          className="grow"
          value={query}
          label={t('myWork.filter.task')}
          onApplied={(applied) => {
            setQuery(applied);
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
      </div>

      {editorLoading && <p role="status">{t('state.loading')}</p>}
      <ErrorBox error={editorError} />
      <ErrorBox error={list.error} onRetry={() => list.refresh()} />

      {dueFrom || dueTo ? (
        <p className="active-filter-summary" role="status">
          <span>{t('filter.deadlineWindow')}:</span>
          <span className="filter-chip">
            {dueFrom || '…'} – {dueTo || '…'}
          </span>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setDueFrom('');
              setDueTo('');
              setPage(1);
            }}
          >
            {t('query.clearFilters')}
          </button>
        </p>
      ) : null}

      {!list.data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : list.data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <table className="table task-table">
          <colgroup>
            <col />
            <col className="col-project" />
            <col className="col-owner" />
            <col className="col-status" />
            <col className="col-deadline" />
            {canManage ? <col className="col-actions" /> : null}
          </colgroup>
          <thead>
            <tr>
              <th {...sortProps('name')}>{sortHeader('name', t('column.name'))}</th>
              <th {...sortProps('project')}>{sortHeader('project', t('nav.projects'))}</th>
              <th {...sortProps('owner')}>{sortHeader('owner', t('column.owner'))}</th>
              <th {...sortProps('status')}>{sortHeader('status', t('column.status'))}</th>
              <th {...sortProps('dueDate')}>{sortHeader('dueDate', t('column.deadline'))}</th>
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

      {list.data ? <p className="muted small">{t('tasks.filteredTreeScope', { n: list.data.items.length, total: list.data.matchedTotal ?? list.data.total })}</p> : null}
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
          onReload={() => reloadTaskAction(action.task.taskId)}
          onConfirm={async ({ confirmation, reason }) => {
            // The revision the confirmation carries is the one currently shown, which a conflict
            // reload has replaced with the server's current value.
            const outcome = await commitMutation(
              () =>
                action.kind === 'complete'
                  ? api.post(`/api/manager/tasks/${action.task.taskId}/complete`, {
                      revision: action.task.revision,
                      confirmed: true,
                      note: reason || undefined
                    })
                  : api.post(`/api/manager/tasks/${action.task.taskId}/override-complete`, {
                      revision: action.task.revision,
                      reason,
                      confirmation
                    }),
              [
                keys.tasks,
                keys.task(action.task.taskId),
                keys.taskIndex,
                keys.overview,
                keys.project(action.task.projectId),
                keys.myWork,
                keys.parentOptions,
                keys.timeline
              ]
            );
            // A result from an ended session changes nothing on this screen.
            if (outcome.status !== 'committed') return;
            setAction(null);
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
    assigneeMemberId: string;
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
  const capabilities = capabilitiesOf(actor);
  const canManage = !readOnly && capabilities.canEdit;
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
                  {task.contextOnly ? <Badge>{t('tasks.contextOnly')}</Badge> : null}
                  {task.reviewState === 'PENDING' ? <Badge tone="warn">{t('tasks.review')}</Badge> : null}
                </td>
                <td className="muted small">{task.projectName}</td>
                <td>
                  {task.ownerName || t('common.unset')}
                  {task.assigneeNames.length ? <div className="muted small">{task.assigneeNames.join(', ')}</div> : null}
                </td>
                <td>
                  <TaskStatusBadge state={task.displayStatus} missing={task.scheduleMissing} showDetail />
                  <WorkflowHint status={task.status} />
                </td>
                <td><DeadlineCell dueDate={task.dueDate} state={task.displayStatus} showLabel={false} /></td>
                {canManage ? (
                  <td className="project-actions-cell">
                    <div className="actions">
                      {canEditRecord(capabilities, task) ? (
                        <>
                          <button type="button" className="button secondary row-action" onClick={() => void openEdit(task)}>
                            {t('action.edit')}
                          </button>
                          {/* Secondary row actions live in one menu, so the name, deadline and
                              status keep their width instead of competing with a row of buttons. */}
                          <Menu label={t('action.more')} className="row-menu">
                            {(close) => (
                              <>
                                {!task.container && task.displayStatus !== 'DONE' && task.displayStatus !== 'CANCELLED' ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="menu-item"
                                    onClick={() => {
                                      close();
                                      setAction({ kind: 'complete', task });
                                    }}
                                  >
                                    {t('tasks.completeDirect')}
                                  </button>
                                ) : null}
                                {actor.role === 'ADMIN' ? (
                                  <>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="menu-item"
                                      onClick={() => {
                                        close();
                                        setAction({ kind: 'override', task });
                                      }}
                                    >
                                      {t('tasks.override')}
                                    </button>
                                    <div className="menu-separator" role="separator" />
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="menu-item danger"
                                      onClick={() => {
                                        close();
                                        void startDelete(task);
                                      }}
                                    >
                                      {t('projects.delete')}
                                    </button>
                                  </>
                                ) : null}
                              </>
                            )}
                          </Menu>
                        </>
                      ) : (
                        <span className="read-only-record" title={t('capability.readOnlyRecordHelp')}>
                          {t('capability.readOnlyRecord')}
                        </span>
                      )}
                    </div>
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
