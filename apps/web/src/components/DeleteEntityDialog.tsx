import { useEffect, useState } from 'react';
import type { DeletionPreflight } from '@eh/contracts';
import { api, ApiFailure } from '../api/client';
import { useI18n } from '../i18n';
import { ConfirmDialog } from './forms';
import { ErrorBox, Modal } from './ui';

const BLOCKER_LABELS: Record<string, string> = {
  HAS_DESCENDANTS: 'delete.blocker.HAS_DESCENDANTS',
  HAS_TASKS: 'delete.blocker.HAS_TASKS',
  AUDIT_HISTORY: 'delete.blocker.AUDIT_HISTORY',
  PUBLISHED: 'delete.blocker.PUBLISHED',
  RECORDED_EFFORT: 'delete.blocker.RECORDED_EFFORT',
  UNVERIFIED_LEGACY_EFFORT: 'delete.blocker.UNVERIFIED_LEGACY_EFFORT',
  APPROVALS: 'delete.blocker.APPROVALS',
  REQUESTS: 'delete.blocker.REQUESTS',
  NOTIFICATIONS: 'delete.blocker.NOTIFICATIONS',
  DEADLINE_HISTORY: 'delete.blocker.DEADLINE_HISTORY',
  SCHEDULE_CONFIRMATIONS: 'delete.blocker.SCHEDULE_CONFIRMATIONS',
  ACTIVE_WORKFLOW: 'delete.blocker.ACTIVE_WORKFLOW',
  ARCHIVED_RECORD: 'delete.blocker.ARCHIVED_RECORD',
  DEPENDENCY_REFERENCED: 'delete.blocker.DEPENDENCY_REFERENCED',
  NOT_FOUND_OR_DELETED: 'delete.blocker.NOT_FOUND_OR_DELETED'
};

function Blockers({ preflight }: { preflight: DeletionPreflight }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="banner warning">
      <strong>{t('delete.blocked')}</strong>
      <ul>
        {preflight.blockers.map((blocker) => (
          <li key={`${blocker.code}:${blocker.detail}`}>
            {t(BLOCKER_LABELS[blocker.code] ?? 'delete.blocker.generic')}
            <span className="muted small"> — {blocker.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PermanentEraseDialog({
  entityType,
  entityId,
  entityName,
  onBack,
  onErased
}: {
  entityType: 'TASKS' | 'SUBPROJECTS';
  entityId: string;
  entityName: string;
  onBack: () => void;
  onErased: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [preflight, setPreflight] = useState<DeletionPreflight | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let current = true;
    api
      .get<DeletionPreflight>(
        `/api/manager/deletion/preflight?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`
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
  }, [entityId, entityType]);

  if (!preflight || !preflight.deletable) {
    return (
      <Modal
        title={t('delete.permanentTitle')}
        onClose={onBack}
        footer={
          <button type="button" className="button secondary" onClick={onBack}>
            {t('delete.useLogicalRemoval')}
          </button>
        }
      >
        <div className="stack">
          <p>
            <span className="muted">{t('delete.target')}: </span>
            <strong>{entityName}</strong>
          </p>
          {!preflight && !loadError ? <p role="status">{t('delete.checkingPermanent')}</p> : null}
          <ErrorBox error={loadError} />
          {preflight ? <Blockers preflight={preflight} /> : null}
          {preflight ? <p className="muted small">{t('delete.permanentBlockedHint')}</p> : null}
        </div>
      </Modal>
    );
  }

  return (
    <ConfirmDialog
      title={t('delete.permanentTitle')}
      destructive
      confirmText={preflight.confirmationText}
      reasonRequired
      message={
        <div className="stack">
          <p>{t('delete.permanentWarning', { name: entityName })}</p>
          <strong>{t('delete.erasePlan')}</strong>
          <ul>
            {(preflight.erasePlan ?? []).map((entry) => (
              <li key={entry.code}>{entry.detail}</li>
            ))}
          </ul>
          <p className="muted small">{t('delete.auditRetained')}</p>
        </div>
      }
      onCancel={onBack}
      onConfirm={async ({ confirmation, reason }) => {
        const path = entityType === 'TASKS' ? 'tasks' : 'subprojects';
        await api.post(`/api/admin/${path}/${entityId}/purge`, {
          revision: preflight.revision,
          confirmed: true,
          reason,
          confirmation
        });
        onErased();
      }}
    />
  );
}

export function DeleteEntityDialog({
  entityType,
  entityId,
  entityName,
  onClose,
  onDeleted,
  onRevealChildren
}: {
  entityType: 'TASKS' | 'SUBPROJECTS';
  entityId: string;
  entityName: string;
  onClose: () => void;
  onDeleted: () => void;
  onRevealChildren?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [preflight, setPreflight] = useState<DeletionPreflight | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [permanent, setPermanent] = useState(false);
  const [reason, setReason] = useState('Created by mistake');

  useEffect(() => {
    let current = true;
    setPreflight(null);
    setLoadError(null);
    api
      .get<DeletionPreflight>(
        `/api/manager/removal/preflight?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`
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
  }, [entityType, entityId]);

  if (permanent) {
    return (
      <PermanentEraseDialog
        entityType={entityType}
        entityId={entityId}
        entityName={entityName}
        onBack={() => setPermanent(false)}
        onErased={onDeleted}
      />
    );
  }

  const deletable = preflight?.deletable === true;
  const canSubmit = deletable && !!preflight && !busy;
  const requiresReason = preflight?.requiresReason === true;

  const submit = async (): Promise<void> => {
    if (!canSubmit || !preflight) return;
    setBusy(true);
    setFailure(null);
    try {
      const path = entityType === 'TASKS' ? 'tasks' : 'subprojects';
      await api.post(`/api/admin/${path}/${entityId}/remove`, {
        revision: preflight.revision,
        confirmed: true,
        reason: requiresReason ? reason.trim() : undefined
      });
      onDeleted();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t(requiresReason ? 'delete.completedTitle' : 'delete.confirmTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </button>
          {onRevealChildren && preflight && !deletable ? (
            <button type="button" className="button secondary" onClick={onRevealChildren}>
              {t('delete.revealChildren')}
            </button>
          ) : null}
          <button type="button" className="button secondary danger" onClick={() => setPermanent(true)} disabled={busy}>
            {t('delete.permanentAction')}
          </button>
          <button
            type="button"
            className="button danger"
            disabled={!canSubmit || (requiresReason && !reason.trim())}
            onClick={() => void submit()}
          >
            {busy ? t('state.saving') : t('delete.submit')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small">
          <span className="muted">{t('delete.target')}: </span>
          <strong>{entityName}</strong>
        </p>
        {!preflight && !loadError ? <p role="status">{t('delete.checking')}</p> : null}
        <ErrorBox error={loadError} />
        {preflight ? (
          deletable ? (
            <>
              {requiresReason ? (
                <>
                  <p>{t('delete.completedTask')}</p>
                  <label className="field">
                    <span className="field-label">{t('confirm.deleteReason')}</span>
                    <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
                  </label>
                </>
              ) : (
                <p>{t(entityType === 'TASKS' ? 'delete.confirmTask' : 'delete.confirmSubproject')}</p>
              )}
              <div className="banner info">{t('delete.allowed')}</div>
            </>
          ) : (
            <>
              <Blockers preflight={preflight} />
              <p className="muted small">{t('delete.blockedHint')}</p>
            </>
          )
        ) : null}
        <ErrorBox error={failure} />
        {failure instanceof ApiFailure && failure.isConflict ? (
          <p className="muted small">{t('delete.staleRevision')}</p>
        ) : null}
      </div>
    </Modal>
  );
}
