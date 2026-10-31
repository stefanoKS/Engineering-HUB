/** Task list: server-side filtering and paging, narrow rows, one form for create and edit. */
import { useState } from 'react';
import type { Actor, Reference, Task, TaskDetail, TaskSummary } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Pagination, ProgressBar, statusTone } from '../components/ui';
import { ConfirmDialog } from '../components/forms';
import { TaskForm } from './TaskForm';
import { projectColor } from '@eh/domain';

type Page = { items: TaskSummary[]; total: number; page: number; pageSize: number; totalPages: number };
type References = {
  members: { memberId: string; name: string; active: boolean }[];
  skills: { skillId: string; skillName: string }[];
  subprojects: Reference[];
};

const STATUSES = ['Not Started', 'Assigned', 'In Progress', 'Blocked', 'On Hold', 'Done', 'Cancelled'];

export function TasksScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t, label } = useI18n();
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ mode: 'create' } | { mode: 'edit'; detail: TaskDetail } | null>(null);
  const [action, setAction] = useState<{ kind: 'approve' | 'confirm' | 'override'; task: TaskSummary } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ task: TaskSummary; confirmation: string; blockers: string[] } | null>(null);

  const references = useQuery<References>(keys.references, () => api.get<References>('/api/manager/references'));
  const projects = useQuery<{ items: { projectId: string; projectName: string }[] }>(keys.projects, () =>
    api.get<{ items: { projectId: string; projectName: string }[] }>('/api/manager/projects?pageSize=100')
  );
  const listKey = `${keys.tasks}${queryString({ projectId, status, query, overdueOnly, page })}`;
  const list = useQuery<Page>(listKey, () =>
    api.get<Page>(
      `/api/manager/tasks${queryString({ projectId, status, query, overdueOnly, page, pageSize: 25 })}`
    )
  );
  const canManage = actor.role === 'ADMIN' || actor.role === 'MANAGER';

  async function openEdit(summary: TaskSummary): Promise<void> {
    const detail = await api.get<TaskDetail>(`/api/manager/tasks/${summary.taskId}`);
    setEditing({ mode: 'edit', detail });
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
        <h2>{t('nav.tasks')}</h2>
        <div className="filters">
          <select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('filter.all')}</option>
            {(projects.data?.items ?? []).map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.projectName}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('filter.all')}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {label('task.status', value)}
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
            <input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />
            {t('overview.overdue')}
          </label>
          {canManage ? (
            <button type="button" className="button" onClick={() => setEditing({ mode: 'create' })}>
              {t('tasks.new')}
            </button>
          ) : null}
        </div>
      </div>

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
              <th>{t('column.progress')}</th>
              <th>{t('column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((task) => (
              <tr key={task.taskId} style={{ ['--project-accent' as string]: projectColor(task.projectId) }}>
                <td>
                  <span className="project-dot" style={{ background: projectColor(task.projectId) }} aria-hidden="true" />
                  <span style={{ paddingLeft: `${Math.max(0, task.depth - 1) * 14}px` }}>
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
                  <Badge tone={statusTone(task.status)}>{label('task.status', task.status)}</Badge>
                </td>
                <td>
                  {task.dueDate ?? t('common.unset')}
                  {task.overdue ? <Badge tone="danger">{t('overview.overdue')}</Badge> : null}
                </td>
                <td>
                  <ProgressBar value={task.progressPercent} />
                </td>
                <td className="actions">
                  {canManage ? (
                    <>
                      <button type="button" className="link-button" onClick={() => void openEdit(task)}>
                        {t('action.edit')}
                      </button>
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
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
                : t('tasks.override')
          }
          message={action.task.taskName}
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
            } else {
              await api.post(`/api/manager/tasks/${action.task.taskId}/override-complete`, {
                revision: action.task.revision,
                reason,
                confirmation
              });
            }
            setAction(null);
            queryCache.invalidate([keys.tasks, keys.task(action.task.taskId), keys.taskIndex, keys.overview, keys.project(action.task.projectId)]);
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
              <div className="banner danger">
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
