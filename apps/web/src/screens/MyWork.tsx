/**
 * My Assigned Work: 自分の担当タスク.
 *
 * The list is always the signed-in member's own work, resolved on the server from the verified
 * session - never from a name, an employee number or a task owner sent by the browser. A manager
 * keeps this personal list beside the departmental one; a MEMBER also files and reports work here;
 * a VIEWER sees the same list read-only.
 */
import { useMemo, useState } from 'react';
import type { Actor, MemberRequest, MemberRequests, MyWorkList, MyWorkProjectOptions } from '@eh/contracts';
import { api, ApiFailure } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, ErrorBox } from '../components/ui';
import { ConfirmDialog, createIdempotencyKey, SelectInput, TextInput, useIdempotencyKey, useSave } from '../components/forms';
import { useRouteMemoryState } from '../state/navigation';

const PAGE_SIZE = 25;

function displayTone(status: MyWorkList['items'][number]['displayStatus']): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
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

export function MyWorkScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const [page, setPage] = useRouteMemoryState('my-work:page', 1);
  const canCreate = actor.role === 'MEMBER';
  const canReport = actor.role === 'MEMBER';

  const list = useQuery<MyWorkList>(`${keys.myWork}:${page}`, () =>
    api.get<MyWorkList>(`/api/employee/my-work?page=${page}`)
  );
  const projects = useQuery<MyWorkProjectOptions>(keys.myProjects, () =>
    canCreate
      ? api.get<MyWorkProjectOptions>('/api/employee/my-work/projects')
      : Promise.resolve({ items: [], taskCreationEnabled: false })
  );
  const requests = useQuery<MemberRequests>(keys.myRequests, () =>
    api.get<MemberRequests>('/api/employee/requests/mine')
  );

  const refreshAll = (): void => {
    queryCache.invalidate([keys.myWork, keys.myRequests]);
  };

  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="screen stack">
      <h2>{t('local.myWork')}</h2>
      <p className="muted small">{canCreate ? t('myWork.intro') : t('myWork.derivedNote')}</p>

      {!canCreate ? (
        <div className="banner info">
          <p className="muted small">{canCreate ? t('myWork.memberOnlyCreate') : t('myWork.managerNote')}</p>
        </div>
      ) : null}

      {requests.data && !requests.data.submissionEnabled && canReport ? (
        <div className="banner warning">
          <strong>{t('myWork.requestsClosed')}</strong>
          <p className="muted small">{t('myWork.requestsClosedHint')}</p>
        </div>
      ) : null}

      {canCreate ? (
        <CreateTaskCard
          projects={projects.data?.items ?? []}
          loading={projects.loading}
          onCreated={() => {
            refreshAll();
          }}
        />
      ) : null}

      <ErrorBox
        error={list.error ?? (canCreate ? projects.error : null) ?? requests.error}
        onRetry={() => {
          list.refresh();
          if (canCreate) projects.refresh();
          requests.refresh();
        }}
      />

      <div className="inline-actions">
        <span className="muted small">{t('myWork.total', { n: total })}</span>
      </div>

      {items.length === 0 ? <p className="muted">{t('myWork.requestsEmpty')}</p> : null}

      {items.map((item) => (
        <WorkCard
          key={`${item.taskId}:${item.revision}`}
          item={item}
          canReport={canReport}
          canManage={actor.role === 'ADMIN' || actor.role === 'MANAGER'}
          submissionEnabled={requests.data?.submissionEnabled ?? false}
          onChanged={refreshAll}
        />
      ))}

      <div className="inline-actions">
        <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {t('local.previous')}
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button type="button" className="button secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          {t('local.next')}
        </button>
      </div>

      <MyRequestsCard requests={requests.data?.items ?? []} />
    </div>
  );
}

