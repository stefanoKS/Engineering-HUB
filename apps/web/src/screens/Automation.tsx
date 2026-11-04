/**
 * Automation settings: safe defaults, an explicit LIVE gate and the emergency stop.
 *
 * Each stored key keeps its existing name and value; only the control changes. The configured
 * value is shown next to the effective state, so "saved as LIVE but stopped by the emergency stop"
 * is never presented as one ambiguous figure. A manager gets a genuine read-only presentation.
 */
import { useMemo, useState } from 'react';
import type { Actor, AutomationSetting, AutomationSettingsView } from '@eh/contracts';
import { api, ApiFailure } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Section } from '../components/ui';

type Control = 'toggle' | 'mode' | 'number' | 'time' | 'day' | 'text';

const MODE_VALUES = ['OFF', 'PREVIEW', 'LIVE'];
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/** The control is chosen from the documented key, never from the stored text. */
function controlOf(key: string): Control {
  if (key === 'EMAIL_MODE') return 'mode';
  if (key === 'WEEKLY_REPORT_DAY') return 'day';
  if (['EXECUTION_WINDOW_START', 'EXECUTION_WINDOW_END', 'WEEKLY_REPORT_TIME'].includes(key)) return 'time';
  if (
    [
      'REMINDER_CATCHUP_DAYS',
      'OVERDUE_FREQUENCY_DAYS',
      'PROJECT_STALE_DAYS',
      'HEALTH_MILESTONE_APPROACH_DAYS',
      'HEALTH_DELAY_TOLERANCE_DAYS',
      'BACKUP_INTERVAL_MINUTES',
      'SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES',
      'MAX_EMAILS_PER_RUN'
    ].includes(key)
  ) {
    return 'number';
  }
  if (key.endsWith('_ENABLED') || key === 'EMERGENCY_STOP' || key === 'WEEKDAY_ONLY_SENDING') return 'toggle';
  return 'text';
}

function consequenceKey(control: Control, key: string): string {
  if (key === 'EMAIL_MODE' || key === 'EMERGENCY_STOP' || key === 'SHARED_DASHBOARD_PUBLISH_ENABLED' || key === 'MAX_EMAILS_PER_RUN') {
    return `automation.consequence.${key}`;
  }
  return control === 'toggle'
    ? 'automation.consequence.TOGGLE'
    : control === 'number'
      ? 'automation.consequence.COUNT'
      : 'automation.consequence.DEFAULT';
}

