/** One collapsible sort control, shared by the project and task tables. */
import { useI18n } from '../i18n';

export function SortHeader<K extends string>({
  label,
  sortKey,
  current,
  direction,
  onSort
}: {
  label: string;
  sortKey: K;
  current: K;
  direction: 'asc' | 'desc';
  onSort: (next: K) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="table-sort"
      onClick={() => onSort(sortKey)}
      aria-label={`${label}: ${t('workload.sort.toggle')}`}
    >
      {label} {current === sortKey ? <span aria-hidden="true">{direction === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  );
}
