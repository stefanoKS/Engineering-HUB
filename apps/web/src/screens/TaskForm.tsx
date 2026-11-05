/**
 * One form for creating and editing a task.
 *
 * The routine form is deliberately small: a readable location, the name, the deadline, the
 * assignees and a compact description. Priority, skill grade and the parent/location change live
 * in one clearly labelled optional section, so a daily creation never scrolls through fields it
 * does not need. On edit the body is a partial patch, so a hidden historical column is never
 * rewritten with a blank or a default.
 */
import { useMemo, useState } from 'react';
import { SKILL_GRADES, formatSkillGrade, gradeToLevel, levelToGrade } from '@eh/domain';
import { ProjectPicker } from '../components/ProjectPicker';
import { AssigneePicker } from '../components/AssigneePicker';
import type { Reference, Task, TaskDetail } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { ErrorBox, Modal, SaveState } from '../components/ui';
import {
  BlockedReasons,
  createIdempotencyKey,
  RemoteSelect,
  RequiredTag,
  SearchSelect,
  SelectInput,
  TextInput,
  useSave
} from '../components/forms';

type References = {
  members: { memberId: string; name: string; active: boolean; employeeId?: string }[];
  skills: { skillId: string; skillName: string }[];
  subprojects: Reference[];
};

/** Display-only context supplied by the screen that opened the form. */
export type TaskFormContext = {
  projectName?: string;
  subprojectPath?: string;
  parentTaskName?: string;
};

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

function subprojectPathOf(subprojects: Reference[], subprojectId: string): string {
  const byId = new Map(subprojects.map((entry) => [entry.id, entry]));
  const names: string[] = [];
  const seen = new Set<string>();
  let node = byId.get(subprojectId);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    names.unshift(node.name);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return names.join(' / ');
}