export function AutomationScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const isAdmin = actor.role === 'ADMIN';
  const view = useQuery<AutomationSettingsView>(keys.automation, () =>
    api.get<AutomationSettingsView>('/api/manager/automation')
  );
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<{ tone: string; text: string } | null>(null);
  const [pending, setPending] = useState<'save' | 'stop' | null>(null);

  const changes = useMemo(() => {
    const result: Record<string, string> = {};
    for (const setting of view.data?.settings ?? []) {
      const next = draft[setting.key];
      if (next !== undefined && next !== setting.value) result[setting.key] = next;
    }
    return result;
  }, [draft, view.data]);

  if (view.error) return <ErrorBox error={view.error} onRetry={() => view.refresh()} />;
  if (!view.data) return <p className="muted">{t('state.loading')}</p>;

  const data = view.data;
  const value = (key: string): string => draft[key] ?? data.settings.find((setting) => setting.key === key)?.value ?? '';
  const configuredEmailMode = value('EMAIL_MODE');
  const modeChanging = changes.EMAIL_MODE === 'LIVE';
  const publishChanging = changes.SHARED_DASHBOARD_PUBLISH_ENABLED === 'true';
  const requiredPhrase = modeChanging ? 'ENABLE LIVE EMAIL' : publishChanging ? 'ENABLE SHARED DASHBOARD PUBLICATION' : '';
  const phraseConfirmed = !requiredPhrase || confirmation === requiredPhrase;

  async function save(): Promise<void> {
    if (pending) return;
    setPending('save');
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
    } finally {
      setPending(null);
    }
  }

  async function stop(): Promise<void> {
    if (pending) return;
    setPending('stop');
    setMessage(null);
    try {
      await api.post('/api/manager/automation/emergency-stop');
      setMessage({ tone: 'ok', text: t('state.saved') });
      setDraft({});
      queryCache.invalidate([keys.automation, keys.status]);
    } catch (failure) {
      setMessage({ tone: 'danger', text: failure instanceof ApiFailure ? failure.message : t('state.failed') });
    } finally {
      setPending(null);
    }
  }

  function control(setting: AutomationSetting): JSX.Element {
    const control = controlOf(setting.key);
    const current = value(setting.key);
    const disabled = !isAdmin || pending !== null;
    if (control === 'toggle') {
      const on = current === 'true';
      return (
        <label className="switch">
          <input
            type="checkbox"
            checked={on}
            disabled={disabled}
            onChange={(event) => setDraft((state) => ({ ...state, [setting.key]: event.target.checked ? 'true' : 'false' }))}
          />
          <span>{on ? 'ON' : 'OFF'}</span>
        </label>
      );
    }
    if (control === 'mode') {
      return (
        <select
          value={current}
          disabled={disabled}
          aria-label={setting.key}
          onChange={(event) => setDraft((state) => ({ ...state, [setting.key]: event.target.value }))}
        >
          {MODE_VALUES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      );
    }
    if (control === 'day') {
      return (
        <select
          value={current}
          disabled={disabled}
          aria-label={setting.key}
          onChange={(event) => setDraft((state) => ({ ...state, [setting.key]: event.target.value }))}
        >
          {DAYS.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={control === 'number' ? 'number' : control === 'time' ? 'time' : 'text'}
        min={control === 'number' ? 0 : undefined}
        value={current}
        disabled={disabled}
        aria-label={setting.key}
        placeholder={current === '' ? t('automation.valueNotSet') : undefined}
        onChange={(event) => setDraft((state) => ({ ...state, [setting.key]: event.target.value }))}
      />
    );
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.automation')}</h2>
        <div className="filters">
          <Badge tone={data.effectiveEmailMode === 'LIVE' ? 'danger' : data.effectiveEmailMode === 'PREVIEW' ? 'warn' : 'neutral'}>
            {t('automation.effective')}: {data.effectiveEmailMode}
          </Badge>
          <Badge tone={data.emergencyStop ? 'danger' : 'ok'}>
            {t('automation.emergency')}: {data.emergencyStop ? 'ON' : 'OFF'}
          </Badge>
        </div>
      </div>

      {message ? (
        <div className={`banner ${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </div>
      ) : null}
      {!isAdmin ? <div className="banner info">{t('automation.readOnlyHint')}</div> : null}
      <p className="muted small">
        {t('automation.configured')}: {configuredEmailMode || t('automation.valueNotSet')} · {t('automation.effective')}:{' '}
        {data.effectiveEmailMode}
      </p>

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
          <table className="table automation-table">
            <thead>
              <tr>
                <th>{t('column.name')}</th>
                <th>{t('automation.configured')}</th>
                <th>{t('automation.consequence')}</th>
                <th>{t('common.items')}</th>
              </tr>
            </thead>
            <tbody>
              {data.settings.map((setting) => (
                <tr key={setting.key}>
                  <td>
                    <strong>{setting.key}</strong>
                    {setting.adminOnly ? <Badge tone="warn">ADMIN</Badge> : null}
                    <div className="muted small">{setting.description}</div>
                  </td>
                  <td>{setting.value === '' ? t('automation.valueNotSet') : setting.value}</td>
                  <td className="muted small">{t(consequenceKey(controlOf(setting.key), setting.key))}</td>
                  <td>{control(setting)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          {t('automation.revision')}: {data.revision}
        </p>
      </Section>

      {requiredPhrase ? (
        <>
          <div className="banner warning">
            {modeChanging ? t('automation.confirmLive') : t('automation.confirmPublish')}
          </div>
          <label className="field">
            <span className="field-label">{t('confirm.type', { text: requiredPhrase })}</span>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
        </>
      ) : null}

      <div className="inline-actions">
        <button
          type="button"
          className="button"
          disabled={!isAdmin || !Object.keys(changes).length || !phraseConfirmed || pending !== null}
          onClick={() => void save()}
        >
          {pending === 'save' ? t('state.saving') : t('automation.save')}
        </button>
        <button
          type="button"
          className="button danger"
          disabled={!isAdmin || pending !== null}
          onClick={() => void stop()}
        >
          {pending === 'stop' ? t('state.saving') : t('automation.emergency')}
        </button>
      </div>
      {!phraseConfirmed ? <p className="muted small">{t('confirm.type', { text: requiredPhrase })}</p> : null}
    </div>
  );
}
