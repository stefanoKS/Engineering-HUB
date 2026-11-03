/**
 * One unified assignee picker.
 *
 * It replaces the old "primary owner" + "additional assignees" pair with a single selection.
 * Identity is always the stable member ID; the lower panel is the effective assignment and the
 * upper panel is what remains selectable. Both panels keep a stable, name-sorted order, so
 * removing and re-adding somebody restores their original position.
 */
import { useMemo, useState } from 'react';
import { useI18n } from '../i18n';

export type AssignableMember = {
  memberId: string;
  name: string;
  active: boolean;
  employeeId?: string;
};

function sortMembers(members: AssignableMember[]): AssignableMember[] {
  return [...members].sort(
    (a, b) => a.name.localeCompare(b.name, 'ja') || a.memberId.localeCompare(b.memberId)
  );
}

export function AssigneePicker({
  members,
  selectedIds,
  onChange,
  disabled
}: {
  members: AssignableMember[];
  selectedIds: string[];
  onChange: (memberIds: string[]) => void;
  disabled?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const active = useMemo(
    () => sortMembers(members.filter((member) => member.active)),
    [members]
  );

  const matches = (member: AssignableMember): boolean => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return (
      member.name.toLowerCase().includes(needle) ||
      (member.employeeId ?? '').toLowerCase().includes(needle)
    );
  };

  const available = active.filter((member) => !selected.has(member.memberId) && matches(member));
  const chosen = active.filter((member) => selected.has(member.memberId));

  const add = (memberId: string): void => {
    if (selected.has(memberId)) return;
    onChange([...selectedIds, memberId]);
  };
  const remove = (memberId: string): void => {
    onChange(selectedIds.filter((id) => id !== memberId));
  };

  return (
    <div className="assignee-picker stack">
      <p className="muted small">{t('assignee.hint')}</p>
      <label className="field">
        <span className="field-label">{t('assignee.search')}</span>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          disabled={disabled}
        />
      </label>

      <section className="assignee-panel" aria-label={t('assignee.available')}>
        <h4>{t('assignee.available')}</h4>
        {available.length === 0 ? (
          <p className="muted small">{active.length === 0 ? t('common.unset') : t('assignee.none')}</p>
        ) : (
          <ul className="assignee-list" role="list">
            {available.map((member) => (
              <li key={member.memberId}>
                <button
                  type="button"
                  className="assignee-option"
                  onClick={() => add(member.memberId)}
                  disabled={disabled}
                  aria-label={`${t('assignee.available')}: ${member.name}`}
                >
                  <span className="assignee-name">{member.name}</span>
                  {member.employeeId ? <span className="muted small">{member.employeeId}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="assignee-panel" aria-label={t('assignee.selected')}>
        <h4>{t('assignee.selected')}</h4>
        {chosen.length === 0 ? (
          <p className="muted small">{t('assignee.empty')}</p>
        ) : (
          <ul className="chip-list" role="list">
            {chosen.map((member) => (
              <li key={member.memberId} className="chip">
                <span>{member.name}</span>
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => remove(member.memberId)}
                  disabled={disabled}
                  aria-label={t('assignee.remove', { name: member.name })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">{t('assignee.ownerNote')}</p>
      </section>
    </div>
  );
}
