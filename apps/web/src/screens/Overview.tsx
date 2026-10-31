/**
 * Overview for managers, and the published-task home for employees.
 *
 * The employee view never calls a manager endpoint: it reads only the allowlisted snapshot and
 * submits a request. Submission is non-blocking: the form closes when the request is validated,
 * the receipt state is reported only after a durable acknowledgement, and an unobservable
 * outcome is shown as unknown rather than retried automatically.
 */
import { useMemo, useState } from 'react';
import type { Actor, EmployeeSnapshot, Overview, Reference } from '@eh/contracts';
import { api, ApiFailure, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, ProgressBar, ProjectAccent, Section, statusTone } from '../components/ui';
import { navigate } from '../App';
import { projectColor } from '@eh/domain';

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

  const bootstrap = useQuery<BootstrapShape>(keys.bootstrap, () => api.get<BootstrapShape>('/api/manager/bootstrap'));
  const key = `${keys.overview}${queryString({ responsibilityId, unassigned })}`;
  const overview = useQuery<Overview>(key, () =>
    api.get<Overview>(`/api/manager/overview${queryString({ responsibilityId, unassigned })}`)
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
            <Kpi label={t('overview.openWork')} value={data.counts.openWork} tone="info" />
            <Kpi label={t('overview.overdue')} value={data.counts.overdueWork} tone="danger" />
            <Kpi label={t('overview.completed')} value={data.counts.completedWork} tone="ok" />
            <Kpi label={t('overview.containers')} value={data.counts.containers} tone="neutral" />
          </div>

          <Section title={t('overview.upcoming')}>
            {data.upcoming.length === 0 ? (
              <EmptyState />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('column.name')}</th>
                    <th>{t('column.status')}</th>
                    <th>{t('column.deadline')}</th>
                    <th>{t('column.progress')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming.map((task) => (
                    <tr key={task.taskId}>
                      <td>
                        <a href={`#/task/${task.taskId}`}>{task.taskName}</a>
                        <span className="muted small"> · {task.projectName}</span>
                      </td>
                      <td>
                        <Badge tone={statusTone(task.status)}>{label('task.status', task.status)}</Badge>
                      </td>
                      <td>{task.dueDate ?? t('common.unset')}</td>
                      <td>
                        <ProgressBar value={task.progressPercent} />
                      </td>
                    </tr>
                  ))}
                </tbody>
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
                      {card.ownerName || t('common.unset')} · {card.projectCount} {t('nav.projects')}
                    </p>
                    <dl className="mini-stats">
                      <div>
                        <dt>{t('overview.openWork')}</dt>
                        <dd>{card.openWork}</dd>
                      </div>
                      <div>
                        <dt>{t('overview.overdue')}</dt>
                        <dd>{card.overdueWork}</dd>
                      </div>
                    </dl>
                    <ProgressBar value={card.progressPercent} />
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

function Kpi({ label, value, tone }: { label: string; value: number; tone: 'info' | 'danger' | 'ok' | 'neutral' }): JSX.Element {
  return (
    <div className={`kpi ${tone}`}>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
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
    const clientRequestId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setForm(null);
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
      receipt.state = result.state;
      receipt.requestId = result.requestId;
      writeReceipt(input.taskId, receipt);
      setReceipts(readReceipts());
      setBanner({ tone: 'ok', text: t('request.transport.RECEIVED') });
      queryCache.invalidate([keys.employee]);
    } catch (failure) {
      if (failure instanceof ApiFailure && (failure.code === 'NETWORK' || failure.code === 'INVALID_RESPONSE')) {
        receipt.state = 'OUTCOME_UNKNOWN';
        writeReceipt(input.taskId, receipt);
        setReceipts(readReceipts());
        setBanner({ tone: 'warning', text: t('request.transport.OUTCOME_UNKNOWN') });
        return;
      }
      writeReceipt(input.taskId, { ...receipt, state: 'FAILED' });
      setReceipts(readReceipts());
      setBanner({
        tone: 'danger',
        text: failure instanceof ApiFailure ? failure.message : t('common.error')
      });
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
                    <span className="muted small">
                      {t('column.deadline')}: {task.dueDate ?? t('common.unset')}
                    </span>
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
                        onClick={() => setForm({ taskId: task.taskId, requestType: 'DEADLINE_CHANGE' })}
                      >
                        {t('request.action.deadline')}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
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
          taskId={form.taskId}
          requestType={form.requestType}
          onCancel={() => setForm(null)}
          onSubmit={(values) => submit({ taskId: form.taskId, requestType: form.requestType, ...values })}
        />
      ) : null}
    </div>
  );
}

function RequestForm({
  taskId,
  requestType,
  onCancel,
  onSubmit
}: {
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
        {validation ? <div className="banner danger">{validation}</div> : null}
        <div className="inline-actions">
          <button type="button" className="button secondary" onClick={onCancel}>
            {t('request.form.cancel')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!valid}
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
            {t('request.form.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
