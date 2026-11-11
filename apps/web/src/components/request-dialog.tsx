/**
 * Completion and extension requests, in one reusable accessible dialog.
 *
 * The dialog identifies the task, its project and subproject and the current deadline, focuses the
 * first input, keeps the background inert (the native `<dialog>` does that), traps focus, supports
 * Escape and Cancel, and restores focus to the control that opened it. The draft stays in memory
 * across a validation error, a temporary failure and a language change, and nothing is written to
 * browser storage.
 *
 * Submission is owned by the session-level tracker (`state/submissions`), not by this component:
 * closing the dialog while a request is in flight never cancels the tracking, and the outcome is
 * still reported by the page-level notice. This dialog only *reads* its own entry, so it can show
 * "sending", a refusal and the permanently-unknown outcome while it is open.
 */
import { useEffect, useRef, useState } from 'react';
import type { SubmissionBlockReason } from '@eh/contracts';
import { useI18n } from '../i18n';
import { Modal } from './ui';
import { createIdempotencyKey } from './forms';
import { submitRequest, reportSubmission, useClaimSubmission, useSubmission } from '../state/submissions';

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
  const clientRequestId = useRef(createIdempotencyKey());
  const submitting = useRef(false);
  const tracked = useSubmission(clientRequestId.current);
  const state = tracked?.state ?? 'idle';

  const blocked = !submissionEnabled || blockedReasons.length > 0;
  const valid = requestType === 'DEADLINE_CHANGE' ? !!requestedDueDate : completionNote.trim().length > 0;

  const submit = async (): Promise<void> => {
    if (blocked || state === 'SENDING' || state === 'UNKNOWN' || state === 'RECEIVED') return;
    if (submitting.current) return;
    if (!valid) {
      setValidation(
        requestType === 'DEADLINE_CHANGE' ? t('request.form.requiredDeadline') : t('request.form.requiredNote')
      );
      return;
    }
    setValidation('');
    submitting.current = true;
    try {
      // The tracker holds the request, the idempotency identity and the outcome. A refusal keeps
      // the draft on screen so it can be corrected; an unknown outcome is never retried here.
      await submitRequest({
        submissionId: clientRequestId.current,
        taskId,
        requestType,
        requestedDueDate,
        reason: reason.trim(),
        explanation: explanation.trim(),
        completionNote: completionNote.trim()
      });
    } finally {
      submitting.current = false;
    }
  };

  const refused = state === 'REFUSED' ? tracked?.message ?? '' : '';
  const sending = state === 'SENDING';
  const settled = state === 'RECEIVED' || state === 'UNKNOWN';
  // While this dialog is open it is the reporter for its own submission, so the shell notice stays
  // quiet for it. When the dialog closes, the shell takes over and the outcome is still delivered.
  useClaimSubmission(clientRequestId.current);
  const reported = useRef('');
  useEffect(() => {
    if (!tracked || tracked.state === 'SENDING') return;
    const marker = `${tracked.state}:${tracked.requestId}:${tracked.message}`;
    if (reported.current === marker) return;
    reported.current = marker;
    // The host page shows the outcome, so the shell notice stays quiet for this submission.
    reportSubmission(tracked.submissionId);
    if (tracked.state === 'RECEIVED') {
      onResult({
        tone: 'ok',
        text: `${t('request.transport.RECEIVED')} ${t('request.confirm.id')}: ${tracked.requestId}`
      });
      // A durable acknowledgement closes the form. Closing earlier is not cancel: the tracker keeps
      // the request and the shell reports it if this form is gone before the answer arrives.
      onClose();
      return;
    }
    onResult(
      tracked.state === 'UNKNOWN'
        ? { tone: 'warning', text: t('request.transport.OUTCOME_UNKNOWN') }
        : { tone: 'danger', text: tracked.message || t('submission.refused') }
    );
  }, [tracked, onResult, onClose, t]);

  return (
    <Modal
      title={requestType === 'DEADLINE_CHANGE' ? t('request.action.deadline') : t('request.action.completion')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            {sending ? t('action.close') : settled ? t('action.close') : t('request.form.cancel')}
          </button>
          {!blocked && !settled ? (
            <button type="button" className="button" disabled={sending} onClick={() => void submit()}>
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
          <fieldset className="stack form-fields" disabled={sending || settled}>
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
            {t('request.transport.RECEIVED')} {t('request.confirm.id')}: {tracked?.requestId ?? ''}
          </p>
        ) : null}
        {state === 'UNKNOWN' ? (
          <p role="alert" className="banner warning">
            <strong>{t('request.transport.OUTCOME_UNKNOWN')}</strong>{' '}
            <span>{t('submission.unknown')}</span>
          </p>
        ) : null}
        {validation ? <div className="banner danger">{validation}</div> : null}
        {state === 'REFUSED' ? (
          <div className="banner danger" role="alert">
            {refused || t('common.error')}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
