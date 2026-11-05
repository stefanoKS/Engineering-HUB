import { useEditorState } from '../state/editor';
/** Project list, create/edit form, archive and the guarded permanent removal. */
import { useState } from 'react';
import type { Actor, Project, ProjectScheduleState, ProjectSummary, Reference } from '@eh/contracts';
import { PROJECT_SCHEDULE_STATES } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { EmptyState, ErrorBox, Pagination, ProgressBar, Section } from '../components/ui';
import { ConfirmDialog, SelectInput, TextInput, useIdempotencyKey, useSave, type SaveStateValue } from '../components/forms';
import { SaveState } from '../components/ui';
import { DeadlineCell, deadlineStateOf } from '../components/deadline';
import { ScheduleBadge } from '../components/project-schedule';
import { navigate } from '../App';
import { projectColor } from '@eh/domain';
import { useRouteMemoryState } from '../state/navigation';
import { useBusinessDate } from '../state/business-date';

type ProjectRow = ProjectSummary & { _revision: number };
type Page = {
  items: ProjectRow[];
  total: number;
  groupTotals?: { responsibilityId: string | null; total: number }[];
  page: number;
  pageSize: number;
  totalPages: number;
};
type References = { responsibilities: Reference[]; members: { memberId: string; name: string; active: boolean }[] };

