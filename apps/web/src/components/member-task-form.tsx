/**
 * Member task creation, as an accessible dialog.
 *
 * The owner, the status, the progress and the hierarchy parent are decided by the server, so this
 * form never offers them. It is the same dialog from My Assigned Work (choose the project and the
 * subproject) and from a project or subproject folder (the destination is fixed and displayed).
 * A non-working deadline is never moved automatically: the server asks for an explicit
 * acknowledgement and the dialog keeps the draft while it is given.
 */
import { useMemo, useState } from 'react';
import type { MyWorkProjectOptions } from '@eh/contracts';
import { ApiFailure, api } from '../api/client';
import { useI18n } from '../i18n';
import { ErrorBox, Modal } from './ui';
import { SelectInput, TextInput, useSave } from './forms';
import { createIdempotencyKey } from './forms';
import { subprojectPath } from './hierarchy';

export type MemberTaskDestination = {
  projectId: string;
  /** Present when the dialog was opened from a subproject folder. */
  subprojectId?: string | null;
  projectName: string;
  subprojectName?: string;
};

export function MemberTaskForm({
  projects,
  loading = false,
  initialProjectId = '',
  initialSubprojectId = '',
  destination,
  onClose,
  onCreated
}: {
  projects: MyWorkProjectOptions['items'];
  loading?: boolean;
  initialProjectId?: string;
  initialSubprojectId?: string;
  /** A fixed, already validated destination; the selectors are then read-only context. */
  destination?: MemberTaskDestination;
  onClose: () => void;
  onCreated: (created: { taskId: string; projectId: string }) => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const save = useSave();
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [projectId, setProjectId] = useState(destination?.projectId ?? initialProjectId);
  const [subprojectId, setSubprojectId] = useState(destination?.subprojectId ?? initialSubprojectId ?? '');
  const [taskName, setTaskName] = useState('');
  const [description, setDescription] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [acknowledged, setAcknowledged] = useState(false);

  const current = useMemo(() => projects.find((entry) => entry.projectId === projectId), [projects, projectId]);
  const subprojects = current?.subprojects ?? [];
  const valid =
    !!projectId && taskName.trim().length > 0 && !!deadline && (!plannedStart || plannedStart <= deadline);
  const needsAcknowledgement =
    save.error instanceof ApiFailure && save.error.code === 'CONFIRMATION_REQUIRED';
  const destinationLabel = destination
    ? `${destination.projectName}${destination.subprojectName ? ` / ${destination.subprojectName}` : ''}`
    : '';

  const submit = async (): Promise<void> => {
    if (!valid || save.state === 'saving') return;
    await save.run(
      () =>
        api.post<{ taskId: string }>('/api/employee/my-work', {
          idempotencyKey,
          projectId,
          subprojectId: subprojectId || null,
          taskName: taskName.trim(),
          description: description.trim() || undefined,
          plannedStart: plannedStart || undefined,
          deadline,
          priority,
          acknowledgeNonWorking: acknowledged || undefined
        }),
      {
        onSuccess: (result) => {
          setIdempotencyKey(createIdempotencyKey());
          onCreated({ taskId: result.taskId, projectId });
        }
      }
    );
  };

  return (
    <Modal
      title={t('myWork.newTask')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={save.state === 'saving'}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!valid || save.state === 'saving' || (needsAcknowledgement && !acknowledged)}
            onClick={() => void submit()}
          >
            {save.state === 'saving' ? t('state.saving') : t('myWork.create')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted small">{t('myWork.ownerNote')}</p>
        {loading ? <p className="muted">{t('myWork.projectsLoading')}</p> : null}
        {!loading && !destination && projects.length === 0 ? (
          <div className="banner warning">{t('myWork.projectsEmpty')}</div>
        ) : null}

        {destination ? (
          <p className="location-path" aria-live="polite">
            {t('myWork.destination')}: {destinationLabel}
          </p>
        ) : (
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('myWork.project')}</span>
              <SelectInput
                value={projectId}
                onChange={(value) => {
                  setProjectId(value);
                  setSubprojectId('');
                }}
                allowEmpty={t('common.unset')}
                options={projects.map((entry) => ({
                  value: entry.projectId,
                  label: entry.responsibilityName
                    ? entry.projectName + ' / ' + entry.responsibilityName
                    : entry.projectName
                }))}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('myWork.subproject')}</span>
              <SelectInput
                value={subprojectId}
                onChange={setSubprojectId}
                allowEmpty={t('myWork.subprojectNone')}
                options={subprojects.map((entry) => ({
                  value: entry.subprojectId,
                  label: subprojectPath(subprojects, entry.subprojectId)
                }))}
              />
            </label>
          </div>
        )}

        <label className="field">
          <span className="field-label">{t('myWork.taskName')}</span>
          <TextInput value={taskName} onChange={setTaskName} required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{t('myWork.description')}</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('schedule.start')}</span>
            <TextInput type="date" value={plannedStart} onChange={setPlannedStart} />
          </label>
          <label className="field">
            <span className="field-label">{t('schedule.finish')}</span>
            <TextInput type="date" value={deadline} onChange={setDeadline} required />
          </label>
          <label className="field">
            <span className="field-label">{t('myWork.priority')}</span>
            <SelectInput
              value={priority}
              onChange={setPriority}
              options={['Low', 'Medium', 'High', 'Critical'].map((value) => ({
                value,
                label: label('priority', value)
              }))}
            />
          </label>
        </div>
        <p className="muted small">{t('schedule.explanation')}</p>
        <p className="muted small">{t('tasks.noDurationNote')}</p>

        {needsAcknowledgement ? (
          <div className="banner warning">
            <p>{t('myWork.dueSoonWarning')}</p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              {t('myWork.acknowledge')}
            </label>
          </div>
        ) : (
          <ErrorBox error={save.error} />
        )}
      </div>
    </Modal>
  );
}
