/**
 * Deadline presentation.
 *
 * A deadline is its own labelled region (納期 / Deadline) instead of a fragment inside a muted
 * metadata paragraph, so the date stays scannable in a long list. The tone is presentation only:
 * it comes from the authoritative display state and the Asia/Tokyo business date, and it never
 * changes a stored date. Overdue is red, due today is amber, an ordinary future deadline keeps
 * readable body text - a deadline is never red just because it exists.
 *
 * The lifecycle state is a required prop. A caller that already holds a task or a project cannot
 * silently omit it and let this component guess from the date alone - that guess is exactly how a
 * completed task ends up painted as overdue. `deadlineStateOf` is the one mapping from the
 * server-derived project schedule state to a deadline state.
 */
import type { DisplayTaskStatus, ProjectScheduleDisplay } from '@eh/contracts';
import { businessDate } from '@eh/domain';
import { useI18n } from '../i18n';
import { Badge } from './ui';

export type DeadlineState = DisplayTaskStatus | 'ARCHIVED';
export type DeadlineTone = 'overdue' | 'today' | 'open' | 'done' | 'cancelled' | 'none';

/** One mapping from a derived project schedule state to a deadline state. */
export function deadlineStateOf(schedule: ProjectScheduleDisplay | undefined): DeadlineState {
  switch (schedule?.state) {
    case 'COMPLETED':
      return 'DONE';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'ARCHIVED':
      return 'ARCHIVED';
    case 'LATE':
      return 'OVERDUE';
    default:
      return 'IN_PROGRESS';
  }
}

/**
 * Precedence: done wins over overdue, cancelled and archived work is never current, otherwise the
 * authoritative state decides. An unusable interval is a warning, never a red "overdue" badge, and
 * a state that is not overdue only ever uses the calendar for the due-today hint. The primary
 * schedule badge always stays authoritative: this hint never renames it.
 */
export function deadlineTone(
  dueDate: string | null | undefined,
  state: DeadlineState,
  today: string = businessDate()
): DeadlineTone {
  if (state === 'DONE') return 'done';
  if (state === 'CANCELLED' || state === 'ARCHIVED') return 'cancelled';
  if (!dueDate) return 'none';
  if (state === 'OVERDUE') return 'overdue';
  if (state === 'INVALID_DATES') return 'open';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'open';
}

/** A completion that happened after its own deadline is stated separately, never as overdue. */
export function isCompletedLate(
  dueDate: string | null | undefined,
  completedOn: string | null | undefined
): boolean {
  if (!dueDate || !completedOn) return false;
  return completedOn.slice(0, 10) > dueDate;
}

/**
 * One deadline value with its unit label and, only when it matters, a state badge.
 *
 * `size="large"` is for a header (タスク詳細) and stays at the row size everywhere else, so a
 * compact list is never forced to grow.
 */
export function DeadlineCell({
  dueDate,
  state,
  completedOn,
  showLabel = true,
  showStateBadge = showLabel,
  size = 'normal'
}: {
  dueDate: string | null | undefined;
  /** The server-derived display state; never inferred by this component alone. */
  state: DeadlineState;
  /** The recorded completion date, used only for the separate "completed late" label. */
  completedOn?: string | null;
  showLabel?: boolean;
  /**
   * Whether this region states the overdue state itself. A compact deadline column
   * (`showLabel={false}`) sits beside the schedule badge and never repeats it, so the default
   * follows `showLabel`; a row that shows the badge elsewhere passes `false` explicitly. The
   * due-today hint and the separate "completed late" label are independent of this prop.
   */
  showStateBadge?: boolean;
  size?: 'normal' | 'large';
}): JSX.Element {
  const { t } = useI18n();
  const tone = deadlineTone(dueDate, state);
  const late = state === 'DONE' && isCompletedLate(dueDate, completedOn);
  return (
    <span className={`deadline deadline-${tone} deadline-size-${size}`}>
      {showLabel ? <span className="deadline-label">{t('deadline.label')}</span> : null}
      <span className="deadline-value">{dueDate ?? t('common.unset')}</span>
      {tone === 'overdue' && showStateBadge ? <Badge tone="danger">{t('taskStatus.OVERDUE')}</Badge> : null}
      {tone === 'today' ? <Badge tone="warn">{t('deadline.todayBadge')}</Badge> : null}
      {late ? <Badge tone="neutral">{t('deadline.completedLate')}</Badge> : null}
    </span>
  );
}

/** A stored date with no lifecycle meaning of its own (a plan value, a history timestamp). */
export function DateValue({ value }: { value: string | null | undefined }): JSX.Element {
  const { t } = useI18n();
  return <span className="date-value">{value ?? t('common.unset')}</span>;
}
