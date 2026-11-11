/**
 * Division administration (課).
 *
 * ADMIN only. A division is administrator-managed data: the identifier is stable, renaming keeps
 * every project, task and audit row intact, and retiring one is a status change that never deletes
 * the record or its history (廃止 / 再有効化).
 */
import { useState } from 'react';
import type { Division } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, SaveState, Section } from '../components/ui';
import { TextInput, useSave } from '../components/forms';
import { setDivisionScope } from '../state/division';
import { DivisionMappingPanel } from '../components/division-mapping-panel';

type Page = { items: (Division & { _revision: number })[] };

export function DivisionsScreen(): JSX.Element {
  const { t } = useI18n();
  const list = useQuery<Page>(keys.divisions, () => api.get<Page>('/api/manager/divisions'));
  const [editing, setEditing] = useState<Division | 'new' | null>(null);
  const save = useSave();

  const reload = (): void => {
    queryCache.invalidate([keys.divisions, keys.references]);
    list.refresh();
  };

  /** The shell rebuilds its switch from the session answer, so a rename refreshes it too. */
  const syncShell = async (): Promise<void> => {
    try {
      const session = await api.get<{ divisions?: Parameters<typeof setDivisionScope>[0] }>('/api/session');
      if (session.divisions) setDivisionScope(session.divisions);
    } catch {
      // A failed refresh leaves the previous switch; the next navigation re-reads it.
    }
  };

  const lifecycle = async (division: Division, action: 'retire' | 'reactivate'): Promise<void> => {
    const confirmed = window.confirm(
      action === 'retire'
        ? `${division.name}: ${t('division.retire')}`
        : `${division.name}: ${t('division.reactivate')}`
    );
    if (!confirmed) return;
    await save.run(async () => {
      await api.post(`/api/admin/divisions/${division.divisionId}/${action}`, {
        revision: division.revision,
        confirmed: true
      });
      return undefined;
    });
    reload();
    await syncShell();
  };

  const move = async (division: Division, direction: 'UP' | 'DOWN', neighborId: string | null): Promise<void> => {
    await save.run(async () => {
      await api.patch(`/api/admin/divisions/${division.divisionId}/order`, {
        revision: division.revision,
        direction,
        expectedNeighborId: neighborId
      });
      return undefined;
    });
    reload();
    await syncShell();
  };

  const items = list.data?.items ?? [];

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('division.manage')}</h2>
        <div className="filters">
          <button type="button" className="button" onClick={() => setEditing('new')}>
            {t('division.new')}
          </button>
        </div>
      </div>
      <p className="muted small">{t('division.hint')}</p>
      <SaveState state={save.state} />
      <ErrorBox error={list.error || save.error} onRetry={() => list.refresh()} />
      {!list.data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('division.name')}</th>
              <th>{t('division.status')}</th>
              <th>{t('division.order')}</th>
              <th>{t('column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((division) => {
              // Reordering stays inside the active/retired group, exactly like the server: a retired
              // division is never the neighbour of an active one.
              const group = items.filter((entry) => entry.status === division.status);
              const groupIndex = group.findIndex((entry) => entry.divisionId === division.divisionId);
              return (
                <tr key={division.divisionId}>
                  <td>{division.name}</td>
                  <td>
                    <Badge tone={division.status === 'Active' ? 'ok' : 'neutral'}>
                      {division.status === 'Active' ? t('division.active') : t('division.retired')}
                    </Badge>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      disabled={groupIndex === 0}
                      onClick={() => void move(division, 'UP', group[groupIndex - 1]?.divisionId ?? null)}
                    >
                      ↑ {t('division.moveUp')}
                    </button>{' '}
                    <button
                      type="button"
                      className="link-button"
                      disabled={groupIndex === group.length - 1}
                      onClick={() => void move(division, 'DOWN', group[groupIndex + 1]?.divisionId ?? null)}
                    >
                      ↓ {t('division.moveDown')}
                    </button>
                  </td>
                  <td className="project-actions-cell">
                    <div className="actions">
                      <button type="button" className="link-button" onClick={() => setEditing(division)}>
                        {t('action.edit')}
                      </button>
                      {division.status === 'Active' ? (
                        <button type="button" className="link-button" onClick={() => void lifecycle(division, 'retire')}>
                          {t('division.retire')}
                        </button>
                      ) : (
                        <button type="button" className="link-button" onClick={() => void lifecycle(division, 'reactivate')}>
                          {t('division.reactivate')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <DivisionMappingPanel />
      {editing ? (
        <DivisionForm
          division={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
            void syncShell();
          }}
        />
      ) : null}
    </div>
  );
}

function DivisionForm({
  division,
  onClose,
  onSaved
}: {
  division?: Division;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const save = useSave();
  const [name, setName] = useState(division?.name ?? '');
  return (
    <Section title={division ? t('division.edit') : t('division.new')}>
      <label className="field">
        <span className="field-label">{t('division.name')}</span>
        <TextInput value={name} onChange={setName} required />
      </label>
      <SaveState state={save.state} />
      <ErrorBox error={save.error} />
      <div className="inline-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          {t('action.cancel')}
        </button>
        <button
          type="button"
          className="button"
          disabled={!name || save.state === 'saving'}
          onClick={() =>
            void save.run(
              async () => {
                if (!division) {
                  return api.post('/api/admin/divisions', { name });
                }
                return api.patch(`/api/admin/divisions/${division.divisionId}`, {
                  revision: division.revision,
                  name
                });
              },
              { onSuccess: onSaved }
            )
          }
        >
          {division ? t('action.save') : t('action.create')}
        </button>
      </div>
    </Section>
  );
}
