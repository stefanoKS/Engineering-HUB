/** 申請一覧: one authorized import per page entry, one synchronisation path, reviewed decisions. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Actor, RequestQueue, TaskRequest } from '@eh/contracts';
import { ApiFailure, api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import {
  Badge,
  DescriptionText,
  EmptyState,
  Modal,
  Pagination,
  Section,
  statusTone
} from '../components/ui';
import { ConfirmDialog, type ReloadOutcome } from '../components/forms';
import { FreshnessLine, NoMatches, NoReadableScope, QueryState, RefreshWarning } from '../components/query-state';
import { useDivisionScope } from '../state/division';
import { useDivisionTransition } from '../state/scope';
import { formatTokyoTimestamp } from '../state/format';
import { commitMutation } from '../state/mutation';

/** Everything a decision changes; a request decision is a task write for invalidation purposes. */
const DECISION_EFFECTS = [
  keys.requests,
  keys.tasks,
  keys.taskIndex,
  keys.overview,
  keys.myWork,
  keys.timeline
];

type SyncFeedback = { tone: 'ok' | 'warning' | 'danger' | 'info'; text: string; scope: string };

/** A single request, read by id through the authorized bounded lookup. */
async function readRequest(requestId: string): Promise<TaskRequest> {
  const payload = await api.get<{ request: TaskRequest }>(
    `/api/manager/requests/${encodeURIComponent(requestId)}`
  );
  return payload.request;
}

