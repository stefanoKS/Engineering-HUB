/**
 * Member subproject creation form.
 *
 * A MEMBER files a subproject immediately: the owner is the verified session and the status is
 * `Active` on the server, so this form never offers an owner, a role or a status. The same form is
 * used from My Assigned Work (choose the project) and from a project the member may read (the
 * project is fixed), and both post to the restricted member endpoint.
 */
import { useMemo, useState } from 'react';
import { MAX_SUBPROJECT_DEPTH } from '@eh/domain';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { ErrorBox } from '../components/ui';
import { createIdempotencyKey, SearchSelect, SelectInput, TextInput, useSave } from './forms';
import { subprojectPath } from './hierarchy';

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

// Kept as a re-export so existing screens keep one shared path helper.
export { subprojectPath };

export function MemberSubprojectForm({
  projects,
  fixedProjectId,
  loading = false,
  onCreated
}: {
  projects: SubprojectProjectOption[];
  /** Set when the project is already known, so the project selector is not shown. */
  fixedProjectId?: string;
  loading?: boolean;
  onCreated: (created: { projectId: string; subprojectId: string; name: string }) => void;
}): JSX.Element {
  const { t } = useI18n();
  const save = useSave();
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [projectId, setProjectId] = useState(fixedProjectId ?? '');
  const [parentId, setParentId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [notice, setNotice] = useState('');

  const effectiveProjectId = fixedProjectId ?? projectId;
  const current = useMemo(
    () => projects.find((entry) => entry.projectId === effectiveProjectId),
    [projects, effectiveProjectId]
  );
  const subprojects = current?.subprojects ?? [];
  // A parent must still have room for one more level; the server re-validates the whole tree.
  const parents = subprojects.filter((entry) => entry.depth < MAX_SUBPROJECT_DEPTH);
  const valid = !!effectiveProjectId && name.trim().length > 0;

  return (
    <form
      className="stack member-subproject-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || save.state === 'saving') return;
        setNotice('');
        void save.run(
          () =>
            api.post<{ subproject: { subprojectId: string }; replayed: boolean }>('/api/employee/subprojects', {
              idempotencyKey,
              projectId: effectiveProjectId,
              parentSubprojectId: parentId || null,
              subprojectName: name.trim(),
              description: description.trim() || undefined,
              deadline: deadline || null
            }),
          {
            onSuccess: (result) => {
              setNotice(t('myWork.subprojectCreated'));
              setIdempotencyKey(createIdempotencyKey());
              onCreated({ projectId: effectiveProjectId, subprojectId: result.subproject.subprojectId, name: name.trim() });
              setName('');
              setDescription('');
              setDeadline('');
            }
          }
        );
      }}
    >
      <h3>{t('myWork.newSubproject')}</h3>
      <p className="muted small">{t('myWork.subprojectOwnerNote')}</p>
      {loading ? <p className="muted">{t('myWork.projectsLoading')}</p> : null}
      {!loading && projects.length === 0 ? <div className="banner warning">{t('myWork.projectsEmpty')}</div> : null}

      <div className="field-row">
        {fixedProjectId ? null : (
          <label className="field">
            <span className="field-label">{t('myWork.project')}</span>
            <SelectInput
              value={projectId}
              onChange={(value) => {
                setProjectId(value);
                setParentId('');
              }}
              allowEmpty={t('common.unset')}
              options={projects.map((entry) => ({
                value: entry.projectId,
                label: entry.responsibilityName ? entry.projectName + ' / ' + entry.responsibilityName : entry.projectName
              }))}
            />
          </label>
        )}
        <label className="field">
          <span className="field-label">{t('myWork.parentSubproject')}</span>
          <SearchSelect
            value={parentId}
            onChange={setParentId}
            allowEmpty={t('myWork.parentSubprojectNone')}
            searchLabel={t('action.search')}
            selectLabel={t('myWork.parentSubproject')}
            options={parents.map((entry) => ({
              value: entry.subprojectId,
              label: subprojectPath(subprojects, entry.subprojectId)
            }))}
          />
          <span className="field-hint">{t('subForm.parentHint')}</span>
        </label>
      </div>

      <label className="field">
        <span className="field-label">{t('myWork.subprojectName')}</span>
        <TextInput value={name} onChange={setName} required />
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
      {notice ? <div className="banner ok">{notice}</div> : null}

      <div className="inline-actions">
        <button type="submit" className="button" disabled={!valid || save.state === 'saving'}>
          {save.state === 'saving' ? t('state.saving') : t('myWork.createSubproject')}
        </button>
      </div>
    </form>
  );
}
