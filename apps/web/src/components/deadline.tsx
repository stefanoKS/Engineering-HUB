/**
 * Deadline presentation.
 *
 * A deadline is its own labelled region (納期 / Deadline) instead of a fragment inside a muted
 * metadata paragraph, so the date stays scannable in a long list. The tone is presentation only:
 * it comes from the server-side display state and the Asia/Tokyo business date, and it never
 * changes a stored date. Overdue is red, due today is amber, an ordinary future deadline keeps
 * readable body text - a deadline is never red just because it exists.
 */
import { businessDate } from '@eh/domain';
import { useI18n } from '../i18n';
import { Badge } from './ui';

export type DeadlineTone = 'overdue' | 'today' | 'open' | 'done' | 'cancelled' | 'none';

type ProjectDeadlineState = 'NONE' | 'OK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED';

function toneFromStatus(
  dueDate: string | null | undefined,
  displayStatus: string | undefined,
  today: string
): DeadlineTone {
  if (!dueDate) return displayStatus === 'DONE' ? 'done' : 'none';
  if (displayStatus === 'DONE') return 'done';
  if (displayStatus === 'CANCELLED') return 'cancelled';
  if (displayStatus === 'OVERDUE') return 'overdue';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'open';
}

function toneFromProject(
  dueDate: string | null | undefined,
  deadlineState: ProjectDeadlineState | undefined,
  today: string
): DeadlineTone {
  if (!dueDate || deadlineState === 'NONE') return 'none';
  if (deadlineState === 'COMPLETED') return 'done';
  if (deadlineState === 'OVERDUE') return 'overdue';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'open';
}

export function deadlineTone(
  dueDate: string | null | undefined,
  options: { displayStatus?: string; deadlineState?: ProjectDeadlineState; today?: string } = {}
): DeadlineTone {
  const today = options.today ?? businessDate();
  return options.deadlineState
    ? toneFromProject(dueDate, options.deadlineState, today)
    : toneFromStatus(dueDate, options.displayStatus, today);
}

/**
 * One deadline value with its unit label and, only when it matters, a state badge.
 *
 * `size="large"` is for a header (タスク詳細) and stays at the row size everywhere else, so a
 * compact list is never forced to grow.
 */
export function DeadlineCell({
  dueDate,
  displayStatus,
  deadlineState,
  showLabel = true,
  size = 'normal'
}: {
  dueDate: string | null | undefined;
  displayStatus?: string;
  deadlineState?: ProjectDeadlineState;
  showLabel?: boolean;
  size?: 'normal' | 'large';
}): JSX.Element {
  const { t } = useI18n();
  const tone = deadlineTone(dueDate, { displayStatus, deadlineState });
  return (
    <span className={`deadline deadline-${tone} deadline-size-${size}`}>
      {showLabel ? <span className="deadline-label">{t('deadline.label')}</span> : null}
      <span className="deadline-value">{dueDate ?? t('common.unset')}</span>
      {tone === 'overdue' ? <Badge tone="danger">{t('taskStatus.OVERDUE')}</Badge> : null}
      {tone === 'today' ? <Badge tone="warn">{t('deadline.todayBadge')}</Badge> : null}
    </span>
  );
}