/** The status filter is the derived schedule state, resolved on the server before paging. */
const SCHEDULE_STATES: ProjectScheduleState[] = [...PROJECT_SCHEDULE_STATES];
const PRIORITIES: Project['priority'][] = ['Low', 'Medium', 'High', 'Critical'];
type ProjectSort = 'deadline' | 'name' | 'responsibility' | 'owner' | 'schedule' | 'priority' | 'updated';

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
  // The derived status depends on today, so the cache identity carries the Tokyo business date.
  const today = useBusinessDate();
  const listKey = `${keys.projects}${queryString({ responsibilityId, unassigned, schedule, query, sort, direction, page })}:${today}`;
  const list = useQuery<Page>(listKey, () =>
    api.get<Page>(`/api/manager/projects${queryString({ responsibilityId, unassigned, schedule, query, sort, direction, page, pageSize: 25 })}`)
  );
  const canManage = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  const grouped = !responsibilityId && !unassigned && list.data
    ? Array.from(list.data.items.reduce((groups, project) => {
        const key = project.responsibilityId ?? '__unassigned__';
        const existing = groups.get(key) ?? { name: project.responsibilityName || t('overview.unassigned'), items: [] as ProjectRow[] };
        existing.items.push(project);
        groups.set(key, existing);
        return groups;
      }, new Map<string, { name: string; items: ProjectRow[] }>()))
    : [];
  const groupTotal = (groupId: string, displayed: number): number =>
    list.data?.groupTotals?.find((total) => (total.responsibilityId ?? '__unassigned__') === groupId)?.total ?? displayed;
  const setSortOrder = (next: ProjectSort): void => {
    setDirection(next === sort ? (direction === 'asc' ? 'desc' : 'asc') : 'asc');
    setSort(next);
    setPage(1);
  };
  const toggleGroup = (group: string): void => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });
  const sortHeader = (key: ProjectSort, text: string): JSX.Element => (
    <button type="button" className="table-sort" onClick={() => setSortOrder(key)} aria-label={`${text}: ${t('workload.sort.toggle')}`}>
      {text} {sort === key ? <span aria-hidden="true">{direction === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  );

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

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.projects')}</h2>
        <div className="filters">
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
          <SelectInput
            value={schedule}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            allowEmpty={t('filter.all')}
            options={SCHEDULE_STATES.map((value) => ({ value, label: t(`project.schedule.${value}`) }))}
          />
          <input
            placeholder={t('filter.query')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
          {canManage ? (
            <button type="button" className="button" onClick={() => setEditing({ mode: 'create' })}>
              {t('projects.new')}
            </button>
          ) : null}
        </div>
      </div>

      {editorLoading && <p role="status">{t('state.loading')}</p>}
      <ErrorBox error={editorError} />
      <ErrorBox error={list.error} onRetry={() => list.refresh()} />

      {!list.data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : list.data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{sortHeader('name', t('column.name'))}</th>
              <th>{sortHeader('responsibility', t('projects.responsibility'))}</th>
              <th>{sortHeader('schedule', t('column.status'))}</th>
              <th>{sortHeader('deadline', t('column.deadline'))}</th>
              <th>{t('column.progress')}</th>
              <th>{t('column.actions')}</th>
            </tr>
          </thead>
          {grouped.length ? grouped.map(([groupId, group]) => (
            <tbody key={groupId}>
              <tr className="project-group-heading">
                <th colSpan={6}>
                  <button type="button" className="link-button" aria-expanded={!collapsedGroups.has(groupId)} onClick={() => toggleGroup(groupId)}>
                    {collapsedGroups.has(groupId) ? '▸' : '▾'} {group.name} ({
                      groupTotal(groupId, group.items.length)
                    })
                  </button>
                  {groupTotal(groupId, group.items.length) > group.items.length
                    ? <span className="muted small">{t('projects.groupContinues')}</span>
                    : null}
                </th>
              </tr>
              {!collapsedGroups.has(groupId) ? group.items.map((project) => (
              <tr key={project.projectId} style={{ ['--project-accent' as string]: projectColor(project.projectId) }}>
                <td>
                  <span className="project-dot" style={{ background: projectColor(project.projectId) }} aria-hidden="true" />
                  <a href={`#/project/${project.projectId}`}>{project.projectName}</a>
                  <div className="muted small">{project.nextAction}</div>
                </td>
                <td>{project.responsibilityName || t('overview.unassigned')}</td>
                <td>
                  <ScheduleBadge schedule={project.schedule} />
                </td>
                <td>
                  <DeadlineCell dueDate={project.committedDeadline} state={deadlineStateOf(project.schedule)} showLabel={false} />
                </td>
                <td>
                  <ProgressBar value={project.progressPercent} />
                  <div className="muted small">
                    {t('overview.openWork')}: {project.openWork} · {t('overview.overdue')}: {project.overdueWork}
                  </div>
                </td>
                <td className="project-actions-cell">
                  <div className="actions">
                    {canManage ? (
                      <>
                        <button type="button" className="link-button" onClick={() => void openEditor(project)}>
                          {t('action.edit')}
                        </button>
                        <button type="button" className="link-button" onClick={() => setArchiveTarget(project)}>
                          {t('projects.archive')}
                        </button>
                        {actor.role === 'ADMIN' ? (
                          <button type="button" className="link-button danger" onClick={() => void startDelete(project)}>
                            {t('projects.delete')}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
              )) : null}
            </tbody>
          )) : (
          <tbody>
            {list.data.items.map((project) => (
              <tr key={project.projectId} style={{ ['--project-accent' as string]: projectColor(project.projectId) }}>
                <td>
                  <span className="project-dot" style={{ background: projectColor(project.projectId) }} aria-hidden="true" />
                  <a href={`#/project/${project.projectId}`}>{project.projectName}</a>
                  <div className="muted small">{project.nextAction}</div>
                </td>
                <td>{project.responsibilityName || t('overview.unassigned')}</td>
                <td>
                  <ScheduleBadge schedule={project.schedule} />
                </td>
                <td>
                  <DeadlineCell dueDate={project.committedDeadline} state={deadlineStateOf(project.schedule)} showLabel={false} />
                </td>
                <td>
                  <ProgressBar value={project.progressPercent} />
                  <div className="muted small">
                    {t('overview.openWork')}: {project.openWork} · {t('overview.overdue')}: {project.overdueWork}
                  </div>
                </td>
                <td className="project-actions-cell">
                  <div className="actions">
                    {canManage ? (
                      <>
                        <button type="button" className="link-button" onClick={() => void openEditor(project)}>
                          {t('action.edit')}
                        </button>
                        <button type="button" className="link-button" onClick={() => setArchiveTarget(project)}>
                          {t('projects.archive')}
                        </button>
                        {actor.role === 'ADMIN' ? (
                          <button type="button" className="link-button danger" onClick={() => void startDelete(project)}>
                            {t('projects.delete')}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          )}
        </table>
      )}

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
            <span className="field-label">{t('projects.responsibility')}</span>
            <SelectInput
              value={form.responsibilityId}
              onChange={(value) => set('responsibilityId', value)}
              allowEmpty={t('common.unset')}
              options={(references?.responsibilities ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('projects.owner')}</span>
            <SelectInput
              value={form.projectOwnerId}
              onChange={(value) => set('projectOwnerId', value)}
              allowEmpty={t('common.unset')}
              options={(references?.members ?? []).map((entry) => ({ value: entry.memberId, label: entry.name }))}
            />
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
              disabled={save.state === 'saving'}
              onClick={() =>
                void save.run(
                  async () => {
                    if (mode === 'create') {
                      const result = await api.post<{ project: Project }>('/api/manager/projects', {
                        idempotencyKey,
                        projectName: form.projectName,
                        description: form.description || undefined,
                        category: form.category || undefined,
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
