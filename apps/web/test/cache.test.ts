/**
 * Deterministic cache-race tests.
 *
 * Each case reproduces a concrete interleaving that used to leave stale data, a blank screen or a
 * resurrected private payload after sign-out.
 */
import { describe, expect, it } from 'vitest';
import { queryCache } from '../src/state/cache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('query cache ownership', () => {
  it('an older completion cannot replace a newer entry after invalidation', async () => {
    const key = 'race/replace';
    const older = deferred<string>();
    const pendingOlder = queryCache.fetch(key, () => older.promise).catch(() => undefined);

    queryCache.invalidate([key]);
    const newer = await queryCache.fetch(key, async () => 'newer');
    expect(newer).toBe('newer');

    older.resolve('older');
    await pendingOlder;
    await tick();
    expect(queryCache.peek<string>(key).data).toBe('newer');
  });

  it('an obsolete failure cannot clear a newer entry', async () => {
    const key = 'race/failure';
    const older = deferred<string>();
    const pendingOlder = queryCache.fetch(key, () => older.promise).catch(() => undefined);

    queryCache.invalidate([key]);
    await queryCache.fetch(key, async () => 'fresh');

    older.reject(new Error('stale failure'));
    await pendingOlder;
    await tick();
    expect(queryCache.peek<string>(key).data).toBe('fresh');
    expect(queryCache.peek<string>(key).error).toBeUndefined();
  });

  it('a forced refresh supersedes an older in-flight read', async () => {
    const key = 'race/force';
    const older = deferred<string>();
    const pendingOlder = queryCache.fetch(key, () => older.promise).catch(() => undefined);

    const forced = await queryCache.fetch(key, async () => 'forced', { force: true });
    expect(forced).toBe('forced');

    older.resolve('stale');
    await pendingOlder;
    await tick();
    expect(queryCache.peek<string>(key).data).toBe('forced');
  });

  it('an export load cannot overwrite a newer entry of the same key', async () => {
    const key = 'race/force-export';
    const first = deferred<string>();
    const pendingFirst = queryCache.fetch(key, () => first.promise).catch(() => undefined);
    await queryCache.fetch(key, async () => 'second', { force: true });
    first.resolve('first');
    await pendingFirst;
    expect(queryCache.peek<string>(key).data).toBe('second');
  });

  it('an unrelated invalidation keeps an in-flight result', async () => {
    const key = 'race/unrelated';
    const pending = queryCache.fetch(key, async () => {
      await tick();
      return 'kept';
    });
    queryCache.invalidate(['something/else']);
    await pending;
    expect(queryCache.peek<string>(key).data).toBe('kept');
  });

  it('refetches a mounted query when its prefix is invalidated', async () => {
    const key = 'race/active';
    await queryCache.fetch(key, async () => 'first');
    let calls = 0;
    const loader = async (): Promise<string> => {
      calls += 1;
      return `run-${calls}`;
    };
    queryCache.activate(key, loader);

    queryCache.invalidate([key]);
    await tick();
    await tick();

    expect(calls).toBe(1);
    expect(queryCache.peek<string>(key).data).toBe('run-1');
    queryCache.deactivate(key);
  });

  it('a late completion after clear cannot repopulate private data', async () => {
    const key = 'race/signout';
    const older = deferred<string>();
    const pending = queryCache.fetch(key, () => older.promise).catch(() => undefined);

    queryCache.clear();
    older.resolve('private');
    await pending;
    await tick();
    expect(queryCache.peek<string>(key).data).toBeUndefined();
  });
});
