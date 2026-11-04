/**
 * The single completion-report form, shared by My Assigned Work and task detail.
 *
 * The member identity and the eligibility rules come from the server; this panel only collects
 * the note. An unobservable outcome is reported as unknown and is never retried automatically.
 */
import { useState } from 'react';
import { ApiFailure, api } from '../api/client';
import { useI18n } from '../i18n';
import { keys, queryCache } from '../state/cache';
import { createIdempotencyKey } from './forms';

export function CompletionReportPanel({
  taskId,
  blockedReasons,
  onSubmitted,
  onDismiss
}: {
  taskId: string;
  /** Every reason the server would refuse this report, so a disabled action always explains itself. */
  blockedReasons: string[];
  onSubmitted: () => void;
  onDismiss?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'unknown'>('idle');
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);
  const [requestId] = useState(createIdempotencyKey);

  const submit = async (): Promise<void> => {
    if (!note.trim() || state === 'sending' || state === 'done' || blockedReasons.length > 0) return;
    setState('sending');
    setMessage(null);
    try {
      const result = await api.post<{ requestId: string }>('/api/employee/requests', {
        clientRequestId: requestId,
        taskId,
        requestType: 'COMPLETION_REPORT',
        completionNote: note.trim()
      });
      setState('done');
      setMessage({ tone: 'ok', text: `${t('request.completion.heading')} ${t('request.confirm.id')}: ${result.requestId}` });
      queryCache.invalidate([keys.myRequests, keys.myWork, keys.task(taskId), keys.tasks, keys.requests]);
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
    <div className="card stack completion-report">
      <h4>{t('report.heading')}</h4>
      {blockedReasons.length > 0 ? (
        <div className="validation-summary" role="status">
          <ul>
            {blockedReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <label className="field">
          <span className="field-label">{t('report.note')}</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            disabled={state !== 'idle'}
          />
        </label>
      )}
      {message ? (
        <div className={`banner ${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </div>
      ) : null}
      {state === 'done' ? <p className="muted small">{t('request.completion.body')}</p> : null}
      <div className="inline-actions">
        {onDismiss ? (
          <button type="button" className="button secondary" onClick={onDismiss} disabled={state === 'sending'}>
            {state === 'done' ? t('report.dismiss') : t('request.form.cancel')}
          </button>
        ) : null}
        {blockedReasons.length === 0 ? (
          <button
            type="button"
            className="button"
            disabled={!note.trim() || state === 'sending' || state === 'done'}
            onClick={() => void submit()}
          >
            {state === 'sending' ? t('report.submitting') : t('report.submit')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
