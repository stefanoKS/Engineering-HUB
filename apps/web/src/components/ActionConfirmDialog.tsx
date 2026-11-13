/**
 * One no-typing confirmation surface for a corrective action.
 *
 * A recoverable removal, a restoration, a corrective reopening and a permanent erasure all ask
 * the same way: a red panel that names the exact record, says what actually happens, and offers
 * Cancel plus one clearly labelled action button. Nothing is typed - no identifier phrase and no
 * mandatory reason - so the panel itself has to be unambiguous.
 *
 * The authority did not change with the interaction: the caller is still an authorised role, the
 * server still re-checks the role, the division, the revision and the blockers, and the audit row
 * records that the confirmation came from this button instead of a typed phrase.
 *
 * A failure is classified before it is shown, because the recovery differs: a revision conflict
 * keeps the dialog open and offers an explicit reload, an unobservable outcome says so instead of
 * pretending the write failed, and a definite refusal shows the server's reason. Nothing here
 * retries automatically, and a second click in the same tick never starts a second write.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiFailure } from '../api/client';
import { useI18n } from '../i18n';
import { ErrorBox, Modal } from './ui';
import type { ReloadOutcome } from './forms';

export function ActionConfirmDialog({
  title,
  recordName,
  context,
  warning,
  details,
  confirmLabel,
  onCancel,
  onConfirm,
  onReload
}: {
  title: string;
  /** The readable name of the selected record; never an internal identifier alone. */
  recordName: string;
  /** Where the record lives (project, subproject path, current state). */
  context?: string;
  /** The honest consequence sentence shown in the red panel. */
  warning: string;
  /** Optional extra rows: blockers, a parent-project acknowledgement, retained history. */
  details?: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  /** Re-reads the selected record by id so a conflict can be reviewed and confirmed again. */
  onReload?: () => Promise<ReloadOutcome>;
}): JSX.Element {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [reloadState, setReloadState] = useState<ReloadOutcome | null>(null);
  const inFlight = useRef(false);
  const reloadInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apiFailure = failure instanceof ApiFailure ? failure : null;
  const conflict = apiFailure?.isConflict === true;
  const unknown = !!apiFailure && ['NETWORK', 'INVALID_RESPONSE'].includes(apiFailure.code);
  const ineligible = reloadState?.status === 'ineligible';

  const reload = async (): Promise<void> => {
    if (!onReload || reloadInFlight.current) return;
    reloadInFlight.current = true;
    setReloading(true);
    try {
      const outcome = await onReload();
      if (!mounted.current) return;
      setReloadState(outcome);
      if (outcome.status === 'fresh') setFailure(null);
    } catch (error) {
      if (!mounted.current) return;
      setReloadState({ status: 'failed', message: error instanceof Error ? error.message : t('error.title') });
    } finally {
      reloadInFlight.current = false;
      if (mounted.current) setReloading(false);
    }
  };

  const confirm = async (): Promise<void> => {
    // Synchronous guard: a second activation in the same tick never starts a second write.
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setReloadState(null);
    try {
      await onConfirm();
    } catch (error) {
      if (mounted.current) setFailure(error);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={() => {
        // Closing while a write is in flight is allowed, but the pending answer is never turned
        // into a second attempt: the write itself is unaffected and reports its own outcome.
        onCancel();
      }}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busy || ineligible}
            aria-busy={busy || undefined}
            onClick={() => void confirm()}
          >
            {busy ? t('state.saving') : confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        <p>
          <strong>{recordName}</strong>
          {context ? <span className="muted small"> · {context}</span> : null}
        </p>
        <div className="banner danger confirm-warning" role="alert">
          <strong>{warning}</strong>
        </div>
        {details}
        {failure ? (
          <div className="stack">
            <ErrorBox error={failure} />
            {conflict && onReload ? (
              <button type="button" className="link-button" disabled={reloading} onClick={() => void reload()}>
                {reloading ? t('editor.reloading') : t('editor.conflictReload')}
              </button>
            ) : null}
          </div>
        ) : null}
        {reloadState?.status === 'fresh' ? (
          <div className="banner info" role="status">
            {t('editor.conflictReloaded')}
          </div>
        ) : null}
        {reloadState?.status === 'ineligible' ? (
          <div className="banner warning" role="alert">
            {reloadState.message}
          </div>
        ) : null}
        {reloadState?.status === 'failed' ? (
          <div className="banner danger" role="alert">
            {`${t('editor.conflictReloadFailed')} ${reloadState.message}`.trim()}
          </div>
        ) : null}
        {unknown ? <p className="muted small">{t('action.unknownOutcomeHelp')}</p> : null}
      </div>
    </Modal>
  );
}
