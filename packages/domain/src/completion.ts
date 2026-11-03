/**
 * `Status = Done` is written only by the reviewed completion workflow.
 *
 * Exactly two sources may complete work: a manager decision on an approved COMPLETION_REPORT
 * request, or an explicit ADMIN correction with a required reason and its own
 * COMPLETION_OVERRIDDEN evidence. Every other entry point refuses the transition, and a
 * container task can never be completed directly because its progress is derived.
 */
import { DomainError } from './errors';

export type CompletionSource = 'REQUEST_DECISION' | 'ADMIN_OVERRIDE';

export type CompletionTask = {
  taskId: string;
  status: string;
  container: boolean;
  assignmentApprovedAt: string | null;
};

export function assertCompletableByDecision(task: CompletionTask): void {
  if (task.container) {
    throw new DomainError(
      'CONTAINER_NOT_COMPLETABLE',
      'A container task is organisation only; complete its leaf work instead'
    );
  }
  if (task.status === 'Cancelled') {
    throw new DomainError('INVALID_TRANSITION', 'Cancelled work cannot be completed');
  }
  if (task.status === 'Done') {
    throw new DomainError('INVALID_TRANSITION', 'The task is already Done');
  }
}

export type OverrideInput = {
  task: CompletionTask;
  reason: string;
  confirmation: string;
  actorRole: string;
};

export function assertOverrideAllowed(input: OverrideInput): void {
  if (input.actorRole !== 'ADMIN') {
    throw new DomainError('AUTHORIZATION_DENIED', 'Only an ADMIN may complete a task outside the reviewed workflow');
  }
  if (!String(input.reason ?? '').trim()) {
    throw new DomainError('VALIDATION_FAILED', 'A reason is required for a completion correction');
  }
  if (input.task.container) {
    throw new DomainError(
      'CONTAINER_NOT_COMPLETABLE',
      'A container task cannot be completed; its completion is derived from leaf work'
    );
  }
  if (input.task.status === 'Cancelled') {
    throw new DomainError('INVALID_TRANSITION', 'Cancelled work cannot be completed');
  }
  const expected = `COMPLETE ${input.task.taskId}`;
  if (String(input.confirmation ?? '').trim() !== expected) {
    throw new DomainError('CONFIRMATION_REQUIRED', `Type exactly "${expected}" to confirm`, { expected });
  }
}

/** Refuses any attempt to write Done through an ordinary update path. */
export function assertNotDirectCompletion(currentStatus: string, nextStatus: string): void {
  if (nextStatus === 'Done' && currentStatus !== 'Done') {
    throw new DomainError(
      'INVALID_TRANSITION',
      'Done is written only by the reviewed completion workflow (request decision or ADMIN correction)'
    );
  }
}

/**
 * A completion decision is a manager decision whatever created the task.
 *
 * A task a member filed for themselves is reviewed by a MANAGER or an ADMIN; requiring an ADMIN
 * specifically would give a manager no authority over the department's ordinary work.
 */
export function assertCompletionDecisionRole(input: { actorRole: string }): void {
  if (input.actorRole !== 'ADMIN' && input.actorRole !== 'MANAGER') {
    throw new DomainError('AUTHORIZATION_DENIED', 'Only a manager may decide a completion report');
  }
}

/**
 * A manager marks authorized work Done directly, without a prior request.
 *
 * The same container, cancelled and already-Done refusals apply as for a request decision, so a
 * direct completion can never bypass the workflow rules that protect derived progress.
 */
export function assertDirectCompletionAllowed(input: { actorRole: string; task: CompletionTask }): void {
  if (input.actorRole !== 'ADMIN' && input.actorRole !== 'MANAGER') {
    throw new DomainError('AUTHORIZATION_DENIED', 'Only a manager may complete a task directly');
  }
  assertCompletableByDecision(input.task);
}

