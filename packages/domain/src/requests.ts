/**
 * Employee request lifecycle.
 *
 * - A pending, rejected or returned request never changes a deadline.
 * - Only a manager approval applies a change, at most once, with history and audit records.
 * - A request whose task revision or deadline changed after submission is STALE; the newer
 *   value is never overwritten.
 * - A decision is applied at most once. A repeated decision is refused without a second task
 *   effect, history row or audit record.
 */
import type { RequestDecision, RequestStatus, RequestType, SubmissionBlockReason as ContractSubmissionBlockReason } from '@eh/contracts';
import { DomainError } from './errors';

export const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  PENDING: ['PROCESSING', 'STALE', 'WITHDRAWN', 'APPROVED', 'REJECTED', 'RETURNED'],
  PROCESSING: ['APPROVED', 'REJECTED', 'RETURNED', 'PENDING', 'STALE'],
  APPROVED: [],
  REJECTED: [],
  RETURNED: [],
  WITHDRAWN: [],
  STALE: []
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return (REQUEST_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError('INVALID_TRANSITION', `Request cannot move from ${from} to ${to}`, {
      from,
      to
    });
  }
}
export type RequestSnapshot = {
  status: RequestStatus;
  requestType: RequestType;
  taskRevisionAtSubmission: string;
  dueDateAtSubmission: string | null;
};

export type TaskSnapshot = {
  taskId: string;
  revision: number;
  dueDate: string | null;
  status: string;
  container: boolean;
};

export type StaleResult = { stale: boolean; reason: string };

/** Normalization for the two logical text columns; other fields are never coerced. */
export function normalizeSnapshotVersion(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return String(value).trim();
}

export function evaluateStaleness(request: RequestSnapshot, task: TaskSnapshot): StaleResult {
  if (request.status === 'APPROVED' || request.status === 'REJECTED' || request.status === 'RETURNED' || request.status === 'WITHDRAWN') {
    return { stale: false, reason: '' };
  }
  const submittedRevision = normalizeSnapshotVersion(request.taskRevisionAtSubmission);
  if (submittedRevision && submittedRevision !== String(task.revision)) {
    return { stale: true, reason: 'REVISION_CHANGED' };
  }
  if (normalizeSnapshotVersion(request.dueDateAtSubmission) !== normalizeSnapshotVersion(task.dueDate)) {
    return { stale: true, reason: 'DEADLINE_CHANGED' };
  }
  return { stale: false, reason: '' };
}

/** A completion report must never target a container: container completion is derived. */
export function assertReportable(requestType: RequestType, task: TaskSnapshot): void {
  if (requestType === 'COMPLETION_REPORT' && task.container) {
    throw new DomainError(
      'CONTAINER_NOT_COMPLETABLE',
      'A task with children is organisation only; its completion is derived from leaf work'
    );
  }
}

export type DecisionRequest = {
  requestId: string;
  requestType: RequestType;
  status: RequestStatus;
  taskId: string;
  requestedDueDate: string | null;
  taskRevisionAtSubmission: string;
  dueDateAtSubmission: string | null;
};

export type DecisionOutcome = {
  requestStatus: RequestStatus;
  taskEffect: 'NONE' | 'DEADLINE_CHANGED' | 'COMPLETED';
  dueDate: string | null;
  auditAction: 'REQUEST_APPROVED' | 'REQUEST_REJECTED' | 'REQUEST_RETURNED';
  historyRequired: boolean;
  completionRequired: boolean;
};

/**
 * Computes the effect of a manager decision without applying it.
 *
 * The caller applies the returned request patch, the single task update, the optional history
 * row and the audit row in one database transaction.
 */
export function planDecision(
  request: DecisionRequest,
  decision: RequestDecision,
  task: TaskSnapshot
): DecisionOutcome {
  if (request.status === 'APPROVED' || request.status === 'REJECTED' || request.status === 'RETURNED') {
    throw new DomainError('DUPLICATE_DECISION', 'This request has already been decided', {
      requestId: request.requestId,
      status: request.status
    });
  }
  if (request.status !== 'PENDING' && request.status !== 'PROCESSING') {
    throw new DomainError('INVALID_TRANSITION', `Request is ${request.status}; it cannot be decided`);
  }
  const stale = evaluateStaleness(request, task);
  if (stale.stale) {
    throw new DomainError('STALE_REQUEST', 'The task changed after this request was submitted', {
      reason: stale.reason
    });
  }
  if (request.taskId !== task.taskId) {
    throw new DomainError('VALIDATION_FAILED', 'Request task does not match the recorded task');
  }
  assertReportable(request.requestType, task);

  if (decision === 'REJECT') {
    return {
      requestStatus: 'REJECTED',
      taskEffect: 'NONE',
      dueDate: task.dueDate,
      auditAction: 'REQUEST_REJECTED',
      historyRequired: false,
      completionRequired: false
    };
  }
  if (decision === 'RETURN') {
    return {
      requestStatus: 'RETURNED',
      taskEffect: 'NONE',
      dueDate: task.dueDate,
      auditAction: 'REQUEST_RETURNED',
      historyRequired: false,
      completionRequired: false
    };
  }
  if (request.requestType === 'COMPLETION_REPORT') {
    return {
      requestStatus: 'APPROVED',
      taskEffect: 'COMPLETED',
      dueDate: task.dueDate,
      auditAction: 'REQUEST_APPROVED',
      historyRequired: false,
      completionRequired: true
    };
  }
  if (!request.requestedDueDate) {
    throw new DomainError('VALIDATION_FAILED', 'A deadline change request has no requested deadline');
  }
  return {
    requestStatus: 'APPROVED',
    taskEffect: 'DEADLINE_CHANGED',
    dueDate: request.requestedDueDate,
    auditAction: 'REQUEST_APPROVED',
    historyRequired: true,
    completionRequired: false
  };
}

