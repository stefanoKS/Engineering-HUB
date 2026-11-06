/**
 * Member project creation, as an accessible dialog.
 *
 * A MEMBER files a project immediately. The owner is the verified session, the lifecycle starts
 * `Active` and the visibility is `INTERNAL` on the server, so the form offers none of them. The
 * responsibility is required and must be active; the options come from the narrow member reference
 * endpoint, never from the manager bootstrap.
 */
import { useState } from 'react';
import type { MyWorkProjectFormOptions } from '@eh/contracts';
import { ApiFailure, api } from '../api/client';
import { useI18n } from '../i18n';
import { ErrorBox, Modal } from './ui';
import { SelectInput, TextInput, createIdempotencyKey, useSave } from './forms';

export function MemberProjectForm({
  options,
  loading = false,
  onClose,
  onCreated
}: {
  options?: MyWorkProjectFormOptions;
  loading?: boolean;
  onClose: () => void;
  onCreated: (created: { projectId: string; projectName: string }) => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const save = useSave();
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [projectName, setProjectName] = useState('');
  const [responsibilityId, setResponsibilityId] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [plannedStart, setPlannedStart] = useState('');
  const [deadline, setDeadline] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const responsibilities = options?.responsibilities ?? [];
  const valid = projectName.trim().length > 0 && !!responsibilityId;
  const needsAcknowledgement = save.error instanceof ApiFailure && save.error.code === 'CONFIRMATION_REQUIRED';

  const submit = async (): Promise<void> => {
    if (!valid || save.state === 'saving') return;
    await save.run(
      () =>
        api.post<{ project: { projectId: string; projectName: string } }>('/api/employee/projects', {
          idempotencyKey,
          projectName: projectName.trim(),
          responsibilityId,
          description: description.trim() || undefined,
          priority,
          plannedStart: plannedStart || undefined,
          committedDeadline: deadline || undefined,
          acknowledgeNonWorking: acknowledged || undefined
        }),
      {
        onSuccess: (result) => {
          setIdempotencyKey(createIdempotencyKey());
          onCreated({ projectId: result.project.projectId, projectName: result.project.projectName });
        }
      }
    );
  };

  return (
    <Modal
      title={t('myWork.newProject')}
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
            {save.state === 'saving' ? t('state.saving') : t('myWork.createProject')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted small">{t('myWork.projectOwnerNote')}</p>
        {loading ? <p className="muted">{t('state.loading')}</p> : null}
        {!loading && responsibilities.length === 0 ? (
          <div className="banner warning">{t('myWork.responsibilitiesEmpty')}</div>
        ) : null}
        <label className="field">
          <span className="field-label">{t('projects.name')}</span>
          <TextInput value={projectName} onChange={setProjectName} required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{t('projects.responsibility')}</span>
          <SelectInput
            value={responsibilityId}
            onChange={setResponsibilityId}
            allowEmpty={t('common.unset')}
            options={responsibilities.map((entry) => ({
              value: entry.responsibilityId,
              label: entry.name
            }))}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('projects.description')}</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={5000}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('projects.priority')}</span>
            <SelectInput
              value={priority}
              onChange={setPriority}
              options={['Low', 'Medium', 'High', 'Critical'].map((value) => ({
                value,
                label: label('priority', value)
              }))}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('schedule.start')}</span>
            <TextInput type="date" value={plannedStart} onChange={setPlannedStart} />
          </label>
          <label className="field">
            <span className="field-label">{t('schedule.finish')}</span>
            <TextInput type="date" value={deadline} onChange={setDeadline} />
          </label>
        </div>
        <p className="muted small">{t('schedule.explanation')}</p>
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
