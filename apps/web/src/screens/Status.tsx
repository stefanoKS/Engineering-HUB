/**
 * Application and operational status.
 *
 * The actionable health of backup, request intake, email delivery and publication comes first;
 * hashes, slots, contract versions, outbox internals and row counts live in one diagnostics
 * disclosure. "Disabled" and "not configured" are distinct from "failed", and nothing here
 * implies a live measurement it did not observe.
 */
import { useState } from 'react';
import type { Actor, PublicationStatus, StatusView } from '@eh/contracts';
import { api, ApiFailure } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Section } from '../components/ui';
import { ConfirmDialog } from '../components/forms';

type Health = { tone: 'ok' | 'warn' | 'danger' | 'neutral'; label: string; detail: string };

function healthOf(kind: 'ok' | 'disabled' | 'notConfigured' | 'failed'): Health {
  return {
    tone: kind === 'ok' ? 'ok' : kind === 'failed' ? 'danger' : kind === 'disabled' ? 'neutral' : 'warn',
    label: { ok: 'common.ok', disabled: 'common.disabled', notConfigured: 'common.notConfigured', failed: 'common.failed' }[kind],
    detail: ''
  };
}

export function StatusScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const status = useQuery<StatusView>(keys.status, () => api.get<StatusView>('/api/manager/status'));
  const publication = useQuery<PublicationStatus>(keys.publication, () =>
    api.get<PublicationStatus>('/api/manager/publication')
  );
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);

  if (status.error || publication.error) {
    return (
      <ErrorBox
        error={status.error ?? publication.error}
        onRetry={() => {
          status.refresh();
          publication.refresh();
        }}
      />
    );
  }

  const backup: Health = !status.data
    ? healthOf('disabled')
    : !status.data.lastBackupAt
      ? { ...healthOf('notConfigured'), detail: t('status.diagnosticsHint') }
      : !status.data.lastBackupOk ||
          (!!status.data.backup?.lastFailureAt &&
            !!status.data.lastBackupAt &&
            status.data.backup.lastFailureAt > status.data.lastBackupAt)
        ? { ...healthOf('failed'), detail: status.data.backup?.lastFailure?.slice(0, 160) ?? '' }
        : { ...healthOf('ok'), detail: status.data.lastBackupAt };
  const requests: Health = !status.data
    ? healthOf('disabled')
    : status.data.requestSubmissionEnabled
      ? healthOf('ok')
      : { ...healthOf('disabled'), detail: t('report.blocked.disabled') };
  const email: Health = !status.data
    ? healthOf('disabled')
    : status.data.outbox.failed > 0
      ? { ...healthOf('failed'), detail: `${status.data.outbox.failed}` }
      : status.data.emailMode === 'OFF'
        ? healthOf('disabled')
        : status.data.emergencyStop
          ? { tone: 'warn', label: 'automation.emergency', detail: t('automation.consequence.EMERGENCY_STOP') }
          : healthOf('ok');
  const publicationHealth: Health = !publication.data
    ? healthOf('disabled')
    : !publication.data.destinationConfigured
      ? healthOf('notConfigured')
      : !publication.data.enabled
        ? healthOf('disabled')
        : publication.data.lastError
          ? { ...healthOf('failed'), detail: publication.data.lastError.slice(0, 160) }
          : healthOf('ok');

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.status')}</h2>
        {status.data ? <Badge tone={status.data.status === 'ok' ? 'ok' : 'warn'}>{status.data.status}</Badge> : null}
      </div>
      {message ? (
        <div className={`banner ${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </div>
      ) : null}

      <Section title={t('status.health')}>
        {!status.data || !publication.data ? (
          <p className="muted">{t('state.loading')}</p>
        ) : (
          <div className="detail-grid">
            {[
              { key: 'backup', health: backup },
              { key: 'requests', health: requests },
              { key: 'email', health: email },
              { key: 'publication', health: publicationHealth }
            ].map((entry) => (
              <div key={entry.key}>
                <dt>{t(`status.health.${entry.key}`)}</dt>
                <dd>
                  <Badge tone={entry.health.tone}>{t(entry.health.label)}</Badge>
                  {entry.health.detail ? <div className="muted small">{entry.health.detail}</div> : null}
                </dd>
              </div>
            ))}
          </div>
        )}
        <div className="inline-actions">
          <a className="button secondary" href="#/members">
            {t('status.memberRecord')}
          </a>
          {actor.role === 'ADMIN' ? (
            <a className="button secondary" href="#/accounts">
              {t('status.accountAdmin')}
            </a>
          ) : null}
        </div>
      </Section>

      <details className="advanced-actions">
        <summary>{t('status.diagnostics')}</summary>
        <p className="muted small">{t('status.diagnosticsHint')}</p>
        <div className="detail-grid">
          <div>
            <dt>{t('automation.effective')}</dt>
            <dd>{status.data?.emailMode ?? t('common.unset')}</dd>
          </div>
          <div>
            <dt>{t('automation.emergency')}</dt>
            <dd>{status.data?.emergencyStop ? 'ON' : 'OFF'}</dd>
          </div>
          <div>
            <dt>{t('publication.contract')}</dt>
            <dd>{status.data?.contractVersion ?? t('common.unset')}</dd>
          </div>
          <div>
            <dt>{t('status.backupLocal')}</dt>
            <dd>
              {status.data?.backup?.lastLocalAt ?? t('common.unset')}{' '}
              {status.data?.backup?.lastLocalOk ? <Badge tone="ok">OK</Badge> : <Badge tone="warn">CHECK</Badge>}
            </dd>
          </div>
          <div>
            <dt>{t('status.backupDrive')}</dt>
            <dd>{status.data?.backup?.lastDriveAt ?? t('common.unset')}</dd>
          </div>
          <div>
            <dt>{t('status.backupFailures')}</dt>
            <dd>
              {status.data?.backup?.lastFailureAt ?? t('common.none')}
              {status.data?.backup?.lastFailure ? (
                <span className="muted small"> {status.data.backup.lastFailure.slice(0, 200)}</span>
              ) : null}
            </dd>
          </div>
        </div>

        <h3>{t('status.outbox')}</h3>
        {!status.data ? (
          <EmptyState />
        ) : (
          <ul className="list">
            <li>PENDING: {status.data.outbox.pending}</li>
            <li>LEASED: {status.data.outbox.leased}</li>
            <li>FAILED: {status.data.outbox.failed}</li>
            <li className="muted small">
              {t('common.unset')}: {status.data.outbox.oldestPendingAt ?? '-'}
            </li>
          </ul>
        )}

        <h3>{t('status.counts')}</h3>
        {!status.data ? (
          <EmptyState />
        ) : (
          <ul className="list">
            {Object.entries(status.data.rowCounts).map(([key, count]) => (
              <li key={key}>
                {key}: {count}
              </li>
            ))}
          </ul>
        )}

        <h3>{t('nav.status')}</h3>
        {!publication.data ? (
          <EmptyState />
        ) : (
          <div className="detail-grid">
            <div>
              <dt>{t('common.disabled')}</dt>
              <dd>
                <Badge tone={publication.data.enabled ? 'ok' : 'neutral'}>
                  {publication.data.enabled ? 'ON' : 'OFF'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>{t('publication.activeSlot')}</dt>
              <dd>{publication.data.activeSlot}</dd>
            </div>
            <div>
              <dt>{t('publication.contract')}</dt>
              <dd>{publication.data.contractVersion}</dd>
            </div>
            <div>
              <dt>{t('publication.hash')}</dt>
              <dd className="muted small">{publication.data.hash || t('common.unset')}</dd>
            </div>
            <div>
              <dt>{t('common.unset')}</dt>
              <dd>{publication.data.lastPublishedAt ?? t('common.unset')}</dd>
            </div>
            <div>
              <dt>{t('common.items')}</dt>
              <dd>{publication.data.rows.tasks ?? 0}</dd>
            </div>
          </div>
        )}
        {publication.data?.lastError ? <div className="banner danger">{publication.data.lastError}</div> : null}

        {actor.role === 'ADMIN' ? (
          <button
            type="button"
            className="button"
            disabled={publishing || !publication.data?.enabled}
            onClick={() => setPublishing(true)}
          >
            {t('publication.publishNow')}
          </button>
        ) : null}
        <p className="muted small">{t('projects.visibilityHint')}</p>
      </details>

      {publishing ? (
        <ConfirmDialog
          title={t('publication.publishNow')}
          message={t('projects.visibilityHint')}
          onCancel={() => setPublishing(false)}
          onConfirm={async () => {
            try {
              await api.post('/api/manager/publication/publish', { confirmed: true });
              setMessage({ tone: 'ok', text: t('state.saved') });
            } catch (failure) {
              setMessage({
                tone: 'danger',
                text: failure instanceof ApiFailure ? failure.message : t('state.failed')
              });
            } finally {
              setPublishing(false);
              queryCache.invalidate([keys.publication, keys.status, keys.employee]);
            }
          }}
        />
      ) : null}
    </div>
  );
}
