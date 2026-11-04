/** Task detail: the authoritative record, its relationships and the reviewed actions. */
import { useState } from 'react';
import { MAX_TASK_DEPTH } from '@eh/domain';
import type { Actor, MemberRequests, Reference, Task, TaskDetail } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import {
  Badge,
  Breadcrumbs,
  DataFreshness,
  DescriptionText,
  EmptyState,
  ErrorBox,
  Section,
  statusTone
} from '../components/ui';
import { ConfirmDialog } from '../components/forms';
import { CompletionReportPanel } from '../components/completion-report';
import { TaskForm } from './TaskForm';
import { displayTone } from './Tasks';
import { formatSkillGrade, projectColor } from '@eh/domain';
import { BackButton } from '../state/navigation';
import { DeleteEntityDialog } from '../components/DeleteEntityDialog';
import { DeadlineCell } from '../components/deadline';

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
  const [addingChild, setAddingChild] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [action, setAction] = useState<'approve' | 'confirm' | 'override' | 'complete' | null>(null);
  const [removing, setRemoving] = useState(false);
  const [notice, setNotice] = useState('');
  const endpoint = readOnly ? `/api/work/tasks/${taskId}` : `/api/manager/tasks/${taskId}`;
  const canManage = !readOnly && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
  const canReport = readOnly && actor.role === 'MEMBER';
  const detail = useQuery<TaskDetail>(keys.task(taskId), () => api.get<TaskDetail>(endpoint));
  const references = useQuery<References>(keys.references, () =>
    readOnly ? Promise.resolve({ members: [], skills: [], subprojects: [] }) : api.get<References>('/api/manager/references')
  );
  // A member's own request receipts decide whether a completion report is already pending. The key
  // is shared with My Work, so both entry points read one authorized payload.
  const myRequests = useQuery<MemberRequests>(
    keys.myRequests,
    () => api.get<MemberRequests>('/api/employee/requests/mine'),
    { enabled: canReport }
  );

  if (detail.error) return <ErrorBox error={detail.error} onRetry={() => detail.refresh()} />;
  if (!detail.data) return <p className="muted">{t('state.loading')}</p>;

  const { record } = detail.data;
  const { context } = detail.data;
  const subprojectPath = context.subprojects.map((entry) => entry.subprojectName).join(' / ');
  const finished = record.displayStatus === 'DONE' || record.displayStatus === 'CANCELLED';
  const childBlockedReason = finished
    ? t('tasks.addChildBlockedFinished')
    : detail.data.depth >= MAX_TASK_DEPTH
      ? t('tasks.addChildBlockedDepth')
      : '';
  const pendingRequest = (myRequests.data?.items ?? []).some(
    (request) => request.taskId === taskId && ['PENDING', 'PROCESSING'].includes(request.status)
  );
  const reportBlocked: string[] = [];
  if (canReport) {
    if (detail.data.children.length > 0) reportBlocked.push(t('report.blocked.container'));
    if (record.displayStatus === 'DONE') reportBlocked.push(t('report.blocked.done'));
    if (record.displayStatus === 'CANCELLED') reportBlocked.push(t('report.blocked.cancelled'));
    if (pendingRequest) reportBlocked.push(t('report.blocked.pending'));
    if (myRequests.data && !myRequests.data.submissionEnabled) reportBlocked.push(t('report.blocked.disabled'));
  }
  return (
    <div className="screen">
      <BackButton actor={actor} fallback="all-work" disabled={editing || addingChild || action !== null} />
      <Breadcrumbs
        items={[
          { label: t('nav.projects'), href: '#/projects' },
          { label: context.projectName || context.projectId, href: `#/project/${context.projectId}` },
          ...(subprojectPath
            ? [{ label: subprojectPath, href: `#/project/${context.projectId}` }]
            : []),
          { label: record.taskName }
        ]}
      />
      <div className="screen-header">
        <div>
          <h2>{record.taskName}</h2>
          <p className="muted small">
            <a href={`#/project/${record.projectId}`}>{context.projectName || record.projectId}</a>
            {subprojectPath ? ` · ${subprojectPath}` : ''} · {record.taskId}
          </p>
        </div>
        {canManage ? (
          <div className="filters">
            <button type="button" className="button secondary" onClick={() => setEditing(true)}>
              {t('action.edit')}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!!childBlockedReason}
              title={childBlockedReason || undefined}
              onClick={() => setAddingChild(true)}
            >
              {t('tasks.addChild')}
            </button>
            {actor.role === 'ADMIN' ? (
              <button type="button" className="button danger" onClick={() => setRemoving(true)}>
                {t('delete.submit')}
              </button>
            ) : null}
            {!detail.data.children.length && record.displayStatus !== 'DONE' && record.displayStatus !== 'CANCELLED' ? (
              <button type="button" className="button" onClick={() => setAction('complete')}>
                {t('tasks.completeDirect')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {canManage && childBlockedReason ? <p className="muted small">{childBlockedReason}</p> : null}
      {notice ? (
        <div className="banner ok" role="status">
          {notice}
        </div>
      ) : null}
      <DataFreshness snapshot={false} />

      <Section title={t('tasks.info')}>
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
            <dd>
              <DeadlineCell dueDate={record.dueDate} displayStatus={record.displayStatus} size="large" />
            </dd>
          </div>
          <div>
            <dt>{t('tasks.priority')}</dt>
            <dd>{label('priority', record.priority)}</dd>
          </div>
          <div>
            <dt>{t('skills.grade')}</dt>
            <dd>{record.requiredSkillId ? formatSkillGrade(record.requiredSkillLevel, t('skills.notAssessed')) : t('common.unset')}</dd>
          </div>
        </div>
        {canManage ? (
          <details className="advanced-actions">
            <summary>{t('tasks.technical')}</summary>
            <p className="muted small">{t('tasks.technicalHint')}</p>
            <div className="detail-grid">
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
            </div>
          </details>
        ) : null}
      </Section>

      {canManage ? (
        <details className="advanced-actions">
          <summary>{t('tasks.advanced')}</summary>
          <p className="muted small">
            {t('tasks.advancedHint')}
          </p>
          <div className="inline-actions">
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
          </div>
        </details>
      ) : null}

      <Section title={t('tasks.descriptionTitle')}>
        <DescriptionText text={record.description} />
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
        {canManage && detail.data.assigneeHistory.length ? (
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

      {canManage ? (
        <>
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
        </>
      ) : null}

      {canReport ? (
        <Section
          title={t('report.heading')}
          actions={
            <button
              type="button"
              className="button"
              disabled={reportBlocked.length > 0 || reporting}
              onClick={() => setReporting(true)}
            >
              {t('report.heading')}
            </button>
          }
        >
          {reportBlocked.length > 0 ? (
            <div className="validation-summary" role="status">
              <ul>
                {reportBlocked.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted small">{t('myWork.completionHeading')}</p>
          )}
          {reporting ? (
            <CompletionReportPanel
              taskId={record.taskId}
              blockedReasons={reportBlocked}
              onDismiss={() => setReporting(false)}
              onSubmitted={() => {
                detail.refresh();
                myRequests.refresh();
              }}
            />
          ) : null}
        </Section>
      ) : null}

      {editing ? (
        <TaskForm
          task={record}
          detail={detail.data}
          context={{
            projectName: context.projectName,
            subprojectPath
          }}
          references={references.data}
          onClose={() => setEditing(false)}
          onSaved={(task: Task) => {
            setEditing(false);
            queryCache.invalidate([keys.task(task.taskId), keys.tasks]);
          }}
        />
      ) : null}

      {addingChild ? (
        <TaskForm
          initialProjectId={record.projectId}
          initialSubprojectId={record.subprojectId ?? undefined}
          initialParentTaskId={record.taskId}
          context={{ projectName: context.projectName, subprojectPath, parentTaskName: record.taskName }}
          references={references.data}
          onClose={() => setAddingChild(false)}
          onSaved={(created: Task) => {
            setAddingChild(false);
            setNotice(t('tasks.addChildCreated'));
            queryCache.invalidate([
              keys.task(record.taskId),
              keys.task(created.taskId),
              keys.tasks,
              keys.taskIndex,
              keys.overview,
              keys.project(record.projectId),
              keys.myWork
            ]);
            detail.refresh();
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

      {removing ? (
        <DeleteEntityDialog
          entityType="TASKS"
          entityId={record.taskId}
          entityName={record.taskName}
          onClose={() => setRemoving(false)}
          onDeleted={() => {
            queryCache.invalidate([
              keys.tasks,
              keys.taskIndex,
              keys.overview,
              keys.project(record.projectId),
              keys.myWork
            ]);
            window.location.hash = '#/all-work';
          }}
        />
      ) : null}
    </div>
  );
}
