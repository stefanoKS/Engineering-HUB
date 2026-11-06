/**
 * Completion and extension requests, in one reusable accessible dialog.
 *
 * The dialog identifies the task, its project and subproject and the current deadline, focuses the
 * first input, keeps the background inert (the native `<dialog>` does that), traps focus, supports
 * Escape and Cancel, and restores focus to the control that opened it. The draft stays in memory
 * across a validation error, a temporary failure and a language change, and nothing is written to
 * browser storage. Submission keeps the documented non-blocking semantics: the request is reported
 * as received only after a durable acknowledgement, a duplicate cannot be sent twice, and an
 * unobservable outcome stays explicitly unknown - it is never retried automatically.
 */
import { useEffect, useRef, useState } from 'react';
import type { SubmissionBlockReason } from '@eh/contracts';
import { ApiFailure, api } from '../api/client';
import { useI18n } from '../i18n';
import { keys, queryCache } from '../state/cache';
import { Modal } from './ui';
import { createIdempotencyKey } from './forms';

export type RequestKind = 'DEADLINE_CHANGE' | 'COMPLETION_REPORT';

export type RequestDialogProps = {
  taskId: string;
  taskName: string;
  projectName: string;
  subprojectName?: string;
  currentDeadline: string | null;
  requestType: RequestKind;
  /** A server answer; without it the action is not offered at all. */
  submissionEnabled: boolean;
  /** Every reason the server would refuse this request, already localized. */
  blockedReasons?: string[];
  onClose: () => void;
  /** A page-level status line, shown after the dialog closes or while an outcome is unknown. */
  onResult: (result: { tone: 'ok' | 'warning' | 'danger'; text: string }) => void;
};

export function blockedReasonLabel(reason: SubmissionBlockReason): string {
  switch (reason) {
    case 'ROLE':
      return 'report.blocked.role';
    case 'NOT_VISIBLE':
      return 'report.blocked.notVisible';
    case 'ARCHIVED':
      return 'report.blocked.archived';
    case 'NOT_ASSIGNED':
      return 'report.blocked.notAssigned';
    case 'CONTAINER':
      return 'report.blocked.container';
    case 'COMPLETED':
      return 'report.blocked.done';
    case 'CANCELLED':
      return 'report.blocked.cancelled';
    case 'PENDING':
      return 'report.blocked.pending';
    case 'SUBMISSION_DISABLED':
    default:
      return 'report.blocked.disabled';
  }
}

