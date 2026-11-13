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

/**
 * The workflow status a reopened task returns to.
 *
 * No reliable pre-completion status or progress is recorded, so a correction never invents one:
 * the task becomes open `In Progress` with 0 recorded progress, and the derived display status
 * (for example 遅延 when the finish date is already in the past) follows from its dates.
 */
export const REOPENED_TASK_STATUS = 'In Progress' as const;
export const REOPENED_PROGRESS_PERCENT = 0;

export type ReopenTaskState = {
  taskId: string;
  status: string;
  container: boolean;
};

export type ReopenProjectState = {
  projectId: string;
  status: string;
  archived: boolean;
};

export type ReopenInput = {
  task: ReopenTaskState;
  project: ReopenProjectState;
  /** The explicit confirmation the red panel collected; there is no typed phrase. */
  confirmed: boolean;
  actorRole: string;
  /** The caller's explicit acknowledgement that a Completed parent project reopens too. */
  reopenProject: boolean;
};

export type ReopenPlan = {
  /** True when the parent project must change from Completed back to Active in the same write. */
  projectReopenRequired: boolean;
};

/**
 * Validates a corrective reopening before the first mutation.
 *
 * Only an ADMIN may reverse a completion, only leaf work qualifies (a container's completion is
 * derived), the stored status must actually be Done, and the caller must have confirmed the
 * action. Confirmation is a clearly labelled button in a red panel, not a typed phrase: the
 * interaction was simplified, the authority was not. A parent project is never silently
 * reactivated: `Completed` requires the explicit acknowledgement that comes with this operation,
 * while an archived or cancelled project is refused with an actionable explanation, because that
 * is a separate lifecycle act.
 */
export function assertReopenAllowed(input: ReopenInput): ReopenPlan {
  if (input.actorRole !== 'ADMIN') {
    throw new DomainError('AUTHORIZATION_DENIED', 'Only an ADMIN may reopen a completed task');
  }
  if (input.confirmed !== true) {
    throw new DomainError('CONFIRMATION_REQUIRED', 'Reopening a completed task requires explicit confirmation');
  }
  if (input.task.container) {
    throw new DomainError(
      'CONTAINER_NOT_COMPLETABLE',
      'A container task is organisation only; reopen its completed leaf work instead'
    );
  }
  if (input.task.status !== 'Done') {
    throw new DomainError('INVALID_TRANSITION', 'Only a completed task can be reopened', {
      status: input.task.status
    });
  }
  if (input.project.status === 'Archived' || input.project.archived) {
    throw new DomainError(
      'INVALID_TRANSITION',
      'The parent project is archived; reactivate the project in a separate lifecycle step before reopening this task',
      { projectId: input.project.projectId, projectStatus: input.project.status }
    );
  }
  if (input.project.status === 'Cancelled') {
    throw new DomainError(
      'INVALID_TRANSITION',
      'The parent project is cancelled; reactivate the project in a separate lifecycle step before reopening this task',
      { projectId: input.project.projectId, projectStatus: input.project.status }
    );
  }
  const projectReopenRequired = input.project.status === 'Completed';
  if (projectReopenRequired && input.reopenProject !== true) {
    throw new DomainError(
      'CONFIRMATION_REQUIRED',
      'The parent project is completed; confirm that it becomes active again in the same correction',
      { projectReopenRequired: true, projectId: input.project.projectId }
    );
  }
  return { projectReopenRequired };
}

