import { useEditorState } from '../state/editor';
/** Project list, create/edit form, archive and the guarded permanent removal. */
import { useState } from 'react';
import type { Actor, Project, ProjectScheduleState, ProjectSummary, Reference } from '@eh/contracts';
import { PROJECT_SCHEDULE_STATES } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { ErrorBox, EmptyState, Menu, Pagination, Section } from '../components/ui';
import { ConfirmDialog, SelectInput, TextInput, useIdempotencyKey, useSave, type SaveStateValue } from '../components/forms';
import { SaveState } from '../components/ui';
import { ScheduleBadge } from '../components/project-schedule';
import { ProjectTable, type ProjectRowView, type ProjectSort } from '../components/project-table';
import { navigate } from '../App';
import { useRouteMemoryState } from '../state/navigation';
import { useBusinessDate } from '../state/business-date';
import { useDivisionScope } from '../state/division';
import { useDivisionTransition } from '../state/scope';
import { capabilitiesOf, canEditRecord, hasWritableDestination } from '../state/capabilities';
import { DebouncedSearchInput } from '../components/search-input';
import { NoMatches, QueryState, RefreshWarning } from '../components/query-state';

type ProjectRow = ProjectSummary & { _revision: number };
type Page = {
  items: ProjectRow[];
  total: number;
  groupTotals?: { responsibilityId: string | null; total: number }[];
  page: number;
  pageSize: number;
  totalPages: number;
};
type References = {
  responsibilities: Reference[];
  members: {
    memberId: string;
    name: string;
    active: boolean;
    workDivisionIds?: string[];
    divisionNames?: string[];
  }[];
};

/** The status filter is the derived schedule state, resolved on the server before paging. */
const SCHEDULE_STATES: ProjectScheduleState[] = [...PROJECT_SCHEDULE_STATES];
const PRIORITIES: Project['priority'][] = ['Low', 'Medium', 'High', 'Critical'];