function CreateTaskCard({
  projects,
  loading,
  onCreated
}: {
  projects: MyWorkProjectOptions['items'];
  loading: boolean;
  onCreated: () => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const initialKey = useIdempotencyKey();
  const [idempotencyKey, setIdempotencyKey] = useState(initialKey);
  const save = useSave();
  const [projectId, setProjectId] = useState('');
  const [subprojectId, setSubprojectId] = useState('');
  const [taskName, setTaskName] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [notice, setNotice] = useState('');

  const current = useMemo(() => projects.find((entry) => entry.projectId === projectId), [projects, projectId]);
  const subprojects = current?.subprojects ?? [];
  const valid = !!projectId && taskName.trim().length > 0 && !!deadline;

  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        event.preventDefault();
        setNotice('');
        void save.run(
          () =>
            api.post('/api/employee/my-work', {
              idempotencyKey,
              projectId,
              subprojectId: subprojectId || null,
              taskName: taskName.trim(),
              description: description.trim() || undefined,
              deadline,
              priority
            }),
          {
            onSuccess: () => {
              setNotice(t('myWork.created'));
              setIdempotencyKey(createIdempotencyKey());
              setTaskName('');
              setDescription('');
              setDeadline('');
              onCreated();
            }
          }
        );
      }}
    >
      <h3>{t('myWork.newTask')}</h3>
      <p className="muted small">{t('myWork.ownerNote')}</p>
      {loading ? <p className="muted">{t('myWork.projectsLoading')}</p> : null}
      {!loading && projects.length === 0 ? <div className="banner warning">{t('myWork.projectsEmpty')}</div> : null}

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t('myWork.project')}</span>
          <SelectInput
            value={projectId}
            onChange={(value) => {
              setProjectId(value);
              setSubprojectId('');
            }}
            allowEmpty={t('common.unset')}
            options={projects.map((entry) => ({
              value: entry.projectId,
              label: entry.responsibilityName ? entry.projectName + ' / ' + entry.responsibilityName : entry.projectName
            }))}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('myWork.subproject')}</span>
          <SelectInput
            value={subprojectId}
            onChange={setSubprojectId}
            allowEmpty={t('myWork.subprojectNone')}
            options={subprojects.map((entry) => ({ value: entry.subprojectId, label: entry.subprojectName }))}
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">{t('myWork.taskName')}</span>
        <TextInput value={taskName} onChange={setTaskName} required />
      </label>

      <label className="field">
        <span className="field-label">{t('myWork.description')}</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t('myWork.deadline')}</span>
          <TextInput type="date" value={deadline} onChange={setDeadline} required />
        </label>
        <label className="field">
          <span className="field-label">{t('myWork.priority')}</span>
          <SelectInput
            value={priority}
            onChange={setPriority}
            options={['Low', 'Medium', 'High', 'Critical'].map((value) => ({ value, label: label('priority', value) }))}
          />
        </label>
      </div>
      <p className="muted small">{t('tasks.noDurationNote')}</p>

      <ErrorBox error={save.error} onRetry={onCreated} />
      {notice ? <div className="banner ok">{notice}</div> : null}

      <div className="inline-actions">
        <button type="submit" className="button" disabled={!valid || save.state === 'saving'}>
          {save.state === 'saving' ? t('state.saving') : t('myWork.create')}
        </button>
      </div>
    </form>
  );
}

