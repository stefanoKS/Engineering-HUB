/** Member directory and profile. Role and activation changes are ADMIN-only and server-checked. */
import { useState } from 'react';
import type { Actor, Member, MemberProfileView } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Pagination, SaveState, Section, statusTone } from '../components/ui';
import { SelectInput, TextInput, useIdempotencyKey, useSave } from '../components/forms';

type Page = { items: (Member & { _revision: number })[]; total: number; page: number; pageSize: number; totalPages: number };
const ROLES = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];

export function MembersScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const list = useQuery<Page>(`${keys.members}${queryString({ query, page })}`, () =>
    api.get<Page>(`/api/manager/members${queryString({ query, page, pageSize: 25 })}`)
  );

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.members')}</h2>
        <div className="filters">
          <input
            placeholder={t('filter.query')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
          {actor.role === 'ADMIN' || actor.role === 'MANAGER' ? (
            <button type="button" className="button" onClick={() => setEditing('new')}>
              {t('members.new')}
            </button>
          ) : null}
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
              <th>{t('members.name')}</th>
              <th>{t('members.department')}</th>
              <th>{t('members.role')}</th>
              <th>{t('members.active')}</th>
              <th>{t('column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((member) => (
              <tr key={member.memberId}>
                <td>
                  <a href={`#/member/${member.memberId}`}>{member.name}</a>
                  <div className="muted small">{member.email}</div>
                </td>
                <td>
                  {member.department || t('common.unset')} / {member.position || t('common.unset')}
                </td>
                <td>
                  <Badge tone={member.role === 'ADMIN' ? 'danger' : member.role === 'MANAGER' ? 'info' : 'neutral'}>
                    {member.role}
                  </Badge>
                </td>
                <td>
                  <Badge tone={member.active ? 'ok' : 'neutral'}>{member.active ? 'ON' : 'OFF'}</Badge>
                </td>
                <td className="actions">
                  <button type="button" className="link-button" onClick={() => setEditing(member)}>
                    {t('action.edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.data ? (
        <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onChange={setPage} />
      ) : null}
      {editing ? (
        <MemberForm
          member={editing === 'new' ? undefined : editing}
          canChangeRole={actor.role === 'ADMIN'}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryCache.invalidate([keys.members, keys.references, keys.status]);
          }}
        />
      ) : null}
    </div>
  );
}

function MemberForm({
  member,
  canChangeRole,
  onClose,
  onSaved
}: {
  member?: Member;
  canChangeRole: boolean;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const save = useSave();
  const idempotencyKey = useIdempotencyKey();
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [department, setDepartment] = useState(member?.department ?? '');
  const [position, setPosition] = useState(member?.position ?? '');
  const [role, setRole] = useState(member?.role ?? 'VIEWER');
  const [active, setActive] = useState(member?.active ?? true);
  const [capacity, setCapacity] = useState(member?.weeklyCapacityHours !== null && member?.weeklyCapacityHours !== undefined ? String(member.weeklyCapacityHours) : '');

  return (
    <div className="modal-screen" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <header className="modal-header">
          <h2>{member ? t('members.edit') : t('members.new')}</h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t('action.cancel')}
          </button>
        </header>
        <div className="modal-body stack">
          <label className="field">
            <span className="field-label">{t('members.name')}</span>
            <TextInput value={name} onChange={setName} required />
          </label>
          <label className="field">
            <span className="field-label">{t('members.email')}</span>
            <TextInput type="email" value={email} onChange={setEmail} required />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('members.department')}</span>
              <TextInput value={department} onChange={setDepartment} />
            </label>
            <label className="field">
              <span className="field-label">{t('members.position')}</span>
              <TextInput value={position} onChange={setPosition} />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('members.role')}</span>
              <SelectInput
                value={role}
                onChange={(value) => setRole(value as Member['role'])}
                options={ROLES.map((value) => ({ value, label: value }))}
              />
              {!canChangeRole ? <span className="field-hint">{t('state.denied')} (ADMIN)</span> : null}
            </label>
            <label className="field">
              <span className="field-label">{t('members.capacity')}</span>
              <TextInput type="number" min={0} value={capacity} onChange={setCapacity} />
            </label>
          </div>
          {canChangeRole ? (
            <label className="checkbox">
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
              {t('members.active')}
            </label>
          ) : null}
          <SaveState state={save.state} />
          <ErrorBox error={save.error} />
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {t('action.cancel')}
            </button>
            <button
              type="button"
              className="button"
              disabled={!name || !email || save.state === 'saving'}
              onClick={() =>
                void save.run(
                  async () => {
                    const payload: Record<string, unknown> = {
                      name,
                      email,
                      department,
                      position,
                      weeklyCapacityHours: capacity === '' ? null : Number(capacity)
                    };
                    if (canChangeRole) {
                      payload.role = role;
                      payload.active = active;
                    }
                    if (!member) {
                      return api.post('/api/manager/members', { ...payload, idempotencyKey });
                    }
                    return api.patch(`/api/manager/members/${member.memberId}`, {
                      ...payload,
                      revision: member.revision
                    });
                  },
                  { onSuccess: onSaved }
                )
              }
            >
              {member ? t('action.save') : t('action.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MemberProfileScreen({ actor, memberId }: { actor: Actor; memberId: string }): JSX.Element {
  const { t, label } = useI18n();
  void actor;
  const profile = useQuery<MemberProfileView>(keys.member(memberId), () =>
    api.get<MemberProfileView>(`/api/manager/members/${memberId}/profile`)
  );
  if (profile.error) return <ErrorBox error={profile.error} onRetry={() => profile.refresh()} />;
  if (!profile.data) return <p className="muted">{t('state.loading')}</p>;
  const data = profile.data;
  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2>{data.member.name}</h2>
          <p className="muted small">
            {data.member.department || t('common.unset')} / {data.member.position || t('common.unset')} ·{' '}
            {data.member.role}
          </p>
        </div>
      </div>
      <Section title={t('members.current')}>
        {data.current.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="list">
            {data.current.map((task) => (
              <li key={task.taskId}>
                <a href={`#/task/${task.taskId}`}>{task.taskName}</a>
                <Badge tone={statusTone(task.status)}>{label('task.status', task.status)}</Badge>
                <span className="muted small">{task.dueDate ?? t('common.unset')}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t('members.previous')}>
        {data.previous.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="list">
            {data.previous.map((task) => (
              <li key={task.taskId}>
                <a href={`#/task/${task.taskId}`}>{task.taskName}</a>
                <span className="muted small">
                  {t('column.owner')}: {task.ownerName || t('common.unset')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t('members.activity')}>
        {data.activity.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="list">
            {data.activity.map((entry) => (
              <li key={entry.auditId}>
                <span className="muted small">{entry.occurredAt.slice(0, 16).replace('T', ' ')}</span> {entry.action}{' '}
                <span className="muted small">{entry.entityType}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">{data.ownership.limitation}</p>
      </Section>
    </div>
  );
}
