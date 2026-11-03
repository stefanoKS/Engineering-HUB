/**
 * Project detail.
 *
 * A manager keeps the authoritative record with the edit/subproject/task controls and the
 * milestone and phase sections. A MEMBER or VIEWER reads the narrow `/api/work/projects/:id`
 * projection: identity, progress, subprojects and active tasks only, with no management action
 * anywhere in the screen.
 */
import { useState } from 'react';
import { ProjectForm } from './Projects';
import { SubprojectForm } from './SubprojectForm';
import { TaskForm } from './TaskForm';
import type { Actor, Project, Reference, ProgressRollup, Subproject, TaskSummary } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, ProgressBar, Section, statusTone } from '../components/ui';
import { projectColor } from '@eh/domain';

type ManagerDetail = {
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

type ReadOnlyDetail = {
  record: {
    projectId: string;
    projectName: string;
    responsibilityName: string;
    projectOwnerName: string;
    status: Project['status'];
    priority: Project['priority'];
    committedDeadline: string | null;
    progressPercent: number | null;
    health: string;
  };
  progress: ProgressRollup;
  subprojects: {
    subprojectId: string;
    subprojectName: string;
    status: Subproject['status'];
    deadline: string | null;
    depth: number;
    progress: ProgressRollup;
  }[];
  tasks: TaskSummary[];
};

type ViewModel = ReadOnlyDetail & { milestones?: ManagerDetail['milestones']; phases?: ManagerDetail['phases'] };

function toViewModel(detail: ManagerDetail | ReadOnlyDetail): ViewModel {
  if ('milestones' in detail) {
    return {
      record: detail.record,
      progress: detail.progress,
      subprojects: detail.subprojects,
      tasks: detail.tasks,
      milestones: detail.milestones,
      phases: detail.phases
    };
  }
  return detail;
}

export function ProjectDetailScreen({
  actor,
  projectId,
  readOnly = false
}: {
  actor: Actor;
  projectId: string;
  readOnly?: boolean;
}): JSX.Element {
  const { t, label } = useI18n();
  const endpoint = readOnly ? `/api/work/projects/${projectId}` : `/api/manager/projects/${projectId}`;
  const cacheKey = `${readOnly ? 'work' : 'manager'}/project/${projectId}`;
  const detail = useQuery<ManagerDetail | ReadOnlyDetail>(cacheKey, () => api.get<ManagerDetail | ReadOnlyDetail>(endpoint));
  const canManage = !readOnly && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
  const [editProject, setEditProject] = useState(false);
  const [editSubproject, setEditSubproject] = useState<Subproject | 'new' | null>(null);
  const [newTask, setNewTask] = useState(false);
  const references = useQuery<{ responsibilities: Reference[]; subprojects: Reference[]; skills: { skillId: string; skillName: string }[]; members: { memberId: string; name: string; active: boolean; employeeId?: string }[] }>(keys.references, () =>
    canManage
      ? api.get('/api/manager/references')
      : Promise.resolve({ responsibilities: [], subprojects: [], skills: [], members: [] })
  );
  const refresh = (): void => {
    queryCache.invalidate([cacheKey, keys.project(projectId), keys.projects, keys.references, keys.tasks, keys.overview, keys.taskIndex]);
  };

  if (detail.error) return <ErrorBox error={detail.error} onRetry={() => detail.refresh()} />;
  if (!detail.data) return <p className="muted">{t('state.loading')}</p>;
  const view = toViewModel(detail.data);
  const { record } = view;

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
          {canManage ? (
            <Badge tone={(record as Project).dashboardVisibility === 'INTERNAL' ? 'ok' : 'neutral'}>
              {(record as Project).dashboardVisibility}
            </Badge>
          ) : null}
        </div>
      </div>

      <Section title={t('projects.progress')}>
        <ProgressBar value={view.progress.percent} />
        <p className="muted small">
          {t('projects.tasks')}: {view.progress.leaves} · {t('overview.completed')}: {view.progress.doneLeaves}
        </p>
      </Section>

      <Section
        title={t('projects.subprojects')}
        actions={canManage && (
          <button type="button" className="button secondary" onClick={() => setEditSubproject('new')}>
            {t('subprojects.new')}
          </button>
        )}
      >
        {view.subprojects.length === 0 ? (
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
              {view.subprojects.map((subproject) => (
                <tr key={subproject.subprojectId}>
                  <td style={{ paddingLeft: `${(subproject.depth - 1) * 16 + 8}px` }}>
                    {canManage && 'parentSubprojectId' in subproject ? (
                      <button type="button" className="link-button" onClick={() => setEditSubproject(subproject as unknown as Subproject)}>
                        {subproject.subprojectName}
                      </button>
                    ) : (
                      subproject.subprojectName
                    )}
                  </td>
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

      <Section
        title={t('projects.tasks')}
        actions={canManage && (
          <button type="button" className="button" onClick={() => setNewTask(true)}>
            {t('tasks.new')}
          </button>
        )}
      >
        {view.tasks.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('column.name')}</th>
                <th>{t('column.owner')}</th>
                <th>{t('column.status')}</th>
                <th>{t('column.deadline')}</th>
              </tr>
            </thead>
            <tbody>
              {view.tasks.map((task) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {canManage && view.milestones ? (
        <Section title={t('projects.milestones')}>
          {view.milestones.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="list">
              {view.milestones.map((milestone) => (
                <li key={milestone.milestone_id}>
                  {milestone.milestone_name} · {milestone.target_date ?? t('common.unset')} · {milestone.status}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {canManage && view.phases ? (
        <Section title={t('projects.phases')}>
          {view.phases.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="list">
              {view.phases.map((phase) => (
                <li key={phase.project_phase_id}>
                  {phase.phase_name} · {phase.planned_start ?? t('common.unset')} → {phase.planned_end ?? t('common.unset')} ·{' '}
                  <Badge tone={phase.status === 'PLANNED' ? 'ok' : 'warn'}>{phase.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {editProject && !readOnly ? (
        <ProjectForm mode="edit" project={record as Project} references={references.data} onClose={() => setEditProject(false)} onSaved={() => { setEditProject(false); refresh(); }} />
      ) : null}
      {editSubproject && !readOnly ? (
        <SubprojectForm projectId={projectId} item={editSubproject === 'new' ? undefined : editSubproject} siblings={view.subprojects as unknown as Subproject[]} members={references.data?.members ?? []} onClose={() => setEditSubproject(null)} onSaved={() => { setEditSubproject(null); refresh(); }} />
      ) : null}
      {newTask && !readOnly ? (
        <TaskForm initialProjectId={projectId} references={references.data} onClose={() => setNewTask(false)} onSaved={() => { setNewTask(false); refresh(); }} />
      ) : null}
    </div>
  );
}
