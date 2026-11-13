/**
 * Deleted Items (ADMIN): recoverably removed tasks and subprojects.
 *
 * Only the recoverable removal appears here; a permanently erased record has no row left and is
 * never offered as a restore candidate. The list is one bounded, searchable page: the server pages
 * before anything is cut, so this screen never loads the whole table and never filters an already
 * paged answer.
 *
 * Restoring an entry re-reads its preflight, so the revision the command echoes is the
 * authoritative one and a stale confirmation is refused instead of overwriting a newer change.
 */
import { useState } from 'react';
import type { Actor, DeletedRecord, DeletedRecordPage, RestorePreflight } from '@eh/contracts';
import { api } from '../api/client';
import { keys, useQuery } from '../state/cache';
import { commitMutation } from '../state/mutation';
import { useI18n } from '../i18n';
import { useRouteMemoryState } from '../state/navigation';
import { EmptyState, ErrorBox, Pagination } from '../components/ui';
import { DebouncedSearchInput } from '../components/search-input';
import { ActionConfirmDialog } from '../components/ActionConfirmDialog';
import type { ReloadOutcome } from '../components/forms';
import { formatTokyoTimestamp } from '../state/format';

type DeletedType = 'ALL' | 'TASKS' | 'SUBPROJECTS';

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const BLOCKER_LABELS: Record<string, string> = {
  PROJECT_DELETED: 'deleted.blocker.PROJECT_DELETED',
  PROJECT_INACTIVE: 'deleted.blocker.PROJECT_INACTIVE',
  PARENT_DELETED: 'deleted.blocker.PARENT_DELETED',
  HIERARCHY_DEPTH: 'deleted.blocker.HIERARCHY_DEPTH',
  NOT_DELETED: 'deleted.blocker.NOT_DELETED',
  NOT_FOUND_OR_DELETED: 'deleted.blocker.NOT_DELETED'
};

