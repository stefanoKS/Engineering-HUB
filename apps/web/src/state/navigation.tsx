import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Actor } from '@eh/contracts';
import { useI18n } from '../i18n';

type Entry = { path: string; previous: number | null };

const entries = new Map<number, Entry>();
const routeMemory = new Map<string, unknown>();
let currentEntry: number | null = null;
let nextEntry = 1;
/**
 * Identifies the signed-in session's navigation memory. A sign-out advances it, so a callback that
 * was already in flight cannot repopulate the next user's remembered filters, selections or scroll
 * position.
 */
let memoryEpoch = 0;

/**
 * Route definitions.
 *
 * One table decides which paths exist and who may reach them. Before this was centralised, `App`
 * rendered a route the Back allowlist did not know, so Back from an administration screen could
 * leave an administrator on a fallback screen. A route is now defined once, and the renderer, the
 * role guard and the Back behaviour all read the same entry.
 */
export type RouteAccess = 'all' | 'manager' | 'admin';

export const APP_ROUTES = {
  overview: 'all',
  'my-work': 'all',
  'all-work': 'all',
  tasks: 'all',
  task: 'all',
  projects: 'all',
  project: 'all',
  timeline: 'all',
  responsibilities: 'manager',
  members: 'manager',
  member: 'manager',
  skills: 'manager',
  requests: 'manager',
  workload: 'manager',
  automation: 'manager',
  status: 'manager',
  accounts: 'admin',
  divisions: 'admin',
  'deleted-items': 'manager'
} as const satisfies Record<string, RouteAccess>;

export type AppRoute = keyof typeof APP_ROUTES;

export function firstSegment(path: string): string {
  return path.split('?')[0]?.split('/').filter(Boolean)[0] ?? 'overview';
}

export function routeAllowed(path: string, actor: Actor): boolean {
  const first = firstSegment(path);
  if (!Object.prototype.hasOwnProperty.call(APP_ROUTES, first)) return false;
  const access = APP_ROUTES[first as AppRoute];
  if (access === 'all') return true;
  if (access === 'manager') return actor.role === 'ADMIN' || actor.role === 'MANAGER';
  return actor.role === 'ADMIN';
}

export function recordRoute(path: string): void {
  const state = window.history.state as { ehEntry?: unknown } | null;
  const known = typeof state?.ehEntry === 'number' && entries.has(state.ehEntry)
    ? state.ehEntry
    : null;
  if (known !== null) {
    currentEntry = known;
    return;
  }
  const entry = nextEntry++;
  entries.set(entry, { path, previous: currentEntry });
  currentEntry = entry;
  window.history.replaceState({ ...(state ?? {}), ehEntry: entry }, '', window.location.href);
}

export function backOrFallback(actor: Actor, fallback: string): void {
  const current = currentEntry === null ? null : entries.get(currentEntry);
  const previous = current?.previous === null || current?.previous === undefined
    ? null
    : entries.get(current.previous);
  if (previous && routeAllowed(previous.path, actor)) {
    window.history.back();
    return;
  }
  const safeFallback = routeAllowed(fallback, actor) ? fallback : 'my-work';
  const oldURL = window.location.href;
  const state = window.history.state as Record<string, unknown> | null;
  window.history.replaceState(state ?? {}, '', `#/${safeFallback}`);
  if (currentEntry !== null) entries.set(currentEntry, { path: safeFallback, previous: null });
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }));
}

export function rememberScroll(path: string, scrollY: number): void {
  routeMemory.set(`scroll:${path}`, scrollY);
}

export function rememberedScroll(path: string): number {
  return Number(routeMemory.get(`scroll:${path}`) ?? 0);
}

/**
 * Ends the signed-in session's navigation memory.
 *
 * Called on sign-out and on a lost session. The browser history entries themselves stay (the user
 * may still press Back), but their identifiers are forgotten, so the next session starts with a
 * fresh memory instead of inheriting another user's filters, selected record or scroll position.
 */
export function resetRouteMemory(): void {
  entries.clear();
  routeMemory.clear();
  currentEntry = null;
  nextEntry = 1;
  memoryEpoch += 1;
}

export function currentMemoryEpoch(): number {
  return memoryEpoch;
}

export function useRouteMemoryState<T>(
  key: string,
  initialValue: T | (() => T),
  options: { resetToInitial?: boolean } = {}
): [T, Dispatch<SetStateAction<T>>] {
  const epoch = useRef(memoryEpoch);
  const [value, setValue] = useState<T>(() => {
    const initial = initialValue instanceof Function ? initialValue() : initialValue;
    if (options.resetToInitial) {
      routeMemory.set(key, initial);
      return initial;
    }
    if (routeMemory.has(key)) return routeMemory.get(key) as T;
    return initial;
  });
  const update = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    // A write that belongs to an ended session never reaches the new session's memory.
    if (epoch.current !== memoryEpoch) return;
    setValue((current) => {
      const value = next instanceof Function ? next(current) : next;
      routeMemory.set(key, value);
      return value;
    });
  }, [key]);
  return [value, update];
}

export function BackButton({
  actor,
  fallback,
  disabled = false
}: {
  actor: Actor;
  fallback: string;
  disabled?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="link-button back-button"
      disabled={disabled}
      onClick={() => backOrFallback(actor, fallback)}
    >
      {t('nav.back')}
    </button>
  );
}
