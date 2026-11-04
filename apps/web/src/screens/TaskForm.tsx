/**
 * One form for creating and editing a task.
 *
 * The routine form is deliberately small: project, subproject, parent task, name, description,
 * deadline, priority, the unified assignee picker and an optional skill grade. Status is derived
 * from the deadline and completion, so there is no status field; duration, working-day
 * acknowledgement, estimated hours, actual hours and progress are gone. On edit the body is a
 * partial patch, so a hidden historical column is never rewritten with a blank or a default.
 */
import { useEffect, useMemo, useState } from 'react';
import { ProjectPicker } from '../components/ProjectPicker';
import { AssigneePicker } from '../components/AssigneePicker';
import type { Reference, Task, TaskDetail } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache } from '../state/cache';
import { useI18n } from '../i18n';
import { ErrorBox, SaveState } from '../components/ui';
import { SelectInput, TextInput, useIdempotencyKey, useSave } from '../components/forms';
import { SKILL_GRADES, formatSkillGrade, gradeToLevel, levelToGrade } from '@eh/domain';

type References = {
  members: { memberId: string; name: string; active: boolean; employeeId?: string }[];
  skills: { skillId: string; skillName: string }[];
  subprojects: Reference[];
};

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

export function TaskForm({
  task,
  detail,
  initialProjectId,
  initialSubprojectId,
  initialParentTaskId,
  references,
  onClose,
  onSaved
}: {
  task?: Task;
  detail?: TaskDetail;
  initialProjectId?: string;
  /** A contextual "new task" inside a subproject preselects it; the manager may still change it. */
  initialSubprojectId?: string;
  initialParentTaskId?: string;
  references?: References;
  onClose: () => void;
  onSaved: (task: Task) => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const save = useSave();
  const idempotencyKey = useIdempotencyKey();
  const [optionError, setOptionError] = useState<unknown>(null);
  const [parentOptions, setParentOptions] = useState<{ id: string; name: string; depth: number }[]>([]);
  const [form, setForm] = useState({
    projectId: task?.projectId ?? initialProjectId ?? '',
    subprojectId: task?.subprojectId ?? initialSubprojectId ?? '',
    parentTaskId: task?.parentTaskId ?? initialParentTaskId ?? '',
    taskName: task?.taskName ?? '',
    description: task?.description ?? '',
    priority: task?.priority ?? 'Medium',
    deadline: task?.dueDate ?? '',
    requiredSkillId: task?.requiredSkillId ?? '',
    requiredSkillGrade: levelToGrade(task?.requiredSkillLevel) ?? ''
  });
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    detail?.assigneeIds ?? (task?.ownerMemberId ? [task.ownerMemberId] : [])
  );

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const deadlineChanged = !!task && (form.deadline ?? '') !== (task.dueDate ?? '');

  useEffect(() => {
    let current = true;
    setParentOptions([]);
    setOptionError(null);
    if (form.projectId) {
      // An explicit empty subproject selects only direct project tasks.
      const params = new URLSearchParams({ projectId: form.projectId, subprojectId: form.subprojectId, excludeTaskId: task?.taskId ?? '' });
      void api.get<{ items: { id: string; name: string; depth: number }[] }>('/api/manager/tasks/parent-options?' + params)
        .then(result => { if (current) setParentOptions(result.items); })
        .catch(error => { if (current) setOptionError(error); });
    }
    return () => { current = false; };
  }, [form.projectId, form.subprojectId, task?.taskId]);

  const gradeOptions = useMemo(
    () => [
      ...SKILL_GRADES.map((grade) => ({ value: grade, label: formatSkillGrade(gradeToLevel(grade), t('skills.notAssessed')) })),
      { value: '', label: formatSkillGrade(null, t('skills.notAssessed')) }
    ],
    [t]
  );

  const createPayload = {
    subprojectId: form.subprojectId || null,
    parentTaskId: form.parentTaskId || null,
    taskName: form.taskName.trim(),
    description: form.description,
    priority: form.priority,
    deadline: form.deadline,
    assigneeIds,
    requiredSkillId: form.requiredSkillId || null,
    requiredSkillLevel: form.requiredSkillGrade ? gradeToLevel(form.requiredSkillGrade) : null
  };

  /**
   * A true partial patch: only the fields the manager actually changed are sent.
   *
   * An untouched deadline, assignment, skill or description is omitted, so the server never
   * recomputes `planned_start` and never rewrites a historical column that this form does not show.
   */
  const editPatch = (): Record<string, unknown> => {
    if (!task) return createPayload;
    const patch: Record<string, unknown> = { revision: task.revision };
    const taskName = form.taskName.trim();
    if (taskName !== task.taskName) patch.taskName = taskName;
    if (form.description !== task.description) patch.description = form.description;
    if (form.priority !== task.priority) patch.priority = form.priority;
    const subprojectId = form.subprojectId || null;
    if (subprojectId !== task.subprojectId) patch.subprojectId = subprojectId;
    const parentTaskId = form.parentTaskId || null;
    if (parentTaskId !== task.parentTaskId) patch.parentTaskId = parentTaskId;
    if (deadlineChanged) {
      patch.deadline = form.deadline;
      patch.confirmDeadlineChange = true;
    }
    const currentAssignees = [...new Set(detail?.assigneeIds ?? (task.ownerMemberId ? [task.ownerMemberId] : []))]
      .sort()
      .join(',');
    const nextAssignees = [...new Set(assigneeIds)].sort().join(',');
    if (nextAssignees !== currentAssignees) patch.assigneeIds = assigneeIds;
    const requiredSkillId = form.requiredSkillId || null;
    if (requiredSkillId !== task.requiredSkillId) patch.requiredSkillId = requiredSkillId;
    const requiredSkillLevel = form.requiredSkillGrade ? gradeToLevel(form.requiredSkillGrade) : null;
    if (requiredSkillLevel !== task.requiredSkillLevel) patch.requiredSkillLevel = requiredSkillLevel;
    return patch;
  };
  const pendingPatch = task ? editPatch() : null;
  const nothingToSave = !!pendingPatch && Object.keys(pendingPatch).length === 1;

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
            <div className="field">
              <span className="field-label">{t('nav.projects')}</span>
              <ProjectPicker value={form.projectId} disabled={!!task} onChange={(projectId) => setForm(current => ({ ...current, projectId, parentTaskId: '', subprojectId: '' }))} />
            </div>
            <label className="field">
              <span className="field-label">{t('tasks.subproject')}</span>
              <SelectInput
                value={form.subprojectId}
                onChange={(value) => {
                  set('subprojectId', value);
                  set('parentTaskId', '');
                }}
                allowEmpty={t('common.unset')}
                options={(references?.subprojects ?? [])
                  .filter((entry) => entry.projectId === form.projectId && entry.status !== 'Archived')
                  .map((entry) => ({ value: entry.id, label: entry.name }))}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">{t('tasks.name')}</span>
            <TextInput value={form.taskName} onChange={(value) => set('taskName', value)} required />
          </label>
          <label className="field">
            <span className="field-label">{t('projects.description')}</span>
            <textarea value={form.description} onChange={(event) => set('description', event.target.value)} rows={3} />
          </label>
          <ErrorBox error={optionError} />
          <label className="field">
            <span className="field-label">{t('tasks.parent')}</span>
            <select
              value={form.parentTaskId}
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
              <span className="field-label">{t('tasks.deadline')}</span>
              <TextInput type="date" value={form.deadline} onChange={(value) => set('deadline', value)} required />
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
          <p className="muted small">{t('tasks.noDurationNote')}</p>
          {deadlineChanged ? <div className="banner warning">{t('tasks.deadlineChangedConfirm')}</div> : null}

          <section className="stack">
            <h3>{t('assignee.heading')}</h3>
            <AssigneePicker
              members={references?.members ?? []}
              selectedIds={assigneeIds}
              onChange={setAssigneeIds}
              disabled={save.state === 'saving'}
            />
          </section>

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
              <span className="field-label">{t('skills.grade')}</span>
              <SelectInput
                value={form.requiredSkillGrade}
                onChange={(value) => set('requiredSkillGrade', value)}
                options={gradeOptions}
              />
            </label>
          </div>
          <p className="muted small">{t('skills.gradeHint')}</p>

          <SaveState state={save.state} />
          <ErrorBox error={save.error} />
          {nothingToSave ? <p className="muted small">{t('tasks.noChanges')}</p> : null}
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {t('action.cancel')}
            </button>
            <button
              type="button"
              className="button"
              disabled={
                save.state === 'saving' || !form.projectId || !form.taskName || !form.deadline || nothingToSave
              }
              onClick={() =>
                void save.run(
                  async () => {
                    if (!task) {
                      const created = await api.post<{ task: Task }>('/api/manager/tasks', {
                        idempotencyKey,
                        projectId: form.projectId,
                        ...createPayload
                      });
                      return created.task;
                    }
                    const updated = await api.patch<{ task: Task }>(
                      `/api/manager/tasks/${task.taskId}`,
                      pendingPatch
                    );
                    return updated.task;
                  },
                  {
                    onSuccess: (saved) => {
                      queryCache.invalidate([
                        keys.task(saved.taskId),
                        keys.tasks,
                        keys.taskIndex,
                        keys.overview,
                        keys.project(saved.projectId),
                        keys.workload,
                        keys.myWork
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
