/**
 * Unmapped-work division mapping (ADMIN).
 *
 * The panel only reads until the administrator types the exact confirmation phrase: it shows the
 * counts, one bounded page of records, the proposal each rule produced, the evidence and the
 * blockers. The apply action sends the reviewed record IDs, target IDs and revisions the screen
 * displayed, so the server can refuse a stale review.
 */
import { useMemo, useState } from 'react';
import type { MappingApplyResult, MappingRecord, UnmappedMappingView } from '@eh/contracts';
import { ApiFailure, api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Pagination, Section, SaveState } from './ui';
import { SelectInput, TextInput, createIdempotencyKey, useSave } from './forms';

function stateTone(state: MappingRecord['state']): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (state === 'SUGGESTED') return 'ok';
  if (state === 'AMBIGUOUS') return 'warn';
  if (state === 'CONFLICT') return 'danger';
  return 'neutral';
}

function recordKey(record: MappingRecord): string {
  return `${record.entityType}:${record.entityId}`;
}

export function DivisionMappingPanel(): JSX.Element {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [entityType, setEntityType] = useState<'ALL' | 'RESPONSIBILITY' | 'PROJECT'>('ALL');
  const [explicitDivisionId, setExplicitDivisionId] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [phrase, setPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [applied, setApplied] = useState<MappingApplyResult | null>(null);
  const save = useSave();

  const query = {
    page,
    pageSize: 10,
    includeArchived,
    entityType,
    ...(explicitDivisionId ? { divisionId: explicitDivisionId } : {})
  } as const;
  const key = `${keys.divisions}/unmapped${JSON.stringify(query)}`;
  const view = useQuery<UnmappedMappingView>(key, () =>
    api.post<UnmappedMappingView>('/api/admin/divisions/mapping/preview', query)
  );

  const items = view.data?.items ?? [];
  // A reviewed selection is kept with the record it was made for: the batch is the intersection of
  // the page and the selection, and the confirmation phrase names the current batch size, so a
  // refresh can never apply a target the administrator did not re-read.

  const batch = useMemo(
    () =>
      items
        .filter((record) => selected[recordKey(record)])
        .map((record) => ({
          entityType: record.entityType,
          entityId: record.entityId,
          divisionId: selected[recordKey(record)] as string,
          revision: revisions[recordKey(record)] ?? record.revision
        })),
    [items, selected, revisions]
  );
  const expectedPhrase = `MAP ${batch.length} RECORD${batch.length === 1 ? '' : 'S'}`;
  const overLimit = view.data ? batch.length > view.data.batchLimit : false;
  const canApply =
    batch.length > 0 &&
    !overLimit &&
    phrase.trim() === expectedPhrase &&
    save.state !== 'saving' &&
    view.data?.backup.verified === true;

  const toggle = (record: MappingRecord): void => {
    const key = recordKey(record);
    setSelected((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = record.proposedDivisionId ?? '';
      return next;
    });
    setRevisions((current) => ({ ...current, [key]: record.revision }));
    setApplied(null);
  };

  const setTarget = (record: MappingRecord, divisionId: string): void => {
    setSelected((current) => ({ ...current, [recordKey(record)]: divisionId }));
    setRevisions((current) => ({ ...current, [recordKey(record)]: record.revision }));
    setApplied(null);
  };

  const apply = async (): Promise<void> => {
    if (!canApply) return;
    await save.run(
      () =>
        api.post<MappingApplyResult>('/api/admin/divisions/mapping/apply', {
          idempotencyKey,
          batch,
          confirmed: true,
          confirmation: phrase.trim(),
          reason: reason.trim() || undefined
        }),
      {
        onSuccess: (result) => {
          setApplied(result);
          setSelected({});
          setRevisions({});
          setPhrase('');
          setReason('');
          setIdempotencyKey(createIdempotencyKey());
          // The mapped records leave the unmapped list and the shell switch may now offer a
          // division that previously had no work; invalidate rather than guess.
          queryCache.invalidate([keys.divisions, keys.projects, keys.tasks, keys.taskIndex, keys.overview, keys.workload]);
        }
      }
    );
  };

  const stalePreview = save.error instanceof ApiFailure && save.error.isConflict;

  return (
    <Section title={t('mapping.title')}>
      <p className="muted small">{t('mapping.hint')}</p>
      {view.data ? (
        <>
          <p className="muted small">
            {t('mapping.counts', {
              responsibilities: view.data.counts.responsibilities,
              projects: view.data.counts.projects,
              archivedResponsibilities: view.data.counts.archivedResponsibilities,
              archivedProjects: view.data.counts.archivedProjects,
              tasks: view.data.counts.tasks
            })}
          </p>
          <p className={view.data.backup.verified ? 'muted small' : 'banner warning'}>
            {view.data.backup.verified
              ? t('mapping.backup.ok', { id: view.data.backup.backupId ?? '' })
              : t('mapping.backup.required')}
          </p>
        </>
      ) : null}

      <div className="filters">
        <label className="inline-field">
          <span>{t('mapping.column.record')}</span>
          <SelectInput
            value={entityType}
            onChange={(value) => setEntityType(value as typeof entityType)}
            options={[
              { value: 'ALL', label: t('mapping.entity.all') },
              { value: 'RESPONSIBILITY', label: t('mapping.entity.responsibility') },
              { value: 'PROJECT', label: t('mapping.entity.project') }
            ]}
          />
        </label>
        <label className="inline-field">
          <span>{t('mapping.column.division')}</span>
          <SelectInput
            value={explicitDivisionId}
            onChange={setExplicitDivisionId}
            allowEmpty={t('common.all')}
            options={(view.data?.divisions ?? []).map((division) => ({
              value: division.divisionId,
              label: division.name
            }))}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          {t('mapping.includeArchived')}
        </label>
      </div>

      <ErrorBox error={view.error} onRetry={() => view.refresh()} />

      {!view.data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : items.length === 0 ? (
        <EmptyState text={t('mapping.none')} />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('mapping.column.select')}</th>
              <th>{t('mapping.column.record')}</th>
              <th>{t('mapping.column.state')}</th>
              <th>{t('mapping.column.division')}</th>
              <th>{t('mapping.column.evidence')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((record) => {
              const key = recordKey(record);
              const isSelected = !!selected[key];
              const historical = record.assignments.filter((entry) => entry.historical);
              return (
                <tr key={key}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${t('mapping.column.select')}: ${record.name}`}
                      checked={isSelected}
                      onChange={() => toggle(record)}
                    />
                  </td>
                  <td>
                    <strong>{record.name}</strong>
                    <div className="muted small">
                      {record.entityType === 'RESPONSIBILITY'
                        ? t('mapping.entity.responsibility')
                        : t('mapping.entity.project')}{' '}
                      · {record.taskCount} / {record.subprojectCount}
                      {record.archived ? ` · ${t('mapping.archivedTag')}` : ''}
                    </div>
                    {record.linkedProjects.length ? (
                      <div className="muted small">
                        {t('mapping.linkedProjects', {
                          names: record.linkedProjects.map((project) => project.projectName).join(', ')
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={stateTone(record.state)}>{t(`mapping.state.${record.state}`)}</Badge>
                    <div className="muted small">{t(`mapping.rule.${record.rule}`)}</div>
                    {record.blockers.length ? (
                      <div className="muted small">
                        {record.blockers
                          .map((blocker) => {
                            const [kind, ids] = blocker.split(':');
                            if (kind === 'INELIGIBLE_ACTIVE_ASSIGNEE') {
                              return t('mapping.blocker.ineligible', {
                                members:
                                  record.assignments.find((entry) => entry.memberId === ids)?.name ?? ids ?? ''
                              });
                            }
                            if (kind === 'LINKED_PROJECT_ALREADY_MAPPED') {
                              const project = record.linkedProjects.find((entry) => entry.projectId === ids);
                              return t('mapping.blocker.mappedProject', { projects: project?.projectName ?? ids ?? '' });
                            }
                            if (kind === 'NO_COMMON_DIVISION' || kind === 'RESPONSIBILITY_DIVISION_CONFLICT') {
                              return t('mapping.blocker.conflict');
                            }
                            return blocker;
                          })
                          .join(' / ')}
                      </div>
                    ) : null}
                    {record.unresolved.includes('MULTIPLE_COMMON_DIVISIONS') ? (
                      <div className="muted small">{t('mapping.blocker.ambiguous')}</div>
                    ) : null}
                    {record.unresolved.includes('NO_ACTIVE_ASSIGNMENT_EVIDENCE') ? (
                      <div className="muted small">{t('mapping.blocker.noEvidence')}</div>
                    ) : null}
                  </td>
                  <td>
                    <SelectInput
                      value={selected[key] ?? record.proposedDivisionId ?? ''}
                      onChange={(value) => setTarget(record, value)}
                      allowEmpty={t('mapping.selectPlaceholder')}
                      options={(view.data?.divisions ?? []).map((division) => ({
                        value: division.divisionId,
                        label: division.name
                      }))}
                    />
                    {!isSelected ? <div className="muted small">{t('mapping.noTarget')}</div> : null}
                  </td>
                  <td>
                    <ul className="list small">
                      {record.assignments.map((assignment) => (
                        <li key={assignment.memberId}>
                          <span>{assignment.name}</span>{' '}
                          <Badge tone={assignment.historical ? 'neutral' : assignment.eligible ? 'ok' : 'danger'}>
                            {assignment.historical
                              ? t('mapping.assignment.historical')
                              : t('mapping.assignment.active')}
                          </Badge>
                        </li>
                      ))}
                      {historical.length === 0 && record.assignments.length === 0 ? (
                        <li className="muted">{t('mapping.blocker.noEvidence')}</li>
                      ) : null}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {view.data ? (
        <Pagination
          page={view.data.page}
          totalPages={view.data.totalPages}
          total={view.data.total}
          onChange={setPage}
        />
      ) : null}

      <div className="stack">
        <p className="muted small">
          {t('mapping.selected', { n: batch.length })}{' '}
          {view.data ? t('mapping.batchLimit', { n: view.data.batchLimit }) : ''}
        </p>
        {batch.length === 0 ? <p className="muted small">{t('mapping.batchEmpty')}</p> : null}
        {overLimit ? <div className="banner warning">{t('mapping.batchLimit', { n: view.data?.batchLimit ?? 0 })}</div> : null}
        <label className="field">
          <span className="field-label">{t('mapping.confirmHint', { phrase: expectedPhrase })}</span>
          <TextInput
            value={phrase}
            onChange={setPhrase}
            ariaLabel={t('mapping.confirmHint', { phrase: expectedPhrase })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('mapping.reason')}</span>
          <TextInput value={reason} onChange={setReason} ariaLabel={t('mapping.reason')} />
        </label>
        <SaveState state={save.state} />
        {save.error ? (
          <div className="banner danger" role="alert">
            {stalePreview
              ? t('mapping.previewStale')
              : save.error instanceof Error
                ? save.error.message
                : t('common.error')}
          </div>
        ) : null}
        {applied ? (
          <div className="banner info" role="status">
            {t('mapping.applied', { responsibilities: applied.responsibilities, projects: applied.projects })}
          </div>
        ) : null}
        <div className="inline-actions">
          <button type="button" className="button secondary" onClick={() => view.refresh()}>
            {t('mapping.review')}
          </button>
          <button type="button" className="button" disabled={!canApply} onClick={() => void apply()}>
            {save.state === 'saving' ? t('state.saving') : t('mapping.apply')}
          </button>
        </div>
      </div>
    </Section>
  );
}
