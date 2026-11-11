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
 * `commitMutation` owns the first part. The cache effect runs inside the mutation itself, so it can
 * never be lost to an unmounted component, and it is skipped when the signed-in session changed
 * while the request was in flight. A failed refresh after a confirmed write is never reported as a
 * failed write: the invalidation refetches in the background and keeps the previous payload.
 */
import { queryCache } from './cache';

export type Invalidation<T> = readonly string[] | ((value: T) => readonly string[]);

export async function commitMutation<T>(run: () => Promise<T>, invalidate?: Invalidation<T>): Promise<T> {
  const epoch = queryCache.sessionEpoch;
  const value = await run();
  if (queryCache.sessionEpoch !== epoch) return value;
  const prefixes = typeof invalidate === 'function' ? invalidate(value) : invalidate;
  if (prefixes && prefixes.length) queryCache.invalidate([...prefixes]);
  return value;
}
