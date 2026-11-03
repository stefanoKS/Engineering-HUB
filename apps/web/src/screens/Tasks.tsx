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
import { ConfirmDialog } from '../components/forms';
import { TaskForm } from './TaskForm';
import { MAX_TASK_DEPTH, projectColor } from '@eh/domain';

type Page = { items: TaskSummary[]; matchedTotal?: number; total: number; page: number; pageSize: number; totalPages: number };
type References = {
  members: { memberId: string; name: string; active: boolean; employeeId?: string; role?: string }[];
  skills: { skillId: string; skillName: string }[];
  subprojects: Reference[];
};

const DISPLAY_STATUSES = ['IN_PROGRESS', 'OVERDUE', 'DONE'] as const;

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

export function TasksScreen({ actor, readOnly = false }: { actor: Actor; readOnly?: boolean }): JSX.Element {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState('');
  const [displayStatus, setDisplayStatus] = useState('');
  const [query, setQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string): void => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [editing, setEditing, loadEditor, editorError, editorLoading] = useEditorState<{ mode: 'create' } | { mode: 'edit'; detail: TaskDetail } | null>(null);
  const [action, setAction] = useState<{ kind: 'approve' | 'confirm' | 'override' | 'complete'; task: TaskSummary } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ task: TaskSummary; confirmation: string; blockers: string[] } | null>(null);

  const endpoint = readOnly ? '/api/work/tasks' : '/api/manager/tasks';
  const keyPrefix = readOnly ? 'work/tasks' : keys.tasks;
  const references = useQuery<References>(keys.references, () =>
    readOnly
      ? Promise.resolve({ members: [], skills: [], subprojects: [] })
      : api.get<References>('/api/manager/references')
  );
  const filters = { projectId, displayStatus, query, includeInactive, page };
  const listKey = `${keyPrefix}${queryString({ ...filters, tree: true })}`;
  const list = useQuery<Page>(listKey, () =>
    api.get<Page>(
      `${endpoint}${queryString({ ...filters, pageSize: 25, tree: true })}`
    )
  );
  const canManage = !readOnly && (actor.role === 'ADMIN' || actor.role === 'MANAGER');

  async function openEdit(summary: TaskSummary): Promise<void> {
    await loadEditor(async () => ({ mode: 'edit', detail: await api.get<TaskDetail>(`/api/manager/tasks/${summary.taskId}`) }));
  }

  async function startDelete(summary: TaskSummary): Promise<void> {
    const preflight = await api.get<{ confirmationText: string; blockers: { code: string; detail: string }[] }>(
      `/api/manager/deletion/preflight${queryString({ entityType: 'TASKS', entityId: summary.taskId })}`
    );
    setDeleteTarget({
      task: summary,
      confirmation: preflight.confirmationText,
      blockers: preflight.blockers.map((blocker) => `${blocker.code}: ${blocker.detail}`)
    });
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2>{t('nav.allWork')}</h2>
          <p className="muted small">{readOnly ? t('allWork.intro') : t('allWork.managerIntro')}</p>
        </div>
        <div className="filters">
          <ProjectPicker value={projectId} onChange={id => { setProjectId(id); setPage(1); }} />
          <select
            value={displayStatus}
            onChange={(event) => {
              setDisplayStatus(event.target.value);
              setPage(1);
            }}
            aria-label={t('column.status')}
          >
            <option value="">{t('filter.all')}</option>
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
              <th>{t('column.name')}</th>
              <th>{t('nav.projects')}</th>
              <th>{t('column.owner')}</th>
              <th>{t('column.status')}</th>
              <th>{t('column.deadline')}</th>
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
            action.kind === 'approve'
              ? t('tasks.approve')
              : action.kind === 'confirm'
                ? t('tasks.confirmSchedule')
                : action.kind === 'complete'
                  ? t('tasks.completeDirectTitle')
                  : t('tasks.override')
          }
          message={action.kind === 'complete' ? t('tasks.completeDirectBody') : action.task.taskName}
          confirmText={action.kind === 'override' ? `COMPLETE ${action.task.taskId}` : undefined}
          reasonRequired={action.kind === 'override'}
          destructive={action.kind === 'override'}
          onCancel={() => setAction(null)}
          onConfirm={async ({ confirmation, reason }) => {
            if (action.kind === 'approve') {
              await api.post(`/api/manager/tasks/${action.task.taskId}/approve`, {
                revision: action.task.revision,
                confirmed: true
              });
            } else if (action.kind === 'confirm') {
              await api.post(`/api/manager/tasks/${action.task.taskId}/confirm-schedule`, {
                revision: action.task.revision,
                confirmed: true
              });
            } else if (action.kind === 'complete') {
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
              keys.myWork
            ]);
          }}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={t('confirm.deleteTitle')}
          destructive
          confirmText={deleteTarget.confirmation}
          reasonRequired
          message={
            deleteTarget.blockers.length ? (
              <div className="stack">
                <strong>{t('confirm.blocked')}</strong>
                <ul>
                  {deleteTarget.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>{deleteTarget.task.taskName}</p>
            )
          }
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async ({ confirmation, reason }) => {
            await api.del(`/api/manager/tasks/${deleteTarget.task.taskId}`, {
              revision: deleteTarget.task.revision,
              confirmed: true,
              reason,
              confirmation
            });
            setDeleteTarget(null);
            queryCache.invalidate([keys.tasks, keys.taskIndex, keys.overview, keys.project(deleteTarget.task.projectId)]);
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
  filters: { projectId: string; displayStatus: string; query: string; includeInactive: boolean; page: number };
  openEdit: (task: TaskSummary) => Promise<void>;
  startDelete: (task: TaskSummary) => Promise<void>;
  setAction: (action: { kind: 'approve' | 'confirm' | 'override' | 'complete'; task: TaskSummary }) => void;
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
                <td>{task.dueDate ?? t('common.unset')}</td>
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
                    <button type="button" className="link-button" onClick={() => setAction({ kind: 'approve', task })}>
                      {t('tasks.approve')}
                    </button>
                    <button type="button" className="link-button" onClick={() => setAction({ kind: 'confirm', task })}>
                      {t('tasks.confirmSchedule')}
                    </button>
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
