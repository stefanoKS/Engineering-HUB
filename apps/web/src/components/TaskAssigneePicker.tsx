import { useEffect, useState } from 'react';
import { TaskAssigneeOptionPage } from '@eh/contracts';
import { api, ApiFailure, queryString } from '../api/client';
import { useI18n } from '../i18n';
import { useQuery } from '../state/cache';
import { ErrorBox, Pagination } from './ui';

type Option = { memberId: string; name: string; active: boolean; divisionNames?: string[]; employeeId?: string };
type Page = TaskAssigneeOptionPage;

async function loadOptions(params: string): Promise<Page> {
  const parsed = TaskAssigneeOptionPage.safeParse(await api.get<unknown>(`/api/work/task-assignees${params}`));
  if (!parsed.success) throw new ApiFailure({ code: 'INVALID_RESPONSE', message: 'Invalid assignee options response', retryable: true });
  return parsed.data;
}

/**
 * One readable label for an option.
 *
 * The stable member identifier stays the option value and the request parameter; it is never shown
 * as the label. Two people who share a display name are told apart by division first and by the
 * existing employee identifier only when the caller may already see one.
 */
export function assigneeOptionLabel(
  option: Option,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const context = [...(option.divisionNames ?? []), option.employeeId].filter((value): value is string => !!value);
  const base = context.length ? `${option.name} — ${context.join(' / ')}` : option.name;
  return option.active ? base : `${base} (${t('assignee.inactive')})`;
}

export function TaskAssigneePicker({ value, onChange }: { value: string; onChange: (id: string) => void }): JSX.Element {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const params = queryString({ query, page, pageSize: 25 });
  const list = useQuery<Page>(`work/task-assignees${params}`, () => loadOptions(params));
  const options = list.data?.items ?? [];
  const selectedParams = queryString({ memberId: value, pageSize: 1 });
  const selected = useQuery<Page>(`work/task-assignees${selectedParams}`, () =>
    loadOptions(selectedParams),
    { enabled: !!value && !options.some(option => option.memberId === value) });
  const selectedOption = selected.data?.items[0];
  // A raw identifier is never rendered while the label is loading or unavailable.
  const pendingLabel = selected.error ? t('assignee.unavailable') : t('assignee.loading');
  return <div className="project-picker stack">
    <input type="search" aria-label={t('tasks.assigneeSearch')} placeholder={t('tasks.assigneeSearch')}
      value={search} onChange={event => setSearch(event.target.value)} />
    <select aria-label={t('tasks.assigneeFilter')} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{t('filter.all')}</option>
      {value && !options.some(option => option.memberId === value) ? <option value={value}>
        {selectedOption ? assigneeOptionLabel(selectedOption, t) : pendingLabel}
      </option> : null}
      {options.map(option => <option key={option.memberId} value={option.memberId}>
        {assigneeOptionLabel(option, t)}
      </option>)}
    </select>
    {!list.data && !list.error ? <span role="status">{t('state.loading')}</span> : null}
    <ErrorBox error={list.error || selected.error} onRetry={() => { list.refresh(); if (value) selected.refresh(); }} />
    {list.data && !list.data.items.length ? <span className="muted small">{t('tasks.assigneeEmpty')}</span> : null}
    {list.data && list.data.totalPages > 1 ? <Pagination page={page} totalPages={list.data.totalPages} total={list.data.total} onChange={setPage} /> : null}
  </div>;
}
