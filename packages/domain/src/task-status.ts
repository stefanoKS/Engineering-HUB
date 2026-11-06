/**
 * Derived, user-facing task schedule status.
 *
 * One calculation serves every screen, report and published aggregate: the stored workflow status
 * decides only the two terminal states (Done, Cancelled), and the plan dates plus the Asia/Tokyo
 * business date decide everything else. `OVERDUE` is never persisted - it is recomputed from the
 * schedule, so no scheduled job is required and no row is rewritten at midnight. Legacy stored
 * values (Blocked, On Hold, Assigned, Not Started, In Progress) keep their historical meaning in
 * the stored row, the workflow history and a secondary detail label; they are never presented as
 * the primary schedule state.
 *
 * Precedence: done, cancelled, an unusable interval, late, planned, in progress, start not set and
 * finally no dates at all. A Finish is inclusive - work is not late during its own finish day -
 * and a missing date is stated as missing instead of being invented.
 */
import { DisplayTaskStatus } from '@eh/contracts';
import type { ScheduleMissingPart } from '@eh/contracts';
import { businessDate } from './time';

/** Every displayed schedule state, taken from the one contract definition. */
export const DISPLAY_TASK_STATUSES = DisplayTaskStatus.options;

export type TaskStatusSource = {
  status: string;
  /** The canonical plan start; `null` means the schedule does not state one. */
  plannedStart: string | null;
  /** The Finish/deadline. `null` means the schedule does not state one. */
  dueDate: string | null;
};

export type TaskScheduleDisplay = {
  state: DisplayTaskStatus;
  /** Which plan boundary the state had to call out; `NONE` when both are usable or terminal. */
  missing: ScheduleMissingPart;
};

/**
 * The one task display-status calculation.
 *
 * `missing` is a detail that coexists with the state: an in-progress task without a Finish still
 * reads as in progress *and* says "Finish not set". The overdue predicate used for counting
 * (`dueDate < today`) stays unchanged and independent of this display precedence, so an unusable
 * interval is warned about without hiding the existing deadline accounting.
 */
export function taskScheduleStatus(
  task: TaskStatusSource,
  today: string = businessDate()
): TaskScheduleDisplay {
  if (task.status === 'Done') return { state: 'DONE', missing: 'NONE' };
  if (task.status === 'Cancelled') return { state: 'CANCELLED', missing: 'NONE' };

  const start = task.plannedStart ?? null;
  const finish = task.dueDate ?? null;
  if (start && finish && start > finish) return { state: 'INVALID_DATES', missing: 'NONE' };
  if (finish && finish < today) return { state: 'OVERDUE', missing: start ? 'NONE' : 'START' };
  if (start && today < start) return { state: 'PLANNED', missing: finish ? 'NONE' : 'FINISH' };
  if (start) return { state: 'IN_PROGRESS', missing: finish ? 'NONE' : 'FINISH' };
  if (finish) return { state: 'START_NOT_SET', missing: 'START' };
  return { state: 'DATES_NOT_SET', missing: 'BOTH' };
}

/** The primary schedule state alone, for a caller with no room for the detail. */
export function displayTaskStatus(
  task: TaskStatusSource,
  today: string = businessDate()
): DisplayTaskStatus {
  return taskScheduleStatus(task, today).state;
}

/**
 * Display states that can still be open work.
 *
 * Planned and undated work is open work: "open" is never a synonym for "currently in progress".
 */
export function isActiveDisplayStatus(status: DisplayTaskStatus): boolean {
  return status !== 'DONE' && status !== 'CANCELLED';
}

/** The single current-overdue display state, so a filter and a badge cannot disagree. */
export function isOverdueDisplayStatus(status: DisplayTaskStatus): boolean {
  return status === 'OVERDUE';
}
