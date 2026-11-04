/**
 * ADMIN-only permanent deletion of an unused responsibility area.
 *
 * The eligibility answer comes from the server preflight; the browser never decides on its own
 * whether a deletion is allowed. A blocked area offers retirement instead, and the delete button
 * is never rendered for an operation that cannot succeed.
 */
import { useEffect, useState } from 'react';
import type { Responsibility, ResponsibilityDeletionPreflight } from '@eh/contracts';
import { api, ApiFailure } from '../api/client';
import { useI18n } from '../i18n';
import { ErrorBox, Modal } from './ui';

const BLOCKER_LABELS: Record<string, string> = {
  PROJECTS_REFERENCED: 'responsibilities.blocker.PROJECTS_REFERENCED',
  PUBLISHED: 'responsibilities.blocker.PUBLISHED',
  ACTIVE_WORKFLOW: 'responsibilities.blocker.ACTIVE_WORKFLOW',
  ALREADY_DELETED: 'responsibilities.blocker.ALREADY_DELETED',
  NOT_FOUND_OR_DELETED: 'responsibilities.blocker.NOT_FOUND_OR_DELETED'
};

function Blockers({ preflight }: { preflight: ResponsibilityDeletionPreflight }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="banner warning" role="alert">
      <strong>{t('responsibilities.deleteBlocked')}</strong>
      <p>{t('responsibilities.deleteProjectCount', { n: preflight.projectCount })}</p>
      <p className="small">{t('responsibilities.deleteBlockedHint')}</p>
      <ul>
        {preflight.blockers.map((blocker) => (
          <li key={`${blocker.code}:${blocker.detail}`}>
            {t(BLOCKER_LABELS[blocker.code] ?? 'responsibilities.blocker.generic')}
            <span className="muted small"> — {blocker.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResponsibilityDeleteDialog({
  item,
  onClose,
  onDeleted,
  onRetired
}: {
  item: Responsibility;
  onClose: () => void;
  onDeleted: (name: string) => void;
  onRetired: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [preflight, setPreflight] = useState<ResponsibilityDeletionPreflight | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setPreflight(null);
    setLoadError(null);
    api
      .get<ResponsibilityDeletionPreflight>(
        `/api/admin/responsibilities/${encodeURIComponent(item.responsibilityId)}/delete-preflight`
      )
      .then((value) => {
        if (current) setPreflight(value);
      })
      .catch((error: unknown) => {
        if (current) setLoadError(error);
      });
    return () => {
      current = false;
    };
  }, [item.responsibilityId, attempt]);

  const reload = (): void => {
    setFailure(null);
    setAttempt((value) => value + 1);
  };

  const remove = async (): Promise<void> => {
    if (!preflight || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      // The typed phrase is derived from the selected record; the operator never types it.
      await api.del(`/api/admin/responsibilities/${encodeURIComponent(item.responsibilityId)}`, {
        revision: preflight.revision,
        confirmed: true,
        confirmation: `DELETE ${item.responsibilityId}`
      });
      onDeleted(item.name);
    } catch (error) {
      setFailure(error);
      if (error instanceof ApiFailure && (error.isConflict || error.code === 'NOT_FOUND')) {
        // The row changed after the preflight: re-ask the server instead of retrying blindly.
        setAttempt((value) => value + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const retire = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.post(`/api/manager/responsibilities/${encodeURIComponent(item.responsibilityId)}/retire`, {
        // The preflight revision is the freshest one this dialog has seen.
        revision: preflight?.revision ?? item.revision,
        confirmed: true
      });
      onRetired();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  if (!preflight) {
    return (
      <Modal
        title={t('responsibilities.delete')}
        onClose={onClose}
        footer={
          <button type="button" className="button secondary" onClick={onClose}>
            {t('action.cancel')}
          </button>
        }
      >
        <div className="stack">
          <p className="muted">{t('responsibilities.deleteChecking')}</p>
          <ErrorBox error={loadError} onRetry={reload} />
        </div>
      </Modal>
    );
  }

  if (!preflight.deletable) {
    const canRetire = preflight.status === 'Active';
    return (
      <Modal
        title={t('responsibilities.deleteBlocked')}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
              {t('action.cancel')}
            </button>
            {canRetire ? (
              <button type="button" className="button" onClick={() => void retire()} disabled={busy}>
                {busy ? t('state.saving') : t('responsibilities.deleteRetireInstead')}
              </button>
            ) : null}
          </>
        }
      >
        <div className="stack">
          <p className="small">
            <span className="muted">{t('delete.target')}: </span>
            <strong>{item.name}</strong>
          </p>
          <Blockers preflight={preflight} />
          <ErrorBox error={failure} onRetry={reload} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t('responsibilities.delete')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </button>
          <button type="button" className="button danger" onClick={() => void remove()} disabled={busy}>
            {busy ? t('state.saving') : t('delete.submit')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p>{t('responsibilities.deleteWarning', { name: item.name })}</p>
        <p className="muted small">{t('responsibilities.deleteMembersNote')}</p>
        <ErrorBox error={failure} onRetry={reload} />
      </div>
    </Modal>
  );
}