export function DeletedItemsScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const [type, setType] = useRouteMemoryState<DeletedType>('deleted:type', 'ALL');
  const [query, setQuery] = useRouteMemoryState('deleted:query', '');
  const [page, setPage] = useRouteMemoryState('deleted:page', 1);
  const [target, setTarget] = useState<{ record: DeletedRecord; preflight: RestorePreflight } | null>(null);
  const [notice, setNotice] = useState('');
  const [restoreError, setRestoreError] = useState<unknown>(null);

  const params = queryString({ entityType: type, query, page, pageSize: 20 });
  const listKey = `${keys.deletedRecords}${params}`;
  const list = useQuery<DeletedRecordPage>(listKey, () =>
    api.get<DeletedRecordPage>(`/api/admin/deleted-records${params}`)
  );

  if (actor.role !== 'ADMIN' && actor.role !== 'MANAGER') return <EmptyState />;

  const openRestore = async (record: DeletedRecord): Promise<void> => {
    setRestoreError(null);
    setNotice('');
    try {
      const preflight = await api.get<RestorePreflight>(
        `/api/admin/${record.entityType === 'TASKS' ? 'tasks' : 'subprojects'}/${encodeURIComponent(record.entityId)}/restore-preflight`
      );
      setTarget({ record, preflight });
    } catch (error) {
      setRestoreError(error);
    }
  };

  const refresh = async (): Promise<RestorePreflight> => {
    if (!target) throw new Error(t('error.title'));
    return api.get<RestorePreflight>(
      `/api/admin/${target.record.entityType === 'TASKS' ? 'tasks' : 'subprojects'}/${encodeURIComponent(target.record.entityId)}/restore-preflight`
    );
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2>{t('deleted.title')}</h2>
          <p className="muted small">{t('deleted.hint')}</p>
        </div>
      </div>
      <p className="muted small">{t('deleted.permanentHint')}</p>
      {notice ? (
        <div className="banner ok" role="status">
          {notice}
        </div>
      ) : null}

      <div className="compact-toolbar">
        <label className="field">
          <span className="field-label">{t('deleted.filterType')}</span>
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as DeletedType);
              setPage(1);
            }}
          >
            <option value="ALL">{t('deleted.type.ALL')}</option>
            <option value="TASKS">{t('deleted.type.TASKS')}</option>
            <option value="SUBPROJECTS">{t('deleted.type.SUBPROJECTS')}</option>
          </select>
        </label>
        <DebouncedSearchInput
          value={query}
          label={t('deleted.search')}
          onApplied={(next) => {
            setQuery(next);
            setPage(1);
          }}
        />
      </div>

      <ErrorBox error={list.error} onRetry={() => list.refresh()} />
      <ErrorBox error={restoreError} />
      {!list.data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : list.data.items.length === 0 ? (
        <p className="muted">{t('deleted.empty')}</p>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>{t('deleted.column.type')}</th>
                <th>{t('deleted.column.name')}</th>
                <th>{t('deleted.column.location')}</th>
                <th>{t('deleted.column.deletedAt')}</th>
                <th>{t('deleted.column.deletedBy')}</th>
                <th>{t('deleted.column.evidence')}</th>
                <th>{t('deleted.column.state')}</th>
                <th>{t('column.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((record) => (
                <tr key={`${record.entityType}:${record.entityId}`}>
                  <td>{t(record.entityType === 'TASKS' ? 'deleted.type.TASKS' : 'deleted.type.SUBPROJECTS')}</td>
                  <td>
                    <strong>{record.name}</strong>
                    <div className="muted small">{record.entityId}</div>
                  </td>
                  <td>
                    {record.projectName}
                    {record.location ? <div className="muted small">{record.location}</div> : null}
                  </td>
                  <td>{record.deletedAt ? formatTokyoTimestamp(record.deletedAt) : t('deleted.unavailable')}</td>
                  <td>{record.deletedByName ?? t('deleted.unavailable')}</td>
                  <td>
                    {record.reason ?? t('deleted.unavailable')}
                    {record.confirmationSource ? (
                      <div className="muted small">{t('deleted.confirmedWithButton')}</div>
                    ) : null}
                  </td>
                  <td>
                    {record.restorable ? (
                      <span>{t('deleted.restorable')}</span>
                    ) : (
                      <>
                        <strong>{t('deleted.blocked')}</strong>
                        <ul>
                          {record.blockers.map((blocker) => (
                            <li key={`${blocker.code}:${blocker.detail}`} className="muted small">
                              {t(BLOCKER_LABELS[blocker.code] ?? 'deleted.blocker.generic')}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!record.restorable}
                      onClick={() => void openRestore(record)}
                    >
                      {t('deleted.restore')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onChange={setPage} />
        </>
      )}

      {target ? (
        <ActionConfirmDialog
          title={t('deleted.restoreTitle')}
          recordName={target.preflight.name}
          context={`${target.record.projectName}${
            target.record.location ? ` · ${target.record.location}` : ''
          }`}
          warning={t('deleted.restoreWarning')}
          confirmLabel={t('deleted.restoreConfirm')}
          details={
            target.preflight.restorable ? null : (
              <div className="banner warning">
                <ul>
                  {target.preflight.blockers.map((blocker) => (
                    <li key={`${blocker.code}:${blocker.detail}`}>
                      {t(BLOCKER_LABELS[blocker.code] ?? 'deleted.blocker.generic')}
                      <span className="muted small"> — {blocker.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          }
          onCancel={() => setTarget(null)}
          onReload={async (): Promise<ReloadOutcome> => {
            try {
              const fresh = await refresh();
              setTarget({ record: target.record, preflight: fresh });
              return fresh.restorable
                ? { status: 'fresh' }
                : { status: 'ineligible', message: t('deleted.reloadIneligible') };
            } catch (error) {
              return { status: 'failed', message: error instanceof Error ? error.message : t('error.title') };
            }
          }}
          onConfirm={async () => {
            const path = target.record.entityType === 'TASKS' ? 'tasks' : 'subprojects';
            const record = target.record;
            const outcome = await commitMutation(
              () =>
                api.post(`/api/admin/${path}/${encodeURIComponent(record.entityId)}/restore`, {
                  revision: target.preflight.revision,
                  confirmed: true
                }),
              [
                keys.deletedRecords,
                keys.tasks,
                keys.task(record.entityId),
                keys.taskIndex,
                keys.overview,
                keys.project(record.projectId),
                keys.projects,
                keys.myWork,
                keys.timeline,
                keys.workload,
                keys.workProjects,
                keys.workOverview,
                keys.employee
              ]
            );
            // A session that ended while the write was in flight paints nothing here.
            if (outcome.status !== 'committed') return;
            setTarget(null);
            setNotice(t('deleted.restored', { name: record.name }));
          }}
        />
      ) : null}
    </div>
  );
}
