/**
 * Derived, user-facing task status.
 *
 * Only three states are shown for active work: 進行中 (in progress), 期限超過 (overdue) and
 * 完了 (done). `OVERDUE` is never persisted - it is recomputed from the deadline and the
 * Asia/Tokyo business date, so no scheduled job is required. Legacy stored values (Blocked,
 * On Hold, Assigned, Not Started, In Progress) all map to the unfinished display state and keep
 * their historical meaning in the stored row and the audit history.
 */
import { businessDate } from './time';

export const DISPLAY_TASK_STATUSES = ['IN_PROGRESS', 'OVERDUE', 'DONE', 'CANCELLED'] as const;
export type DisplayTaskStatus = (typeof DISPLAY_TASK_STATUSES)[number];

export type TaskStatusSource = {
  status: string;
  dueDate: string | null;
};

/**
 * Precedence: done wins over overdue, cancelled work is never active, otherwise a deadline
 * strictly before today (Asia/Tokyo calendar dates) is overdue.
 */
export function displayTaskStatus(task: TaskStatusSource, today: string = businessDate()): DisplayTaskStatus {
  if (task.status === 'Done') return 'DONE';
  if (task.status === 'Cancelled') return 'CANCELLED';
  if (task.dueDate && task.dueDate < today) return 'OVERDUE';
  return 'IN_PROGRESS';
}

/** Display states that appear in a default active-work list. */
export function isActiveDisplayStatus(status: DisplayTaskStatus): boolean {
  return status === 'IN_PROGRESS' || status === 'OVERDUE';
}