/** A stable inbox identity: the inbox request ID is the permanent request ID. */
export function inboxDedupeKey(inboxRequestId: string): string {
  return `inbox:${inboxRequestId}`;
}

/**
 * Submission snapshot. A request records the revision and the deadline it was submitted
 * against, so a later change is detected instead of overwritten.
 */
export function submissionSnapshot(task: TaskSnapshot): {
  taskRevisionAtSubmission: string;
  dueDateAtSubmission: string | null;
  snapshotVersion: string;
} {
  return {
    taskRevisionAtSubmission: String(task.revision),
    dueDateAtSubmission: task.dueDate,
    snapshotVersion: `rev:${task.revision}`
  };
}

export type SubmissionValidation = {
  taskId: string;
  requestType: RequestType;
  requestedDueDate?: string | null;
  completionNote?: string;
  reason?: string;
};

export function validateSubmission(input: SubmissionValidation): void {
  if (input.requestType === 'DEADLINE_CHANGE' && !input.requestedDueDate) {
    throw new DomainError('VALIDATION_FAILED', 'A requested deadline is required');
  }
  if (input.requestType === 'COMPLETION_REPORT' && !String(input.completionNote ?? '').trim()) {
    throw new DomainError('VALIDATION_FAILED', 'A completion note is required');
  }
}

/**
 * Why a request cannot be filed right now.
 *
 * One list drives the reported capability and the submission refusal, so a disabled action always
 * explains itself and the server never depends on the client having asked first. The values live in
 * the contract; the order below is the order a refusal is reported in.
 */
export type SubmissionBlockReason = ContractSubmissionBlockReason;

export const SUBMISSION_BLOCK_REASON_ORDER: readonly SubmissionBlockReason[] = [
  'ROLE',
  'NOT_VISIBLE',
  'ARCHIVED',
  'NOT_ASSIGNED',
  'CONTAINER',
  'COMPLETED',
  'CANCELLED',
  'PENDING',
  'SUBMISSION_DISABLED'
];

export type SubmissionTaskState = {
  status: string;
  /** The task has children, so its completion is derived from leaf work. */
  container: boolean;
  /** The task, its subproject chain or its project is archived. */
  archived: boolean;
};

export type SubmissionAssessment = {
  requestType: RequestType;
  /** `canReportCompletion()` for this verified identity. */
  mayReportCompletion: boolean;
  /** `canRequestDeadlineChange()` for this verified identity. */
  mayRequestDeadlineChange: boolean;
  /** The verified member is the owner or an active additional assignee. */
  assigned: boolean;
  /** The reader can reach the task under the documented visibility policy. */
  visible: boolean;
  submissionEnabled: boolean;
  /** Another completion report for this task is still open. */
  pending: boolean;
  task: SubmissionTaskState;
};

/**
 * The ordered, complete list of reasons a submission would be refused.
 *
 * The approved completion-report exception stops at `NOT_VISIBLE` and `ROLE`: reporting another
 * person's accessible work is allowed, reading a restricted project to report it is not, and a
 * deadline change still requires the assignment.
 */
export function submissionBlockReasons(input: SubmissionAssessment): SubmissionBlockReason[] {
  const reasons: SubmissionBlockReason[] = [];
  const reporting = input.requestType === 'COMPLETION_REPORT';
  if (reporting ? !input.mayReportCompletion : !input.mayRequestDeadlineChange) reasons.push('ROLE');
  if (!input.visible) reasons.push('NOT_VISIBLE');
  if (input.task.archived) reasons.push('ARCHIVED');
  if (!reporting && !input.assigned) reasons.push('NOT_ASSIGNED');
  if (input.task.container) reasons.push('CONTAINER');
  if (input.task.status === 'Done') reasons.push('COMPLETED');
  if (input.task.status === 'Cancelled') reasons.push('CANCELLED');
  if (input.pending) reasons.push('PENDING');
  if (!input.submissionEnabled) reasons.push('SUBMISSION_DISABLED');
  return reasons;
}

export type SubmissionSeverity = 'DENIED' | 'REFUSED' | 'CLOSED' | 'CONTAINER';

/** The stable refusal a first blocking reason maps to; the code, never the wording, is authoritative. */
export function submissionRefusal(reason: SubmissionBlockReason): {
  code: 'AUTHORIZATION_DENIED' | 'INVALID_TRANSITION' | 'REQUEST_SUBMISSION_CLOSED' | 'CONTAINER_NOT_COMPLETABLE';
  severity: SubmissionSeverity;
} {
  switch (reason) {
    case 'ROLE':
    case 'NOT_VISIBLE':
    case 'NOT_ASSIGNED':
      return { code: 'AUTHORIZATION_DENIED', severity: 'DENIED' };
    case 'CONTAINER':
      return { code: 'CONTAINER_NOT_COMPLETABLE', severity: 'CONTAINER' };
    case 'SUBMISSION_DISABLED':
      return { code: 'REQUEST_SUBMISSION_CLOSED', severity: 'CLOSED' };
    default:
      return { code: 'INVALID_TRANSITION', severity: 'REFUSED' };
  }
}