function WorkCard({
  item,
  canReport,
  canManage,
  submissionEnabled,
  onChanged
}: {
  item: MyWorkList['items'][number];
  canReport: boolean;
  canManage: boolean;
  submissionEnabled: boolean;
  onChanged: () => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const [reporting, setReporting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const save = useSave();

  const finished = ['DONE', 'CANCELLED'].includes(item.displayStatus);
  const locked = finished || item.container;
  const review = reviewKey(item.reviewState);

  return (
    <div className="card stack">
      <h3>
        <a href={`#/task/${item.taskId}`}>{item.taskName}</a>
      </h3>
      <p className="muted small">
        {item.projectName}
        {item.subprojectName ? ` / ${item.subprojectName}` : ''} · {t('myWork.deadline')}: {item.dueDate ?? t('common.unset')} ·{' '}
        {label('priority', item.priority)}
      </p>
      <p className="small">
        <span className="muted">{t('myWork.status')}: </span>
        <Badge tone={displayTone(item.displayStatus)}>{t(`taskStatus.${item.displayStatus}`)}</Badge>
        {item.pendingRequest ? <Badge tone="warn">{t('myWork.pendingBadge')}</Badge> : null}
        {item.creationChannel === 'MEMBER' ? (
          <span className="muted small"> · {t('myWork.adminApprovalNote')}</span>
        ) : null}
      </p>
      {canReport ? (
        <p className="small">
          <span className="muted">{t('myWork.reviewLabel')}: </span>
          <Badge tone={review.tone}>{t(review.label)}</Badge>
        </p>
      ) : null}

      {canReport ? (
        <div className="inline-actions">
          <button
            type="button"
            className="button secondary"
            disabled={locked || item.pendingRequest || !submissionEnabled}
            title={submissionEnabled ? undefined : t('myWork.requestsClosed')}
            onClick={() => setReporting(true)}
          >
            {t('myWork.reportCompletion')}
          </button>
        </div>
      ) : null}
      {canManage ? (
        <div className="inline-actions">
          <a className="button secondary" href={`#/task/${item.taskId}`}>{t('action.open')}</a>
          {!locked ? (
            <button type="button" className="button" onClick={() => setCompleting(true)}>
              {t('tasks.completeDirect')}
            </button>
          ) : null}
        </div>
      ) : null}
      <ErrorBox error={save.error} onRetry={onChanged} />
      {completing ? (
        <ConfirmDialog
          title={t('tasks.completeDirectTitle')}
          message={t('tasks.completeDirectBody')}
          destructive={false}
          onCancel={() => setCompleting(false)}
          onConfirm={async () => {
            await save.run(
              () =>
                api.post(`/api/manager/tasks/${item.taskId}/complete`, {
                  revision: item.revision,
                  confirmed: true
                }),
              {
                onSuccess: () => {
                  setCompleting(false);
                  queryCache.invalidate([keys.myWork, keys.tasks, keys.taskIndex, keys.overview, keys.task(item.taskId), keys.project(item.projectId)]);
                  onChanged();
                }
              }
            );
          }}
        />
      ) : null}
      {item.pendingRequest ? <p className="muted small">{t('myWork.review.pending')}</p> : null}
      {finished ? <p className="muted small">{t('myWork.doneNote')}</p> : null}
      {item.container ? <p className="muted small">{t('myWork.containerNote')}</p> : null}

      {reporting ? (
        <CompletionRequestForm
          taskId={item.taskId}
          onCancel={() => {
            setReporting(false);
            onChanged();
          }}
          onSubmitted={onChanged}
        />
      ) : null}
    </div>
  );
}

function reviewKey(reviewState: MyWorkList['items'][number]['reviewState']): { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  switch (reviewState) {
    case 'PENDING':
      return { label: 'myWork.review.pending', tone: 'warn' };
    case 'APPROVED':
      return { label: 'myWork.review.approved', tone: 'ok' };
    case 'REJECTED':
      return { label: 'myWork.review.rejected', tone: 'danger' };
    case 'RETURNED':
      return { label: 'myWork.review.returned', tone: 'warn' };
    case 'STALE':
      return { label: 'myWork.review.stale', tone: 'warn' };
    default:
      return { label: 'myWork.review.none', tone: 'neutral' };
  }
}

/**
 * Completion report submission.
 *
 * The receipt ID stays on screen only: the client is non-blocking and an unobservable outcome is
 * reported as unknown instead of being retried automatically.
 */
function CompletionRequestForm({
  taskId,
  onCancel,
  onSubmitted
}: {
  taskId: string;
  onCancel: () => void;
  onSubmitted: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'unknown'>('idle');
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);
  const clientRequestId = useIdempotencyKey();

  const submit = async (): Promise<void> => {
    if (!note.trim() || state === 'sending' || state === 'done') return;
    setState('sending');
    setMessage(null);
    try {
      const result = await api.post<{ requestId: string }>('/api/employee/requests', {
        clientRequestId,
        taskId,
        requestType: 'COMPLETION_REPORT',
        completionNote: note.trim()
      });
      setState('done');
      setMessage({ tone: 'ok', text: `${t('request.completion.heading')} ${t('request.confirm.id')}: ${result.requestId}` });
      onSubmitted();
    } catch (failure) {
      if (failure instanceof ApiFailure && ['NETWORK', 'INVALID_RESPONSE'].includes(failure.code)) {
        setState('unknown');
        setMessage({ tone: 'warning', text: t('request.transport.OUTCOME_UNKNOWN') });
        return;
      }
      setState('idle');
      setMessage({
        tone: 'danger',
        text: failure instanceof ApiFailure ? failure.message : t('common.error')
      });
    }
  };

  return (
    <div className="card stack">
      <h4>{t('myWork.completionHeading')}</h4>
      <label className="field">
        <span className="field-label">{t('myWork.completionNote')}</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          disabled={state !== 'idle'}
        />
      </label>
      {message ? <div className={`banner ${message.tone}`}>{message.text}</div> : null}
      {state === 'done' ? <p className="muted small">{t('request.completion.body')}</p> : null}
      <div className="inline-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={state === 'sending'}>
          {state === 'done' ? t('request.activity.dismiss') : t('request.form.cancel')}
        </button>
        <button
          type="button"
          className="button"
          disabled={!note.trim() || state === 'sending' || state === 'done'}
          onClick={() => void submit()}
        >
          {state === 'sending' ? t('request.form.submitting') : t('myWork.submitCompletion')}
        </button>
      </div>
    </div>
  );
}

function MyRequestsCard({ requests }: { requests: MemberRequest[] }): JSX.Element {
  const { t, label } = useI18n();
  return (
    <section className="card stack">
      <h3>{t('myWork.requestsHeading')}</h3>
      {requests.length === 0 ? <p className="muted">{t('myWork.requestsEmpty')}</p> : null}
      {requests.length > 0 ? (
        <ul className="list">
          {requests.map((request) => (
            <li key={request.requestId}>
              <strong>{request.taskName || request.taskId}</strong>
              <span className="muted small">
                {' '}
                · {t(`myWork.requestType.${request.requestType}`)} · {label('request.status', request.status)} ·{' '}
                {request.submittedAt.slice(0, 10)} ({request.requestId})
              </span>
              {request.decisionNote ? <div className="muted small">{t('myWork.decisionNote')}: {request.decisionNote}</div> : null}
              {request.staleReason ? <div className="muted small">{t('myWork.review.stale')}: {request.staleReason}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
