/**
 * Member subproject creation, as an accessible dialog.
 *
 * A MEMBER files a subproject immediately: the owner is the verified session and the status is
 * `Active` on the server, so this form never offers an owner, a role or a status. Subprojects stay
 * flat for self-service creation - the server refuses a parent - so the form offers none. The same
 * dialog is used from My Assigned Work (choose the project) and from a project the member may read
 * (the project is fixed), and both post to the restricted member endpoint.
 */
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { ErrorBox, Modal } from './ui';
import { createIdempotencyKey, SelectInput, TextInput, useSave } from './forms';

// Kept as a re-export so existing screens keep one shared path helper.
export { subprojectPath } from './hierarchy';

export type SubprojectOption = {
  subprojectId: string;
  subprojectName: string;
  parentSubprojectId: string | null;
  depth: number;
};

export type SubprojectProjectOption = {
  projectId: string;
  projectName: string;
  responsibilityName: string;
  subprojects: SubprojectOption[];
};

export function MemberSubprojectForm({
  projects,
  fixedProjectId,
  loading = false,
  onClose,
  onCreated
}: {
  projects: SubprojectProjectOption[];
  /** Set when the project is already known, so the project selector is not shown. */
  fixedProjectId?: string;
  loading?: boolean;
  onClose: () => void;
  onCreated: (created: { projectId: string; subprojectId: string; name: string }) => void;
}): JSX.Element {
  const { t } = useI18n();
  const save = useSave();
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [projectId, setProjectId] = useState(fixedProjectId ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');

  const effectiveProjectId = fixedProjectId ?? projectId;
  const current = useMemo(
    () => projects.find((entry) => entry.projectId === effectiveProjectId),
    [projects, effectiveProjectId]
  );
  const valid = !!effectiveProjectId && name.trim().length > 0;
  const destination = current
    ? `${current.projectName}${current.responsibilityName ? ` / ${current.responsibilityName}` : ''}`
    : '';

  const submit = async (): Promise<void> => {
    if (!valid || save.state === 'saving') return;
    await save.run(
      () =>
        api.post<{ subproject: { subprojectId: string }; replayed: boolean }>('/api/employee/subprojects', {
          idempotencyKey,
          projectId: effectiveProjectId,
          subprojectName: name.trim(),
          description: description.trim() || undefined,
          deadline: deadline || null
        }),
      {
        onSuccess: (result) => {
          onCreated({ projectId: effectiveProjectId, subprojectId: result.subproject.subprojectId, name: name.trim() });
          // The next dialog starts a new operation, never a replay of this one.
          setIdempotencyKey(createIdempotencyKey());
        }
      }
    );
    // A failed save keeps the dialog and its unsent draft open for a correction or a retry.
  };

  return (
    <Modal
      title={t('myWork.newSubproject')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={save.state === 'saving'}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!valid || save.state === 'saving'}
            onClick={() => void submit()}
          >
            {save.state === 'saving' ? t('state.saving') : t('myWork.createSubproject')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted small">{t('myWork.subprojectOwnerNote')}</p>
        {loading ? <p className="muted">{t('myWork.projectsLoading')}</p> : null}
        {!loading && projects.length === 0 ? <div className="banner warning">{t('myWork.projectsEmpty')}</div> : null}
        {fixedProjectId ? (
          <p className="location-path" aria-live="polite">
            {t('myWork.destination')}: {destination || fixedProjectId}
          </p>
        ) : (
          <label className="field">
            <span className="field-label">{t('myWork.project')}</span>
            <SelectInput
              value={projectId}
              onChange={setProjectId}
              allowEmpty={t('common.unset')}
              options={projects.map((entry) => ({
                value: entry.projectId,
                label: entry.responsibilityName ? entry.projectName + ' / ' + entry.responsibilityName : entry.projectName
              }))}
            />
          </label>
        )}
        <label className="field">
          <span className="field-label">{t('myWork.subprojectName')}</span>
          <TextInput value={name} onChange={setName} required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{t('subprojects.description')}</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} />
        </label>
        <label className="field">
          <span className="field-label">{t('myWork.deadlineOptional')}</span>
          <TextInput type="date" value={deadline} onChange={setDeadline} />
        </label>
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
