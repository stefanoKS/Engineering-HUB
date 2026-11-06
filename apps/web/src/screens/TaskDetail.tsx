/** Task detail: the authoritative record, its relationships and the reviewed actions. */
import { useState } from 'react';
import { MAX_TASK_DEPTH } from '@eh/domain';
import type { Actor, Reference, ReopenEligibility, ReportEligibility, Task, TaskDetail } from '@eh/contracts';
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
  Menu,
  Section,
  statusTone
} from '../components/ui';
import { ConfirmDialog } from '../components/forms';
import { blockedReasonLabel, RequestDialog, type RequestKind } from '../components/request-dialog';
import { TaskForm } from './TaskForm';
import { formatSkillGrade, projectColor } from '@eh/domain';
import { BackButton } from '../state/navigation';
import { DeleteEntityDialog } from '../components/DeleteEntityDialog';
import { DeadlineCell } from '../components/deadline';
import { TaskStatusBadge } from '../components/task-status';
import { capabilitiesOf } from '../state/capabilities';

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
  const [requestType, setRequestType] = useState<RequestKind | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'warning' | 'danger'; text: string } | null>(null);
  const [action, setAction] = useState<'approve' | 'confirm' | 'override' | 'complete' | null>(null);
  const [removing, setRemoving] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [notice, setNotice] = useState('');
  const endpoint = readOnly ? `/api/work/tasks/${taskId}` : `/api/manager/tasks/${taskId}`;
  const capabilities = capabilitiesOf(actor);
  const canManage = !readOnly && capabilities.canEdit;
  // A completion report may be filed by any authenticated MEMBER, MANAGER or ADMIN; an extension
  // request stays limited to the assigned MEMBER. Eligibility itself is a server answer.
  const canReport = capabilities.canSubmitCompletionRequest;
  const detail = useQuery<TaskDetail>(keys.task(taskId), () => api.get<TaskDetail>(endpoint));
  const references = useQuery<References>(keys.references, () =>
    readOnly ? Promise.resolve({ members: [], skills: [], subprojects: [] }) : api.get<References>('/api/manager/references')
  );
  // The server decides whether a report is possible for this task and this reader.
  const eligibility = useQuery<ReportEligibility>(
    keys.reportEligibility(taskId),
    () => api.get<ReportEligibility>(`/api/employee/tasks/${taskId}/report-eligibility`),
    { enabled: canReport }
  );
  // Corrective reopening is an ADMIN-only read; a manager or member never requests it.
  const reopen = useQuery<ReopenEligibility>(
    keys.reopenEligibility(taskId),
    () => api.get<ReopenEligibility>(`/api/manager/tasks/${taskId}/reopen-eligibility`),
    { enabled: !readOnly && capabilities.canReopenTask }
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
  // Eligibility is only "available" when the server answered and listed no refusal.
  const reportBlocked = (eligibility.data?.reasons ?? []).map((reason) => t(blockedReasonLabel(reason)));
  const reportReady = eligibility.data?.eligible === true;
  const assigneeNames = detail.data.assignees.map((entry) => entry.name);
  // A refused completion capability (completed, cancelled, container) is not offered at all; it is
  // never rendered as a disabled control that suggests the action might become possible.
  const completionReasons = new Set(eligibility.data?.reasons ?? []);
  const completionOffered =
    canReport &&
    eligibility.data !== undefined &&
    !completionReasons.has('COMPLETED') &&
    !completionReasons.has('CANCELLED') &&
    !completionReasons.has('CONTAINER');
  const extensionOffered = capabilities.canSubmitExtensionRequest && !finished && detail.data.children.length === 0;
  const reopenReasons = (reopen.data?.reasons ?? []).map((reason) => t(`reopen.blocked.${reason}`));
  const canReopen =
    capabilities.canReopenTask && record.status === 'Done' && detail.data.children.length === 0;
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
          <div className="compact-toolbar">
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
            {!detail.data.children.length && record.displayStatus !== 'DONE' && record.displayStatus !== 'CANCELLED' ? (
              <button type="button" className="button" onClick={() => setAction('complete')}>
                {t('tasks.completeDirect')}
              </button>
            ) : null}
            {canReopen || actor.role === 'ADMIN' ? (
              <Menu label={t('action.more')} className="row-menu">
                {(close) => (
                  <>
                    {canReopen ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        onClick={() => {
                          close();
                          setReopening(true);
                        }}
                      >
                        {t('reopen.action')}
                      </button>
                    ) : null}
                    {actor.role === 'ADMIN' ? (
                      <>
                        <div className="menu-separator" role="separator" />
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-item danger"
                          onClick={() => {
                            close();
                            setRemoving(true);
                          }}
                        >
                          {t('delete.submit')}
                        </button>
                      </>
                    ) : null}
                  </>
                )}
              </Menu>
            ) : null}
          </div>
        ) : null}
      </div>
      {canManage && childBlockedReason ? <p className="muted small">{childBlockedReason}</p> : null}
      {status ? (
        <div className={`banner ${status.tone}`} role={status.tone === 'danger' ? 'alert' : 'status'}>
          {status.text}
        </div>
      ) : null}
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
              <TaskStatusBadge state={record.displayStatus} missing={record.scheduleMissing} showDetail />
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
              <DeadlineCell dueDate={record.dueDate} state={record.displayStatus} size="large" />
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
                <dt>{t('task.workflowStatus')}</dt>
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
                    <TaskStatusBadge state={child.displayStatus} missing={child.scheduleMissing} showDetail />
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
          {detail.data.deadlineHistory.length === 0 ? (
            <CollapsedSection title={t('tasks.history')} />
          ) : (
            <Section title={t('tasks.history')}>
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
            </Section>
          )}

          {detail.data.confirmations.length === 0 ? (
            <CollapsedSection title={t('tasks.confirmSchedule')} />
          ) : (
            <Section title={t('tasks.confirmSchedule')}>
              <ul className="list">
                {detail.data.confirmations.map((confirmation) => (
                  <li key={confirmation.scheduleConfirmationId}>
                    v{confirmation.version} · {confirmation.confirmedAt.slice(0, 16).replace('T', ' ')} ·{' '}
                    {confirmation.confirmedBy}
                    {confirmation.active ? <Badge tone="ok">{t('state.saved')}</Badge> : null}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      ) : null}

      {canReport || capabilities.canSubmitExtensionRequest ? (
        <Section
          title={t('report.heading')}
          actions={
            <div className="inline-actions">
              {completionOffered ? (
                <button
                  type="button"
                  className="button secondary"
                  disabled={!reportReady}
                  onClick={() => setRequestType('COMPLETION_REPORT')}
                >
                  {t('request.action.completion')}
                </button>
              ) : null}
              {extensionOffered ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setRequestType('DEADLINE_CHANGE')}
                >
                  {t('request.action.deadline')}
                </button>
              ) : null}
            </div>
          }
        >
          <p className="muted small">
            {assigneeNames.length > 0
              ? t('report.assignedTo', { names: assigneeNames.join(', ') })
              : t('report.noAssignee')}
          </p>
          {eligibility.data ? (
            <p className="muted small">{t('report.reporter', { name: eligibility.data.reporterName })}</p>
          ) : null}
          {canManage ? <p className="muted small">{t('tasks.completeDirectBody')}</p> : null}
          {canReport && !eligibility.data && eligibility.loading ? (
            <p className="muted small">{t('report.eligibilityLoading')}</p>
          ) : null}
          {canReport && eligibility.error ? (
            <div className="banner warning" role="status">
              <span>{t('report.eligibilityUnavailable')}</span>
              <button type="button" className="link-button" onClick={() => eligibility.refresh()}>
                {t('state.retry')}
              </button>
            </div>
          ) : null}
          {canReport && reportBlocked.length > 0 ? (
            <div className="validation-summary" role="status">
              <ul>
                {reportBlocked.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!completionOffered && !extensionOffered ? (
            <p className="muted small">{t('request.notAvailable')}</p>
          ) : null}
        </Section>
      ) : null}

      {requestType ? (
        <RequestDialog
          key={`${record.taskId}:${requestType}`}
          taskId={record.taskId}
          taskName={record.taskName}
          projectName={context.projectName || record.projectId}
          subprojectName={subprojectPath || undefined}
          currentDeadline={record.dueDate}
          requestType={requestType}
          submissionEnabled={eligibility.data?.submissionEnabled ?? false}
          blockedReasons={requestType === 'COMPLETION_REPORT' ? reportBlocked : []}
          onClose={() => setRequestType(null)}
          onResult={(value) => {
            setStatus(value);
            detail.refresh();
            eligibility.refresh();
            queryCache.invalidate([keys.myWork, keys.myRequests]);
          }}
        />
      ) : null}

      {reopening && capabilities.canReopenTask ? (
        <ConfirmDialog
          title={t('reopen.title')}
          destructive
          confirmText={reopen.data?.confirmationText ?? `REOPEN ${record.taskId}`}
          reasonRequired
          message={
            <div className="stack">
              <p>
                <strong>{record.taskName}</strong> · {record.taskId}
              </p>
              <p>{t('reopen.body')}</p>
              {reopen.data?.completedAt ? (
                <p className="muted small">{t('reopen.completedAt', { at: reopen.data.completedAt.slice(0, 16).replace('T', ' ') })}</p>
              ) : (
                <p className="muted small">{t('reopen.noCompletionRecord')}</p>
              )}
              <p className="muted small">{t('reopen.resultingState')}</p>
              {reopen.data?.projectReopenRequired ? (
                <div className="banner warning">
                  {t('reopen.projectReopen', { name: reopen.data.projectName })}
                </div>
              ) : null}
              {reopenReasons.length > 0 ? (
                <div className="banner danger">
                  <ul>
                    {reopenReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          }
          onCancel={() => setReopening(false)}
          onConfirm={async ({ confirmation, reason }) => {
            await api.post(`/api/manager/tasks/${record.taskId}/reopen`, {
              idempotencyKey: `reopen-${record.taskId}-${record.revision}-${Date.now()}`,
              revision: record.revision,
              reason,
              confirmation,
              reopenProject: reopen.data?.projectReopenRequired === true || undefined
            });
            setReopening(false);
            setStatus({ tone: 'ok', text: t('reopen.done') });
            queryCache.invalidate([
              keys.task(record.taskId),
              keys.tasks,
              keys.taskIndex,
              keys.overview,
              keys.project(record.projectId),
              keys.projects,
              keys.myWork,
              keys.timeline,
              keys.requests,
              keys.workload,
              keys.workProjects,
              keys.workOverview
            ]);
            detail.refresh();
            reopen.refresh();
            eligibility.refresh();
          }}
        />
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
            queryCache.invalidate([keys.task(task.taskId), keys.tasks, keys.parentOptions, keys.timeline]);
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
              keys.myWork,
              keys.parentOptions,
              keys.timeline
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
            queryCache.invalidate([keys.task(record.taskId), keys.tasks, keys.taskIndex, keys.overview, keys.project(record.projectId), keys.myWork, keys.timeline]);
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
              keys.myWork,
              keys.parentOptions,
              keys.timeline
            ]);
            window.location.hash = '#/all-work';
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * An empty history panel is a single closed line instead of a bordered placeholder, and it stays
 * reachable so a reader can confirm the history exists and is empty.
 */
function CollapsedSection({ title }: { title: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <details className="disclosure history-empty">
      <summary>{title}</summary>
      <p className="muted small">{t('state.empty')}</p>
    </details>
  );
}
