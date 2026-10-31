/** Skill catalogue and the manager-only assessment matrix. */
import { useState } from 'react';
import type { Actor, Skill, SkillAssessment } from '@eh/contracts';
import { api } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { EmptyState, ErrorBox, SaveState, Section } from '../components/ui';
import { SelectInput, TextInput, useSave } from '../components/forms';

type References = { members: { memberId: string; name: string }[] };

export function SkillsScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  void actor;
  const data = useQuery<{ items: Skill[]; assessments: SkillAssessment[] }>(keys.skills, () =>
    api.get<{ items: Skill[]; assessments: SkillAssessment[] }>('/api/manager/skills')
  );
  const references = useQuery<References>(keys.references, () => api.get<References>('/api/manager/references'));
  const [creating, setCreating] = useState(false);
  const [assessing, setAssessing] = useState(false);

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.skills')}</h2>
        <div className="filters">
          <button type="button" className="button" onClick={() => setCreating(true)}>
            {t('skills.new')}
          </button>
          <button type="button" className="button secondary" onClick={() => setAssessing(true)}>
            {t('skills.assess')}
          </button>
        </div>
      </div>
      <ErrorBox error={data.error} onRetry={() => data.refresh()} />
      <Section title={t('nav.skills')}>
        {!data.data ? (
          <p className="muted">{t('state.loading')}</p>
        ) : data.data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('column.name')}</th>
                <th>{t('projects.category')}</th>
                <th>{t('skills.level')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.items.map((skill) => (
                <tr key={skill.skillId}>
                  <td>{skill.skillName}</td>
                  <td>{skill.category || t('common.unset')}</td>
                  <td>{skill.requiredLevel ?? t('common.unset')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={t('skills.assess')}>
        {!data.data ? null : data.data.assessments.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('members.name')}</th>
                <th>{t('nav.skills')}</th>
                <th>{t('skills.level')}</th>
                <th>{t('skills.evidence')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.assessments.map((assessment) => (
                <tr key={assessment.memberSkillId}>
                  <td>{assessment.memberName}</td>
                  <td>{assessment.skillName}</td>
                  <td>{assessment.currentLevel}</td>
                  <td className="muted small">{assessment.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {creating ? (
        <SkillForm onClose={() => setCreating(false)} onSaved={() => setCreating(false)} />
      ) : null}
      {assessing ? (
        <AssessmentForm
          members={references.data?.members ?? []}
          skills={data.data?.items ?? []}
          onClose={() => setAssessing(false)}
          onSaved={() => setAssessing(false)}
        />
      ) : null}
    </div>
  );
}

function SkillForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): JSX.Element {
  const { t } = useI18n();
  const save = useSave();
  const [skillName, setSkillName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [requiredLevel, setRequiredLevel] = useState('');
  return (
    <div className="modal-screen" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <header className="modal-header">
          <h2>{t('skills.new')}</h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t('action.cancel')}
          </button>
        </header>
        <div className="modal-body stack">
          <label className="field">
            <span className="field-label">{t('column.name')}</span>
            <TextInput value={skillName} onChange={setSkillName} required />
          </label>
          <label className="field">
            <span className="field-label">{t('projects.category')}</span>
            <TextInput value={category} onChange={setCategory} />
          </label>
          <label className="field">
            <span className="field-label">{t('projects.description')}</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
          </label>
          <label className="field">
            <span className="field-label">{t('skills.level')}</span>
            <TextInput type="number" min={0} max={4} value={requiredLevel} onChange={setRequiredLevel} />
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
              disabled={!skillName || save.state === 'saving'}
              onClick={() =>
                void save.run(
                  () =>
                    api.post('/api/manager/skills', {
                      skillName,
                      category,
                      description,
                      requiredLevel: requiredLevel === '' ? null : Number(requiredLevel)
                    }),
                  {
                    onSuccess: () => {
                      queryCache.invalidate([keys.skills, keys.references]);
                      onSaved();
                    }
                  }
                )
              }
            >
              {t('action.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssessmentForm({
  members,
  skills,
  onClose,
  onSaved
}: {
  members: { memberId: string; name: string }[];
  skills: Skill[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const save = useSave();
  const [memberId, setMemberId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [level, setLevel] = useState('1');
  const [evidence, setEvidence] = useState('');
  const [trainingAction, setTrainingAction] = useState('');
  return (
    <div className="modal-screen" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <header className="modal-header">
          <h2>{t('skills.assess')}</h2>
          <button type="button" className="link-button" onClick={onClose}>
            {t('action.cancel')}
          </button>
        </header>
        <div className="modal-body stack">
          <label className="field">
            <span className="field-label">{t('members.name')}</span>
            <SelectInput
              value={memberId}
              onChange={setMemberId}
              allowEmpty={t('common.unset')}
              options={members.map((member) => ({ value: member.memberId, label: member.name }))}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('nav.skills')}</span>
            <SelectInput
              value={skillId}
              onChange={setSkillId}
              allowEmpty={t('common.unset')}
              options={skills.map((skill) => ({ value: skill.skillId, label: skill.skillName }))}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('skills.level')}</span>
            <TextInput type="number" min={0} max={4} value={level} onChange={setLevel} />
          </label>
          <label className="field">
            <span className="field-label">{t('skills.evidence')}</span>
            <textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} rows={2} />
          </label>
          <label className="field">
            <span className="field-label">{t('projects.nextAction')}</span>
            <TextInput value={trainingAction} onChange={setTrainingAction} />
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
              disabled={!memberId || !skillId || save.state === 'saving'}
              onClick={() =>
                void save.run(
                  () =>
                    api.post('/api/manager/skills/assess', {
                      memberId,
                      skillId,
                      currentLevel: Number(level),
                      evidence,
                      trainingAction
                    }),
                  {
                    onSuccess: () => {
                      queryCache.invalidate([keys.skills]);
                      onSaved();
                    }
                  }
                )
              }
            >
              {t('action.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
