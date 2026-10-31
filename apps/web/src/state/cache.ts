/**
 * Query cache.
 *
 * - in-flight reads are deduplicated per key;
 * - cached data is served immediately and revalidated in the background (stale-while-revalidate);
 * - invalidation supersedes the in-flight read as well as the cached payload, so a read started
 *   before a newer save can neither paint nor be joined by the newer refresh;
 * - nothing is persisted: no private manager data reaches localStorage or IndexedDB.
 */
import { useEffect, useReducer, useRef } from 'react';

type Entry = {
  data?: unknown;
  error?: unknown;
  promise?: Promise<unknown>;
  updatedAt: number;
  generation: number;
};

const STALE_AFTER_MS = 30_000;

class QueryCache {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  generation = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  peek<T>(key: string): { data?: T; error?: unknown; loading: boolean } {
    const entry = this.entries.get(key);
    return {
      data: entry?.data as T | undefined,
      error: entry?.error,
      loading: !!entry?.promise && entry.data === undefined
    };
  }

  async fetch<T>(key: string, loader: () => Promise<T>, options: { force?: boolean } = {}): Promise<T> {
    const existing = this.entries.get(key);
    if (!options.force && existing?.promise) return existing.promise as Promise<T>;
    if (!options.force && existing?.data !== undefined && Date.now() - existing.updatedAt < STALE_AFTER_MS) {
      return existing.data as T;
    }
    const generation = this.generation;
    const entry: Entry = {
      data: existing?.data,
      error: undefined,
      updatedAt: existing?.updatedAt ?? 0,
      generation
    };
    const promise = loader()
      .then((data) => {
        // A superseded read is dropped with its payload: it cannot paint a newer screen.
        if (entry.generation !== this.generation) return data;
        entry.data = data;
        entry.error = undefined;
        entry.updatedAt = Date.now();
        return data;
      })
      .catch((error: unknown) => {
        if (entry.generation === this.generation) entry.error = error;
        throw error;
      })
      .finally(() => {
        entry.promise = undefined;
        this.entries.set(key, entry);
        this.emit();
      });
    entry.promise = promise;
    this.entries.set(key, entry);
    this.emit();
    return promise;
  }

  /** Removes cached and in-flight entries whose key starts with one of the prefixes. */
  invalidate(prefixes: string[]): void {
    let changed = false;
    for (const [key, entry] of [...this.entries]) {
      if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
      this.entries.delete(key);
      void entry;
      changed = true;
    }
    this.generation += 1;
    if (changed || prefixes.length) this.emit();
  }

  clear(): void {
    this.entries.clear();
    this.generation += 1;
    this.emit();
  }
}

export const queryCache = new QueryCache();

/** Invalidation groups a save uses: narrow by default, never "reload everything". */
export const keys = {
  bootstrap: 'bootstrap',
  overview: 'manager/overview',
  projects: 'manager/projects',
  project: (id: string) => `manager/projects/${id}`,
  tasks: 'manager/tasks',
  task: (id: string) => `manager/tasks/${id}`,
  taskIndex: 'manager/task-index',
  members: 'manager/members',
  member: (id: string) => `manager/members/${id}`,
  responsibilities: 'manager/responsibilities',
  skills: 'manager/skills',
  requests: 'manager/requests',
  automation: 'manager/automation',
  publication: 'manager/publication',
  status: 'manager/status',
  workload: 'manager/workload',
  references: 'manager/references',
  employee: 'employee/snapshot'
};

export function useQuery<T>(
  key: string,
  loader: () => Promise<T>,
  options: { enabled?: boolean } = {}
): { data?: T; error?: unknown; loading: boolean; refresh: () => void } {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const keyRef = useRef(key);

  useEffect(() => {
    keyRef.current = key;
    if (options.enabled === false) return undefined;
    let cancelled = false;
    void queryCache
      .fetch(key, () => loaderRef.current())
      .then(() => {
        if (!cancelled) rerender();
      })
      .catch(() => {
        if (!cancelled) rerender();
      });
    const unsubscribe = queryCache.subscribe(() => {
      if (!cancelled) rerender();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key, options.enabled]);

  const state = queryCache.peek<T>(key);
  return {
    ...state,
    refresh: () => {
      void queryCache.fetch(key, () => loaderRef.current(), { force: true }).catch(() => undefined);
    }
  };
}
