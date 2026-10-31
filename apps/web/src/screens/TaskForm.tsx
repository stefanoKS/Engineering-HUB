/** One form for creating and editing a task (a partial patch on edit). */
import { useState } from 'react';
import type { Reference, Task } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache } from '../state/cache';
import { useI18n } from '../i18n';
import { ErrorBox, SaveState } from '../components/ui';
import { SelectInput, TextInput, useIdempotencyKey, useSave } from '../components/forms';

type References = {
  members: { memberId: string; name: string; active: boolean }[];
  skills: { skillId: string; skillName: string }[];
  subprojects: Reference[];
};

type ProjectOption = { projectId: string; projectName: string };

const STATUSES = ['Not Started', 'Assigned', 'In Progress', 'Blocked', 'On Hold', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

export function TaskForm({
  task,
  detail,
  initialProjectId,
  initialParentTaskId,
  references,
  onClose,
  onSaved
}: {
  task?: Task;
  detail?: { additionalAssigneeIds: string[]; record: Task };
  initialProjectId?: string;
  initialParentTaskId?: string;
  references?: References;
  onClose: () => void;
  onSaved: (task: Task) => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const save = useSave();
  const idempotencyKey = useIdempotencyKey();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [parentOptions, setParentOptions] = useState<{ id: string; name: string; depth: number }[]>([]);
  const [form, setForm] = useState({
    projectId: task?.projectId ?? initialProjectId ?? '',
    subprojectId: task?.subprojectId ?? '',
    parentTaskId: task?.parentTaskId ?? initialParentTaskId ?? '',
    taskName: task?.taskName ?? '',
    description: task?.description ?? '',
    ownerMemberId: task?.ownerMemberId ?? '',
    assigneeIds: detail?.additionalAssigneeIds ?? [],
    status: task?.status ?? 'Not Started',
    priority: task?.priority ?? 'Medium',
    deadline: task?.dueDate ?? '',
    plannedDurationValue: task?.plannedDurationValue ? String(task.plannedDurationValue) : '',
    plannedDurationUnit: task?.plannedDurationUnit ?? 'DAY',
    plannedDurationBasis: task?.plannedDurationBasis ?? 'WORKING_DAYS',
    estimatedHours: task?.estimatedHours !== null && task?.estimatedHours !== undefined ? String(task.estimatedHours) : '',
    actualHours: task?.actualHours !== null && task?.actualHours !== undefined ? String(task.actualHours) : '',
    progressPercent: task?.progressPercent !== null && task?.progressPercent !== undefined ? String(task.progressPercent) : '0',
    dependencyIds: task?.dependencyIds ?? [],
    acceptanceCriteria: task?.acceptanceCriteria ?? '',
    nextAction: task?.nextAction ?? '',
    requiredSkillId: task?.requiredSkillId ?? '',
    requiredSkillLevel: task?.requiredSkillLevel !== null && task?.requiredSkillLevel !== undefined ? String(task.requiredSkillLevel) : '',
    notificationEnabled: task?.notificationEnabled ?? false
  });
  const [confirmDeadline, setConfirmDeadline] = useState(!task);
  const [acknowledge, setAcknowledge] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  async function loadProjects(): Promise<void> {
    const page = await api.get<{ items: ProjectOption[] }>('/api/manager/projects?pageSize=100');
    setProjects(page.items);
    if (!form.projectId && page.items[0]) set('projectId', page.items[0].projectId);
  }

  async function loadParents(projectId: string): Promise<void> {
    if (!projectId) return;
    const options = await api.get<{ items: { id: string; name: string; depth: number }[] }>(
      `/api/manager/tasks/parent-options${queryString({ projectId, excludeTaskId: task?.taskId })}`
    );
    setParentOptions(options.items);
  }

  return (
    <div className="modal-screen" role="dialog" aria-modal="true">
      <div className="modal-panel wide">
        <header className="modal-header">
          <h2>{task ? t('tasks.edit') : t('tasks.new')}</h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t('action.cancel')}
          </button>
        </header>
        <div className="modal-body stack">
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('nav.projects')}</span>
              <select
                value={form.projectId}
                disabled={!!task}
                onFocus={() => {
                  if (!projects.length) void loadProjects();
                }}
                onChange={(event) => {
                  set('projectId', event.target.value);
                  set('parentTaskId', '');
                  set('subprojectId', '');
                  void loadParents(event.target.value);
                }}
              >
                <option value="">{t('common.unset')}</option>
                {projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.projectName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('tasks.subproject')}</span>
              <SelectInput
                value={form.subprojectId}
                onChange={(value) => {
                  set('subprojectId', value);
                  set('parentTaskId', '');
                  void loadParents(form.projectId);
                }}
                allowEmpty={t('common.unset')}
                options={(references?.subprojects ?? [])
                  .filter((entry) => entry.parentId !== undefined)
                  .map((entry) => ({ value: entry.id, label: entry.name }))}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">{t('tasks.name')}</span>
            <TextInput value={form.taskName} onChange={(value) => set('taskName', value)} required />
          </label>
          <label className="field">
            <span className="field-label">{t('tasks.parent')}</span>
            <select
              value={form.parentTaskId}
              onFocus={() => {
                if (form.projectId && !parentOptions.length) void loadParents(form.projectId);
              }}
              onChange={(event) => set('parentTaskId', event.target.value)}
            >
              <option value="">{t('common.none')}</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {'　'.repeat(Math.max(0, option.depth - 1))}
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('tasks.owner')}</span>
              <SelectInput
                value={form.ownerMemberId}
                onChange={(value) => set('ownerMemberId', value)}
                allowEmpty={t('common.unset')}
                options={(references?.members ?? []).map((entry) => ({ value: entry.memberId, label: entry.name }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('tasks.assignees')}</span>
              <select
                multiple
                value={form.assigneeIds}
                onChange={(event) =>
                  set(
                    'assigneeIds',
                    [...event.target.selectedOptions].map((option) => option.value)
                  )
                }
              >
                {(references?.members ?? []).map((entry) => (
                  <option key={entry.memberId} value={entry.memberId}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('tasks.deadline')}</span>
              <TextInput type="date" value={form.deadline} onChange={(value) => set('deadline', value)} required />
            </label>
            <label className="field">
              <span className="field-label">{t('tasks.duration')}</span>
              <TextInput
                type="number"
                min={1}
                value={form.plannedDurationValue}
                onChange={(value) => set('plannedDurationValue', value)}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('tasks.durationUnit')}</span>
              <SelectInput
                value={form.plannedDurationUnit}
                onChange={(value) => set('plannedDurationUnit', value as 'DAY' | 'WEEK')}
                options={[
                  { value: 'DAY', label: '日' },
                  { value: 'WEEK', label: '週' }
                ]}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('tasks.durationBasis')}</span>
              <SelectInput
                value={form.plannedDurationBasis}
                onChange={(value) => set('plannedDurationBasis', value as 'WORKING_DAYS' | 'CALENDAR_DAYS')}
                options={[
                  { value: 'WORKING_DAYS', label: '営業日' },
                  { value: 'CALENDAR_DAYS', label: '暦日' }
                ]}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('column.status')}</span>
              <SelectInput
                value={form.status}
                onChange={(value) => set('status', value as Task['status'])}
                options={STATUSES.map((value) => ({ value, label: label('task.status', value) }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('projects.priority')}</span>
              <SelectInput
                value={form.priority}
                onChange={(value) => set('priority', value as Task['priority'])}
                options={PRIORITIES.map((value) => ({ value, label: label('priority', value) }))}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('tasks.estimate')}</span>
              <TextInput type="number" min={0} value={form.estimatedHours} onChange={(value) => set('estimatedHours', value)} />
            </label>
            <label className="field">
              <span className="field-label">{t('tasks.actual')}</span>
              <TextInput type="number" min={0} value={form.actualHours} onChange={(value) => set('actualHours', value)} />
            </label>
            <label className="field">
              <span className="field-label">{t('tasks.progress')}</span>
              <TextInput type="number" min={0} max={100} value={form.progressPercent} onChange={(value) => set('progressPercent', value)} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">{t('tasks.dependencies')}</span>
            <select
              multiple
              value={form.dependencyIds}
              onChange={(event) => set('dependencyIds', [...event.target.selectedOptions].map((option) => option.value))}
            >
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('tasks.acceptance')}</span>
            <textarea value={form.acceptanceCriteria} onChange={(event) => set('acceptanceCriteria', event.target.value)} rows={2} />
          </label>
          <label className="field">
            <span className="field-label">{t('projects.nextAction')}</span>
            <TextInput value={form.nextAction} onChange={(value) => set('nextAction', value)} />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('nav.skills')}</span>
              <SelectInput
                value={form.requiredSkillId}
                onChange={(value) => set('requiredSkillId', value)}
                allowEmpty={t('common.unset')}
                options={(references?.skills ?? []).map((entry) => ({ value: entry.skillId, label: entry.skillName }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('skills.level')}</span>
              <TextInput type="number" min={0} max={4} value={form.requiredSkillLevel} onChange={(value) => set('requiredSkillLevel', value)} />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.notificationEnabled}
              onChange={(event) => set('notificationEnabled', event.target.checked)}
            />
            {t('nav.automation')} — {t('tasks.approve')}
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={confirmDeadline} onChange={(event) => setConfirmDeadline(event.target.checked)} />
            {t('tasks.deadlineConfirmed')}
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />
            {t('tasks.ackNonWorking')}
          </label>
          <SaveState state={save.state} />
          <ErrorBox error={save.error} />
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {t('action.cancel')}
            </button>
            <button
              type="button"
              className="button"
              disabled={save.state === 'saving' || !form.projectId || !form.taskName || !form.deadline}
              onClick={() =>
                void save.run(
                  async () => {
                    const payload = {
                      subprojectId: form.subprojectId || null,
                      parentTaskId: form.parentTaskId || null,
                      taskName: form.taskName,
                      description: form.description,
                      ownerMemberId: form.ownerMemberId || null,
                      assigneeIds: form.assigneeIds,
                      status: form.status,
                      priority: form.priority,
                      deadline: form.deadline,
                      plannedDurationValue: form.plannedDurationValue ? Number(form.plannedDurationValue) : null,
                      plannedDurationUnit: form.plannedDurationValue ? form.plannedDurationUnit : null,
                      plannedDurationBasis: form.plannedDurationValue ? form.plannedDurationBasis : null,
                      estimatedHours: form.estimatedHours === '' ? null : Number(form.estimatedHours),
                      actualHours: form.actualHours === '' ? null : Number(form.actualHours),
                      progressPercent: form.progressPercent === '' ? 0 : Number(form.progressPercent),
                      dependencyIds: form.dependencyIds,
                      acceptanceCriteria: form.acceptanceCriteria,
                      nextAction: form.nextAction,
                      requiredSkillId: form.requiredSkillId || null,
                      requiredSkillLevel: form.requiredSkillLevel === '' ? null : Number(form.requiredSkillLevel),
                      notificationEnabled: form.notificationEnabled
                    };
                    if (!task) {
                      const created = await api.post<{ task: Task }>('/api/manager/tasks', {
                        idempotencyKey,
                        projectId: form.projectId,
                        ...payload,
                        acknowledgeNonWorking: acknowledge
                      });
                      return created.task;
                    }
                    const updated = await api.patch<{ task: Task }>(`/api/manager/tasks/${task.taskId}`, {
                      revision: task.revision,
                      ...payload,
                      confirmDeadlineChange: confirmDeadline,
                      acknowledgeNonWorking: acknowledge
                    });
                    return updated.task;
                  },
                  {
                    onSuccess: (saved) => {
                      queryCache.invalidate([
                        keys.tasks,
                        keys.task(saved.taskId),
                        keys.taskIndex,
                        keys.overview,
                        keys.project(saved.projectId),
                        keys.workload
                      ]);
                      onSaved(saved);
                    }
                  }
                )
              }
            >
              {task ? t('action.save') : t('action.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
