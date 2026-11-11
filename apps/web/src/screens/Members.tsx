/** Member directory and profile. Role and activation changes are ADMIN-only and server-checked. */
import { useState } from 'react';
import type { Actor, Member, MemberProfileView } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Pagination, SaveState, Section } from '../components/ui';
import { DeadlineCell } from '../components/deadline';
import { TaskStatusBadge, WorkflowHint } from '../components/task-status';import { SelectInput, TextInput, useIdempotencyKey, useSave } from '../components/forms';
import { useDivisionScope } from '../state/division';

type Page = { items: (Member & { _revision: number })[]; total: number; page: number; pageSize: number; totalPages: number };
const ROLES = ['ADMIN', 'MANAGER', 'GENERAL_MANAGER', 'MEMBER', 'VIEWER'];

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
                <td className="project-actions-cell">
                  <div className="actions">
                    <button type="button" className="link-button" onClick={() => setEditing(member)}>
                      {t('action.edit')}
                    </button>
                  </div>
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
  const scope = useDivisionScope();
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [department, setDepartment] = useState(member?.department ?? '');
  const [position, setPosition] = useState(member?.position ?? '');
  const [role, setRole] = useState(member?.role ?? 'VIEWER');
  const [active, setActive] = useState(member?.active ?? true);
  const [capacity, setCapacity] = useState(member?.weeklyCapacityHours !== null && member?.weeklyCapacityHours !== undefined ? String(member.weeklyCapacityHours) : '');
  // Division access is an ADMIN relationship edit; the server refuses it for any other role.
  const [grants, setGrants] = useState<Record<string, 'WORK' | 'READ'>>(() =>
    Object.fromEntries((member?.divisionGrants ?? []).map((grant) => [grant.divisionId, grant.accessKind]))
  );
  const [allDivisions, setAllDivisions] = useState(member?.allDivisionsRead === true);
  const activeDivisions = scope.readable.filter((division) => division.status === 'Active');

  const setGrant = (divisionId: string, kind: 'WORK' | 'READ' | null): void => {
    setGrants((current) => {
      const next = { ...current };
      if (kind) next[divisionId] = kind;
      else delete next[divisionId];
      return next;
    });
  };

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
            <TextInput type="email" value={email} onChange={setEmail} required={!member} />
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
            <section className="field divison-grants">
              <h3 className="field-label">{t('division.label')}</h3>
              <p className="muted small">{t('members.divisionsHint')}</p>
              {activeDivisions.length === 0 ? (
                <p className="muted small">{t('division.none')}</p>
              ) : (
                <table className="table division-grant-table">
                  <thead>
                    <tr>
                      <th>{t('division.label')}</th>
                      <th>{t('members.divisions')}</th>
                      <th>{t('members.additionalRead')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDivisions.map((division) => (
                      <tr key={division.divisionId}>
                        <td>{division.name}</td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${division.name} ${t('members.divisions')}`}
                            checked={grants[division.divisionId] === 'WORK'}
                            onChange={(event) => setGrant(division.divisionId, event.target.checked ? 'WORK' : null)}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${division.name} ${t('members.additionalRead')}`}
                            checked={grants[division.divisionId] === 'READ'}
                            onChange={(event) => setGrant(division.divisionId, event.target.checked ? 'READ' : null)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {role === 'GENERAL_MANAGER' ? (
                <fieldset className="field">
                  <legend className="field-label">{t('division.label')}</legend>
                  <label className="checkbox">
                    <input type="radio" name="division-oversight" checked={allDivisions} onChange={() => setAllDivisions(true)} />
                    {t('members.allDivisions')}
                  </label>
                  <label className="checkbox">
                    <input type="radio" name="division-oversight" checked={!allDivisions} onChange={() => setAllDivisions(false)} />
                    {t('members.selectedDivisions')}
                  </label>
                  <span className="field-hint">{t('members.allDivisionsHint')}</span>
                </fieldset>
              ) : null}
              {save.error ? <span className="field-hint">{t('members.divisionBlocked')}</span> : null}
            </section>
          ) : null}
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
              disabled={!name || (!member && !email) || save.state === 'saving'}
              onClick={() =>
                void save.run(
                  async () => {
                    const payload: Record<string, unknown> = {
                      name,
                      ...(email ? {email} : {}),
                      department,
                      position,
                      weeklyCapacityHours: capacity === '' ? null : Number(capacity)
                    };
                    if (canChangeRole) {
                      if (!member || role !== member.role) payload.role = role;
                      if (!member || active !== member.active) payload.active = active;
                      const storedGrants = JSON.stringify(
                        (member?.divisionGrants ?? [])
                          .map((grant) => [grant.divisionId, grant.accessKind])
                          .sort()
                      );
                      const nextGrants = JSON.stringify(Object.entries(grants).sort());
                      if (!member || storedGrants !== nextGrants) {
                        payload.divisionGrants = Object.entries(grants).map(([divisionId, accessKind]) => ({ divisionId, accessKind }));
                      }
                      if (role === 'GENERAL_MANAGER' && (!member || allDivisions !== member.allDivisionsRead)) {
                        payload.allDivisionsRead = allDivisions;
                      }
                    }
                    if (!member) {
                      return api.post('/api/manager/members', { ...payload, idempotencyKey });
                    }
                    for (const key of Object.keys(payload)) {
                      if (payload[key] === member[key as keyof Member]) delete payload[key];
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
  const { t } = useI18n();
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
                <TaskStatusBadge state={task.displayStatus} missing={task.scheduleMissing} showDetail />
                <WorkflowHint status={task.status} />
                <DeadlineCell dueDate={task.dueDate} state={task.displayStatus} showLabel={false} />
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