export function RequestDialog({
  taskId,
  taskName,
  projectName,
  subprojectName,
  currentDeadline,
  requestType,
  submissionEnabled,
  blockedReasons = [],
  onClose,
  onResult
}: RequestDialogProps): JSX.Element {
  const { t } = useI18n();
  const [requestedDueDate, setRequestedDueDate] = useState('');
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [completionNote, setCompletionNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'unknown'>('idle');
  const [failure, setFailure] = useState<unknown>(null);
  const [validation, setValidation] = useState('');
  const clientRequestId = useRef(createIdempotencyKey());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const blocked = !submissionEnabled || blockedReasons.length > 0;
  const valid = requestType === 'DEADLINE_CHANGE' ? !!requestedDueDate : completionNote.trim().length > 0;

  const submit = async (): Promise<void> => {
    if (blocked || state === 'sending' || state === 'unknown') return;
    if (!valid) {
      setValidation(
        requestType === 'DEADLINE_CHANGE' ? t('request.form.requiredDeadline') : t('request.form.requiredNote')
      );
      return;
    }
    setValidation('');
    setFailure(null);
    setState('sending');
    try {
      const result = await api.post<{ requestId: string; state: string }>('/api/employee/requests', {
        clientRequestId: clientRequestId.current,
        taskId,
        requestType,
        requestedDueDate: requestType === 'DEADLINE_CHANGE' ? requestedDueDate : undefined,
        reason: reason.trim() || undefined,
        explanation: explanation.trim() || undefined,
        completionNote: requestType === 'COMPLETION_REPORT' ? completionNote.trim() : undefined
      });
      // A durable acknowledgement is the only thing that closes the dialog and reports success.
      queryCache.invalidate([
        keys.myRequests,
        keys.myWork,
        keys.task(taskId),
        keys.tasks,
        keys.requests,
        keys.timeline,
        keys.overview,
        keys.reportEligibility(taskId)
      ]);
      if (!mounted.current) return;
      onResult({
        tone: 'ok',
        text: `${t('request.transport.RECEIVED')} ${t('request.confirm.id')}: ${result.requestId}`
      });
      onClose();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiFailure && ['NETWORK', 'INVALID_RESPONSE'].includes(error.code)) {
        // The server may or may not have stored it: never retried automatically, never reported
        // as success, and the same client request ID keeps a manual retry idempotent.
        setState('unknown');
        onResult({ tone: 'warning', text: t('request.transport.OUTCOME_UNKNOWN') });
        return;
      }
      setState('idle');
      setFailure(error);
      // The definite refusal leaves the draft intact for a correction.
      if (error instanceof ApiFailure) {
        onResult({ tone: 'danger', text: error.message });
      }
    }
  };

  return (
    <Modal
      title={requestType === 'DEADLINE_CHANGE' ? t('request.action.deadline') : t('request.action.completion')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            {state === 'sending' ? t('action.close') : t('request.form.cancel')}
          </button>
          {!blocked && state !== 'unknown' ? (
            <button type="button" className="button" disabled={state === 'sending'} onClick={() => void submit()}>
              {state === 'sending' ? t('request.transport.SENDING') : t('request.form.submit')}
            </button>
          ) : null}
        </>
      }
    >
      <div className="stack">
        <dl className="detail-grid request-target">
          <div>
            <dt>{t('report.task')}</dt>
            <dd>{taskName}</dd>
          </div>
          <div>
            <dt>{t('myWork.project')}</dt>
            <dd>{projectName}</dd>
          </div>
          {subprojectName ? (
            <div>
              <dt>{t('myWork.subproject')}</dt>
              <dd>{subprojectName}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('column.deadline')}</dt>
            <dd>{currentDeadline ?? t('common.unset')}</dd>
          </div>
        </dl>

        {blocked ? (
          <div className="validation-summary" role="status">
            <ul>
              {(submissionEnabled ? blockedReasons : [t('report.blocked.disabled'), ...blockedReasons]).map(
                (reasonText) => (
                  <li key={reasonText}>{reasonText}</li>
                )
              )}
            </ul>
          </div>
        ) : (
          <fieldset className="stack form-fields" disabled={state !== 'idle'}>
            {requestType === 'DEADLINE_CHANGE' ? (
              <>
                <label className="field">
                  <span className="field-label">{t('request.form.requestedDeadline')}</span>
                  <input
                    type="date"
                    value={requestedDueDate}
                    autoFocus
                    onChange={(event) => setRequestedDueDate(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">{t('request.form.reason')}</span>
                  <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
                </label>
              </>
            ) : (
              <label className="field">
                <span className="field-label">{t('request.completion.note')}</span>
                <textarea
                  value={completionNote}
                  autoFocus
                  onChange={(event) => setCompletionNote(event.target.value)}
                  rows={3}
                />
              </label>
            )}
            <label className="field">
              <span className="field-label">{t('request.form.explanation')}</span>
              <textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={3} />
            </label>
          </fieldset>
        )}

        {state === 'unknown' ? (
          <p role="status" className="banner warning">
            {t('request.transport.OUTCOME_UNKNOWN')}
          </p>
        ) : null}
        {validation ? <div className="banner danger">{validation}</div> : null}
        {failure ? (
          <div className="banner danger" role="alert">
            {failure instanceof ApiFailure ? failure.message : t('common.error')}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
