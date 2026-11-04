/** Task detail: the authoritative record, its relationships and the reviewed actions. */
import { useState } from 'react';
import type { Actor, Reference, Task, TaskDetail } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Section, statusTone } from '../components/ui';
import { ConfirmDialog } from '../components/forms';
import { TaskForm } from './TaskForm';
import { displayTone } from './Tasks';
import { formatSkillGrade, projectColor } from '@eh/domain';
import { BackButton } from '../state/navigation';

type References = {
  members: { memberId: string; name: string; active: boolean; employeeId?: string }[];
  skills: { skillId: string; skillName: string }[];
  subprojects: Reference[];
};

export function TaskDetailScreen({
  actor,
  taskId,
  readOnly = false
}: {
  actor: Actor;
  taskId: string;
  readOnly?: boolean;
}): JSX.Element {
  const { t, label } = useI18n();
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<'approve' | 'confirm' | 'override' | 'complete' | null>(null);
  const endpoint = readOnly ? `/api/work/tasks/${taskId}` : `/api/manager/tasks/${taskId}`;
  const detail = useQuery<TaskDetail>(keys.task(taskId), () => api.get<TaskDetail>(endpoint));
  const references = useQuery<References>(keys.references, () =>
    readOnly ? Promise.resolve({ members: [], skills: [], subprojects: [] }) : api.get<References>('/api/manager/references')
  );
  const canManage = !readOnly && (actor.role === 'ADMIN' || actor.role === 'MANAGER');

  if (detail.error) return <ErrorBox error={detail.error} onRetry={() => detail.refresh()} />;
  if (!detail.data) return <p className="muted">{t('state.loading')}</p>;

  const { record } = detail.data;
  return (
    <div className="screen">
      <BackButton actor={actor} fallback="all-work" disabled={editing || action !== null} />
      <div className="screen-header">
        <div>
          <h2>{record.taskName}</h2>
          <p className="muted small">
            <a href={`#/project/${record.projectId}`}>{record.projectId}</a> · {record.taskId}
          </p>
        </div>
        <div className="filters">
          {canManage ? (
            <>
              <button type="button" className="button secondary" onClick={() => setEditing(true)}>
                {t('action.edit')}
              </button>
              {!detail.data.children.length && record.displayStatus !== 'DONE' && record.displayStatus !== 'CANCELLED' ? (
                <button type="button" className="button" onClick={() => setAction('complete')}>
                  {t('tasks.completeDirect')}
                </button>
              ) : null}
              <button type="button" className="button secondary" onClick={() => setAction('approve')}>
                {t('tasks.approve')}
              </button>
              <button type="button" className="button secondary" onClick={() => setAction('confirm')}>
                {t('tasks.confirmSchedule')}
              </button>
              {actor.role === 'ADMIN' ? (
                <button type="button" className="button secondary" onClick={() => setAction('override')}>
                  {t('tasks.override')}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <Section title={t('common.items')}>
        <div className="detail-grid" style={{ ['--project-accent' as string]: projectColor(record.projectId) }}>
          <div>
            <dt>{t('column.status')}</dt>
            <dd>
              <Badge tone={displayTone(record.displayStatus)}>{t(`taskStatus.${record.displayStatus}`)}</Badge>
            </dd>
          </div>
          <div>
            <dt>{t('column.owner')}</dt>
            <dd>
              {record.ownerName || t('common.unset')}
              {detail.data.assignees.length > 1 ? (
                <span className="muted small"> +{detail.data.assignees.length - 1}</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t('column.deadline')}</dt>
            <dd>{record.dueDate ?? t('common.unset')}</dd>
          </div>
          <div>
            <dt>{t('skills.grade')}</dt>
            <dd>{record.requiredSkillId ? formatSkillGrade(record.requiredSkillLevel, t('skills.notAssessed')) : t('common.unset')}</dd>
          </div>
          {canManage ? (
            <>
              <div>
                <dt>{t('column.status')} (DB)</dt>
                <dd>
                  <Badge tone={statusTone(record.status)}>{label('task.status', record.status)}</Badge>
                </dd>
              </div>
              <div>
                <dt>{t('tasks.approve')}</dt>
                <dd>
                  {record.assignmentApprovedAt ? (
                    <Badge tone="ok">v{record.assignmentVersion}</Badge>
                  ) : (
                    <Badge tone="warn">v{record.assignmentVersion}</Badge>
                  )}
                </dd>
              </div>
            </>
          ) : null}
        </div>
      </Section>

      {detail.data.children.length ? (
        <div className="banner info">{t('tasks.containerNote')}</div>
      ) : null}

      <Section title={t('tasks.assignees')}>
        {detail.data.assignees.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="list">
            {detail.data.assignees.map((assignee) => (
              <li key={assignee.memberId}>
                {assignee.name}
                {assignee.primary ? <Badge tone="info">{t('tasks.owner')}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
        {detail.data.assigneeHistory.length ? (
          <>
            <h3>{t('members.previous')}</h3>
            <ul className="list muted">
              {detail.data.assigneeHistory.map((assignee) => (
                <li key={`${assignee.memberId}-${assignee.assignedAt}`}>{assignee.name}</li>
              ))}
            </ul>
          </>
        ) : null}
      </Section>

      {detail.data.children.length ? (
        <Section title={t('tasks.children')}>
          <table className="table">
            <tbody>
              {detail.data.children.map((child) => (
                <tr key={child.taskId}>
                  <td>
                    <a href={`#/task/${child.taskId}`}>{child.taskName}</a>
                  </td>
                  <td>
                    <Badge tone={statusTone(child.status)}>{label('task.status', child.status)}</Badge>
                  </td>
                  <td>{child.dueDate ?? t('common.unset')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section title={t('tasks.history')}>
        {detail.data.deadlineHistory.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.items')}</th>
                <th>{t('column.deadline')}</th>
                <th>{t('common.unset')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.deadlineHistory.map((entry) => (
                <tr key={entry.historyId}>
                  <td>{entry.changedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    {entry.previousDueDate ?? t('common.unset')} → {entry.newDueDate ?? t('common.unset')}
                  </td>
                  <td className="muted small">
                    {entry.changedBy} · {entry.source} · {entry.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={t('tasks.confirmSchedule')}>
        {detail.data.confirmations.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="list">
            {detail.data.confirmations.map((confirmation) => (
              <li key={confirmation.scheduleConfirmationId}>
                v{confirmation.version} · {confirmation.confirmedAt.slice(0, 16).replace('T', ' ')} ·{' '}
                {confirmation.confirmedBy}
                {confirmation.active ? <Badge tone="ok">{t('state.saved')}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {editing ? (
        <TaskForm
          task={record}
          detail={detail.data}
          references={references.data}
          onClose={() => setEditing(false)}
          onSaved={(task: Task) => {
            setEditing(false);
            queryCache.invalidate([keys.task(task.taskId), keys.tasks]);
          }}
        />
      ) : null}

      {action ? (
        <ConfirmDialog
          title={
            action === 'approve'
              ? t('tasks.approve')
              : action === 'confirm'
                ? t('tasks.confirmSchedule')
                : action === 'complete'
                  ? t('tasks.completeDirectTitle')
                  : t('tasks.override')
          }
          message={action === 'complete' ? t('tasks.completeDirectBody') : record.taskName}
          confirmText={action === 'override' ? `COMPLETE ${record.taskId}` : undefined}
          reasonRequired={action === 'override'}
          destructive={action === 'override'}
          onCancel={() => setAction(null)}
          onConfirm={async ({ confirmation, reason }) => {
            if (action === 'approve') {
              await api.post(`/api/manager/tasks/${record.taskId}/approve`, { revision: record.revision, confirmed: true });
            } else if (action === 'confirm') {
              await api.post(`/api/manager/tasks/${record.taskId}/confirm-schedule`, {
                revision: record.revision,
                confirmed: true
              });
            } else if (action === 'complete') {
              await api.post(`/api/manager/tasks/${record.taskId}/complete`, {
                revision: record.revision,
                confirmed: true,
                note: reason || undefined
              });
            } else {
              await api.post(`/api/manager/tasks/${record.taskId}/override-complete`, {
                revision: record.revision,
                reason,
                confirmation
              });
            }
            setAction(null);
            queryCache.invalidate([keys.task(record.taskId), keys.tasks, keys.taskIndex, keys.overview, keys.project(record.projectId), keys.myWork]);
          }}
        />
      ) : null}
    </div>
  );
}
