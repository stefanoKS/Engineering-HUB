/**
 * Derived, user-facing project schedule status.
 *
 * The stored `projects.status` value is a lifecycle fact (an explicit archive, cancellation or
 * completion decision and its history). Everyday progress is not stored and not rewritten at
 * midnight: the displayed schedule badge is calculated from the plan dates and the Asia/Tokyo
 * business date, so no scheduled job exists and no audit row is produced by the passage of time.
 *
 * Precedence is: archived, cancelled, explicitly completed, unusable dates, late, planned,
 * in progress. A missing date is reported as a missing date and never invented, and a Finish is
 * inclusive - a project is not late during its own finish day.
 */
import {
  PROJECT_SCHEDULE_STATES,
  SCHEDULE_MISSING_PARTS,
  type ProjectScheduleState,
  type ScheduleMissingPart
} from '@eh/contracts';
import { DomainError } from './errors';
import { businessDate } from './time';

export { PROJECT_SCHEDULE_STATES, SCHEDULE_MISSING_PARTS };
export type { ProjectScheduleState, ScheduleMissingPart };

export type ProjectScheduleStatus = {
  state: ProjectScheduleState;
  missing: ScheduleMissingPart;
};

export type ProjectScheduleSource = {
  status: string;
  plannedStart: string | null;
  committedDeadline: string | null;
  archivedAt?: string | null;
};

const TERMINAL_LIFECYCLE: readonly string[] = ['Archived', 'Cancelled', 'Completed'];

/** True when the stored lifecycle status already decides the answer. */
export function isTerminalProjectStatus(status: string): boolean {
  return TERMINAL_LIFECYCLE.includes(status);
}

export function projectScheduleStatus(
  project: ProjectScheduleSource,
  today: string = businessDate()
): ProjectScheduleStatus {
  const archived = project.status === 'Archived' || !!project.archivedAt;
  if (archived) return { state: 'ARCHIVED', missing: 'NONE' };
  if (project.status === 'Cancelled') return { state: 'CANCELLED', missing: 'NONE' };
  if (project.status === 'Completed') return { state: 'COMPLETED', missing: 'NONE' };

  const start = project.plannedStart ?? null;
  const finish = project.committedDeadline ?? null;
  if (start && finish) {
    if (start > finish) return { state: 'INVALID_DATES', missing: 'NONE' };
    if (today > finish) return { state: 'LATE', missing: 'NONE' };
    if (today < start) return { state: 'PLANNED', missing: 'NONE' };
    return { state: 'IN_PROGRESS', missing: 'NONE' };
  }
  if (start) {
    return today < start
      ? { state: 'PLANNED', missing: 'FINISH' }
      : { state: 'IN_PROGRESS', missing: 'FINISH' };
  }
  if (finish) {
    return today > finish
      ? { state: 'LATE', missing: 'START' }
      : { state: 'START_NOT_SET', missing: 'START' };
  }
  return { state: 'DATES_NOT_SET', missing: 'BOTH' };
}

/** The non-terminal stored statuses an ordinary edit no longer chooses between. */
export const NON_TERMINAL_PROJECT_STATUSES: readonly string[] = ['Planned', 'Active', 'On Hold'];

/**
 * The stored lifecycle status is no longer an editable dropdown.
 *
 * An ordinary edit therefore may not move a project between non-terminal statuses, may not clear
 * a terminal decision, and may not archive (that has its own confirmed action). Completion,
 * cancellation and reactivation stay possible through explicit, confirmed manager actions, and a
 * client that bypasses the form is refused here rather than silently accepted.
 */
export function assertProjectLifecycleChange(stored: string, next: string): void {
  if (next === stored) return;
  if (next === 'Archived' || stored === 'Archived') {
    throw new DomainError('INVALID_TRANSITION', 'Archive and reactivation use their own confirmed action', {
      stored,
      next
    });
  }
  if (stored === 'Completed') {
    throw new DomainError('INVALID_TRANSITION', 'A completed project is not reopened by an edit', {
      stored,
      next
    });
  }
  if (next === 'Completed' || next === 'Cancelled') return;
  if (stored === 'Cancelled' && next === 'Active') return;
  throw new DomainError(
    'INVALID_TRANSITION',
    'Planned, In progress and On hold are derived from the schedule; only completion, cancellation and reactivation are explicit actions',
    { stored, next }
  );
}

/**
 * A new V2 project is either plainly active or explicitly planned; anything else would bypass the
 * completion and cancellation workflows at creation time.
 */
export function assertProjectCreationStatus(status: string | null | undefined): void {
  if (status === undefined || status === null) return;
  if (status === 'Active' || status === 'Planned') return;
  throw new DomainError('INVALID_TRANSITION', `A new project cannot start as ${status}`, { status });
}
