import { useState } from 'react';
import { ProjectForm } from './Projects';
import { SubprojectForm } from './SubprojectForm';
import { TaskForm } from './TaskForm';
/** Project detail: authoritative record, derived rollup, subprojects and task summaries. */
import type { Actor, Project, Reference, ProgressRollup, Subproject, TaskSummary } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, ProgressBar, Section, statusTone } from '../components/ui';
import { projectColor } from '@eh/domain';

type Detail = {
  record: Project;
  progress: ProgressRollup;
  subprojects: (Subproject & { progress: ProgressRollup })[];
  tasks: TaskSummary[];
  milestones: {
    milestone_id: string;
    milestone_name: string;
    target_date: string | null;
    actual_date: string | null;
    status: string;
  }[];
  phases: {
    project_phase_id: string;
    phase_name: string;
    planned_start: string | null;
    planned_end: string | null;
    status: string;
  }[];
};

export function ProjectDetailScreen({ actor, projectId }: { actor: Actor; projectId: string }): JSX.Element {
  const { t, label } = useI18n();
  const detail = useQuery<Detail>(keys.project(projectId), () => api.get<Detail>(`/api/manager/projects/${projectId}`));
  const canManage = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  const [editProject, setEditProject] = useState(false);
  const [editSubproject, setEditSubproject] = useState<Subproject | 'new' | null>(null);
  const [newTask, setNewTask] = useState(false);
  const references = useQuery<{ responsibilities: Reference[]; subprojects: Reference[]; skills: { skillId: string; skillName: string }[]; members: { memberId: string; name: string; active: boolean }[] }>(keys.references, () => api.get('/api/manager/references'));
  const refresh = (): void => { queryCache.invalidate([keys.project(projectId), keys.projects, keys.references, keys.tasks, keys.overview, keys.taskIndex]); };

  if (detail.error) return <ErrorBox error={detail.error} onRetry={() => detail.refresh()} />;
  if (!detail.data) return <p className="muted">{t('state.loading')}</p>;
  const { record } = detail.data;

  return (
    <div className="screen" style={{ ['--project-accent' as string]: projectColor(record.projectId) }}>
      <div className="screen-header">
        <div>
          <h2>
            <span className="project-dot" style={{ background: projectColor(record.projectId) }} aria-hidden="true" />
            {record.projectName}
          </h2>
          <p className="muted small">
            {record.projectId} · {record.responsibilityName || t('overview.unassigned')} ·{' '}
            {record.projectOwnerName || t('common.unset')}
          </p>
        </div>
        <div className="filters">
          {canManage && <button type="button" className="button secondary" onClick={() => setEditProject(true)}>{t('projects.edit')}</button>}
          <Badge tone={statusTone(record.status)}>{label('project.status', record.status)}</Badge>
          <Badge tone={record.dashboardVisibility === 'INTERNAL' ? 'ok' : 'neutral'}>
            {record.dashboardVisibility}
          </Badge>
        </div>
      </div>

      <Section title={t('projects.progress')}>
        <ProgressBar value={detail.data.progress.percent} />
        <p className="muted small">
          {t('projects.tasks')}: {detail.data.progress.leaves} ·{' '}
          {t('overview.completed')}: {detail.data.progress.doneLeaves} · {t('workload.unknown')}:{' '}
          {detail.data.progress.unknownEffort}
        </p>
      </Section>

      <Section title={t('projects.subprojects')} actions={canManage && <button type="button" className="button secondary" onClick={() => setEditSubproject('new')}>{t('subprojects.new')}</button>}>
        {detail.data.subprojects.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('column.name')}</th>
                <th>{t('column.status')}</th>
                <th>{t('column.deadline')}</th>
                <th>{t('column.progress')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.subprojects.map((subproject) => (
                <tr key={subproject.subprojectId}>
                  <td style={{ paddingLeft: `${(subproject.depth - 1) * 16 + 8}px` }}>{canManage ? <button type="button" className="link-button" onClick={() => setEditSubproject(subproject)}>{subproject.subprojectName}</button> : subproject.subprojectName}</td>
                  <td>
                    <Badge tone={statusTone(subproject.status)}>{label('project.status', subproject.status)}</Badge>
                  </td>
                  <td>{subproject.deadline ?? t('common.unset')}</td>
                  <td>
                    <ProgressBar value={subproject.progress.percent} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={t('projects.tasks')} actions={canManage && <button type="button" className="button" onClick={() => setNewTask(true)}>{t('tasks.new')}</button>}>
        {detail.data.tasks.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('column.name')}</th>
                <th>{t('column.owner')}</th>
                <th>{t('column.status')}</th>
                <th>{t('column.deadline')}</th>
                <th>{t('column.progress')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.tasks.map((task) => (
                <tr key={task.taskId}>
                  <td style={{ paddingLeft: `${(task.depth - 1) * 16 + 8}px` }}>
                    <a href={`#/task/${task.taskId}`}>{task.taskName}</a>
                    {task.container ? <Badge>{t('request.container')}</Badge> : null}
                  </td>
                  <td>{task.ownerName || t('common.unset')}</td>
                  <td>
                    <Badge tone={statusTone(task.status)}>{label('task.status', task.status)}</Badge>
                  </td>
                  <td>
                    {task.dueDate ?? t('common.unset')}
                    {task.overdue ? <Badge tone="danger">{t('overview.overdue')}</Badge> : null}
                  </td>
                  <td>
                    <ProgressBar value={task.progressPercent} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={t('projects.milestones')}>
        {detail.data.milestones.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="list">
            {detail.data.milestones.map((milestone) => (
              <li key={milestone.milestone_id}>
                {milestone.milestone_name} · {milestone.target_date ?? t('common.unset')} · {milestone.status}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('projects.phases')}>
        {detail.data.phases.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="list">
            {detail.data.phases.map((phase) => (
              <li key={phase.project_phase_id}>
                {phase.phase_name} · {phase.planned_start ?? t('common.unset')} → {phase.planned_end ?? t('common.unset')} ·{' '}
                <Badge tone={phase.status === 'PLANNED' ? 'ok' : 'warn'}>{phase.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editProject && <ProjectForm mode="edit" project={record} references={references.data} onClose={() => setEditProject(false)} onSaved={() => { setEditProject(false); refresh(); }} />}
      {editSubproject && <SubprojectForm projectId={projectId} item={editSubproject === 'new' ? undefined : editSubproject} siblings={detail.data.subprojects} members={references.data?.members ?? []} onClose={() => setEditSubproject(null)} onSaved={() => { setEditSubproject(null); refresh(); }} />}
      {newTask && <TaskForm initialProjectId={projectId} references={references.data} onClose={() => setNewTask(false)} onSaved={() => { setNewTask(false); refresh(); }} />}
    </div>
  );
}
