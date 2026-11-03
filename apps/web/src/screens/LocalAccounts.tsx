/**
 * Local account administration (ADMIN only; the server re-checks the role on every call).
 *
 * Three simple jobs: create a brand-new employee with a login, attach a login to an existing
 * member without touching that member's name/role/history, and reset a password. The employee
 * number is the login identifier and keeps its leading zeros.
 */
import { useState } from 'react';
import type { LinkableMemberList, LocalAccountList } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { useQuery, queryCache } from '../state/cache';
import { useI18n } from '../i18n';
import { ErrorBox } from '../components/ui';
import { SelectInput, TextInput, useSave } from '../components/forms';

export function PasswordScreen({ required, onChanged, onCancel }: { required: boolean; onChanged: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const save = useSave();
  const matches = password.length >= 4 && password === repeat;
  return (
    <main className="login-screen">
      <form
        className="login-card stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!matches) return;
          void save.run(
            () => api.post('/api/account/password', { currentPassword: current, password }),
            { onSuccess: onChanged }
          );
        }}
      >
        <h2>{t('local.change')}</h2>
        {required ? <p>{t('local.required')}</p> : null}
        <label className="field">
          <span>{t('local.current')}</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required maxLength={128} />
        </label>
        <label className="field">
          <span>{t('local.newPassword')}</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={4} maxLength={128} />
        </label>
        <label className="field">
          <span>{t('local.repeat')}</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} required maxLength={128} />
        </label>
        <ErrorBox error={save.error} />
        <button className="button" disabled={save.state === 'saving' || !matches}>
          {t('local.change')}
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          {t(required ? 'nav.signOut' : 'action.cancel')}
        </button>
      </form>
    </main>
  );
}

type Account = LocalAccountList['items'][number];

function freshKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'account-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