export function ProjectsScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const [responsibilityId, setResponsibilityId] = useRouteMemoryState('projects:responsibility', '');
  const [unassigned, setUnassigned] = useRouteMemoryState('projects:unassigned', false);
  const [schedule, setStatus] = useRouteMemoryState('projects:schedule', '');
  const [query, setQuery] = useRouteMemoryState('projects:query', '');
  const [page, setPage] = useRouteMemoryState('projects:page', 1);
  const [sort, setSort] = useRouteMemoryState<ProjectSort>('projects:sort', 'deadline');
  const [direction, setDirection] = useRouteMemoryState<'asc' | 'desc'>('projects:direction', 'asc');
  const [collapsedGroups, setCollapsedGroups] = useRouteMemoryState<Set<string>>('projects:collapsed-groups', () => new Set());
  const [editing, setEditing, loadEditor, editorError, editorLoading] = useEditorState<{ mode: 'create' } | { mode: 'edit'; project: Project } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ProjectRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ summary: ProjectRow; confirmation: string; blockers: string[] } | null>(null);

  const references = useQuery<References>(keys.references, () => api.get<References>('/api/manager/references'));
  // The shell's division switch narrows every division-sensitive screen. It is a display filter
  // that is sent with the request; the server re-narrows it against the resolved scope.
  const { selected: selectedDivision } = useDivisionScope();
  // The derived status depends on today, so the cache identity carries the Tokyo business date.
  const today = useBusinessDate();
  const listKey = `${keys.projects}${queryString({ responsibilityId, unassigned, schedule, query, sort, direction, page, divisionId: selectedDivision ?? undefined })}:${today}`;
  const list = useQuery<Page>(listKey, () =>
    api.get<Page>(`/api/manager/projects${queryString({ responsibilityId, unassigned, schedule, query, sort, direction, page, pageSize: 25, divisionId: selectedDivision ?? undefined })}`)
  );
  // A different division starts the list again at page 1 and drops the responsibility selection,
  // whose compatibility with the new scope is not known here. The sort order is presentation state
  // and survives, and so does the search text. A superseded response cannot repaint because the
  // cache key carries the selection.
  useDivisionTransition(() => {
    setPage(1);
    setResponsibilityId('');
    setUnassigned(false);
  });
  const canManage = capabilitiesOf(actor).canEdit;
  const capabilities = capabilitiesOf(actor);
  const divisionScope = useDivisionScope();
  // A new project needs a destination the manager may actually write in; a role alone is not one.
  const canCreate = canManage && hasWritableDestination(divisionScope);
  const setSortOrder = (next: ProjectSort): void => {
    setDirection(next === sort ? (direction === 'asc' ? 'desc' : 'asc') : 'asc');
    setSort(next);
    setPage(1);
  };
  const toggleGroup = (group: string): void =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  async function openEditor(summary: ProjectRow): Promise<void> {
    await loadEditor(async () => {
      const detail = await api.get<{ record: Project }>(`/api/manager/projects/${summary.projectId}`);
      return { mode: 'edit', project: detail.record };
    });
  }

  async function startDelete(summary: ProjectRow): Promise<void> {
    const preflight = await api.get<{
      deletable: boolean;
      blockers: { code: string; detail: string }[];
      confirmationText: string;
    }>(`/api/manager/deletion/preflight${queryString({ entityType: 'PROJECTS', entityId: summary.projectId })}`);
    setDeleteTarget({
      summary,
      confirmation: preflight.confirmationText,
      blockers: preflight.blockers.map((blocker) => `${blocker.code}: ${blocker.detail}`)
    });
  }

  // The shared table renders the identity, schedule and counts; only the action cell is a
  // manager concern, so a role without a management capability renders no action column at all.
  // Within a mixed or all-division list the actions are resolved per record: a project the caller
  // may only read carries the read-only explanation instead of a disabled-looking editor.
  const toRow = (project: ProjectRow): ProjectRowView => ({
    projectId: project.projectId,
    projectName: project.projectName,
    responsibilityId: project.responsibilityId,
    responsibilityName: project.responsibilityName,
    schedule: project.schedule,
    priority: project.priority,
    committedDeadline: project.committedDeadline,
    progressPercent: project.progressPercent,
    openWork: project.openWork,
    overdueWork: project.overdueWork,
    nextAction: project.nextAction,
    actions: canEditRecord(capabilities, project) ? (
      <div className="actions">
        <button type="button" className="link-button" onClick={() => void openEditor(project)}>
          {t('action.edit')}
        </button>
        <Menu label={t('action.more')} className="row-menu">
          {(close) => <>
            <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); setArchiveTarget(project); }}>
              {t('projects.archive')}
            </button>
            {capabilities.canDelete ? (
              <button type="button" role="menuitem" className="menu-item danger" onClick={() => { close(); void startDelete(project); }}>
                {t('projects.delete')}
              </button>
            ) : null}
          </>}
        </Menu>
      </div>
    ) : (
      <span className="read-only-record" title={t('capability.readOnlyRecordHelp')}>
        {t('capability.readOnlyRecord')}
      </span>
    )
  });

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.projects')}</h2>
        {canCreate ? (
          <button type="button" className="button" onClick={() => setEditing({ mode: 'create' })}>
            {t('projects.new')}
          </button>
        ) : canManage ? (
          <p className="muted small">{t('capability.noWritableDestination')}</p>
        ) : null}
      </div>

      <div className="compact-toolbar">
        <label className="field">
          <span className="field-label">{t('filter.responsibility')}</span>
          <SelectInput
            value={unassigned ? '__unassigned__' : responsibilityId}
            onChange={(value) => {
              setUnassigned(value === '__unassigned__');
              setResponsibilityId(value === '__unassigned__' ? '' : value);
              setPage(1);
            }}
            allowEmpty={t('filter.all')}
            options={[
              ...(references.data?.responsibilities ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
              { value: '__unassigned__', label: t('overview.unassigned') }
            ]}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('column.status')}</span>
          <SelectInput
            value={schedule}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            allowEmpty={t('filter.all')}
            options={SCHEDULE_STATES.map((value) => ({ value, label: t(`project.schedule.${value}`) }))}
          />
        </label>
        <DebouncedSearchInput
          className="grow"
          value={query}
          label={t('filter.searchProjects')}
          onApplied={(applied) => {
            setQuery(applied);
            setPage(1);
          }}
        />
      </div>

      {editorLoading && <p role="status">{t('state.loading')}</p>}
      <ErrorBox error={editorError} />
      <RefreshWarning error={list.error} onRetry={() => list.refresh()} />

      <QueryState query={list}>
        {(data) =>
          data.items.length === 0 ? (
            query || responsibilityId || unassigned || schedule ? (
              <NoMatches
                onClear={() => {
                  setQuery('');
                  setResponsibilityId('');
                  setUnassigned(false);
                  setStatus('');
                  setPage(1);
                }}
              />
            ) : (
              <EmptyState />
            )
          ) : (
            <ProjectTable
              items={data.items.map(toRow)}
              groupTotals={data.groupTotals}
              grouped={!responsibilityId && !unassigned}
              sort={sort}
              direction={direction}
              onSort={setSortOrder}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              showActions
            />
          )
        }
      </QueryState>

      {list.data ? (
        <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onChange={setPage} />
      ) : null}

      {editing ? (
        <ProjectForm
          mode={editing.mode}
          project={editing.mode === 'edit' ? editing.project : undefined}
          references={references.data}
          onClose={() => setEditing(null)}
          onSaved={(project) => {
            setEditing(null);
            queryCache.invalidate([keys.projects, keys.overview, keys.status, keys.bootstrap, keys.timeline]);
            if (editing.mode === 'create') navigate(`project/${project.projectId}`);
          }}
        />
      ) : null}

      {archiveTarget ? (
        <ConfirmDialog
          title={t('confirm.archiveTitle')}
          message={`${archiveTarget.projectName} / ${archiveTarget.projectId}`}
          onCancel={() => setArchiveTarget(null)}
          onConfirm={async () => {
            await api.post(`/api/manager/projects/${archiveTarget.projectId}/archive`, {
              revision: archiveTarget._revision,
              confirmed: true
            });
            setArchiveTarget(null);
            queryCache.invalidate([keys.projects, keys.overview, keys.status, keys.timeline]);
          }}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={t('confirm.deleteTitle')}
          destructive
          confirmText={deleteTarget.confirmation}
          reasonRequired
          message={
            deleteTarget.blockers.length ? (
              <div className="banner danger">
                <strong>{t('confirm.blocked')}</strong>
                <ul>
                  {deleteTarget.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>{deleteTarget.summary.projectName}</p>
            )
          }
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async ({ confirmation, reason }) => {
            await api.del(`/api/manager/projects/${deleteTarget.summary.projectId}`, {
              revision: deleteTarget.summary._revision,
              confirmed: true,
              reason,
              confirmation
            });
            setDeleteTarget(null);
            queryCache.invalidate([keys.projects, keys.overview, keys.status, keys.bootstrap, keys.timeline]);
          }}
        />
      ) : null}
    </div>
  );
}

