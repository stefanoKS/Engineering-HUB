/**
 * Session-bound mutation completion.
 *
 * A confirmed write has two audiences and they have different lifetimes:
 *
 * 1. the **session**: the private cache must reflect the write even when the editor that started
 *    it has already been closed, replaced or unmounted;
 * 2. the **dialog**: the local save state, the inline error and the close action belong to a
 *    component that may be gone by the time the answer arrives.
 *
 * `commitMutation` owns the first part and reports the second part explicitly. The result is a
 * discriminated union rather than a bare value: when the signed-in session ended while the request
 * was in flight the outcome is `superseded`, and a caller *must* handle that case instead of
 * running its follow-up effects (a second invalidation, a notice, a navigation, a dialog change).
 * Handing an ordinary success value back with a comment would let a caller forget.
 *
 * A failed refresh after a confirmed write is never reported as a failed write: the invalidation
 * refetches in the background and keeps the previous payload.
 */
import { queryCache } from './cache';

export type Invalidation<T> = readonly string[] | ((value: T) => readonly string[]);

export type MutationOutcome<T> =
  | { status: 'committed'; value: T }
  /** The session that started this write has ended; the caller must not act on it. */
  | { status: 'superseded' };

export async function commitMutation<T>(
  run: () => Promise<T>,
  invalidate?: Invalidation<T>
): Promise<MutationOutcome<T>> {
  const epoch = queryCache.sessionEpoch;
  const value = await run();
  if (queryCache.sessionEpoch !== epoch) return { status: 'superseded' };
  const prefixes = typeof invalidate === 'function' ? invalidate(value) : invalidate;
  if (prefixes && prefixes.length) queryCache.invalidate([...prefixes]);
  return { status: 'committed', value };
}
