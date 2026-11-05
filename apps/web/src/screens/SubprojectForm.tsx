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
import { subprojectPath } from '../components/hierarchy';

export function SubprojectForm({
  projectId,
  projectName,
  item,
  initialParentSubprojectId,
  siblings,
  members,
  onClose,
  onSaved
}: {
  projectId: string;
  /** Display-only project name, so the form shows where the record is filed. */
  projectName?: string;
  item?: Subproject;
  initialParentSubprojectId?: string | null;
  siblings: Subproject[];
  members: { memberId: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const save = useSave();
  const idempotencyKey = useIdempotencyKey();
  const [name, setName] = useState(item?.subprojectName ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [parent, setParent] = useState(item?.parentSubprojectId ?? initialParentSubprojectId ?? '');
  const [owner, setOwner] = useState(item?.ownerId ?? '');
  const [status, setStatus] = useState(item?.status ?? 'Planned');
  const [deadline, setDeadline] = useState(item?.deadline ?? '');
  const [start, setStart] = useState(item?.plannedStart ?? '');
  const [end, setEnd] = useState(item?.plannedEnd ?? '');
  const [hours, setHours] = useState(
    item?.estimatedHours === null || item?.estimatedHours === undefined ? '' : String(item.estimatedHours)
  );
  const [next, setNext] = useState(item?.nextAction ?? '');
  const [confirmed, setConfirmed] = useState(false);
  // The location is readable at a glance; its editors appear only when the manager asks for them.
  const [locationOpen, setLocationOpen] = useState(false);

  const excluded = new Set(item ? [item.subprojectId] : []);
  for (let depth = 0; depth < siblings.length; depth++) {
    for (const candidate of siblings) {
      if (candidate.parentSubprojectId && excluded.has(candidate.parentSubprojectId)) {
        excluded.add(candidate.subprojectId);
      }
    }
  }
  const parents = siblings.filter(
    (entry) => !excluded.has(entry.subprojectId) && entry.depth < 4 && entry.status !== 'Archived'
  );
  const changedDeadline = !!item && (item.deadline ?? '') !== deadline;

  const locationPath = [
    projectName ?? projectId,
    parent ? subprojectPath(siblings, parent) : ''
  ]
    .filter(Boolean)
    .join(' / ');

  const patch = (): Record<string, unknown> => {
    if (!item) {
      return {
        subprojectName: name.trim(),
        description,
        parentSubprojectId: parent || null,
        ownerId: owner || null,
        status,
        deadline: deadline || null,
        plannedStart: start || null,
        plannedEnd: end || null,
        estimatedHours: hours === '' ? null : Number(hours),
        nextAction: next
      };
    }
    const body: Record<string, unknown> = { revision: item.revision };
    if (name.trim() !== item.subprojectName) body.subprojectName = name.trim();
    if (description !== (item.description ?? '')) body.description = description;
    if ((parent || null) !== (item.parentSubprojectId ?? null)) body.parentSubprojectId = parent || null;
    if ((owner || null) !== (item.ownerId ?? null)) body.ownerId = owner || null;
    if (status !== item.status) body.status = status;
    if (changedDeadline) {
      body.deadline = deadline || null;
      body.confirmDeadlineChange = confirmed;
    }
    if ((start || null) !== (item.plannedStart ?? null)) body.plannedStart = start || null;
    if ((end || null) !== (item.plannedEnd ?? null)) body.plannedEnd = end || null;
    const nextHours = hours === '' ? null : Number(hours);
    if (nextHours !== (item.estimatedHours ?? null)) body.estimatedHours = nextHours;
    if (next !== (item.nextAction ?? '')) body.nextAction = next;
    return body;
  };

  const pending = patch();
  const nothingToSave = !!item && Object.keys(pending).length === 1;

  const blocked: string[] = [];
  if (!name.trim()) blocked.push(t('subForm.nameRequired'));
  if (changedDeadline && !confirmed) blocked.push(t('tasks.deadlineChangedConfirm'));
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
          {/* Opening or closing this section never changes the selected parent. */}
          {locationOpen ? (
            <label className="field">
              <span className="field-label">{t('subprojects.parent')}</span>
              <SearchSelect
                value={parent}
                onChange={setParent}
                allowEmpty={t('common.none')}
                searchLabel={t('action.search')}
                selectLabel={t('subprojects.parent')}
                options={parents.map((entry) => ({
                  value: entry.subprojectId,
                  label: subprojectPath(siblings, entry.subprojectId)
                }))}
              />
              <span className="field-hint">{t('subForm.parentHint')}</span>
            </label>
          ) : (
            <p className="muted small">{t('taskForm.keepLocationHint')}</p>
          )}
        </section>

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
          <span className="field-label">{t('tasks.deadline')}</span>
          <TextInput type="date" value={deadline} onChange={setDeadline} />
          <span className="field-hint">{t('projects.deadlineHint')}</span>
        </label>
        {changedDeadline ? (
          <label className="checkbox">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            {t('tasks.deadlineConfirmed')}
          </label>
        ) : null}

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
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t('projects.plannedStart')}</span>
              <TextInput type="date" value={start} onChange={setStart} />
            </label>
            <label className="field">
              <span className="field-label">{t('projects.forecast')}</span>
              <TextInput type="date" value={end} onChange={setEnd} />
              <span className="field-hint">{t('subForm.estimateHint')}</span>
            </label>
          </div>
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
