/**
 * Submission tracking that outlives the dialog.
 *
 * A request posting is a session-level operation, not a dialog-level one: the durable answer can
 * arrive after the dialog that started it has been closed, and the person must still be told what
 * happened.
 *
 * The unit of work is an **attempt**, not a dialog. One dialog identity (`submissionId`) may own
 * several attempts over time, and each attempt has one immutable payload and one stable identity
 * (`attemptId` = the `clientRequestId` the server keys idempotency on).
 *
 * Lifecycle rules:
 *
 * - `SENDING` and `UNKNOWN` attempts are never silently replaced or replayed. A repeat call with
 *   the same attempt identity is answered from the tracker, never by a second POST;
 * - `RECEIVED` attempts cannot be resubmitted;
 * - a **definite refusal** (`REFUSED`) is safe to correct: the server refuses before it reserves the
 *   idempotency key, so a deliberate new attempt uses a *new* identity. Reusing the old key with
 *   changed content would be refused by the server as `IDEMPOTENCY_REPLAY`, and is never done
 *   silently;
 * - `RECEIVED` requires a validated acknowledgement from the authoritative contract
 *   (`RequestSubmissionReceipt`). A payload without a valid request id, or with an unknown state,
 *   is `UNKNOWN` - never success;
 * - an outcome that cannot be observed (timeout, dropped connection, unreadable or incompatible
 *   answer) is `UNKNOWN` and is never retried automatically;
 * - only a code that establishes "nothing was written" is a `REFUSED`. `IDEMPOTENCY_REPLAY` is
 *   treated as uncertain, because it can describe an earlier attempt whose outcome was never seen;
 * - nothing crosses a session boundary: a sign-out clears the tracker, an answer that arrives after
 *   the session ended is reported as `superseded`, and the cache effect runs only inside the
 *   session that started it;
 * - dismissal hides a notice; it never removes the duplicate/uncertainty guard for that attempt;
 * - only non-sensitive receipt metadata is held, bounded, in memory. Explanation text is never
 *   retained here and nothing is written to browser storage.
 */
import { useSyncExternalStore } from 'react';
import { RequestSubmissionReceipt, type RequestSubmissionReceipt as Receipt } from '@eh/contracts';
import { ApiFailure, api, sessionEvents } from '../api/client';
import { keys, queryCache } from './cache';

export type SubmissionKind = 'DEADLINE_CHANGE' | 'COMPLETION_REPORT';
export type SubmissionOutcome = 'SENDING' | 'RECEIVED' | 'UNKNOWN' | 'REFUSED';

export type SubmissionAttempt = {
  /** The idempotency identity of this attempt; sent to the server as `clientRequestId`. */
  attemptId: string;
  /** The dialog identity this attempt belongs to; stable across corrections. */
  submissionId: string;
  attempt: number;
  taskId: string;
  requestType: SubmissionKind;
  outcome: SubmissionOutcome;
  /** The server's request id, present only after a validated acknowledgement. */
  requestId: string;
  /** How the server acknowledged it: a fresh record or an idempotent replay of the same one. */
  acknowledgement: '' | Receipt['state'];
  /** The readable refusal text; empty for every other outcome. */
  message: string;
  failureCode: string;
  /** True once a host page has shown this outcome, so the shell does not repeat it. */
  reported: boolean;
  /** True once the notice was dismissed. Dismissal never removes the guard. */
  dismissed: boolean;
  startedAt: number;
  settledAt: number | null;
};

/** Bounded retention of attempts: display rows and the duplicate guard share this budget. */
const MAX_ATTEMPTS = 50;
let attempts: SubmissionAttempt[] = [];
const listeners = new Set<() => void>();

/** Synchronous in-flight guard, so a double click can never start two POSTs in one tick. */
const inFlight = new Set<string>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): SubmissionAttempt[] {
  return attempts;
}

function upsert(next: SubmissionAttempt): void {
  const index = attempts.findIndex((entry) => entry.attemptId === next.attemptId);
  const without = index >= 0 ? [...attempts.slice(0, index), ...attempts.slice(index + 1)] : attempts;
  attempts = [next, ...without].slice(0, MAX_ATTEMPTS);
  emit();
}

export function clearSubmissions(): void {
  inFlight.clear();
  // Claims belong to dialogs; a session change ends them with every other private payload.
  claimed.clear();
  if (attempts.length === 0) return;
  attempts = [];
  emit();
}

/**
 * Hides a notice. The attempt itself is retained: removing it would remove the only protection
 * against replaying an uncertain submission.
 */
export function dismissSubmission(attemptId: string): void {
  const entry = attempts.find((candidate) => candidate.attemptId === attemptId);
  if (!entry || entry.dismissed) return;
  upsert({ ...entry, dismissed: true });
}

export function attemptById(attemptId: string): SubmissionAttempt | undefined {
  return attempts.find((entry) => entry.attemptId === attemptId);
}

/** Marks an outcome as already shown by its host page, so the shell does not repeat it. */
export function reportSubmission(attemptId: string): void {
  const entry = attempts.find((candidate) => candidate.attemptId === attemptId);
  if (!entry || entry.reported) return;
  upsert({ ...entry, reported: true });
}

/** Which attempts an open dialog is currently reporting, so the shell stays quiet for them. */
const claimed = new Set<string>();

/**
 * Claims are display state too, so a change must produce a new snapshot reference: React compares
 * the snapshot by identity, and mutating a set outside the array would never re-render the shell.
 */
function touch(): void {
  attempts = [...attempts];
  emit();
}

export function claimSubmission(attemptId: string): () => void {
  claimed.add(attemptId);
  touch();
  return () => {
    if (!claimed.delete(attemptId)) return;
    touch();
  };
}

