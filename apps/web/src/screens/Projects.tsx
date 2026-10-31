/** Project list, create/edit form, archive and the guarded permanent removal. */
import { useState } from 'react';
import type { Actor, Project, ProjectSummary, Reference } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Pagination, ProgressBar, Section, statusTone } from '../components/ui';
import { ConfirmDialog, SelectInput, TextInput, useIdempotencyKey, useSave, type SaveStateValue } from '../components/forms';
import { SaveState } from '../components/ui';
import { navigate } from '../App';
import { projectColor } from '@eh/domain';

type ProjectRow = ProjectSummary & { _revision: number };
type Page = { items: ProjectRow[]; total: number; page: number; pageSize: number; totalPages: number };
type References = { responsibilities: Reference[]; members: { memberId: string; name: string; active: boolean }[] };

const STATUSES: Project['status'][] = ['Planned', 'Active', 'On Hold', 'Completed', 'Cancelled', 'Archived'];
const PRIORITIES: Project['priority'][] = ['Low', 'Medium', 'High', 'Critical'];

export function ProjectsScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t, label } = useI18n();
  const [responsibilityId, setResponsibilityId] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ mode: 'create' } | { mode: 'edit'; project: Project } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ProjectRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ summary: ProjectRow; confirmation: string; blockers: string[] } | null>(null);

  const references = useQuery<References>(keys.references, () => api.get<References>('/api/manager/references'));
  const listKey = `${keys.projects}${queryString({ responsibilityId, status, query, page })}`;
  const list = useQuery<Page>(listKey, () =>
    api.get<Page>(`/api/manager/projects${queryString({ responsibilityId, status, query, page, pageSize: 25 })}`)
  );
  const canManage = actor.role === 'ADMIN' || actor.role === 'MANAGER';

  async function openEditor(summary: ProjectRow): Promise<void> {
    const detail = await api.get<{ record: Project }>(`/api/manager/projects/${summary.projectId}`);
    setEditing({ mode: 'edit', project: detail.record });
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
            value={responsibilityId}
            onChange={(value) => {
              setResponsibilityId(value);
              setPage(1);
            }}
            allowEmpty={t('filter.all')}
            options={(references.data?.responsibilities ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
          />
          <SelectInput
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            allowEmpty={t('filter.all')}
            options={STATUSES.map((value) => ({ value, label: label('project.status', value) }))}
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
              <th>{t('projects.responsibility')}</th>
              <th>{t('column.status')}</th>
              <th>{t('column.deadline')}</th>
              <th>{t('column.progress')}</th>
              <th>{t('column.actions')}</th>
            </tr>
          </thead>
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
                  <Badge tone={statusTone(project.status)}>{label('project.status', project.status)}</Badge>
                </td>
                <td>
                  {project.committedDeadline ?? t('common.unset')}
                  {project.deadlineState === 'OVERDUE' ? <Badge tone="danger">{t('overview.overdue')}</Badge> : null}
                </td>
                <td>
                  <ProgressBar value={project.progressPercent} />
                  <div className="muted small">
                    {t('overview.openWork')}: {project.openWork} · {t('overview.overdue')}: {project.overdueWork}
                  </div>
                </td>
                <td className="actions">
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
        <ProjectForm
          mode={editing.mode}
          project={editing.mode === 'edit' ? editing.project : undefined}
          references={references.data}
          onClose={() => setEditing(null)}
          onSaved={(project) => {
            setEditing(null);
            queryCache.invalidate([keys.projects, keys.overview, keys.status, keys.bootstrap]);
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
            queryCache.invalidate([keys.projects, keys.overview, keys.status]);
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
            queryCache.invalidate([keys.projects, keys.overview, keys.status, keys.bootstrap]);
          }}
        />
      ) : null}
    </div>
  );
}

function ProjectForm({
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
    status: project?.status ?? 'Planned',
    priority: project?.priority ?? 'Medium',
    committedDeadline: project?.committedDeadline ?? '',
    forecastEnd: project?.forecastEnd ?? '',
    plannedStart: project?.plannedStart ?? '',
    nextAction: project?.nextAction ?? '',
    notificationEnabled: project?.notificationEnabled ?? true,
    dashboardVisibility: project?.dashboardVisibility ?? 'RESTRICTED',
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
            <label className="field">
              <span className="field-label">{t('projects.status')}</span>
              <SelectInput
                value={form.status}
                onChange={(value) => set('status', value as Project['status'])}
                options={STATUSES.map((value) => ({ value, label: label('project.status', value) }))}
              />
            </label>
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
              <span className="field-label">{t('projects.deadline')}</span>
              <TextInput type="date" value={form.committedDeadline} onChange={(value) => set('committedDeadline', value)} />
            </label>
            <label className="field">
              <span className="field-label">{t('projects.forecast')}</span>
              <TextInput type="date" value={form.forecastEnd} onChange={(value) => set('forecastEnd', value)} />
            </label>
          </div>
          <button type="button" className="link-button" onClick={() => void checkPlan()}>
            {t('nav.status')}: {t('common.retry')}
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
                { value: 'RESTRICTED', label: 'RESTRICTED' },
                { value: 'INTERNAL', label: 'INTERNAL' }
              ]}
            />
            <span className="field-hint">{t('projects.visibilityHint')}</span>
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
                        status: form.status,
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
                      status: form.status,
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
