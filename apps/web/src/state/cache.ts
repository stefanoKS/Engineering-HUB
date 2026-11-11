/**
 * Query cache.
 *
 * - in-flight reads are deduplicated per key;
 * - cached data is served immediately and revalidated in the background (stale-while-revalidate);
 * - every read owns its entry, so a superseded read can neither paint, recreate nor clear a newer
 *   entry - invalidation, a forced refresh and a logout all supersede the older owner;
 * - invalidating a prefix refetches the queries that are currently mounted instead of leaving a
 *   blank screen;
 * - a refresh keeps the last successful payload and reports itself as *refreshing*, so a background
 *   failure is presented as "older data + a refresh warning" instead of an empty screen;
 * - a retained payload is never borrowed across keys: freshness metadata is per entry;
 * - subscribers are key-scoped: a change to one entry only re-renders the components that read it;
 * - nothing is persisted: no private manager data reaches localStorage or IndexedDB.
 */
import { useEffect, useReducer, useRef } from 'react';

type Entry = {
  data?: unknown;
  error?: unknown;
  promise?: Promise<unknown>;
  updatedAt: number;
  generation: number;
  /** Bumped on every mutation of this entry, so a subscriber can detect its own change. */
  version: number;
};

/** A hard ceiling on retained payloads, so a long session cannot grow without bound. */
const MAX_ENTRIES = 240;

type Active = {
  count: number;
  loader: () => Promise<unknown>;
};

const STALE_AFTER_MS = 30_000;

export type QuerySnapshot<T> = {
  data?: T;
  error?: unknown;
  /** A first read is still in flight and there is nothing to show yet. */
  loading: boolean;
  /** A read is in flight while an earlier payload is still displayed. */
  refreshing: boolean;
  /** When the displayed payload was last confirmed by the server (epoch milliseconds, 0 = never). */
  updatedAt: number;
  /** The displayed payload is older than the revalidation window. */
  stale: boolean;
};

class QueryCache {
  private entries = new Map<string, Entry>();
  private active = new Map<string, Active>();
  private listeners = new Set<() => void>();
  generation = 0;
  /**
   * Identifies the signed-in session's private data. `clear()` advances it, and a mutation that
   * started before a sign-out therefore performs no cache effect afterwards.
   */
  sessionEpoch = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private touch(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.version += 1;
    this.emit();
  }

  /** The change counter of one key: a subscriber re-renders only when its own entry changed. */
  version(key: string): number {
    return this.entries.get(key)?.version ?? 0;
  }

  /** Registers a mounted query so invalidation can refetch it. */
  activate(key: string, loader: () => Promise<unknown>): void {
    const existing = this.active.get(key);
    this.active.set(key, { count: (existing?.count ?? 0) + 1, loader });
  }

  deactivate(key: string): void {
    const existing = this.active.get(key);
    if (!existing) return;
    if (existing.count <= 1) this.active.delete(key);
    else this.active.set(key, { ...existing, count: existing.count - 1 });
  }

  peek<T>(key: string): QuerySnapshot<T> {
    const entry = this.entries.get(key);
    const hasData = entry?.data !== undefined;
    return {
      data: entry?.data as T | undefined,
      error: entry?.error,
      loading: !!entry?.promise && !hasData,
      refreshing: !!entry?.promise && hasData,
      updatedAt: entry?.updatedAt ?? 0,
      stale: hasData && Date.now() - (entry?.updatedAt ?? 0) >= STALE_AFTER_MS
    };
  }

