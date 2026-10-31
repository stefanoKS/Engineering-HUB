/** Responsibility areas: list, create/edit, ordering and retirement. */
import { useState } from 'react';
import type { Actor, Responsibility } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, SaveState, Section, statusTone } from '../components/ui';
import { ConfirmDialog, SelectInput, TextInput, useIdempotencyKey, useSave } from '../components/forms';

type Member = { memberId: string; name: string; active: boolean };

export function ResponsibilitiesScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const [editing, setEditing] = useState<Responsibility | 'new' | null>(null);
  const [statusChange, setStatusChange] = useState<{ item: Responsibility; status: 'Active' | 'Retired' } | null>(null);
  const list = useQuery<{ items: (Responsibility & { _revision: number })[] }>(keys.responsibilities, () =>
    api.get<{ items: (Responsibility & { _revision: number })[] }>('/api/manager/responsibilities')
  );
  const members = useQuery<{ members: Member[] }>(keys.references, () =>
    api.get<{ members: Member[] }>('/api/manager/references')
  );

  async function move(item: Responsibility, delta: number): Promise<void> {
    await api.patch(`/api/manager/responsibilities/${item.responsibilityId}/order`, {
      revision: item.revision,
      sortOrder: Math.max(0, item.sortOrder + delta)
    });
    queryCache.invalidate([keys.responsibilities, keys.overview, keys.employee]);
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.responsibilities')}</h2>
        <div className="filters">
          <button type="button" className="button" onClick={() => setEditing('new')}>
            {t('responsibilities.new')}
          </button>
        </div>
      </div>
      <ErrorBox error={list.error} onRetry={() => list.refresh()} />
      {!list.data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : list.data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('column.name')}</th>
              <th>{t('responsibilities.owner')}</th>
              <th>{t('responsibilities.members')}</th>
              <th>{t('column.status')}</th>
              <th>{t('responsibilities.order')}</th>
              <th>{t('column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((item) => (
              <tr key={item.responsibilityId}>
                <td>
                  <span className="color-swatch" style={{ background: item.color || '#ccc' }} aria-hidden="true" />
                  {item.name}
                </td>
                <td>{item.ownerName || t('common.unset')}</td>
                <td>{item.members.filter((member) => !member.primary).map((member) => member.name).join(', ') || t('common.none')}</td>
                <td>
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                </td>
                <td>
                  <button type="button" className="link-button" onClick={() => void move(item, -1)}>
                    ↑
                  </button>
                  <button type="button" className="link-button" onClick={() => void move(item, 1)}>
                    ↓
                  </button>
                </td>
                <td className="actions">
                  <button type="button" className="link-button" onClick={() => setEditing(item)}>
                    {t('action.edit')}
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      setStatusChange({ item, status: item.status === 'Active' ? 'Retired' : 'Active' })
                    }
                  >
                    {item.status === 'Active' ? t('responsibilities.retire') : t('responsibilities.reactivate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing ? (
        <ResponsibilityForm
          item={editing === 'new' ? undefined : editing}
          members={members.data?.members ?? []}
          canChangeOwner={actor.role === 'ADMIN'}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : null}

      {statusChange ? (
        <ConfirmDialog
          title={statusChange.status === 'Retired' ? t('responsibilities.retire') : t('responsibilities.reactivate')}
          message={statusChange.item.name}
          onCancel={() => setStatusChange(null)}
          onConfirm={async ({ reason }) => {
            const action = statusChange.status === 'Retired' ? 'retire' : 'reactivate';
            await api.post(`/api/manager/responsibilities/${statusChange.item.responsibilityId}/${action}`, {
              revision: statusChange.item.revision,
              confirmed: true,
              reason
            });
            setStatusChange(null);
            queryCache.invalidate([keys.responsibilities, keys.overview, keys.employee]);
          }}
        />
      ) : null}
    </div>
  );
}

function ResponsibilityForm({
  item,
  members,
  canChangeOwner,
  onClose,
  onSaved
}: {
  item?: Responsibility;
  members: Member[];
  canChangeOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const save = useSave();
  const idempotencyKey = useIdempotencyKey();
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [ownerMemberId, setOwnerMemberId] = useState(item?.ownerMemberId ?? '');
  const [additional, setAdditional] = useState<string[]>(item?.additionalMemberIds ?? []);
  const [colorHex, setColorHex] = useState(item?.color ?? '');
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));

  return (
    <div className="modal-screen" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <header className="modal-header">
          <h2>{item ? t('responsibilities.edit') : t('responsibilities.new')}</h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t('action.cancel')}
          </button>
        </header>
        <div className="modal-body stack">
          <Section title={t('responsibilities.name')}>
            <TextInput value={name} onChange={setName} required />
          </Section>
          <label className="field">
            <span className="field-label">{t('projects.description')}</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
          </label>
          <label className="field">
            <span className="field-label">{t('responsibilities.owner')}</span>
            <SelectInput
              value={ownerMemberId}
              onChange={setOwnerMemberId}
              allowEmpty={t('common.unset')}
              options={members.map((member) => ({ value: member.memberId, label: member.name }))}
            />
            {!canChangeOwner ? <span className="field-hint">{t('state.denied')} (ADMIN)</span> : null}
          </label>
          <label className="field">
            <span className="field-label">{t('responsibilities.members')}</span>
            <select
              multiple
              value={additional}
              onChange={(event) => setAdditional([...event.target.selectedOptions].map((option) => option.value))}
            >
              {members.map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('responsibilities.color')}</span>
              <TextInput value={colorHex} onChange={setColorHex} placeholder="#2563EB" />
            </label>
            <label className="field">
              <span className="field-label">{t('responsibilities.order')}</span>
              <TextInput type="number" min={0} value={sortOrder} onChange={setSortOrder} />
            </label>
          </div>
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
                    const payload = {
                      name,
                      description,
                      ownerMemberId: ownerMemberId || null,
                      colorHex: colorHex || null,
                      sortOrder: Number(sortOrder) || 0,
                      additionalMemberIds: additional
                    };
                    if (!item) {
                      return api.post('/api/manager/responsibilities', { ...payload, idempotencyKey });
                    }
                    return api.patch(`/api/manager/responsibilities/${item.responsibilityId}`, {
                      ...payload,
                      revision: item.revision
                    });
                  },
                  {
                    onSuccess: () => {
                      queryCache.invalidate([keys.responsibilities, keys.overview, keys.employee, keys.references]);
                      onSaved();
                    }
                  }
                )
              }
            >
              {item ? t('action.save') : t('action.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
