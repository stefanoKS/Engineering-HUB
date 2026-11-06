/**
 * The Asia/Tokyo business date of the open page.
 *
 * Date-dependent labels (a derived schedule badge, an overdue deadline) must not stay frozen in a
 * tab that was left open overnight. The value is re-read at the next Tokyo midnight and whenever
 * the page regains focus; including it in a query key re-reads the server's answer, which is
 * calculated from the same calendar date. Nothing polls, and nothing is written.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { businessDate } from '@eh/domain';
import { DATE_DEPENDENT_PREFIXES, queryCache } from './cache';

const DAY_MS = 86_400_000;
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Milliseconds until the next Asia/Tokyo midnight (Tokyo has no daylight-saving offset). */
export function msUntilTokyoMidnight(now: Date): number {
  const shifted = now.getTime() + TOKYO_OFFSET_MS;
  const intoDay = shifted % DAY_MS;
  return Math.max(1000, DAY_MS - intoDay + 1000);
}

export function useBusinessDate(): string {
  const [today, setToday] = useState<string>(() => businessDate());
  const sync = useCallback((): void => {
    setToday((current) => {
      const next = businessDate();
      return next === current ? current : next;
    });
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      timer = setTimeout(() => {
        sync();
        schedule();
      }, msUntilTokyoMidnight(new Date()));
    };
    schedule();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [sync]);

  return today;
}

/**
 * The same business date, plus one invalidation when it changes.
 *
 * The server derives every schedule state from its own Asia/Tokyo date, so a page left open across
 * midnight must re-read the answers it shows rather than keep yesterday's badge. Only mounted
 * queries are refetched; nothing is written and nothing polls.
 */
export function useBusinessDateRefresh(): string {
  const today = useBusinessDate();
  const seen = useRef(today);
  useEffect(() => {
    if (seen.current === today) return;
    seen.current = today;
    queryCache.invalidate([...DATE_DEPENDENT_PREFIXES]);
  }, [today]);
  return today;
}
