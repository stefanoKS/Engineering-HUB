import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { Actor } from '@eh/contracts';
import { useI18n } from '../i18n';

type Entry = { path: string; previous: number | null };

const entries = new Map<number, Entry>();
const routeMemory = new Map<string, unknown>();
let currentEntry: number | null = null;
let nextEntry = 1;

const APP_ROUTES = new Set([
  'overview',
  'my-work',
  'all-work',
  'tasks',
  'task',
  'projects',
  'project',
  'timeline',
  'responsibilities',
  'members',
  'member',
  'skills',
  'requests',
  'workload',
  'automation',
  'status',
  'accounts'
]);

export function routeAllowed(path: string, actor: Actor): boolean {
  const first = path.split('?')[0]?.split('/').filter(Boolean)[0] ?? 'overview';
  if (!APP_ROUTES.has(first)) return false;
  if (actor.role === 'ADMIN' || actor.role === 'MANAGER') return true;
  return new Set(['overview', 'my-work', 'all-work', 'tasks', 'task', 'projects', 'project', 'timeline']).has(first);
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

export function useRouteMemoryState<T>(
  key: string,
  initialValue: T | (() => T),
  options: { resetToInitial?: boolean } = {}
): [T, Dispatch<SetStateAction<T>>] {
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
