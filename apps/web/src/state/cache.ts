/**
 * Query cache.
 *
 * - in-flight reads are deduplicated per key;
 * - cached data is served immediately and revalidated in the background (stale-while-revalidate);
 * - every read owns its entry, so a superseded read can neither paint, recreate nor clear a newer
 *   entry - invalidation, a forced refresh and a logout all supersede the older owner;
 * - invalidating a prefix refetches the queries that are currently mounted instead of leaving a
 *   blank screen;
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

type Active = {
  count: number;
  loader: () => Promise<unknown>;
};

const STALE_AFTER_MS = 30_000;

class QueryCache {
  private entries = new Map<string, Entry>();
  private active = new Map<string, Active>();
  private listeners = new Set<() => void>();
  generation = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
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
    // A new entry object becomes the sole owner of the key. Any older read still in flight sees
    // a different object in the map and drops its result, error and completion.
    const entry: Entry = {
      data: existing?.data,
      error: undefined,
      updatedAt: existing?.updatedAt ?? 0,
      generation: this.generation
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
   */
  invalidate(prefixes: string[]): void {
    const matches = (key: string): boolean => prefixes.some((prefix) => key.startsWith(prefix));
    let changed = false;
    for (const key of [...this.entries.keys()]) {
      if (!matches(key)) continue;
      this.entries.delete(key);
      changed = true;
    }
    this.generation += 1;
    if (changed || prefixes.length) this.emit();
    for (const [key, active] of [...this.active]) {
      if (!matches(key)) continue;
      // The refetch claims the key again; an older in-flight read can no longer own it.
      void this.fetch(key, active.loader, { force: true }).catch(() => undefined);
    }
  }

  /** Drops every payload. Used on sign-out and on a lost session; nothing is refetched. */
  clear(): void {
    this.entries.clear();
    this.generation += 1;
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

export function useQuery<T>(
  key: string,
  loader: () => Promise<T>,
  options: { enabled?: boolean } = {}
): { data?: T; error?: unknown; loading: boolean; refresh: () => void } {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (options.enabled === false) return undefined;
    let cancelled = false;
    queryCache.activate(key, () => loaderRef.current());
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
      queryCache.deactivate(key);
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