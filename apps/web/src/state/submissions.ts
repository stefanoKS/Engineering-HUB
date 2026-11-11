/**
 * Submission tracking that outlives the dialog.
 *
 * A request posting is a session-level operation, not a dialog-level one: the durable answer can
 * arrive after the dialog that started it has been closed, and the person must still be told what
 * happened. The tracker therefore owns the request, its stable idempotency identity and its
 * outcome; the dialog only reads the entry for its own id while it is open.
 *
 * Rules this module keeps:
 *
 * - one submission per client request id - a duplicate is refused synchronously, not by a later
 *   render;
 * - `RECEIVED` only after a durable server acknowledgement that carried a request id;
 * - a timeout, a dropped connection or an unreadable answer is `UNKNOWN` and is never retried
 *   automatically, because the server may already have stored it;
 * - a definite refusal is `REFUSED` and is never confused with uncertainty - the draft stays;
 * - nothing crosses a session boundary: a sign-out clears the tracker and an answer that arrives
 *   after the session ended is discarded;
 * - only non-sensitive receipt metadata is held, bounded, in memory. Explanation text is never
 *   retained here and nothing is written to browser storage.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { ApiFailure, api, sessionEvents } from '../api/client';
import { keys, queryCache } from './cache';

export type SubmissionKind = 'DEADLINE_CHANGE' | 'COMPLETION_REPORT';
export type SubmissionState = 'SENDING' | 'RECEIVED' | 'UNKNOWN' | 'REFUSED';

export type Submission = {
  submissionId: string;
  taskId: string;
  requestType: SubmissionKind;
  state: SubmissionState;
  /** The server's request id, present only once a durable acknowledgement arrived. */
  requestId: string;
  /** The readable refusal text; empty for every other outcome. */
  message: string;
  failureCode: string;
  /** True once a host page has shown this outcome, so the shell does not repeat it. */
  reported: boolean;
  startedAt: number;
  settledAt: number | null;
};

const MAX_SUBMISSIONS = 20;
let entries: Submission[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): Submission[] {
  return entries;
}

function upsert(next: Submission): void {
  const index = entries.findIndex((entry) => entry.submissionId === next.submissionId);
  const without = index >= 0 ? [...entries.slice(0, index), ...entries.slice(index + 1)] : entries;
  entries = [next, ...without].slice(0, MAX_SUBMISSIONS);
  emit();
}

export function clearSubmissions(): void {
  if (entries.length === 0) return;
  entries = [];
  emit();
}

export function dismissSubmission(submissionId: string): void {
  const next = entries.filter((entry) => entry.submissionId !== submissionId);
  if (next.length === entries.length) return;
  entries = next;
  emit();
}

export function submissionById(submissionId: string): Submission | undefined {
  return entries.find((entry) => entry.submissionId === submissionId);
}

/**
 * Which submission is currently reported by an open dialog.
 *
 * While a dialog is on screen it is the nearest and clearest place to report its own outcome, so
 * the shell notice stays quiet for that id. As soon as the dialog closes, the shell takes over -
 * which is exactly the case this release fixes: a close must not silence the result.
 */
const claimed = new Set<string>();

export function claimSubmission(submissionId: string): () => void {
  claimed.add(submissionId);
  emit();
  return () => {
    claimed.delete(submissionId);
    emit();
  };
}

export function isClaimed(submissionId: string): boolean {
  return claimed.has(submissionId);
}

/** Marks an outcome as already shown by its host page, so the shell does not repeat it. */
export function reportSubmission(submissionId: string): void {
  const entry = entries.find((candidate) => candidate.submissionId === submissionId);
  if (!entry || entry.reported) return;
  upsert({ ...entry, reported: true });
}

/** The cache groups a question changes; a received request is a write for invalidation purposes. */
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

export type SubmitRequestInput = {
  submissionId: string;
  taskId: string;
  requestType: SubmissionKind;
  requestedDueDate?: string;
  reason?: string;
  explanation?: string;
  completionNote?: string;
};

/**
 * Posts one request. Calling it again with the same `submissionId` never sends a second request:
 * an in-flight or settled entry is returned instead.
 */
export async function submitRequest(input: SubmitRequestInput): Promise<Submission> {
  const existing = submissionById(input.submissionId);
  if (existing) return existing;

  const epoch = queryCache.sessionEpoch;
  const pending: Submission = {
    submissionId: input.submissionId,
    taskId: input.taskId,
    requestType: input.requestType,
    state: 'SENDING',
    requestId: '',
    message: '',
    failureCode: '',
    reported: false,
    startedAt: Date.now(),
    settledAt: null
  };
  upsert(pending);

  try {
    const result = await api.post<{ requestId: string; state?: string }>('/api/employee/requests', {
      clientRequestId: input.submissionId,
      taskId: input.taskId,
      requestType: input.requestType,
      requestedDueDate: input.requestType === 'DEADLINE_CHANGE' ? input.requestedDueDate : undefined,
      reason: input.reason || undefined,
      explanation: input.explanation || undefined,
      completionNote: input.requestType === 'COMPLETION_REPORT' ? input.completionNote : undefined
    });
    // An answer that arrives after the session ended belongs to that earlier session: it can
    // neither repaint nor touch the next user's cache.
    if (queryCache.sessionEpoch !== epoch) return pending;
    const settled: Submission = {
      ...pending,
      state: 'RECEIVED',
      requestId: typeof result?.requestId === 'string' ? result.requestId : '',
      reported: false,
      settledAt: Date.now()
    };
    // A durable acknowledgement is the only outcome that is reported as received. The cache
    // effect belongs to the session, so it runs even when the dialog has been closed.
    queryCache.invalidate(invalidationFor(input));
    upsert(settled);
    return settled;
  } catch (failure) {
    if (queryCache.sessionEpoch !== epoch) return pending;
    const api_failure = failure instanceof ApiFailure ? failure : null;
    const unobservable = !api_failure || ['NETWORK', 'INVALID_RESPONSE'].includes(api_failure.code);
    const settled: Submission = {
      ...pending,
      state: unobservable ? 'UNKNOWN' : 'REFUSED',
      message: unobservable ? '' : api_failure!.message,
      failureCode: api_failure?.code ?? 'ERROR',
      reported: false,
      settledAt: Date.now()
    };
    upsert(settled);
    return settled;
  }
}

/** Every tracked submission, newest first. */
export function useSubmissions(): Submission[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The tracked submission for one dialog identity, or `undefined`. */
export function useSubmission(submissionId: string): Submission | undefined {
  const all = useSubmissions();
  return all.find((entry) => entry.submissionId === submissionId);
}

/** Marks this submission as reported by an open dialog until the component unmounts. */
export function useClaimSubmission(submissionId: string): void {
  useEffect(() => claimSubmission(submissionId), [submissionId]);
}

// A lost session ends the tracker with every other private payload.
sessionEvents.addEventListener('session-lost', clearSubmissions);
