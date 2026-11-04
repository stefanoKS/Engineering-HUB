/**
 * Overview for managers, and the published-task home for employees.
 *
 * The employee view never calls a manager endpoint: it reads only the allowlisted snapshot and
 * submits a request. Submission is non-blocking: the form closes only after the server acknowledges the request,
 * the receipt state is reported only after a durable acknowledgement, and an unobservable
 * outcome is shown as unknown rather than retried automatically.
 */
import { useMemo, useRef, useState } from 'react';
import type { Actor, EmployeeSnapshot, Overview, Reference } from '@eh/contracts';
import { api, ApiFailure, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, ProgressBar, ProjectAccent, Section, statusTone } from '../components/ui';
import { DeadlineCell } from '../components/deadline';
import { navigate } from '../App';
import { projectColor } from '@eh/domain';
import { useRouteMemoryState } from '../state/navigation';

type BootstrapShape = { references: { responsibilities: Reference[] } };

export function OverviewScreen({ actor }: { actor: Actor }): JSX.Element {
  void actor;
  const isManager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  return isManager ? <ManagerOverview /> : <EmployeeHome actor={actor} />;
}

function ManagerOverview(): JSX.Element {
  const { t, label } = useI18n();
  const [responsibilityId, setResponsibilityId] = useState('');
  const [unassigned, setUnassigned] = useState(false);
  const [upcomingDays, setUpcomingDays] = useRouteMemoryState<7 | 14 | 30>('overview:upcomingDays', 7);

  const bootstrap = useQuery<BootstrapShape>(keys.bootstrap, () => api.get<BootstrapShape>('/api/manager/bootstrap'));
  const key = `${keys.overview}${queryString({ responsibilityId, unassigned, upcomingDays })}`;
  const overview = useQuery<Overview>(key, () =>
    api.get<Overview>(`/api/manager/overview${queryString({ responsibilityId, unassigned, upcomingDays })}`)
  );

  const data = overview.data;
  const responsibilities = bootstrap.data?.references.responsibilities ?? [];

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.overview')}</h2>
        <div className="filters">
          <label className="inline-field">
            <span>{t('overview.scope')}</span>
            <select
              value={unassigned ? '__unassigned__' : responsibilityId}
              onChange={(event) => {
                if (event.target.value === '__unassigned__') {
                  setUnassigned(true);
                  setResponsibilityId('');
                } else {
                  setUnassigned(false);
                  setResponsibilityId(event.target.value);
                }
              }}
            >
              <option value="">{t('filter.all')}</option>
              {responsibilities.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
              <option value="__unassigned__">{t('overview.unassigned')}</option>
            </select>
          </label>
        </div>
      </div>

      <ErrorBox error={overview.error} onRetry={() => overview.refresh()} />

      {!data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label={t('overview.openWork')}
              value={data.counts.openWork}
              tone="info"
              onClick={() => navigate(taskDestination({ workState: 'OPEN', responsibilityId, unassigned }))}
            />
            <Kpi
              label={t('overview.overdue')}
              value={data.counts.overdueWork}
              tone="danger"
              onClick={() => navigate(taskDestination({ displayStatus: 'OVERDUE', responsibilityId, unassigned }))}
            />
            <Kpi
              label={t('overview.completed')}
              value={data.counts.completedWork}
              tone="ok"
              onClick={() => navigate(taskDestination({ displayStatus: 'DONE', responsibilityId, unassigned }))}
            />
            <Kpi label={t('overview.containers')} value={data.counts.containers} tone="neutral" />
          </div>

          <Section
            title={t('overview.overdueWork')}
            actions={data.overdueTotal > 10 ? (
              <button
                type="button"
                className="link-button"
                onClick={() => navigate(taskDestination({ displayStatus: 'OVERDUE', responsibilityId, unassigned }))}
              >
                {t('overview.viewAll')}
              </button>
            ) : undefined}
          >
            {data.overdue.length === 0 ? (
              <EmptyState />
            ) : (
              <table className="table overview-work-table">
                <thead>
                  <tr>
                    <th>{t('column.name')}</th>
                    <th>{t('nav.projects')}</th>
                    <th>{t('column.owner')}</th>
                    <th>{t('column.deadline')}</th>
                    <th>{t('overview.daysOverdue')}</th>
                    <th>{t('column.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.overdue.map((task) => (
                    <tr key={task.taskId}>
                      <td><a href={`#/task/${task.taskId}`}>{task.taskName}</a></td>
                      <td>
                        <a
                          href={`#/project/${task.projectId}`}
                          aria-label={t('overview.openProject', { name: task.projectName })}
                        >
                          {task.projectName}
                        </a>
                      </td>
                      <td>{taskAssignees(task, t('common.unset'))}</td>
                      <td><DeadlineCell dueDate={task.dueDate} displayStatus={task.displayStatus} showLabel={false} /></td>
                      <td>{daysBetween(task.dueDate, data.upcomingWindow.from)}</td>
                      <td>
                        <Badge tone="danger">{t(`taskStatus.${task.displayStatus}`)}</Badge>
                        {task.reviewState === 'PENDING' ? <Badge tone="warn">{t('overview.extensionPending')}</Badge> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title={t('overview.upcoming')}
            actions={(
              <label className="inline-field">
                <span>{t('overview.period')}</span>
                <select
                  value={upcomingDays}
                  onChange={(event) => setUpcomingDays(Number(event.target.value) as 7 | 14 | 30)}
                  aria-label={t('overview.period')}
                >
                  <option value={7}>{t('overview.days7')}</option>
                  <option value={14}>{t('overview.days14')}</option>
                  <option value={30}>{t('overview.days30')}</option>
                </select>
              </label>
            )}
          >
            <p className="muted small overview-date-range">
              {data.upcomingWindow.from} – {data.upcomingWindow.to}
            </p>
            {data.upcoming.length === 0 ? <EmptyState /> : (
              <table className="table overview-work-table">
                <thead><tr>
                  <th>{t('column.name')}</th>
                  <th>{t('nav.projects')}</th>
                  <th>{t('column.owner')}</th>
                  <th>{t('column.deadline')}</th>
                  <th>{t('column.status')}</th>
                </tr></thead>
                <tbody>{data.upcoming.map((task) => (
                  <tr key={task.taskId}>
                    <td><a href={`#/task/${task.taskId}`}>{task.taskName}</a></td>
                    <td>
                      <a
                        href={`#/project/${task.projectId}`}
                        aria-label={t('overview.openProject', { name: task.projectName })}
                      >
                        {task.projectName}
                      </a>
                    </td>
                    <td>{taskAssignees(task, t('common.unset'))}</td>
                    <td><DeadlineCell dueDate={task.dueDate} displayStatus={task.displayStatus} showLabel={false} /></td>
                    <td>
                      <Badge tone={task.displayStatus === 'OVERDUE' ? 'danger' : 'info'}>
                        {t(`taskStatus.${task.displayStatus}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Section>

          <Section title={t('overview.areas')}>
            {data.responsibilities.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="card-grid">
                {data.responsibilities.map((card) => (
                  <div key={card.responsibilityId} className="area-card" style={{ borderColor: card.color || undefined }}>
                    <h3>{card.name}</h3>
                    <p className="muted small">
                      {card.ownerName || t('common.unset')} · {card.status === 'Active' ? null : (
                        <span>{label('responsibility.status', card.status)} · </span>
                      )}
                      {card.projectCount} {t('nav.projects')}
                    </p>
                    <dl className="mini-stats">
                      <div>
                        <dt>{t('overview.openWork')}</dt>
                        <dd>{card.openWork}</dd>
                      </div>
                      <div>
                        <dt>{t('overview.overdue')}</dt>
                        <dd className={card.overdueWork > 0 ? 'danger-cell' : undefined}>{card.overdueWork}</dd>
                      </div>
                      <div>
                        <dt>{t('overview.completedWork')}</dt>
                        <dd>{card.completedWork}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={t('overview.pending')}>
            {data.pendingRequests.length === 0 ? (
              <EmptyState text={t('requests.empty')} />
            ) : (
              <ul className="list">
                {data.pendingRequests.map((request) => (
                  <li key={request.requestId}>
                    <Badge tone={statusTone(request.status)}>{label('request.status', request.status)}</Badge>
                    <span>{request.requesterName || t('common.unknown')}</span>
                    <span className="muted small">{request.requestType}</span>
                    <button type="button" className="link-button" onClick={() => navigate('requests')}>
                      {t('nav.requests')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function taskDestination(input: {
  workState?: 'OPEN';
  displayStatus?: 'OVERDUE' | 'DONE';
  responsibilityId: string;
  unassigned: boolean;
}): string {
  return `all-work${queryString(input)}`;
}

function daysBetween(dueDate: string | null, today: string): number {
  if (!dueDate) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

function taskAssignees(task: Overview['upcoming'][number], unset: string): string {
  const names = [...new Set([task.ownerName, ...task.assigneeNames].filter(Boolean))];
  return names.join(', ') || unset;
}

function Kpi({
  label,
  value,
  tone,
  onClick
}: {
  label: string;
  value: number;
  tone: 'info' | 'danger' | 'ok' | 'neutral';
  onClick?: () => void;
}): JSX.Element {
  const content = (
    <>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={`kpi kpi-button ${tone}`} onClick={onClick} aria-label={`${label}: ${value}`}>
      {content}
    </button>
  ) : <div className={`kpi ${tone}`}>{content}</div>;
}

type Receipt = {
  taskId: string;
  requestType: string;
  submittedAt: string;
  state: string;
  requestId: string;
};

const RECEIPT_KEY = 'eh.receipts';

function readReceipts(): Record<string, Receipt> {
  try {
    const raw = window.localStorage.getItem(RECEIPT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Receipt>) : {};
  } catch {
    return {};
  }
}

function writeReceipt(taskId: string, receipt: Receipt): void {
  try {
    const all = readReceipts();
    all[taskId] = receipt;
    window.localStorage.setItem(RECEIPT_KEY, JSON.stringify(all));
  } catch {
    // Storage is optional; the receipt is also shown on screen.
  }
}

export function EmployeeHome({ actor }: { actor: Actor }): JSX.Element {
  const { t, label } = useI18n();
  const snapshot = useQuery<EmployeeSnapshot>(keys.employee, () => api.get<EmployeeSnapshot>('/api/employee/snapshot'));
  const sending = useRef(false);
  const requestId = useRef<string | null>(null);
  const [submission, setSubmission] = useState<'idle' | 'sending' | 'unknown'>('idle');
  const [worker, setWorker] = useState('');
  const [receipts, setReceipts] = useState<Record<string, Receipt>>(() => readReceipts());
  const [banner, setBanner] = useState<{ tone: string; text: string } | null>(null);
  const [form, setForm] = useState<{ taskId: string; requestType: 'DEADLINE_CHANGE' | 'COMPLETION_REPORT' } | null>(null);

  const workers = useMemo(() => {
    const names = new Set<string>();
    for (const task of snapshot.data?.tasks ?? []) {
      if (task.ownerName) names.add(task.ownerName);
      for (const name of task.assigneeNames) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ja'));
  }, [snapshot.data]);

  const tasks = (snapshot.data?.tasks ?? []).filter(
    (task) => !worker || task.ownerName === worker || task.assigneeNames.includes(worker)
  );

  async function submit(input: {
    taskId: string;
    requestType: 'DEADLINE_CHANGE' | 'COMPLETION_REPORT';
    requestedDueDate?: string;
    reason?: string;
    explanation?: string;
    completionNote?: string;
    requesterName?: string;
  }): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setSubmission('sending');
    const clientRequestId = requestId.current ?? (
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    requestId.current = clientRequestId;
    setBanner({ tone: 'info', text: t('request.transport.SENDING') });
    const receipt: Receipt = {
      taskId: input.taskId,
      requestType: input.requestType,
      submittedAt: new Date().toISOString(),
      state: 'SENDING',
      requestId: clientRequestId
    };
    try {
      const result = await api.post<{ requestId: string; state: string }>('/api/employee/requests', {
        ...input,
        clientRequestId
      });
      setForm(null);
      setSubmission('idle');
      requestId.current = null;
      receipt.state = result.state;
      receipt.requestId = result.requestId;
      writeReceipt(input.taskId, receipt);
      setReceipts(readReceipts());
      setBanner({ tone: 'ok', text: t('request.transport.RECEIVED') });
      queryCache.invalidate([keys.employee]);
    } catch (failure) {
      if (failure instanceof ApiFailure && (failure.code === 'NETWORK' || failure.code === 'INVALID_RESPONSE')) {
        setSubmission('unknown');
        receipt.state = 'OUTCOME_UNKNOWN';
        writeReceipt(input.taskId, receipt);
        setReceipts(readReceipts());
        setBanner({ tone: 'warning', text: t('request.transport.OUTCOME_UNKNOWN') });
        return;
      }
      requestId.current = null;
      setSubmission('idle');
      writeReceipt(input.taskId, { ...receipt, state: 'FAILED' });
      setReceipts(readReceipts());
      setBanner({
        tone: 'danger',
        text: failure instanceof ApiFailure ? failure.message : t('common.error')
      });
    } finally {
      sending.current = false;
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.overview')}</h2>
        <label className="inline-field">
          <span>{t('request.form.owner')}</span>
          <select value={worker} onChange={(event) => setWorker(event.target.value)}>
            <option value="">{t('filter.all')}</option>
            {workers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">{t('request.form.owner')}: {actor.name} · {t('login.domain')}</p>

      {banner ? <div className={`banner ${banner.tone}`}>{banner.text}</div> : null}
      <ErrorBox error={snapshot.error} onRetry={() => snapshot.refresh()} />

      {!snapshot.data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : !snapshot.data.submissionEnabled ? (
        <div className="banner warning">{snapshot.data.submissionClosedMessage || t('request.config.disabled')}</div>
      ) : null}

      <Section title={t('nav.tasks')}>
        {tasks.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="card-grid">
            {tasks.map((task) => {
              const receipt = receipts[task.taskId];
              return (
                <ProjectAccent key={task.taskId} projectId={task.projectId} className="task-card">
                  <div className="task-card-head">
                    <span className="project-dot" style={{ background: projectColor(task.projectId) }} aria-hidden="true" />
                    <h3>{task.taskName}</h3>
                  </div>
                  <p className="muted small">
                    {task.projectName} · {task.responsibilityName || t('overview.unassigned')}
                  </p>
                  <div className="task-card-meta">
                    <Badge tone={statusTone(task.status)}>{label('task.status', task.status)}</Badge>
                    <DeadlineCell dueDate={task.dueDate} displayStatus={task.displayStatus} />
                    {task.pendingRequest ? <Badge tone="warn">{t('request.status.PENDING')}</Badge> : null}
                  </div>
                  <ProgressBar value={task.progressPercent} />
                  {receipt ? (
                    <p className="muted small">
                      {receipt.state === 'OUTCOME_UNKNOWN'
                        ? t('request.transport.OUTCOME_UNKNOWN')
                        : `${receipt.requestId} · ${receipt.submittedAt.slice(0, 16).replace('T', ' ')}`}
                    </p>
                  ) : null}
                  {snapshot.data?.submissionEnabled && !task.container ? (
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={!!form}
                         onClick={() => setForm({ taskId: task.taskId, requestType: 'DEADLINE_CHANGE' })}
                      >
                        {t('request.action.deadline')}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={!!form}
                         onClick={() => setForm({ taskId: task.taskId, requestType: 'COMPLETION_REPORT' })}
                      >
                        {t('request.action.completion')}
                      </button>
                    </div>
                  ) : null}
                </ProjectAccent>
              );
            })}
          </div>
        )}
      </Section>

      {form ? (
        <RequestForm
          key={form.taskId + form.requestType}
          submission={submission}
          taskId={form.taskId}
          requestType={form.requestType}
          onCancel={() => setForm(null)}
          onSubmit={(values) => submit({ taskId: form.taskId, requestType: form.requestType, ...values })}
        />
      ) : null}
    </div>
  );
}

export function RequestForm({
  submission = 'idle',
  taskId,
  requestType,
  onCancel,
  onSubmit
}: {
  submission?: 'idle' | 'sending' | 'unknown';
  taskId: string;
  requestType: 'DEADLINE_CHANGE' | 'COMPLETION_REPORT';
  onCancel: () => void;
  onSubmit: (values: {
    requestedDueDate?: string;
    reason?: string;
    explanation?: string;
    completionNote?: string;
    requesterName?: string;
  }) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const [requestedDueDate, setRequestedDueDate] = useState('');
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [completionNote, setCompletionNote] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [validation, setValidation] = useState('');
  const valid =
    requestType === 'DEADLINE_CHANGE'
      ? !!requestedDueDate
      : completionNote.trim().length > 0;

  return (
    <div className="card form-card">
      <h2>{requestType === 'DEADLINE_CHANGE' ? t('request.action.deadline') : t('request.action.completion')}</h2>
      <p className="muted small">{t('request.confirm.id')}: {taskId}</p>
      <div className="stack">
        <fieldset className="stack form-fields" disabled={submission !== 'idle'}>
        {requestType === 'DEADLINE_CHANGE' ? (
          <>
            <label className="field">
              <span className="field-label">{t('request.form.requestedDeadline')}</span>
              <input type="date" value={requestedDueDate} onChange={(event) => setRequestedDueDate(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">{t('request.form.reason')}</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
            </label>
          </>
        ) : (
          <label className="field">
            <span className="field-label">{t('request.completion.note')}</span>
            <textarea value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} rows={3} />
          </label>
        )}
        <label className="field">
          <span className="field-label">{t('request.form.explanation')}</span>
          <textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={3} />
        </label>
        <label className="field">
          <span className="field-label">{t('request.form.requester')}</span>
          <input value={requesterName} onChange={(event) => setRequesterName(event.target.value)} maxLength={200} />
        </label>
        </fieldset>
        {submission === 'unknown' && <p role="status" className="banner warning">{t('state.unknown')}</p>}
        {validation ? <div className="banner danger">{validation}</div> : null}
        <div className="inline-actions">
          <button type="button" className="button secondary" disabled={submission !== 'idle'} onClick={onCancel}>
            {t('request.form.cancel')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!valid || submission === 'sending'}
            onClick={() => {
              if (!valid) {
                setValidation(t('request.form.requiredNote'));
                return;
              }
              void onSubmit({
                requestedDueDate: requestedDueDate || undefined,
                reason: reason || undefined,
                explanation: explanation || undefined,
                completionNote: completionNote || undefined,
                requesterName: requesterName || undefined
              });
            }}
          >
            {submission === 'sending' ? t('state.saving') : submission === 'unknown' ? t('state.retry') : t('request.form.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
