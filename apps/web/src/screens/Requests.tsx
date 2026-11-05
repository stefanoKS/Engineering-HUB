/** 申請一覧: one authorized import per page entry, a filter, and the reviewed decision. */
import { useEffect, useState } from 'react';
import type { Actor, RequestQueue, TaskRequest } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Pagination, Section, statusTone } from '../components/ui';
import { ConfirmDialog } from '../components/forms';

export function RequestsScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t, label } = useI18n();
  void actor;
  const [page, setPage] = useState(1);
  const [includeDecided, setIncludeDecided] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [syncOnce, setSyncOnce] = useState(false);
  const [decision, setDecision] = useState<{ request: TaskRequest; kind: 'APPROVE' | 'REJECT' | 'RETURN' } | null>(null);

  const key = `${keys.requests}:${includeDecided}:${page}`;
  const queue = useQuery<RequestQueue>(key, () =>
    api.get<RequestQueue>(`/api/manager/requests?includeDecided=${includeDecided}&page=${page}&pageSize=25`)
  );

  // Exactly one import per page entry; a filter or language change never re-imports.
  useEffect(() => {
    if (syncOnce) return;
    setSyncOnce(true);
    let cancelled = false;
    api
      .post<RequestQueue>('/api/manager/requests/sync', { includeDecided })
      .then((result) => {
        if (cancelled) return;
        if (result.imported.imported > 0) queryCache.invalidate([keys.requests, keys.tasks, keys.taskIndex, keys.overview]);
        setImportMessage(
          result.imported.configured
            ? result.imported.failed > 0
              ? result.imported.message
              : t('requests.imported', { n: result.imported.imported })
            : result.imported.message
        );
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        // An import failure is a warning: it never hides already imported requests.
        setImportMessage(failure instanceof Error ? failure.message : t('common.error'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.requests')}</h2>
        <div className="filters">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeDecided}
              onChange={(event) => {
                setIncludeDecided(event.target.checked);
                setPage(1);
                queryCache.invalidate([keys.requests]);
              }}
            />
            {t('requests.includeDecided')}
          </label>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              void api
                .post<RequestQueue>('/api/manager/requests/sync', { includeDecided })
                .then((result) => {
                  queryCache.invalidate([keys.requests]);
                  setImportMessage(
                    result.imported.configured
                      ? t('requests.imported', { n: result.imported.imported })
                      : result.imported.message
                  );
                })
                .catch((failure: unknown) =>
                  setImportMessage(failure instanceof Error ? failure.message : t('common.error'))
                )
            }
          >
            {t('requests.sync')}
          </button>
        </div>
      </div>

      {importMessage ? <div className="banner info">{importMessage}</div> : null}
      <ErrorBox error={queue.error} onRetry={() => queue.refresh()} />

      <Section title={t('nav.requests')}>
        {!queue.data ? (
          <p className="muted">{t('state.loading')}</p>
        ) : queue.data.items.length === 0 ? (
          <EmptyState text={t('requests.empty')} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('requests.task')}</th>
                <th>{t('requests.context')}</th>
                <th>{t('requests.reporter')}</th>
                <th>{t('requests.submitted')}</th>
                <th>{t('request.confirm.note')}</th>
                <th>{t('requests.state')}</th>
                <th>{t('column.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {queue.data.items.map((request) => (
                <tr key={request.requestId}>
                  <td>
                    <strong>{request.taskName || request.taskId}</strong>
                    <div className="muted small">{label('request.type', request.requestType) || request.requestType}</div>
                    <div className="muted small">{request.requestId}</div>
                  </td>
                  <td>
                    {request.projectName || t('common.unset')}
                    {request.subprojectName ? <div className="muted small">{request.subprojectName}</div> : null}
                  </td>
                  <td>
                    {request.requesterName || t('common.unknown')}
                    {request.requesterMemberId ? null : (
                      <div className="muted small">{t('requests.selfReported')}</div>
                    )}
                    <div>
                      <a href={`#/task/${request.taskId}`} target="_blank" rel="noopener noreferrer">
                        {t('requests.openTask')}
                      </a>
                    </div>
                  </td>
                  <td className="muted small">{request.submittedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="muted small">
                    {request.requestType === 'DEADLINE_CHANGE'
                      ? `${request.originalDueDate ?? '-'} → ${request.requestedDueDate ?? '-'}`
                      : request.completionNote}
                  </td>
                  <td>
                    <Badge tone={statusTone(request.status)}>{label('request.status', request.status)}</Badge>
                    {request.status === 'STALE' ? (
                      <div className="muted small">{t('requests.stale')}</div>
                    ) : null}
                    {request.reviewer ? (
                      <div className="muted small">{t('report.reviewedBy', { name: request.reviewer })}</div>
                    ) : null}
                  </td>
                  <td className="actions">
                    {['PENDING', 'PROCESSING'].includes(request.status) ? (
                      <>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setDecision({ request, kind: 'APPROVE' })}
                        >
                          {t('requests.approve')}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setDecision({ request, kind: 'REJECT' })}
                        >
                          {t('requests.reject')}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setDecision({ request, kind: 'RETURN' })}
                        >
                          {t('requests.return')}
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {queue.data && <Pagination page={queue.data.page} totalPages={queue.data.totalPages} total={queue.data.total} onChange={setPage} />}
      </Section>

      {decision ? (
        <DecisionDialog
          request={decision.request}
          kind={decision.kind}
          onClose={() => setDecision(null)}
          onDecided={() => {
            setDecision(null);
            queryCache.invalidate([keys.requests, keys.tasks, keys.task(decision.request.taskId), keys.overview, keys.taskIndex, keys.project(decision.request.projectId ?? ''), keys.myWork, keys.timeline]);
          }}
        />
      ) : null}
    </div>
  );
}

function DecisionDialog({
  request,
  kind,
  onClose,
  onDecided
}: {
  request: TaskRequest;
  kind: 'APPROVE' | 'REJECT' | 'RETURN';
  onClose: () => void;
  onDecided: () => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const [note, setNote] = useState('');
  return (
    <ConfirmDialog
      title={
        kind === 'APPROVE' ? t('requests.approve') : kind === 'REJECT' ? t('requests.reject') : t('requests.return')
      }
      message={
        <div className="stack">
          <dl className="request-summary">
            <dt>{t('requests.task')}</dt>
            <dd>{request.taskName || request.taskId}</dd>
            <dt>{t('requests.context')}</dt>
            <dd>
              {request.projectName || t('common.unset')}
              {request.subprojectName ? ` / ${request.subprojectName}` : ''}
            </dd>
            <dt>{t('request.form.task')}</dt>
            <dd>{label('request.type', request.requestType) || request.requestType}</dd>
            <dt>{t('requests.reporter')}</dt>
            <dd>
              {request.requesterName || t('common.unknown')}
              {request.requesterMemberId ? null : (
                <span className="muted small"> · {t('requests.selfReported')}</span>
              )}
            </dd>
            <dt>{t('requests.submitted')}</dt>
            <dd>{request.submittedAt.slice(0, 16).replace('T', ' ')}</dd>
            <dt>{t('requests.state')}</dt>
            <dd>{label('request.status', request.status)}</dd>
          </dl>
          <p>
            {request.requestType === 'DEADLINE_CHANGE'
              ? `${request.originalDueDate ?? '-'} → ${request.requestedDueDate ?? '-'}`
              : request.completionNote}
          </p>
          <p className="muted small">
            {kind === 'APPROVE'
              ? t('requests.approveHelp')
              : kind === 'REJECT'
                ? t('requests.rejectHelp')
                : t('requests.returnHelp')}
          </p>
          <p className="muted small">
            {t('request.confirm.id')}: {request.requestId} · {request.taskId}
          </p>
          <label className="field">
            <span className="field-label">{t('requests.note')}</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </label>
        </div>
      }
      destructive={kind !== 'APPROVE'}
      onCancel={onClose}
      onConfirm={async () => {
        await api.post(`/api/manager/requests/${request.requestId}/decide`, {
          decision: kind,
          revision: request.revision,
          note: note || undefined,
          confirmed: true
        });
        onDecided();
      }}
    />
  );
}