export function RequestsScreen({ actor, routeSearch = '' }: { actor: Actor; routeSearch?: string }): JSX.Element {
  const { t, label } = useI18n();
  void actor;
  const [page, setPage] = useState(1);
  const [includeDecided, setIncludeDecided] = useState(false);
  const [feedback, setFeedback] = useState<SyncFeedback | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [decision, setDecision] = useState<{ request: TaskRequest; kind: 'APPROVE' | 'REJECT' | 'RETURN' } | null>(null);
  const [details, setDetails] = useState<TaskRequest | null>(null);
  // A link from the overview names the request it came from. It is resolved by id, never by
  // scanning the loaded page.
  const focusRequestId = new URLSearchParams(routeSearch).get('requestId') ?? '';
  const division = useDivisionScope();
  const divisionId = division.selected ?? undefined;
  const scope = divisionId ?? 'all';
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const key = `${keys.requests}:${includeDecided}:${scope}:${page}`;
  const queue = useQuery<RequestQueue>(key, () =>
    api.get<RequestQueue>(
      `/api/manager/requests?includeDecided=${includeDecided}&page=${page}&pageSize=25${divisionId ? `&divisionId=${encodeURIComponent(divisionId)}` : ''}`
    )
  );

  // A scope change starts the queue again at page 1, and feedback that described the previous
  // scope is dropped rather than shown under the new one.
  useDivisionTransition(() => {
    setPage(1);
    setFeedback(null);
  });

  const inFlight = useRef(false);
  const generation = useRef(0);

  /**
   * The one synchronisation path.
   *
   * Page entry and the manual control run exactly the same code: the selected scope is sent, a
   * concurrent submission is refused synchronously, the busy state is shown, and the outcome is
   * described honestly. A failed import never hides the queue and never claims success.
   *
   * The cache effect belongs to the session (it runs even when this screen is gone); the feedback
   * belongs to this mounted screen and to the scope it was started in.
   */
  const runSync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const sessionEpoch = queryCache.sessionEpoch;
    const owner = ++generation.current;
    if (mounted.current) setSyncing(true);
    try {
      const result = await api.post<RequestQueue>('/api/manager/requests/sync', {
        includeDecided,
        ...(divisionId ? { divisionId } : {})
      });
      // An answer from an ended session has no effect at all - not even on the cache.
      if (queryCache.sessionEpoch !== sessionEpoch) return;
      const imported = result.imported;
      // Only an import that changed something costs a re-read, and that is session-owned.
      if (imported.configured && imported.failed === 0 && imported.imported > 0) {
        queryCache.invalidate([...DECISION_EFFECTS]);
      }
      // The feedback is scope-specific and UI-specific: it is only applied by the still-current
      // render of the scope that started it.
      if (!mounted.current || owner !== generation.current) return;
      if (!imported.configured) {
        setFeedback({ tone: 'warning', text: t('requests.syncNotConfigured'), scope });
        return;
      }
      if (imported.failed > 0) {
        setFeedback({
          tone: 'warning',
          text: t('requests.syncPartial', { n: imported.imported, failed: imported.failed }),
          scope
        });
        return;
      }
      setFeedback(
        imported.imported > 0
          ? { tone: 'ok', text: t('requests.syncDone', { n: imported.imported }), scope }
          : { tone: 'info', text: t('requests.syncNothingNew'), scope }
      );
    } catch {
      if (queryCache.sessionEpoch !== sessionEpoch) return;
      // A failed import is a warning: it never hides the requests already on screen and never
      // claims that synchronisation succeeded.
      if (!mounted.current || owner !== generation.current) return;
      setFeedback({ tone: 'danger', text: t('requests.syncFailed'), scope });
    } finally {
      // The guard always settles, so a scope change can never leave the screen permanently busy.
      inFlight.current = false;
      if (mounted.current && owner === generation.current) setSyncing(false);
    }
  }, [divisionId, includeDecided, scope, t]);

  // Exactly one automatic import per page entry. A filter, language or render change never
  // re-imports; only entering the screen does.
  const entered = useRef(false);
  useEffect(() => {
    if (entered.current) return;
    entered.current = true;
    void runSync();
  }, [runSync]);

  // A pending deep-link lookup is abandoned when the link, the scope or the session changes, and a
  // late answer never reopens a closed dialog.
  const lookup = useRef(0);
  useEffect(() => {
    if (!focusRequestId) return undefined;
    const owner = ++lookup.current;
    const sessionEpoch = queryCache.sessionEpoch;
    let cancelled = false;
    void readRequest(focusRequestId)
      .then((request) => {
        if (cancelled || owner !== lookup.current) return;
        if (!mounted.current || queryCache.sessionEpoch !== sessionEpoch) return;
        setDetails(request);
      })
      .catch((failure: unknown) => {
        if (cancelled || owner !== lookup.current) return;
        if (!mounted.current || queryCache.sessionEpoch !== sessionEpoch) return;
        const code = failure instanceof ApiFailure ? failure.code : '';
        setFeedback({
          tone: 'warning',
          text:
            code === 'NOT_FOUND'
              ? t('requests.linkUnavailable')
              : t('requests.linkLookupFailed'),
          scope
        });
      });
    return () => {
      cancelled = true;
    };
  }, [focusRequestId, scope, t]);

  // Feedback that belongs to a previous scope is not shown under the current one.
  const visibleFeedback = feedback && feedback.scope === scope ? feedback : null;

  /**
   * Conflict recovery for a decision.
   *
   * The selected request is re-read by id and replaces the snapshot the dialog will submit, so the
   * next confirmation carries the current revision. Nothing is merged, and an unusable record
   * disables the action.
   */
  const reloadDecision = async (requestId: string): Promise<ReloadOutcome> => {
    const sessionEpoch = queryCache.sessionEpoch;
    try {
      const fresh = await readRequest(requestId);
      // A reload that finishes after the session ended or after this screen closed changes nothing.
      if (!mounted.current || queryCache.sessionEpoch !== sessionEpoch) {
        return { status: 'failed', message: t('common.error') };
      }
      if (!fresh.canDecide) {
        return { status: 'ineligible', message: t('requests.decideRedonlyNow') };
      }
      if (!['PENDING', 'PROCESSING'].includes(fresh.status)) {
        return { status: 'ineligible', message: t('requests.decideAlreadySettled') };
      }
      setDecision((current) => (current && current.request.requestId === requestId ? { ...current, request: fresh } : current));
      return { status: 'fresh' };
    } catch (failure) {
      const code = failure instanceof ApiFailure ? failure.code : '';
      return {
        status: 'failed',
        message: code === 'NOT_FOUND' ? t('requests.linkUnavailable') : t('common.error')
      };
    }
  };

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
              }}
            />
            {t('requests.includeDecided')}
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={syncing}
            aria-busy={syncing}
            onClick={() => void runSync()}
          >
            {syncing ? t('requests.syncBusy') : t('requests.sync')}
          </button>
        </div>
      </div>

      {visibleFeedback ? (
        <div
          className={`banner ${visibleFeedback.tone}`}
          role={visibleFeedback.tone === 'danger' ? 'alert' : 'status'}
        >
          {visibleFeedback.text}
        </div>
      ) : null}

      <FreshnessLine
        updatedAt={queue.updatedAt}
        refreshing={queue.refreshing}
        stale={queue.stale}
        onRefresh={queue.refresh}
      />

      <QueryState query={queue}>
        {(data) => (
          <>
            {queue.error ? <RefreshWarning error={queue.error} onRetry={queue.refresh} /> : null}
            <Section title={t('nav.requests')}>
              {division.loaded && division.readable.length === 0 ? (
                <NoReadableScope />
              ) : data.items.length === 0 ? (
                includeDecided ? (
                  <EmptyState text={t('requests.empty')} />
                ) : (
                  <NoMatches />
                )
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('requests.task')}</th>
                      <th>{t('requests.context')}</th>
                      <th>{t('requests.reporter')}</th>
                      <th>{t('requests.submitted')}</th>
                      <th>{t('requests.summary')}</th>
                      <th>{t('requests.state')}</th>
                      <th>{t('column.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((request) => (
                      <tr
                        key={request.requestId}
                        data-request-id={request.requestId}
                        className={request.requestId === focusRequestId ? 'row-highlight' : undefined}
                      >
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
                        {/* Instants are Tokyo wall-clock values; the stored string is untouched. */}
                        <td className="muted small">{formatTokyoTimestamp(request.submittedAt)}</td>
                        <td className="muted small">
                          {request.requestType === 'DEADLINE_CHANGE'
                            ? `${request.originalDueDate ?? '-'} → ${request.requestedDueDate ?? '-'}`
                            : truncate(request.completionNote, 80)}
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
                        <td className="project-actions-cell">
                          <div className="actions">
                            <button type="button" className="link-button" onClick={() => setDetails(request)}>
                              {t('requests.details')}
                            </button>
                            {/* A decision is offered only when the server says this caller may decide
                                *this* request; a missing capability is treated as "no". */}
                            {request.canDecide === true && ['PENDING', 'PROCESSING'].includes(request.status) ? (
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
                            ) : request.canDecide === false && ['PENDING', 'PROCESSING'].includes(request.status) ? (
                              <span className="read-only-record" title={t('capability.readOnlyRecordHelp')}>
                                {t('capability.readOnlyRecord')}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
            </Section>
          </>
        )}
      </QueryState>

      {details ? <RequestDetails request={details} onClose={() => setDetails(null)} /> : null}

      {decision ? (
        <DecisionDialog
          request={decision.request}
          kind={decision.kind}
          onClose={() => setDecision(null)}
          onReload={() => reloadDecision(decision.request.requestId)}
          onDecided={() => {
            const decided = decision.request;
            setDecision(null);
            // A decision is a task write for invalidation purposes: the derived values are re-read
            // from the server, never rebuilt from a guess.
            queryCache.invalidate([keys.task(decided.taskId), keys.project(decided.projectId ?? '')]);
          }}
        />
      ) : null}
    </div>
  );
}

function truncate(text: string, max: number): string {
  const value = text.trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** One readable review summary: what was asked, why, and how it was decided. */
function RequestDetails({ request, onClose }: { request: TaskRequest; onClose: () => void }): JSX.Element {
  const { t, label } = useI18n();
  return (
    <Modal
      title={t('requests.reviewHeading')}
      onClose={onClose}
      footer={
        <button type="button" className="button secondary" onClick={onClose}>
          {t('requests.close')}
        </button>
      }
    >
      <div className="stack request-review">
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
          <dd>{formatTokyoTimestamp(request.submittedAt)}</dd>
          <dt>{t('requests.state')}</dt>
          <dd>
            <Badge tone={statusTone(request.status)}>{label('request.status', request.status)}</Badge>
          </dd>
          {request.requestType === 'DEADLINE_CHANGE' ? (
            <>
              <dt>{t('requests.current')}</dt>
              <dd>{request.originalDueDate ?? t('common.unset')}</dd>
              <dt>{t('requests.requested')}</dt>
              <dd>{request.requestedDueDate ?? t('common.unset')}</dd>
            </>
          ) : null}
        </dl>

        {request.requestType === 'COMPLETION_REPORT' ? (
          <div>
            <h3>{t('requests.completionNote')}</h3>
            <DescriptionText text={request.completionNote || t('requests.noNote')} />
          </div>
        ) : null}

        <div>
          <h3>{t('requests.reason')}</h3>
          <DescriptionText text={request.reason || t('requests.noNote')} />
        </div>
        <div>
          <h3>{t('requests.explanation')}</h3>
          <DescriptionText text={request.explanation || t('requests.noNote')} />
        </div>

        {request.status === 'STALE' ? (
          <div className="banner warning" role="status">
            <strong>{t('requests.staleReason')}</strong>
            <DescriptionText text={request.staleReason || t('requests.stale')} />
          </div>
        ) : null}

        {request.reviewer || request.decidedAt ? (
          <div className="request-decision">
            <h3>{t('requests.decidedAt')}</h3>
            <dl className="request-summary">
              <dt>{t('requests.state')}</dt>
              <dd>{label('request.status', request.status)}</dd>
              <dt>{t('requests.reporter')}</dt>
              <dd>{request.reviewer || t('common.unknown')}</dd>
              <dt>{t('requests.decidedAt')}</dt>
              <dd>{request.decidedAt ? formatTokyoTimestamp(request.decidedAt) : t('common.unset')}</dd>
            </dl>
            <h3>{t('requests.decisionNote')}</h3>
            <DescriptionText text={request.decisionNote || t('requests.noNote')} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function DecisionDialog({
  request,
  kind,
  onClose,
  onDecided,
  onReload
}: {
  request: TaskRequest;
  kind: 'APPROVE' | 'REJECT' | 'RETURN';
  onClose: () => void;
  onDecided: () => void;
  onReload: () => Promise<ReloadOutcome>;
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
            <dd>{formatTokyoTimestamp(request.submittedAt)}</dd>
            <dt>{t('requests.state')}</dt>
            <dd>{label('request.status', request.status)}</dd>
            <dt>{t('request.confirm.revision')}</dt>
            <dd>{request.revision}</dd>
          </dl>
          <p>
            {request.requestType === 'DEADLINE_CHANGE'
              ? `${request.originalDueDate ?? '-'} → ${request.requestedDueDate ?? '-'}`
              : request.completionNote}
          </p>
          {request.reason ? (
            <div>
              <h3>{t('requests.reason')}</h3>
              <DescriptionText text={request.reason} />
            </div>
          ) : null}
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
      onReload={onReload}
      onConfirm={async () => {
        // The revision-checked decision is one commit; cache effects belong to the mutation, so a
        // dialog that closes while it is in flight still refreshes the queue and derived views.
        const outcome = await commitMutation(
          () =>
            api.post(`/api/manager/requests/${request.requestId}/decide`, {
              decision: kind,
              revision: request.revision,
              note: note || undefined,
              confirmed: true
            }),
          DECISION_EFFECTS
        );
        // An answer that belongs to an ended session has no follow-up effect here.
        if (outcome.status !== 'committed') return;
        onDecided();
      }}
    />
  );
}
