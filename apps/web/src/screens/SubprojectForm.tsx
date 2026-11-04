/** One revision-checked form for a project's nested subprojects. */
import { useState } from 'react';
import type { Subproject } from '@eh/contracts';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { TextInput, SelectInput, useIdempotencyKey, useSave } from '../components/forms';
import { ErrorBox, Modal, SaveState } from '../components/ui';
export function SubprojectForm({ projectId, item, initialParentSubprojectId, siblings, members, onClose, onSaved }: {
  projectId: string; item?: Subproject; initialParentSubprojectId?: string | null; siblings: Subproject[]; members: { memberId: string; name: string }[];
  onClose: () => void; onSaved: () => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const save = useSave(); const idempotencyKey = useIdempotencyKey();
  const [name, setName] = useState(item?.subprojectName ?? '');
  const [parent, setParent] = useState(item?.parentSubprojectId ?? initialParentSubprojectId ?? '');
  const [owner, setOwner] = useState(item?.ownerId ?? '');
  const [status, setStatus] = useState(item?.status ?? 'Planned');
  const [deadline, setDeadline] = useState(item?.deadline ?? '');
  const [start, setStart] = useState(item?.plannedStart ?? '');
  const [end, setEnd] = useState(item?.plannedEnd ?? '');
  const [hours, setHours] = useState(item?.estimatedHours === null || item?.estimatedHours === undefined ? '' : String(item.estimatedHours));
  const [next, setNext] = useState(item?.nextAction ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const excluded = new Set(item ? [item.subprojectId] : []);
  for (let depth = 0; depth < siblings.length; depth++) {
    for (const candidate of siblings) if (candidate.parentSubprojectId && excluded.has(candidate.parentSubprojectId)) excluded.add(candidate.subprojectId);
  }
  const parents = siblings.filter(s => !excluded.has(s.subprojectId) && s.depth < 4 && s.status !== 'Archived');
  const changedDeadline = !!item && (item.deadline ?? '') !== deadline;
  return <Modal title={t(item ? 'subprojects.edit' : 'subprojects.new')} onClose={onClose} footer={<>
    <button className="button secondary" type="button" onClick={onClose}>{t('action.cancel')}</button>
    <button className="button" type="button" disabled={!name.trim() || save.state === 'saving' || (changedDeadline && !confirmed)} onClick={() => void save.run(async () => {
      const payload = { subprojectName: name.trim(), parentSubprojectId: parent || null, ownerId: owner || null, status,
        deadline: deadline || null, plannedStart: start || null, plannedEnd: end || null, estimatedHours: hours === '' ? null : Number(hours), nextAction: next };
      return item ? api.patch('/api/manager/subprojects/' + item.subprojectId, { ...payload, revision: item.revision, confirmDeadlineChange: confirmed })
        : api.post('/api/manager/subprojects', { ...payload, projectId, idempotencyKey });
    }, { onSuccess: onSaved })}>{t(item ? 'action.save' : 'action.create')}</button>
  </>}>
    <div className="stack">
      <label className="field"><span className="field-label">{t('subprojects.name')}</span><TextInput value={name} onChange={setName} required /></label>
      <label className="field"><span className="field-label">{t('subprojects.parent')}</span><SelectInput value={parent} onChange={setParent} allowEmpty={t('common.none')} options={parents.map(s => ({ value: s.subprojectId, label: s.subprojectName }))} /></label>
      <label className="field"><span className="field-label">{t('projects.owner')}</span><SelectInput value={owner} onChange={setOwner} allowEmpty={t('common.unset')} options={members.map(m => ({ value: m.memberId, label: m.name }))} /></label>
      <label className="field"><span className="field-label">{t('projects.status')}</span><SelectInput value={status} onChange={value => setStatus(value as Subproject['status'])} options={['Planned','Active','On Hold','Completed','Cancelled','Archived'].map(value => ({ value, label: label('project.status', value) }))} /></label>
      <div className="field-row">
        <label className="field"><span className="field-label">{t('projects.plannedStart')}</span><TextInput type="date" value={start} onChange={setStart} /></label>
        <label className="field"><span className="field-label">{t('projects.forecast')}</span><TextInput type="date" value={end} onChange={setEnd} /></label>
      </div>
      <label className="field"><span className="field-label">{t('tasks.deadline')}</span><TextInput type="date" value={deadline} onChange={setDeadline} /></label>
      {changedDeadline && <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t('tasks.deadlineConfirmed')}</label>}
      <label className="field"><span className="field-label">{t('tasks.estimate')}</span><TextInput type="number" min={0} value={hours} onChange={setHours} /></label>
      <label className="field"><span className="field-label">{t('projects.nextAction')}</span><TextInput value={next} onChange={setNext} /></label>
      <SaveState state={save.state} /><ErrorBox error={save.error} />
    </div>
  </Modal>;
}