  /** Drops the least recently confirmed payloads once the bounded size is exceeded. */
  private trim(): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    const ordered = [...this.entries.entries()]
      .filter(([, entry]) => !entry.promise)
      .sort((left, right) => left[1].updatedAt - right[1].updatedAt);
    for (const [key] of ordered) {
      if (this.entries.size <= MAX_ENTRIES) break;
      this.entries.delete(key);
    }
  }

  async fetch<T>(key: string, loader: () => Promise<T>, options: { force?: boolean } = {}): Promise<T> {
    const existing = this.entries.get(key);
    if (!options.force && existing?.promise) return existing.promise as Promise<T>;
    if (!options.force && existing?.data !== undefined && Date.now() - existing.updatedAt < STALE_AFTER_MS) {
      return existing.data as T;
    }
    // A new entry object becomes the sole owner of the key. Any older read still in flight sees
    // a different object in the map and drops its result, error and completion. The last
    // successful payload is carried over, so a refresh is never a blank screen.
    const entry: Entry = {
      data: existing?.data,
      error: undefined,
      updatedAt: existing?.updatedAt ?? 0,
      generation: this.generation,
      version: (existing?.version ?? 0) + 1
    };
    const owns = (): boolean => this.entries.get(key) === entry;
    const promise = loader()
      .then((data) => {
        if (!owns()) return data;
        entry.data = data;
        entry.error = undefined;
        entry.updatedAt = Date.now();
        return data;
      })
      .catch((error: unknown) => {
        if (owns()) entry.error = error;
        throw error;
      })
      .finally(() => {
        if (!owns()) return;
        entry.promise = undefined;
        entry.version += 1;
        this.trim();
        this.emit();
      });
    entry.promise = promise;
    this.entries.set(key, entry);
    this.emit();
    return promise;
  }

  /**
   * Removes cached and in-flight entries whose key starts with one of the prefixes, then
   * refetches every mounted query in that group once.
   *
   * A mounted query keeps its last successful payload while it refetches, so an invalidation never
   * blanks a screen that is on display (and never unmounts the editor a user is working in). An
   * entry nobody is looking at is dropped, which keeps the cache bounded. The union of cached and
   * in-flight keys is what counts, so a read started before a newer write can neither paint nor be
   * joined by the refresh that follows it.
   */
  invalidate(prefixes: string[]): void {
    const matches = (key: string): boolean => prefixes.some((prefix) => key.startsWith(prefix));
    const affected = new Set<string>([...this.entries.keys(), ...this.active.keys()]);
    let changed = false;
    for (const key of affected) {
      if (!matches(key)) continue;
      if (this.active.has(key)) continue;
      if (this.entries.delete(key)) changed = true;
    }
    this.generation += 1;
    if (changed || prefixes.length) this.emit();
    for (const [key, active] of [...this.active]) {
      if (!matches(key)) continue;
      // The refetch claims the key again; an older in-flight read can no longer own it.
      void this.fetch(key, active.loader, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Drops every payload. Used on sign-out and on a lost session; nothing is refetched.
   *
   * The session epoch advances, so a mutation that was already in flight when the session ended
   * can never invalidate, repopulate or otherwise touch the next user's cache.
   */
  clear(): void {
    this.entries.clear();
    this.generation += 1;
    this.sessionEpoch += 1;
    this.emit();
  }
}

export const queryCache = new QueryCache();

/**
 * Reads whose answer depends on the Asia/Tokyo business date.
 *
 * A derived schedule badge, an overdue count and a "due today" hint are calculated on the server
 * from its own date, so a page open across midnight drops these entries instead of showing
 * yesterday's answer. The list is a prefix set: `manager/projects` also covers one project.
 */
export const DATE_DEPENDENT_PREFIXES = [
  'bootstrap',
  'manager/overview',
  'manager/projects',
  'manager/tasks',
  'manager/task-index',
  'manager/members',
  'manager/workload',
  'employee/snapshot',
  'employee/my-work',
  'work/projects',
  'work/overview',
  'work/timeline'
] as const;

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
  divisions: 'manager/divisions',
  employee: 'employee/snapshot',
  myWork: 'employee/my-work',
  myProjects: 'employee/my-work/projects',
  myProjectForm: 'employee/references',
  myRequests: 'employee/requests/mine',
  reportEligibility: (taskId: string) => `employee/report-eligibility/${taskId}`,
  reopenEligibility: (taskId: string) => `manager/reopen-eligibility/${taskId}`,
  /** The read-only project explorer and overview: one authorized scope, shared by member screens. */
  workProjects: 'work/projects',
  workOverview: 'work/overview',
  workProject: (id: string) => `work/project/${id}`,
  /** Prefix of every server-searched option list; a task save invalidates all of them. */
  parentOptions: 'parent-options:',
  /** The read-only timeline: a task or project change dates it, so a save refreshes it. */
  timeline: 'work/timeline'
};

export type QueryResult<T> = QuerySnapshot<T> & {
  refresh: () => void;
  /** Re-reads only when the displayed payload is older than the revalidation window. */
  revalidate: () => void;
};

export function useQuery<T>(
  key: string,
  loader: () => Promise<T>,
  options: { enabled?: boolean } = {}
): QueryResult<T> {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seenVersion = useRef(queryCache.version(key));

  useEffect(() => {
    if (options.enabled === false) return undefined;
    let cancelled = false;
    seenVersion.current = queryCache.version(key);
    queryCache.activate(key, () => loaderRef.current());
    void queryCache
      .fetch(key, () => loaderRef.current())
      .then(() => {
        if (!cancelled) rerender();
      })
      .catch(() => {
        if (!cancelled) rerender();
      });
    // Key-scoped notification: this component re-renders only when its own entry changed, so an
    // unrelated save never repaints every open list.
    const unsubscribe = queryCache.subscribe(() => {
      if (cancelled) return;
      const version = queryCache.version(key);
      if (version === seenVersion.current) return;
      seenVersion.current = version;
      rerender();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      queryCache.deactivate(key);
    };
  }, [key, options.enabled]);

  const refresh = (): void => {
    void queryCache.fetch(key, () => loaderRef.current(), { force: true }).catch(() => undefined);
  };

  return {
    ...queryCache.peek<T>(key),
    refresh,
    revalidate: () => {
      if (!queryCache.peek<T>(key).stale) return;
      refresh();
    }
  };
}