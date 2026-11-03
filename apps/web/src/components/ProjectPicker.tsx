/** Server-paged project selection; selected identity survives a search or page change. */
import { useEffect, useState } from 'react';
import { api, queryString } from '../api/client';
import { useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { ErrorBox, Pagination } from './ui';
type Option = { projectId: string; projectName: string };
type Page = { items: Option[]; total: number; totalPages: number };
/**
 * `scope` selects the role-appropriate endpoint.
 *
 * A manager keeps `/api/manager/projects`. A MEMBER or VIEWER must never call a manager route, so
 * the read-only screens use `/api/work/projects`, which returns only the projects the documented
 * visibility policy allows the reader to see.
 */
export function ProjectPicker({ value, onChange, disabled = false, scope = 'manager' }: { value: string; onChange: (id: string) => void; disabled?: boolean; scope?: 'manager' | 'read' }): JSX.Element {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 200); return () => clearTimeout(timer); }, [search]);
  const params = queryString({ query, page, pageSize: 25 });
  const base = scope === 'read' ? '/api/work/projects' : '/api/manager/projects';
  const list = useQuery<Page>(`${scope}/projects/picker${params}`, () => api.get<Page>(base + params), { enabled: !disabled });
  const selected = useQuery<{ record: Option }>(`${scope}/project/${value}`, () => api.get<{ record: Option }>(base + '/' + value), { enabled: !!value });
  const options = list.data?.items ?? [];
  return <div className="project-picker stack">
    {!disabled && <input aria-label={t('picker.search')} placeholder={t('picker.search')} value={search} onChange={e => setSearch(e.target.value)} />}
    <select aria-label={t('nav.projects')} disabled={disabled} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{t('common.unset')}</option>
      {value && !options.some(p => p.projectId === value) && <option value={value}>{selected.data?.record.projectName ?? value}</option>}
      {options.map(p => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}
    </select>
    <ErrorBox error={list.error || selected.error} onRetry={() => { list.refresh(); if (value) selected.refresh(); }} />
    {!disabled && list.data && list.data.totalPages > 1 && <Pagination page={page} totalPages={list.data.totalPages} total={list.data.total} onChange={setPage} />}
  </div>;
}