export function ProjectForm({
  mode,
  project,
  references,
  onClose,
  onSaved
}: {
  mode: 'create' | 'edit';
  project?: Project;
  references?: References;
  onClose: () => void;
  onSaved: (project: Project) => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const save = useSave();
  const idempotencyKey = useIdempotencyKey();
  // A creation needs one concrete writable division; the aggregate "all readable" scope is not a
  // creation destination. An existing project's division is not editable here - a transfer is a
  // separate, guarded ADMIN operation.
  const divisionScope = useDivisionScope();
  const writableDivisions = divisionScope.writable;
  // The shell selection is a *read* scope: it becomes the default only when it is also a division
  // this account may create in, so a read-only filter can never turn into a writable default.
  const shellDivision =
    divisionScope.selected && writableDivisions.some((entry) => entry.divisionId === divisionScope.selected)
      ? divisionScope.selected
      : '';
  const [divisionId, setDivisionId] = useState(
    project?.divisionId ?? (writableDivisions.length === 1 ? writableDivisions[0]!.divisionId : shellDivision)
  );
  const [form, setForm] = useState({
    projectName: project?.projectName ?? '',
    description: project?.description ?? '',
    category: project?.category ?? '',
    responsibilityId: project?.responsibilityId ?? '',
    projectOwnerId: project?.projectOwnerId ?? '',
    priority: project?.priority ?? 'Medium',
    committedDeadline: project?.committedDeadline ?? '',
    forecastEnd: project?.forecastEnd ?? '',
    plannedStart: project?.plannedStart ?? '',
    nextAction: project?.nextAction ?? '',
    notificationEnabled: project?.notificationEnabled ?? true,
    // A new V2 project is INTERNAL by default; the selector still allows an explicit RESTRICTED.
    dashboardVisibility: project?.dashboardVisibility ?? 'INTERNAL',
    dashboardSummary: project?.dashboardSummary ?? ''
  });
  const [acknowledge, setAcknowledge] = useState(false);
  const [confirmDeadline, setConfirmDeadline] = useState(mode === 'create');
  const [planWarnings, setPlanWarnings] = useState<string[]>([]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  // Options follow the selected division: a responsibility of another division and a person
  // without a WORK membership there cannot be chosen. An existing owner or responsibility is
  // preserved and shown so an unrelated edit never silently drops a relationship.
  const divisionResponsibilities = (references?.responsibilities ?? []).filter(
    (entry) =>
      !divisionId ||
      entry.divisionId === divisionId ||
      entry.divisionId === null ||
      entry.divisionId === undefined ||
      entry.id === form.responsibilityId
  );
  const divisionMembers = (references?.members ?? []).filter(
    (entry) =>
      !divisionId ||
      (entry.workDivisionIds ?? []).includes(divisionId) ||
      entry.memberId === form.projectOwnerId
  );

  const changeDivision = (next: string): void => {
    setDivisionId(next);
    const responsibility = (references?.responsibilities ?? []).find(
      (entry) => entry.id === form.responsibilityId
    );
    if (responsibility?.divisionId && responsibility.divisionId !== next) set('responsibilityId', '');
    const owner = (references?.members ?? []).find((entry) => entry.memberId === form.projectOwnerId);
    if (owner && next && !(owner.workDivisionIds ?? []).includes(next)) set('projectOwnerId', '');
  };

  async function checkPlan(): Promise<void> {
    if (!form.committedDeadline) {
      setPlanWarnings([]);
      return;
    }
    const preview = await api.get<{ warnings: { code: string; message: string }[] }>(
      `/api/manager/plan/preview${queryString({ deadline: form.committedDeadline })}`
    );
    setPlanWarnings(preview.warnings.map((warning) => `${warning.code}: ${warning.message}`));
  }

  return (
    <div className="modal-screen" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <header className="modal-header">
          <h2>{mode === 'create' ? t('projects.new') : t('projects.edit')}</h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t('action.cancel')}
          </button>
        </header>
        <div className="modal-body stack">
          <label className="field">
            <span className="field-label">{t('projects.name')}</span>
            <TextInput value={form.projectName} onChange={(value) => set('projectName', value)} required />
          </label>
          <label className="field">
            <span className="field-label">{t('projects.description')}</span>
            <textarea
              value={form.description}
              onChange={(event) => set('description', event.target.value)}
              rows={4}
              maxLength={5000}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('division.label')}</span>
            {mode === 'create' ? (
              <>
                <SelectInput
                  value={divisionId}
                  onChange={changeDivision}
                  allowEmpty={t('division.selectPlaceholder')}
                  options={writableDivisions.map((entry) => ({ value: entry.divisionId, label: entry.name }))}
                />
                <span className="field-hint">{t('projectForm.divisionHint')}</span>
              </>
            ) : (
              <p className="field-readonly">
                {divisionScope.readable.find((entry) => entry.divisionId === project?.divisionId)?.name ??
                  project?.divisionId ??
                  t('common.unset')}
              </p>
            )}
          </label>
          <label className="field">
            <span className="field-label">{t('projects.responsibility')}</span>
            <SelectInput
              value={form.responsibilityId}
              onChange={(value) => set('responsibilityId', value)}
              allowEmpty={t('common.unset')}
              options={divisionResponsibilities.map((entry) => ({ value: entry.id, label: entry.name }))}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('projects.owner')}</span>
            <SelectInput
              value={form.projectOwnerId}
              onChange={(value) => set('projectOwnerId', value)}
              allowEmpty={t('common.unset')}
              options={divisionMembers.map((entry) => ({ value: entry.memberId, label: entry.name }))}
            />
            <span className="field-hint">{t('projectForm.ownerHint')}</span>
          </label>
          <div className="field-row">
            <div className="field">
              <span className="field-label">{t('project.schedule.title')}</span>
              {project ? <ScheduleBadge schedule={project.schedule} showDetail /> : null}
              <span className="field-hint">{t('project.schedule.derivedHint')}</span>
            </div>
            <label className="field">
              <span className="field-label">{t('projects.priority')}</span>
              <SelectInput
                value={form.priority}
                onChange={(value) => set('priority', value as Project['priority'])}
                options={PRIORITIES.map((value) => ({ value, label: label('priority', value) }))}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('schedule.start')}</span>
              <TextInput type="date" value={form.plannedStart} onChange={(value) => set('plannedStart', value)} />
            </label>
            <label className="field">
              <span className="field-label">{t('schedule.finish')}</span>
              <TextInput type="date" value={form.committedDeadline} onChange={(value) => set('committedDeadline', value)} />
            </label>
          </div>
          <p className="muted small">{t('schedule.explanation')}</p>
          {mode === 'edit' && form.forecastEnd && !form.committedDeadline ? (
            <div className="banner info">
              <span>{t('schedule.forecastHistory')}: {form.forecastEnd}</span>
              <button type="button" className="link-button" onClick={() => {
                set('committedDeadline', form.forecastEnd);
                setConfirmDeadline(true);
              }}>
                {t('schedule.adoptForecast')}
              </button>
            </div>
          ) : null}
          <details className="advanced-actions">
            <summary>{t('form.optionalSection')}</summary>
            <label className="field">
              <span className="field-label">{t('schedule.forecastHistory')}</span>
              <TextInput type="date" value={form.forecastEnd} onChange={(value) => set('forecastEnd', value)} />
            </label>
          </details>
          <button type="button" className="link-button" onClick={() => void checkPlan()}>
            {t('plan.check')}
          </button>
          {planWarnings.length ? (
            <div className="banner warning">
              <ul>
                {planWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <label className="checkbox">
                <input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />
                {t('tasks.ackNonWorking')}
              </label>
            </div>
          ) : null}
          <label className="field">
            <span className="field-label">{t('projects.nextAction')}</span>
            <TextInput value={form.nextAction} onChange={(value) => set('nextAction', value)} />
          </label>
          <label className="field">
            <span className="field-label">{t('projects.visibility')}</span>
            <SelectInput
              value={form.dashboardVisibility}
              onChange={(value) => set('dashboardVisibility', value as Project['dashboardVisibility'])}
              options={[
                { value: 'INTERNAL', label: t('projects.visibility.internal') },
                { value: 'RESTRICTED', label: t('projects.visibility.restricted') }
              ]}
            />
            <span className="field-hint">{t('projects.visibilityHint')}</span>
            <span className="field-hint">{t('projects.visibilityScopeHint')}</span>
          </label>
          <label className="field">
            <span className="field-label">{t('projects.summary')}</span>
            <textarea value={form.dashboardSummary} onChange={(event) => set('dashboardSummary', event.target.value)} rows={2} />
          </label>
          {mode === 'edit' ? (
            <label className="checkbox">
              <input type="checkbox" checked={confirmDeadline} onChange={(event) => setConfirmDeadline(event.target.checked)} />
              {t('tasks.deadlineConfirmed')}
            </label>
          ) : null}
          <SaveState state={save.state as SaveStateValue} />
          <ErrorBox error={save.error} />
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {t('action.cancel')}
            </button>
            <button
              type="button"
              className="button"
              disabled={save.state === 'saving' || (mode === 'create' && (!divisionId || !form.projectName.trim() || !form.responsibilityId))}
              onClick={() =>
                void save.run(
                  async () => {
                    if (mode === 'create') {
                      const result = await api.post<{ project: Project }>('/api/manager/projects', {
                        idempotencyKey,
                        projectName: form.projectName,
                        description: form.description || undefined,
                        category: form.category || undefined,
                        divisionId,
                        responsibilityId: form.responsibilityId,
                        projectOwnerId: form.projectOwnerId || undefined,
                        priority: form.priority,
                        plannedStart: form.plannedStart || undefined,
                        forecastEnd: form.forecastEnd || undefined,
                        committedDeadline: form.committedDeadline || undefined,
                        originalDeadline: form.committedDeadline || undefined,
                        nextAction: form.nextAction || undefined,
                        notificationEnabled: form.notificationEnabled,
                        dashboardVisibility: form.dashboardVisibility,
                        dashboardSummary: form.dashboardSummary || undefined
                      });
                      return result.project;
                    }
                    if (!project) throw new Error('missing project');
                    const result = await api.patch<{ project: Project }>(`/api/manager/projects/${project.projectId}`, {
                      revision: project.revision,
                      projectName: form.projectName,
                      description: form.description,
                      category: form.category,
                      responsibilityId: form.responsibilityId || null,
                      projectOwnerId: form.projectOwnerId || null,
                      priority: form.priority,
                      plannedStart: form.plannedStart || null,
                      forecastEnd: form.forecastEnd || null,
                      committedDeadline: form.committedDeadline || null,
                      nextAction: form.nextAction,
                      notificationEnabled: form.notificationEnabled,
                      dashboardVisibility: form.dashboardVisibility,
                      dashboardSummary: form.dashboardSummary,
                      confirmDeadlineChange: confirmDeadline,
                      acknowledgeNonWorking: acknowledge
                    });
                    return result.project;
                  },
                  { onSuccess: (saved) => onSaved(saved) }
                )
              }
            >
              {mode === 'create' ? t('action.create') : t('action.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Section };
