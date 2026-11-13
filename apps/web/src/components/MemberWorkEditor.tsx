import type { Subproject, Task, TaskDetail, Reference } from '@eh/contracts';
import { api } from '../api/client';
import { queryCache } from '../state/cache';
import { useEffect, useState } from 'react';
import { ErrorBox, Modal } from './ui';
import { useI18n } from '../i18n';
import { TaskForm } from '../screens/TaskForm';
import { SubprojectForm } from '../screens/SubprojectForm';

type References = { members: { memberId: string; name: string; active: boolean; workDivisionIds: string[] }[]; skills: { skillId: string; skillName: string }[]; subprojects: Reference[] };

/** Mounted only while the editor is open; late reads cannot reopen a dismissed editor. */
export function MemberWorkEditor({ kind, id, projectId, onClose, onSaved }: {
  kind: 'tasks' | 'subprojects'; id: string; projectId: string; onClose: () => void; onSaved: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ record: TaskDetail | { record: Subproject }; references: References }>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let current = true;
    const epoch = queryCache.sessionEpoch;
    setData(undefined); setError(undefined);
    void Promise.all([api.get<TaskDetail | { record: Subproject }>(`/api/work/editor/${kind}/${id}`), api.get<References>(`/api/work/editor/references?projectId=${encodeURIComponent(projectId)}`)])
      .then(([record, references]) => { if (current && epoch === queryCache.sessionEpoch) setData({ record, references }); })
      .catch(value => { if (current && epoch === queryCache.sessionEpoch) setError(value); });
    return () => { current = false; };
  }, [kind, id, projectId, attempt]);
  const record = { data: data?.record, error };
  const references = { data: data?.references, error };
  if (!record.data || !references.data || record.error || references.error) return <Modal title={t('action.edit')} onClose={onClose}>
    {record.error || references.error ? <ErrorBox error={record.error || references.error} onRetry={() => { setAttempt(value => value + 1); }} /> : <p>{t('state.loading')}</p>}
  </Modal>;
  return kind === 'tasks'
    ? <TaskForm memberEdit task={record.data.record as Task} detail={record.data as TaskDetail} references={references.data} onClose={onClose} onSaved={onSaved} />
    : <SubprojectForm memberEdit projectId={projectId} item={record.data.record as Subproject} members={references.data.members} onClose={onClose} onSaved={onSaved} />;
}
