/**
 * Project/subproject lifecycle and the narrow, ADMIN-only permanent deletion preflight.
 *
 * Archiving is a status change, never a removal: every project, task, milestone, approval and
 * history row stays, the area stays visible in lists and filters, and a subproject archive
 * cascades nothing. A permanent removal is allowed only for a demonstrably mistaken, empty
 * record; operational evidence always falls back to archive.
 */
import { DomainError } from './errors';

export type LifecycleTask = { taskId: string; status: string };

/** A project can only be marked Completed when every task is Done. */
export function assertProjectCompletable(tasks: readonly LifecycleTask[]): void {
  const open = tasks.filter((task) => task.status !== 'Done' && task.status !== 'Cancelled');
  if (open.length) {
    throw new DomainError(
      'INVALID_TRANSITION',
      `A project can only be Completed when all its tasks are done (${open.length} remaining)`,
      { remaining: open.length }
    );
  }
}

export type DeletionEntity = 'PROJECTS' | 'SUBPROJECTS' | 'TASKS';

export type DeletionEvidence = {
  entityType: DeletionEntity;
  entityId: string;
  archived?: boolean;
  deleted?: boolean;
  descendantCount?: number;
  dependencyCount?: number;
  taskCount?: number;
  recordedEffort?: boolean;
  approvals?: boolean;
  requests?: boolean;
  notifications?: boolean;
  deadlineHistory?: boolean;
  scheduleConfirmations?: boolean;
  auditHistory?: boolean;
  published?: boolean;
};

export type DeletionBlocker = { code: string; detail: string };

export type DeletionPreflightResult = {
  deletable: boolean;
  blockers: DeletionBlocker[];
  confirmationText: string;
};

export function deletionPreflight(evidence: DeletionEvidence): DeletionPreflightResult {
  const blockers: DeletionBlocker[] = [];
  const blocked = (code: string, detail: string): void => {
    blockers.push({ code, detail });
  };
  if (evidence.deleted) blocked('ALREADY_DELETED', 'The record is already removed');
  if (evidence.archived) blocked('ARCHIVED_RECORD', 'An archived record is retained; archive is not deletion');
  if ((evidence.descendantCount ?? 0) > 0) {
    blocked('HAS_DESCENDANTS', 'Remove or archive the child records first; nothing cascades');
  }
  if ((evidence.taskCount ?? 0) > 0) {
    blocked('HAS_TASKS', 'The record still owns tasks; archive it instead');
  }
  if ((evidence.dependencyCount ?? 0) > 0) {
    blocked('DEPENDENCY_REFERENCED', 'Other work depends on this record');
  }
  if (evidence.recordedEffort) blocked('RECORDED_EFFORT', 'Recorded effort is operational history');
  if (evidence.approvals) blocked('APPROVALS', 'Assignment or schedule approvals exist');
  if (evidence.requests) blocked('REQUESTS', 'Employee requests exist for this record');
  if (evidence.notifications) blocked('NOTIFICATIONS', 'Notification history exists for this record');
  if (evidence.deadlineHistory) blocked('DEADLINE_HISTORY', 'Deadline history is operational history');
  if (evidence.scheduleConfirmations) blocked('SCHEDULE_CONFIRMATIONS', 'A schedule decision exists for this record');
  if (evidence.auditHistory) blocked('AUDIT_HISTORY', 'Audit evidence exists; archive instead of deleting');
  if (evidence.published) blocked('PUBLISHED', 'The record is published to the shared dashboard');
  return {
    deletable: blockers.length === 0,
    blockers,
    confirmationText: `DELETE ${evidence.entityId}`
  };
}

export function assertDeletionAllowed(result: DeletionPreflightResult, supplied: string): void {
  if (!result.deletable) {
    throw new DomainError('INVALID_TRANSITION', 'This record cannot be removed permanently', {
      blockers: result.blockers
    });
  }
  if (String(supplied ?? '').trim() !== result.confirmationText) {
    throw new DomainError('CONFIRMATION_REQUIRED', `Type exactly "${result.confirmationText}" to confirm`, {
      expected: result.confirmationText
    });
  }
}

/** Publication is only for a project explicitly marked INTERNAL. */
export function isPublishable(visibility: string | null | undefined): boolean {
  return String(visibility ?? '') === 'INTERNAL';
}