export function TaskForm({
  task,
  detail,
  initialProjectId,
  initialSubprojectId,
  initialParentTaskId,
  context,
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
  context?: TaskFormContext;
  references?: References;
  onClose: () => void;
  onSaved: (task: Task) => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const save = useSave();
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [parentLabel, setParentLabel] = useState<string>('');
  // A contextual creation keeps the known location; changing it is always an explicit step. An
  // edit starts collapsed on its readable location, so "Change location" is the only way in.
  const [locationOpen, setLocationOpen] = useState(!task && !initialProjectId);
  const locationDisabled = !locationOpen;
  const [retained, setRetained] = useState<{ assignees: string; priority: string } | null>(null);
  const [form, setForm] = useState({
    projectId: task?.projectId ?? initialProjectId ?? '',
    subprojectId: task?.subprojectId ?? initialSubprojectId ?? '',
    parentTaskId: task?.parentTaskId ?? initialParentTaskId ?? '',
    taskName: task?.taskName ?? '',
    description: task?.description ?? '',
    priority: task?.priority ?? 'Medium',
    plannedStart: task?.plannedStart ?? '',
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

  // The picker and this form share one cache key, so the readable name costs no extra request.
  const knownProjectId = task?.projectId ?? initialProjectId;
  // The name is read for the selected project, including after the manager changes away from the
  // context that opened the form; the context name is only valid for the project it describes.
  const projectRecord = useQuery<{ record: { projectId: string; projectName: string } }>(
    `manager/project/${form.projectId}`,
    () => api.get<{ record: { projectId: string; projectName: string } }>(`/api/manager/projects/${form.projectId}`),
    { enabled: !!form.projectId && (form.projectId !== knownProjectId || !context?.projectName) }
  );

  const knownSubprojectId = task?.subprojectId ?? initialSubprojectId;
  const effectiveProjectName =
    context?.projectName && form.projectId === knownProjectId
      ? context.projectName
      : projectRecord.data?.record.projectName || '';
  const effectiveSubprojectName =
    context?.subprojectPath && form.subprojectId === knownSubprojectId
      ? context.subprojectPath
      : references?.subprojects
        ? subprojectPathOf(references.subprojects, form.subprojectId)
        : '';
  const parentName =
    parentLabel ||
    (form.parentTaskId === (task?.parentTaskId ?? initialParentTaskId) ? context?.parentTaskName ?? '' : '') ||
    (form.parentTaskId ? form.parentTaskId : '');
  const locationPath = [effectiveProjectName, effectiveSubprojectName, form.parentTaskId ? parentName : '']
    .filter(Boolean)
    .join(' / ');

  const gradeOptions = useMemo(
    () => [
      ...SKILL_GRADES.map((grade) => ({
        value: grade,
        label: formatSkillGrade(gradeToLevel(grade), t('skills.notAssessed'))
      })),
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
    plannedStart: form.plannedStart || null,
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
    if ((form.plannedStart || null) !== (task.plannedStart ?? null)) patch.plannedStart = form.plannedStart || null;
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

  const invalidate = (saved: Task): void => {
    queryCache.invalidate([
      keys.task(saved.taskId),
      keys.tasks,
      keys.taskIndex,
      keys.overview,
      keys.project(saved.projectId),
      keys.workload,
      keys.myWork,
      // A new or renamed task changes every parent selector's candidate list.
      keys.parentOptions,
      keys.timeline
    ]);
  };

  const blocked: string[] = [];
  if (!form.projectId) blocked.push(t('taskForm.projectRequired'));
  if (!form.taskName.trim()) blocked.push(t('taskForm.nameRequired'));
  if (!form.deadline) blocked.push(t('taskForm.deadlineRequired'));
  if (form.plannedStart && form.deadline && form.plannedStart > form.deadline) blocked.push(t('schedule.order'));
  if (nothingToSave) blocked.push(t('form.noChanges'));

  const memberNames = (ids: string[]): string =>
    ids.map((id) => references?.members.find((member) => member.memberId === id)?.name ?? id).join(', ');

  async function submit(addAnother: boolean): Promise<void> {
    await save.run(
      async () => {
        if (!task) {
          const created = await api.post<{ task: Task }>('/api/manager/tasks', {
            idempotencyKey,
            projectId: form.projectId,
            ...createPayload
          });
          return created.task;
        }
        const updated = await api.patch<{ task: Task }>(`/api/manager/tasks/${task.taskId}`, pendingPatch);
        return updated.task;
      },
      {
        onSuccess: (saved) => {
          invalidate(saved);
          if (!addAnother) {
            onSaved(saved);
            return;
          }
          // A fresh idempotency key means the next create can never replay this one.
          setForm((current) => ({
            ...current,
            taskName: '',
            description: '',
            plannedStart: '',
            deadline: '',
            requiredSkillId: '',
            requiredSkillGrade: ''
          }));
          setIdempotencyKey(createIdempotencyKey());
          setRetained({ assignees: memberNames(assigneeIds), priority: label('priority', form.priority) });
          save.reset();
          window.requestAnimationFrame(() => document.getElementById('task-name-field')?.focus());
        }
      }
    );
  }

  const footer = (
    <>
      <button type="button" className="button secondary" onClick={onClose}>
        {t('action.cancel')}
      </button>
      {!task ? (
        <button
          type="button"
          className="button secondary"
          disabled={save.state === 'saving' || blocked.length > 0}
          onClick={() => void submit(true)}
        >
          {t('taskForm.createAnother')}
        </button>
      ) : null}
      <button
        type="button"
        className="button"
        disabled={save.state === 'saving' || blocked.length > 0}
        onClick={() => void submit(false)}
      >
        {task ? t('action.save') : t('action.create')}
      </button>
    </>
  );

  const locationFields = (
    <div className="stack location-fields">
      <div className="field-row">
        <div className="field">
          <span className="field-label">{t('nav.projects')}</span>
          <ProjectPicker
            value={form.projectId}
            disabled={!!task || locationDisabled}
            onChange={(projectId) => {
              setForm((current) => ({ ...current, projectId, parentTaskId: '', subprojectId: '' }));
              setParentLabel('');
            }}
          />
        </div>
        <label className="field">
          <span className="field-label">{t('tasks.subproject')}</span>
          <SearchSelect
            value={form.subprojectId}
            onChange={(value) => {
              set('subprojectId', value);
              set('parentTaskId', '');
              setParentLabel('');
            }}
            allowEmpty={t('common.unset')}
            searchLabel={t('action.search')}
            selectLabel={t('tasks.subproject')}
            disabled={!locationOpen}
            options={(references?.subprojects ?? [])
              .filter((entry) => entry.projectId === form.projectId && entry.status !== 'Archived')
              .map((entry) => ({ value: entry.id, label: subprojectPathOf(references?.subprojects ?? [], entry.id) }))}
          />
        </label>
      </div>
      <div className="field">
        <span className="field-label">{t('tasks.parent')}</span>
        <RemoteSelect
          value={form.parentTaskId}
          optionsKey={`parent-options:${form.projectId}:${form.subprojectId}:${task?.taskId ?? ''}`}
          onChange={(value) => {
            set('parentTaskId', value);
            setParentLabel('');
          }}
          allowEmpty={t('common.none')}
          searchLabel={t('taskForm.parentSearch')}
          selectLabel={t('tasks.parent')}
          emptyHint={t('taskForm.noParentOptions')}
          enabled={!!form.projectId}
          disabled={!locationOpen}
          load={async ({ query, page }) => {
            // An explicit empty subproject selects only direct project tasks, so the parameter is
            // sent even when it is empty.
            const params = new URLSearchParams({
              projectId: form.projectId,
              subprojectId: form.subprojectId,
              excludeTaskId: task?.taskId ?? '',
              selectedId: form.parentTaskId,
              query,
              page: String(page),
              pageSize: '25'
            });
            const result = await api.get<{
              items: { id: string; name: string; path: string; depth: number }[];
              total: number;
              page: number;
              pageSize: number;
              totalPages: number;
              selected: { id: string; name: string; path: string } | null;
            }>('/api/manager/tasks/parent-options?' + params.toString());
            return {
              items: result.items.map((option) => ({ value: option.id, label: option.path })),
              total: result.total,
              page: result.page,
              totalPages: result.totalPages,
              selected: result.selected ? { value: result.selected.id, label: result.selected.path } : null
            };
          }}
        />
        <span className="field-hint">{t('taskForm.parentHint')}</span>
      </div>
    </div>
  );

  return (
    <Modal title={task ? t('tasks.edit') : t('tasks.new')} onClose={onClose} footer={footer}>
      <div className="stack task-form">
        {retained ? (
          <div className="banner ok" role="status">
            <strong>{t('taskForm.createdAnother')}</strong>
            <p className="muted small">
              {t('taskForm.retainedHint')}:{' '}
              {t('taskForm.retainedAssignees', { names: retained.assignees || t('common.none') })} ·{' '}
              {t('taskForm.retainedPriority', { value: retained.priority })}
            </p>
          </div>
        ) : null}

        <section className="stack primary-section" aria-label={t('taskForm.location')}>
          <div className="location-summary">
            <span className="field-label">{t('taskForm.location')}</span>
            <p className="location-path">{locationPath || t('common.unset')}</p>
            <button
              type="button"
              className="link-button"
              aria-expanded={locationOpen}
              onClick={() => setLocationOpen((value) => !value)}
            >
              {locationOpen ? t('taskForm.keepLocation') : t('taskForm.changeLocation')}
            </button>
          </div>
          {/* The location editors exist only while the section is explicitly expanded. */}
          {locationOpen ? locationFields : <p className="muted small">{t('taskForm.keepLocationHint')}</p>}
        </section>

        <div className="field">
          <span className="field-label">
            {t('tasks.name')} <RequiredTag />
          </span>
          <TextInput
            id="task-name-field"
            value={form.taskName}
            onChange={(value) => set('taskName', value)}
            required
            ariaLabel={t('tasks.name')}
          />
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('schedule.start')}</span>
            <TextInput
              type="date"
              value={form.plannedStart}
              onChange={(value) => set('plannedStart', value)}
              ariaLabel={t('schedule.start')}
            />
          </label>
          <div className="field">
          <span className="field-label">
            {t('schedule.finish')} <RequiredTag />
          </span>
          <TextInput
            type="date"
            value={form.deadline}
            onChange={(value) => set('deadline', value)}
            required
            ariaLabel={t('schedule.finish')}
          />
          </div>
        </div>
        <p className="muted small">{t('schedule.explanation')}</p>
        {deadlineChanged ? <div className="banner warning">{t('tasks.deadlineChangedConfirm')}</div> : null}

        <section className="stack">
          <h3>{t('assignee.heading')}</h3>
          <p className="muted small">{t('taskForm.assigneeHint')}</p>
          <AssigneePicker
            members={references?.members ?? []}
            selectedIds={assigneeIds}
            onChange={setAssigneeIds}
            disabled={save.state === 'saving'}
          />
        </section>

        <label className="field">
          <span className="field-label">{t('projects.description')}</span>
          <textarea
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            rows={2}
          />
        </label>

        <details className="advanced-actions">
          <summary>{t('form.optionalSection')}</summary>
          <p className="muted small">{t('form.optionalHint')}</p>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('projects.priority')}</span>
              <SelectInput
                value={form.priority}
                onChange={(value) => set('priority', value as Task['priority'])}
                options={PRIORITIES.map((value) => ({ value, label: label('priority', value) }))}
              />
            </label>
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
        </details>

        <p className="muted small">{t('tasks.noDurationNote')}</p>
        <BlockedReasons reasons={blocked} />
        <SaveState state={save.state} />
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
