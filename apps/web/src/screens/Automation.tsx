/** Automation settings: safe defaults, an explicit LIVE gate and the emergency stop. */
import { useState } from 'react';
import type { Actor, AutomationSettingsView } from '@eh/contracts';
import { api, ApiFailure } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, SaveState, Section } from '../components/ui';

export function AutomationScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const isAdmin = actor.role === 'ADMIN';
  const view = useQuery<AutomationSettingsView>(keys.automation, () => api.get<AutomationSettingsView>('/api/manager/automation'));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);

  if (view.error) return <ErrorBox error={view.error} onRetry={() => view.refresh()} />;
  if (!view.data) return <p className="muted">{t('state.loading')}</p>;

  const data = view.data;
  const value = (key: string): string => draft[key] ?? data.settings.find((setting) => setting.key === key)?.value ?? '';
  const changes: Record<string, string> = {};
  for (const setting of data.settings) {
    const next = draft[setting.key];
    if (next !== undefined && next !== setting.value) changes[setting.key] = next;
  }
  const modeChanging = changes.EMAIL_MODE === 'LIVE';
  const publishChanging = changes.SHARED_DASHBOARD_PUBLISH_ENABLED === 'true';

  async function save(): Promise<void> {
    setMessage(null);
    try {
      await api.put('/api/manager/automation', {
        revision: data.revision,
        changes,
        confirmed: true,
        confirmation: confirmation || undefined
      });
      setDraft({});
      setConfirmation('');
      setMessage({ tone: 'ok', text: t('state.saved') });
      queryCache.invalidate([keys.automation, keys.status, keys.publication]);
    } catch (failure) {
      setMessage({
        tone: 'danger',
        text: failure instanceof ApiFailure ? failure.message : t('state.failed')
      });
    }
  }

  async function stop(): Promise<void> {
    setMessage(null);
    try {
      await api.post('/api/manager/automation/emergency-stop');
      setMessage({ tone: 'ok', text: t('state.saved') });
      queryCache.invalidate([keys.automation, keys.status]);
    } catch (failure) {
      setMessage({ tone: 'danger', text: failure instanceof ApiFailure ? failure.message : t('state.failed') });
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.automation')}</h2>
        <div className="filters">
          <Badge tone={data.effectiveEmailMode === 'LIVE' ? 'danger' : data.effectiveEmailMode === 'PREVIEW' ? 'warn' : 'neutral'}>
            {t('automation.mode')}: {data.effectiveEmailMode}
          </Badge>
          <Badge tone={data.emergencyStop ? 'danger' : 'ok'}>
            {t('automation.emergency')}: {data.emergencyStop ? 'ON' : 'OFF'}
          </Badge>
        </div>
      </div>

      {message ? <div className={`banner ${message.tone}`}>{message.text}</div> : null}
      {!isAdmin ? <div className="banner info">{t('state.denied')} (ADMIN)</div> : null}

      <Section title={t('automation.liveRequirements')}>
        <ul className="list">
          {data.liveRequirements.map((requirement) => (
            <li key={requirement.key}>
              <Badge tone={requirement.satisfied ? 'ok' : 'warn'}>{requirement.satisfied ? 'OK' : 'BLOCKED'}</Badge>
              {requirement.detail}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('nav.automation')}>
        {data.settings.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('column.name')}</th>
                <th>{t('common.items')}</th>
                <th>{t('common.unset')}</th>
              </tr>
            </thead>
            <tbody>
              {data.settings.map((setting) => (
                <tr key={setting.key}>
                  <td>
                    {setting.key}
                    {setting.adminOnly ? <Badge tone="warn">ADMIN</Badge> : null}
                    <div className="muted small">{setting.description}</div>
                  </td>
                  <td>
                    <input
                      value={value(setting.key)}
                      disabled={!isAdmin || setting.adminOnly === false ? false : !isAdmin}
                      onChange={(event) => setDraft((current) => ({ ...current, [setting.key]: event.target.value }))}
                    />
                  </td>
                  <td className="muted small">
                    {setting.updatedAt.slice(0, 16).replace('T', ' ')} · {setting.updatedBy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {modeChanging ? <div className="banner warning">{t('automation.confirmLive')}</div> : null}
      {publishChanging ? <div className="banner warning">{t('automation.confirmPublish')}</div> : null}
      {modeChanging || publishChanging ? (
        <label className="field">
          <span className="field-label">{t('confirm.type', { text: modeChanging ? 'ENABLE LIVE EMAIL' : 'ENABLE SHARED DASHBOARD PUBLICATION' })}</span>
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
      ) : null}

      <div className="inline-actions">
        <button type="button" className="button" disabled={!isAdmin || !Object.keys(changes).length} onClick={() => void save()}>
          {t('automation.save')}
        </button>
        <button type="button" className="button danger" disabled={!isAdmin} onClick={() => void stop()}>
          {t('automation.emergency')}
        </button>
        <SaveState state="idle" />
      </div>
      <p className="muted small">
        {t('automation.revision')}: {data.revision}
      </p>
    </div>
  );
}
