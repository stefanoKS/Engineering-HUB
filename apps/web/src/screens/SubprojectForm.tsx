/**
 * One revision-checked form for a project's nested subprojects.
 *
 * The routine fields are the name, the location, the owner and an optional deadline. Planning
 * values (planned dates, effort and the next action) sit in one expandable section, and the
 * deadline is never confused with the forecast end or with effort hours.
 */
import { useState } from 'react';
import type { Subproject } from '@eh/contracts';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import {
  BlockedReasons,
  RequiredTag,
  SearchSelect,
  SelectInput,
  TextInput,
  useIdempotencyKey,
  useSave
} from '../components/forms';
import { ErrorBox, Modal, SaveState } from '../components/ui';

export function SubprojectForm({
  projectId,
  projectName,
  item,
  members,
  onClose,
  onSaved
}: {
  projectId: string;
  /** Display-only project name, so the form shows where the record is filed. */
  projectName?: string;
  item?: Subproject;
  members: { memberId: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const save = useSave();
  const idempotencyKey = useIdempotencyKey();
  const [name, setName] = useState(item?.subprojectName ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [owner, setOwner] = useState(item?.ownerId ?? '');
  const [status, setStatus] = useState(item?.status ?? 'Planned');
  const [hours, setHours] = useState(
    item?.estimatedHours === null || item?.estimatedHours === undefined ? '' : String(item.estimatedHours)
  );
  const [next, setNext] = useState(item?.nextAction ?? '');

  const patch = (): Record<string, unknown> => {
    if (!item) {
      return {
        subprojectName: name.trim(),
        description,
        ownerId: owner || null,
        status,
        estimatedHours: hours === '' ? null : Number(hours),
        nextAction: next
      };
    }
    const body: Record<string, unknown> = { revision: item.revision };
    if (name.trim() !== item.subprojectName) body.subprojectName = name.trim();
    if (description !== (item.description ?? '')) body.description = description;
    if ((owner || null) !== (item.ownerId ?? null)) body.ownerId = owner || null;
    if (status !== item.status) body.status = status;
    const nextHours = hours === '' ? null : Number(hours);
    if (nextHours !== (item.estimatedHours ?? null)) body.estimatedHours = nextHours;
    if (next !== (item.nextAction ?? '')) body.nextAction = next;
    return body;
  };

  const pending = patch();
  const nothingToSave = !!item && Object.keys(pending).length === 1;

  const blocked: string[] = [];
  if (!name.trim()) blocked.push(t('subForm.nameRequired'));
  if (nothingToSave) blocked.push(t('form.noChanges'));

  return (
    <Modal
      title={t(item ? 'subprojects.edit' : 'subprojects.new')}
      onClose={onClose}
      footer={
        <>
          <button className="button secondary" type="button" onClick={onClose}>
            {t('action.cancel')}
          </button>
          <button
            className="button"
            type="button"
            disabled={save.state === 'saving' || blocked.length > 0}
            onClick={() =>
              void save.run(
                async () => {
                  if (item) {
                    return api.patch('/api/manager/subprojects/' + item.subprojectId, pending);
                  }
                  return api.post('/api/manager/subprojects', { ...pending, projectId, idempotencyKey });
                },
                { onSuccess: onSaved }
              )
            }
          >
            {t(item ? 'action.save' : 'action.create')}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <span className="field-label">
            {t('subprojects.name')} <RequiredTag />
          </span>
          <TextInput value={name} onChange={setName} required autoFocus ariaLabel={t('subprojects.name')} />
        </div>

        <p className="muted small">{projectName ?? projectId}</p>

        <label className="field">
          <span className="field-label">{t('projects.owner')}</span>
          <SearchSelect
            value={owner}
            onChange={setOwner}
            allowEmpty={t('common.unset')}
            searchLabel={t('action.search')}
            selectLabel={t('projects.owner')}
            options={members.map((member) => ({ value: member.memberId, label: member.name }))}
          />
        </label>

        <label className="field">
          <span className="field-label">{t('subprojects.description')}</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={2000}
          />
        </label>

        <details className="advanced-actions">
          <summary>{t('subForm.planning')}</summary>
          <p className="muted small">{t('subForm.planningHint')}</p>
          <label className="field">
            <span className="field-label">{t('projects.status')}</span>
            <SelectInput
              value={status}
              onChange={(value) => setStatus(value as Subproject['status'])}
              options={['Planned', 'Active', 'On Hold', 'Completed', 'Cancelled', 'Archived'].map((value) => ({
                value,
                label: label('project.status', value)
              }))}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('tasks.estimate')}</span>
            <TextInput type="number" min={0} value={hours} onChange={setHours} />
            <span className="field-hint">{t('subForm.estimateHint')}</span>
          </label>
          <label className="field">
            <span className="field-label">{t('projects.nextAction')}</span>
            <TextInput value={next} onChange={setNext} />
          </label>
        </details>

        <BlockedReasons reasons={blocked} />
        <SaveState state={save.state} />
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}
