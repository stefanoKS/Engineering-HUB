/** Application status, outbox health and the shared-dashboard publication. */
import { useState } from 'react';
import type { Actor, PublicationStatus, StatusView } from '@eh/contracts';
import { api, ApiFailure } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Section } from '../components/ui';
import { ConfirmDialog } from '../components/forms';

export function StatusScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const status = useQuery<StatusView>(keys.status, () => api.get<StatusView>('/api/manager/status'));
  const publication = useQuery<PublicationStatus>(keys.publication, () =>
    api.get<PublicationStatus>('/api/manager/publication')
  );
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.status')}</h2>
      </div>
      {message ? <div className={`banner ${message.tone}`}>{message.text}</div> : null}
      <ErrorBox error={status.error ?? publication.error} onRetry={() => {
        status.refresh();
        publication.refresh();
      }} />

      <Section title={t('nav.status')}>
        {!status.data ? (
          <p className="muted">{t('state.loading')}</p>
        ) : (
          <div className="detail-grid">
            <div>
              <dt>{t('nav.status')}</dt>
              <dd>
                <Badge tone={status.data.status === 'ok' ? 'ok' : 'warn'}>{status.data.status}</Badge>
              </dd>
            </div>
            <div>
              <dt>{t('publication.contract')}</dt>
              <dd>{status.data.contractVersion}</dd>
            </div>
            <div>
              <dt>{t('automation.mode')}</dt>
              <dd>{status.data.emailMode}</dd>
            </div>
            <div>
              <dt>{t('automation.emergency')}</dt>
              <dd>{status.data.emergencyStop ? 'ON' : 'OFF'}</dd>
            </div>
            <div>
              <dt>{t('status.backup')}</dt>
              <dd>
                {status.data.lastBackupAt ?? t('common.unset')}{' '}
                {status.data.lastBackupOk ? <Badge tone="ok">OK</Badge> : <Badge tone="warn">CHECK</Badge>}
              </dd>
            </div>
          </div>
        )}
      </Section>

      <Section title={t('status.outbox')}>
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
      </Section>

      <Section title={t('status.counts')}>
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
      </Section>

      <Section
        title={t('nav.status')}
        actions={
          actor.role === 'ADMIN' ? (
            <button
              type="button"
              className="button"
              disabled={publishing || !publication.data?.enabled}
              onClick={() => setPublishing(true)}
            >
              {t('publication.publishNow')}
            </button>
          ) : null
        }
      >
        {!publication.data ? (
          <EmptyState />
        ) : (
          <div className="detail-grid">
            <div>
              <dt>{t('nav.status')}</dt>
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
        <p className="muted small">{t('projects.visibilityHint')}</p>
      </Section>

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