export function LocalAccountsScreen(): JSX.Element {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'new' | 'link'>('new');
  const [idempotencyKey, setIdempotencyKey] = useState(freshKey);
  const [employeeId, setEmployeeId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [password, setPassword] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<{ memberId: string; name: string; role: string } | null>(null);
  const [reset, setReset] = useState<Account | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const save = useSave();

  const list = useQuery<LocalAccountList>(`local-accounts${queryString({ page, query })}`, () =>
    api.get<LocalAccountList>('/api/admin/accounts' + queryString({ page, query }))
  );
  const linkable = useQuery<LinkableMemberList>(`local-linkable:${memberQuery}`, () =>
    api.get<LinkableMemberList>('/api/admin/accounts/linkable' + queryString({ query: memberQuery, limit: 20 }))
  );

  const valid = reset
    ? password.length >= 4 && confirmed
    : employeeId.trim().length > 0 &&
      password.length >= 4 &&
      (mode === 'new' ? name.trim().length > 0 : !!selectedMember);

  const submit = (): void => {
    setNotice('');
    if (reset) {
      void save.run(
        () => api.post(`/api/admin/accounts/${reset.memberId}/reset-password`, { password, confirmed }),
        {
          onSuccess: () => {
            setNotice(t('local.saved'));
            setReset(null);
            setPassword('');
            setConfirmed(false);
            queryCache.invalidate(['local-accounts']);
          }
        }
      );
      return;
    }
    void save.run(
      () =>
        api.post('/api/admin/accounts', {
          idempotencyKey,
          employeeId: employeeId.trim(),
          password,
          ...(mode === 'new' ? { name: name.trim(), role } : { memberId: selectedMember?.memberId })
        }),
      {
        onSuccess: () => {
          setNotice(t('local.saved'));
          setIdempotencyKey(freshKey());
          setPassword('');
          setEmployeeId('');
          setName('');
          setSelectedMember(null);
          setMemberQuery('');
          queryCache.invalidate(['local-accounts', 'local-linkable', 'members']);
        }
      }
    );
  };

  return (
    <div className="screen stack">
      <h2>{t('local.accounts')}</h2>
      <p className="muted small">{t('local.employeeNumberHint')}</p>

      <label className="field">
        <span className="field-label">{t('filter.query')}</span>
        <input
          type="search"
          value={query}
          placeholder={t('filter.query')}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      </label>

      <ErrorBox error={list.error} onRetry={() => list.refresh()} />
      {list.data && list.data.items.length === 0 ? <p className="muted">{t('local.noAccounts')}</p> : null}
      {list.data && list.data.items.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t('local.employeeId')}</th>
              <th>{t('members.name')}</th>
              <th>{t('members.role')}</th>
              <th>{t('members.active')}</th>
              <th>{t('local.mustChange')}</th>
              <th>{t('column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((account) => (
              <tr key={account.memberId}>
                <td>{account.employeeId}</td>
                <td>{account.name}</td>
                <td>{account.role}</td>
                <td>{account.active ? 'ON' : 'OFF'}</td>
                <td>{account.mustChangePassword ? 'ON' : '—'}</td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setReset(account);
                      setPassword('');
                      setConfirmed(false);
                      setNotice('');
                    }}
                  >
                    {t('local.reset')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {list.data ? (
        <div className="inline-actions">
          <button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
            {t('local.previous')}
          </button>
          <span>
            {list.data.page} / {list.data.totalPages}
          </span>
          <button className="button secondary" disabled={page >= list.data.totalPages} onClick={() => setPage(page + 1)}>
            {t('local.next')}
          </button>
        </div>
      ) : null}

      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) submit();
        }}
      >
        <h3>{reset ? `${t('local.reset')} · ${reset.employeeId}` : t('local.create')}</h3>

        {!reset ? (
          <div className="filters">
            <button
              type="button"
              className={mode === 'new' ? 'button' : 'button secondary'}
              onClick={() => {
                setMode('new');
                setSelectedMember(null);
              }}
            >
              {t('local.newMember')}
            </button>
            <button
              type="button"
              className={mode === 'link' ? 'button' : 'button secondary'}
              onClick={() => setMode('link')}
            >
              {t('local.linkExisting')}
            </button>
          </div>
        ) : null}

        <fieldset className="stack" disabled={save.state === 'saving' || save.state === 'unknown'}>
          {!reset && mode === 'new' ? (
            <>
              <label className="field">
                <span className="field-label">{t('members.name')}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
              </label>
              <label className="field">
                <span className="field-label">{t('members.role')}</span>
                <SelectInput
                  value={role}
                  onChange={setRole}
                  options={['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'].map((value) => ({ value, label: value }))}
                />
              </label>
            </>
          ) : null}

          {!reset && mode === 'link' ? (
            <section className="stack">
              <label className="field">
                <span className="field-label">{t('local.memberSearch')}</span>
                <input
                  type="search"
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                />
              </label>
              <ErrorBox error={linkable.error} onRetry={() => linkable.refresh()} />
              {selectedMember ? (
                <p className="small">
                  <span className="muted">{t('local.memberSelected')}: </span>
                  <strong>{selectedMember.name}</strong> ({selectedMember.memberId} · {selectedMember.role})
                  <button type="button" className="link-button" onClick={() => setSelectedMember(null)}>
                    {t('action.cancel')}
                  </button>
                </p>
              ) : (
                <>
                  {linkable.data && linkable.data.items.length === 0 ? (
                    <p className="muted small">{t('local.noLinkable')}</p>
                  ) : (
                    <ul className="list">
                      {(linkable.data?.items ?? []).map((entry) => (
                        <li key={entry.memberId}>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setSelectedMember({ memberId: entry.memberId, name: entry.name, role: entry.role })}
                          >
                            {entry.name} · {entry.memberId} · {entry.role}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <p className="muted small">{t('local.roleFromMember')}</p>
            </section>
          ) : null}

          {!reset ? (
            <label className="field">
              <span className="field-label">{t('local.employeeId')}</span>
              <TextInput value={employeeId} onChange={setEmployeeId} required />
            </label>
          ) : null}

          <label className="field">
            <span className="field-label">{t('local.temporary')}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={4}
              maxLength={128}
            />
          </label>
          {reset ? (
            <label className="checkbox">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              {t('local.resetConfirm')}
            </label>
          ) : null}
        </fieldset>

        <ErrorBox error={save.error} />
        {notice ? <p role="status">{notice}</p> : null}
        <div className="inline-actions">
          <button className="button" disabled={!valid || save.state === 'saving'}>
            {t('action.save')}
          </button>
          {reset ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setReset(null);
                setPassword('');
                setConfirmed(false);
              }}
            >
              {t('action.cancel')}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
