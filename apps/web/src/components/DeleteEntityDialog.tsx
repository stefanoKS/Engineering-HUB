import { useEffect, useState } from 'react';
import type { DeletionPreflight } from '@eh/contracts';
import { api, ApiFailure } from '../api/client';
import { useI18n } from '../i18n';
import { ActionConfirmDialog } from './ActionConfirmDialog';
import { ErrorBox, Modal } from './ui';
import type { ReloadOutcome } from './forms';
import { keys } from '../state/cache';
import { commitMutation } from '../state/mutation';

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

/**
 * The guarded permanent erasure.
 *
 * ADMIN only, and exposed only to an administrator: it is never part of a manager's action set.
 * The confirmation is the same red-panel button used everywhere else, while the eligibility
 * safeguards (blockers, revision, tombstone, audit intent) stay exactly as they were.
 */
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
    <ActionConfirmDialog
      title={t('delete.permanentTitle')}
      recordName={entityName}
      context={entityId}
      warning={t('delete.permanentWarning', { name: entityName })}
      confirmLabel={t('delete.permanentConfirm')}
      details={
        <div className="stack">
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
      onConfirm={async () => {
        const path = entityType === 'TASKS' ? 'tasks' : 'subprojects';
        // A confirmed write updates the session's cache even if this dialog is already gone, and a
        // session that ended while the request was in flight runs no follow-up effect at all.
        const outcome = await commitMutation(
          () =>
            api.post(`/api/admin/${path}/${entityId}/purge`, {
              revision: preflight.revision,
              confirmed: true
            }),
          [keys.deletedRecords]
        );
        if (outcome.status !== 'committed') return;
        onErased();
      }}
    />
  );
}

/**
 * The recoverable removal of a task or a subproject.
 *
 * The preflight the server returns decides whether the action is offered at all, and the red panel
 * says plainly that the record leaves the normal lists while the row and its history stay. A
 * manager sees no permanent-erasure control, and the removal endpoint itself re-checks the role
 * and the record's division.
 */
export function DeleteEntityDialog({
  memberAction = false,
  entityType,
  entityId,
  entityName,
  context,
  canPurge,
  onClose,
  onDeleted,
  onRevealChildren
}: {
  memberAction?: boolean;
  entityType: 'TASKS' | 'SUBPROJECTS';
  entityId: string;
  entityName: string;
  /** A readable location (project or subproject path) shown beside the record name. */
  context?: string;
  /** Permanent erasure is an ADMIN action and is never offered to a manager. */
  canPurge: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onRevealChildren?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [preflight, setPreflight] = useState<DeletionPreflight | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [permanent, setPermanent] = useState(false);
  const removalPath = `/api/${memberAction ? "work" : "manager"}/removal/preflight?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`;

  const load = async (): Promise<DeletionPreflight> => {
    const value = await api.get<DeletionPreflight>(removalPath);
    setPreflight(value);
    return value;
  };

  useEffect(() => {
    let current = true;
    setPreflight(null);
    setLoadError(null);
    api
      .get<DeletionPreflight>(removalPath)
      .then((value) => {
        if (current) setPreflight(value);
      })
      .catch((error: unknown) => {
        if (current) setLoadError(error);
      });
    return () => {
      current = false;
    };
  }, [removalPath]);

  if (permanent && canPurge) {
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

  if (!preflight || !preflight.deletable) {
    return (
      <Modal
        title={t('delete.confirmTitle')}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="button secondary" onClick={onClose}>
              {t('action.cancel')}
            </button>
            {onRevealChildren && preflight && !preflight.deletable ? (
              <button type="button" className="button secondary" onClick={onRevealChildren}>
                {t('delete.revealChildren')}
              </button>
            ) : null}
          </>
        }
      >
        <div className="stack">
          <p>
            <span className="muted">{t('delete.target')}: </span>
            <strong>{entityName}</strong>
            {context ? <span className="muted small"> · {context}</span> : null}
          </p>
          {!preflight && !loadError ? <p role="status">{t('delete.checking')}</p> : null}
          <ErrorBox error={loadError} />
          {preflight ? <Blockers preflight={preflight} /> : null}
          {preflight ? <p className="muted small">{t('delete.blockedHint')}</p> : null}
        </div>
      </Modal>
    );
  }

  return (
    <ActionConfirmDialog
      title={t('delete.confirmTitle')}
      recordName={entityName}
      context={context}
      warning={t(entityType === 'TASKS' ? 'delete.confirmTask' : 'delete.confirmSubproject')}
      confirmLabel={t('delete.submit')}
      details={
        <div className="stack">
          {preflight.retainedHistory ? (
            <div className="banner warning">{t('delete.retainedHistory')}</div>
          ) : null}
          {canPurge ? (
            <button type="button" className="link-button danger" onClick={() => setPermanent(true)}>
              {t('delete.permanentAction')}
            </button>
          ) : null}
        </div>
      }
      onCancel={onClose}
      onReload={async (): Promise<ReloadOutcome> => {
        try {
          const fresh = await load();
          if (!fresh.deletable) {
            return { status: 'ineligible', message: t('delete.reloadIneligible') };
          }
          return { status: 'fresh' };
        } catch (error) {
          return {
            status: 'failed',
            message: error instanceof ApiFailure ? error.message : t('error.title')
          };
        }
      }}
      onConfirm={async () => {
        // The revision the dialog loaded is submitted; a newer stored revision is a conflict the
        // caller must review, never a silent overwrite.
        const path = entityType === 'TASKS' ? 'tasks' : 'subprojects';
        // A confirmed write updates the session's cache even if this dialog is already gone, and a
        // session that ended while the request was in flight runs no follow-up effect at all.
        const outcome = await commitMutation(
          () =>
            api.post(`/api/${memberAction ? "work" : "manager"}/${path}/${entityId}/remove`, {
              revision: preflight.revision,
              confirmed: true
            }),
          [keys.deletedRecords]
        );
        if (outcome.status !== 'committed') return;
        onDeleted();
      }}
    />
  );
}
