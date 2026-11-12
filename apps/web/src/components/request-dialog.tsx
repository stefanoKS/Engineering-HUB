/**
 * Completion and deadline requests, in one reusable accessible dialog.
 *
 * The dialog identifies the task, its project and subproject and the current deadline, focuses the
 * first input, keeps the background inert (the native `<dialog>` does that), traps focus, supports
 * Escape and Cancel, and restores focus to the control that opened it. The draft stays in memory
 * across a validation error, a temporary failure and a language change, and nothing is written to
 * browser storage.
 *
 * Submission is owned by the session-level tracker (`state/submissions`), not by this component:
 * closing the dialog while a request is in flight never cancels the tracking, and the outcome is
 * still reported by the page-level notice. This dialog only *reads* the attempt it currently owns.
 *
 * An attempt is one immutable payload with one identity. A **definite refusal** keeps the draft and
 * allows a deliberate correction, which starts a *new* attempt with a *new* identity (the server
 * refused before reserving the old key, so the corrected content is accepted). A `SENDING`,
 * `UNKNOWN` or `RECEIVED` attempt is never resubmitted.
 */
import { useEffect, useRef, useState } from 'react';
import type { SubmissionBlockReason } from '@eh/contracts';
import { useI18n } from '../i18n';
import { Modal } from './ui';
import { createIdempotencyKey } from './forms';
import {
  attemptById,
  claimSubmission,
  reportSubmission,
  submitRequest,
  useSubmission
} from '../state/submissions';

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
  const [validation, setValidation] = useState('');
  // The dialog identity is stable for the open form; the attempt identity changes only when a
  // refused attempt is deliberately corrected.
  const submissionId = useRef(createIdempotencyKey());
  const [attemptId, setAttemptIdState] = useState(() => createIdempotencyKey());
  const attemptIdRef = useRef(attemptId);
  const setAttemptId = (next: string): void => {
    attemptIdRef.current = next;
    setAttemptIdState(next);
  };
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const attempt = useSubmission(attemptId);
  const state = attempt?.outcome ?? 'IDLE';

  const blocked = !submissionEnabled || blockedReasons.length > 0;
  const valid = requestType === 'DEADLINE_CHANGE' ? !!requestedDueDate : completionNote.trim().length > 0;
  const canEditDraft = state === 'IDLE' || state === 'REFUSED';
  const settled = state === 'RECEIVED' || state === 'UNKNOWN';

  const submit = async (): Promise<void> => {
    // Synchronous guards: a double click in one tick, or a click on a settled attempt, never sends.
    if (submitting.current || blocked || !canEditDraft) return;
    if (!valid) {
      setValidation(
        requestType === 'DEADLINE_CHANGE' ? t('request.form.requiredDeadline') : t('request.form.requiredNote')
      );
      return;
    }
    setValidation('');
    const current = attemptById(attemptIdRef.current);
    // A corrected attempt is a new attempt with a new identity; the refused one is never reused.
    const id = current ? createIdempotencyKey() : attemptIdRef.current;
    if (id !== attemptIdRef.current) setAttemptId(id);
    submitting.current = true;
    try {
      const outcome = await submitRequest({
        attemptId: id,
        submissionId: submissionId.current,
        taskId,
        requestType,
        requestedDueDate,
        reason: reason.trim(),
        explanation: explanation.trim(),
        completionNote: completionNote.trim()
      });
      // An answer that belongs to an ended session has no UI effect here.
      void outcome;
    } finally {
      submitting.current = false;
    }
  };

  // While this dialog is open it reports its own current attempt, so the shell notices stay quiet
  // for it. When the dialog closes, the shell takes over and the outcome is still delivered.
  useEffect(() => claimSubmission(attemptId), [attemptId]);

  const reported = useRef('');
  useEffect(() => {
    if (!attempt || attempt.outcome === 'SENDING') return;
    const marker = `${attempt.attemptId}:${attempt.outcome}:${attempt.requestId}:${attempt.message}`;
    if (reported.current === marker) return;
    reported.current = marker;
    // `RECEIVED` and a corrected `REFUSED` are final for this form: the host page shows them and
    // the shell stays quiet. An `UNKNOWN` outcome is *not* marked as reported, because it must stay
    // visible in the shell after the form is gone - it is the one state a person must not ignore.
    if (attempt.outcome !== 'UNKNOWN') reportSubmission(attempt.attemptId);
    if (attempt.outcome === 'RECEIVED') {
      onResult({
        tone: 'ok',
        text: `${t('request.transport.RECEIVED')} ${t('request.confirm.id')}: ${attempt.requestId}`
      });
      // A durable acknowledgement closes the form. Closing earlier is not cancel: the tracker keeps
      // the attempt and the shell reports it if this form is gone before the answer arrives.
      onClose();
      return;
    }
    onResult(
      attempt.outcome === 'UNKNOWN'
        ? { tone: 'warning', text: t('request.transport.OUTCOME_UNKNOWN') }
        : { tone: 'danger', text: attempt.message || t('submission.refused') }
    );
  }, [attempt, onResult, onClose, t]);

  const sending = state === 'SENDING';
  const refused = state === 'REFUSED' ? attempt?.message ?? '' : '';

  return (
    <Modal
      title={requestType === 'DEADLINE_CHANGE' ? t('request.action.deadline') : t('request.action.completion')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            {sending || settled ? t('action.close') : t('request.form.cancel')}
          </button>
          {!blocked && !settled ? (
            <button type="button" className="button" disabled={sending || submitting.current} onClick={() => void submit()}>
              {sending ? t('request.transport.SENDING') : t('request.form.submit')}
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
          <fieldset className="stack form-fields" disabled={!canEditDraft}>
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

        {sending ? (
          <p role="status" className="banner info">
            {t('submission.sending')}
          </p>
        ) : null}
        {state === 'RECEIVED' ? (
          <p role="status" className="banner ok">
            {t('request.transport.RECEIVED')} {t('request.confirm.id')}: {attempt?.requestId ?? ''}
          </p>
        ) : null}
        {state === 'UNKNOWN' ? (
          <p role="alert" className="banner warning">
            <strong>{t('request.transport.OUTCOME_UNKNOWN')}</strong> <span>{t('submission.unknown')}</span>
          </p>
        ) : null}
        {validation ? <div className="banner danger">{validation}</div> : null}
        {state === 'REFUSED' ? (
          <div className="banner danger" role="alert">
            <span>{refused || t('common.error')}</span>
            {/* The draft above is still editable: a deliberate correction is a new attempt. */}
            <span className="muted small">{t('submission.correctHint')}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