export function isClaimed(attemptId: string): boolean {
  return claimed.has(attemptId);
}

/** The cache groups a request changes; a received request is a write for invalidation purposes. */
function invalidationFor(input: { taskId: string }): string[] {
  return [
    keys.myRequests,
    keys.myWork,
    keys.task(input.taskId),
    keys.tasks,
    keys.requests,
    keys.timeline,
    keys.overview,
    keys.reportEligibility(input.taskId)
  ];
}

/**
 * Codes that establish "nothing was written" for this attempt.
 *
 * `IDEMPOTENCY_REPLAY` is deliberately absent: it can mean an earlier attempt with this identity is
 * still being processed, so the outcome is unknown rather than safely correctable.
 */
const DEFINITE_REFUSALS = new Set([
  'VALIDATION_FAILED',
  'CONFIRMATION_REQUIRED',
  'AUTHORIZATION_DENIED',
  'NOT_FOUND',
  'INVALID_TRANSITION',
  'DIVISION_REQUIRED',
  'NOT_CONFIGURED',
  'EDIT_CONFLICT'
]);

export type SubmitRequestInput = {
  /** The identity of this attempt. A correction starts a new attempt with a new identity. */
  attemptId: string;
  /** The dialog identity; several attempts may share it. */
  submissionId: string;
  taskId: string;
  requestType: SubmissionKind;
  requestedDueDate?: string;
  reason?: string;
  explanation?: string;
  completionNote?: string;
};

export type SubmitOutcome =
  | { status: 'settled'; attempt: SubmissionAttempt }
  /** The session ended while the attempt was in flight; no effect belongs to the next session. */
  | { status: 'superseded' };

/**
 * Posts one attempt.
 *
 * Calling it again with the same `attemptId` never sends a second request: the tracked attempt is
 * returned instead. A refused attempt is returned too - the caller must start a *new* attempt with
 * a new identity rather than resubmitting this one.
 */
export async function submitRequest(input: SubmitRequestInput): Promise<SubmitOutcome> {
  const existing = attemptById(input.attemptId);
  if (existing) return { status: 'settled', attempt: existing };
  if (inFlight.has(input.attemptId)) {
    return {
      status: 'settled',
      attempt: pendingOf(input, countAttempts(input.submissionId) + 1)
    };
  }

  const epoch = queryCache.sessionEpoch;
  const pending = pendingOf(input, countAttempts(input.submissionId) + 1);
  inFlight.add(input.attemptId);
  upsert(pending);

  try {
    const payload = await api.post<unknown>('/api/employee/requests', {
      clientRequestId: input.attemptId,
      taskId: input.taskId,
      requestType: input.requestType,
      requestedDueDate: input.requestType === 'DEADLINE_CHANGE' ? input.requestedDueDate : undefined,
      reason: input.reason || undefined,
      explanation: input.explanation || undefined,
      completionNote: input.requestType === 'COMPLETION_REPORT' ? input.completionNote : undefined
    });
    if (queryCache.sessionEpoch !== epoch) return { status: 'superseded' };
    // The acknowledgement is validated against the authoritative contract before anything is
    // reported as received. A payload we cannot read is an unknown outcome, never a success.
    const parsed = RequestSubmissionReceipt.safeParse(payload);
    if (!parsed.success) {
      const settled: SubmissionAttempt = {
        ...pending,
        outcome: 'UNKNOWN',
        failureCode: 'INVALID_RESPONSE',
        settledAt: Date.now()
      };
      upsert(settled);
      return { status: 'settled', attempt: settled };
    }
    const receipt = parsed.data;
    const settled: SubmissionAttempt = {
      ...pending,
      outcome: 'RECEIVED',
      requestId: receipt.requestId,
      acknowledgement: receipt.state,
      settledAt: Date.now()
    };
    // A durable acknowledgement is the only outcome reported as received. The cache effect belongs
    // to the session, so it runs even when the dialog has been closed.
    queryCache.invalidate(invalidationFor(input));
    upsert(settled);
    return { status: 'settled', attempt: settled };
  } catch (failure) {
    if (queryCache.sessionEpoch !== epoch) return { status: 'superseded' };
    const apiFailure = failure instanceof ApiFailure ? failure : null;
    const code = apiFailure?.code ?? 'ERROR';
    const definite = !!apiFailure && DEFINITE_REFUSALS.has(code);
    const settled: SubmissionAttempt = {
      ...pending,
      outcome: definite ? 'REFUSED' : 'UNKNOWN',
      message: definite ? apiFailure!.message : '',
      failureCode: code,
      settledAt: Date.now()
    };
    upsert(settled);
    return { status: 'settled', attempt: settled };
  } finally {
    inFlight.delete(input.attemptId);
  }
}

function pendingOf(input: SubmitRequestInput, attempt: number): SubmissionAttempt {
  return {
    attemptId: input.attemptId,
    submissionId: input.submissionId,
    attempt,
    taskId: input.taskId,
    requestType: input.requestType,
    outcome: 'SENDING',
    requestId: '',
    acknowledgement: '',
    message: '',
    failureCode: '',
    reported: false,
    dismissed: false,
    startedAt: Date.now(),
    settledAt: null
  };
}

function countAttempts(submissionId: string): number {
  return attempts.filter((entry) => entry.submissionId === submissionId).length;
}

/** Every tracked attempt, newest first. */
export function useSubmissions(): SubmissionAttempt[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The tracked attempt for one identity, or `undefined`. */
export function useSubmission(attemptId: string): SubmissionAttempt | undefined {
  const all = useSubmissions();
  return all.find((entry) => entry.attemptId === attemptId);
}

// A lost session ends the tracker with every other private payload.
sessionEvents.addEventListener('session-lost', clearSubmissions);
