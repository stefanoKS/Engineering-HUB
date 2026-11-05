/**
 * Calendar arithmetic for the read-only timeline.
 *
 * Every value is a calendar date (YYYY-MM-DD) in Asia/Tokyo business terms, never an instant, so
 * a bar never shifts because a browser sits in another time zone. All arithmetic happens in UTC
 * on the parsed date parts, which keeps a month boundary exact.
 */

export type TimelineScale = 'WEEK' | 'MONTH' | 'QUARTER';

const DAY_MS = 86_400_000;

export function todayJst(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  return parts.replace(/\//g, '-');
}

export function parseDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

export function toDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(ms: number, days: number): number {
  return ms + days * DAY_MS;
}

export function dayDiff(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

export function startOfWeek(ms: number): number {
  const date = new Date(ms);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(ms, -weekday);
}

export function startOfMonth(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export function addMonths(ms: number, months: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

export function endOfMonth(ms: number): number {
  return addDays(addMonths(ms, 1), -1);
}

export function startOfQuarter(ms: number): number {
  const date = new Date(ms);
  const month = Math.floor(date.getUTCMonth() / 3) * 3;
  return Date.UTC(date.getUTCFullYear(), month, 1);
}

export function addQuarters(ms: number, quarters: number): number {
  return addMonths(startOfQuarter(ms), quarters * 3);
}

export function endOfQuarter(ms: number): number {
  return endOfMonth(addMonths(startOfQuarter(ms), 2));
}

/** The window one scale shows, anchored on a date inside it. */
export function scaleWindow(scale: TimelineScale, anchor: string): { from: string; to: string; days: number } {
  const base = parseDate(anchor) ?? (parseDate(todayJst()) as number);
  if (scale === 'WEEK') {
    const from = startOfWeek(base);
    return { from: toDate(from), to: toDate(addDays(from, 6)), days: 7 };
  }

  if (scale === 'MONTH') {
    const from = startOfMonth(base);
    const to = endOfMonth(base);
    return { from: toDate(from), to: toDate(to), days: dayDiff(from, to) + 1 };
  }
  const from = startOfQuarter(base);
  const to = endOfQuarter(base);
  return { from: toDate(from), to: toDate(to), days: dayDiff(from, to) + 1 };
}

/** The current Tokyo calendar month, used only to reset a display window. */
export function calendarMonthWindow(anchor = todayJst()): { from: string; to: string; days: number } {
  const base = parseDate(anchor) ?? (parseDate(todayJst()) as number);
  const from = startOfMonth(base);
  const to = endOfMonth(base);
  return { from: toDate(from), to: toDate(to), days: dayDiff(from, to) + 1 };
}

/** Date ranges and tick density are deliberately independent. */
export function scaleForRange(days: number): TimelineScale {
  if (days <= 35) return 'WEEK';
  if (days <= 180) return 'MONTH';
  return 'QUARTER';
}

/** One step of the same scale: previous period, next period. */
export function shiftAnchor(scale: TimelineScale, anchor: string, direction: 1 | -1): string {
  const base = parseDate(anchor) ?? (parseDate(todayJst()) as number);
  if (scale === 'WEEK') return toDate(addDays(base, direction * 7));
  if (scale === 'MONTH') return toDate(addMonths(base, direction));
  return toDate(addQuarters(base, direction));
}

export const DAY_WIDTH: Record<TimelineScale, number> = { WEEK: 48, MONTH: 22, QUARTER: 10 };

/** A clamped pixel span for one range, or null when it falls outside the window. */
export function spanOf(
  start: string | null,
  end: string | null,
  window: { from: string; to: string; days: number },
  dayWidth: number
): { left: number; width: number; clampedStart: boolean; clampedEnd: boolean } | null {
  if (!start && !end) return null;
  const windowStart = parseDate(window.from);
  const windowEnd = parseDate(window.to);
  if (windowStart === null || windowEnd === null) return null;
  const startMs = start ? parseDate(start) : parseDate(end as string);
  const endMs = end ? parseDate(end) : startMs;
  if (startMs === null || endMs === null) return null;
  if (endMs < windowStart || startMs > windowEnd) return null;
  const clampedStart = startMs < windowStart;
  const clampedEnd = endMs > windowEnd;
  const from = Math.max(startMs, windowStart);
  const to = Math.min(endMs, windowEnd);
  return {
    left: dayDiff(windowStart, from) * dayWidth,
    width: Math.max((dayDiff(from, to) + 1) * dayWidth, dayWidth),
    clampedStart,
    clampedEnd
  };
}

/** A marker (deadline or completion) inside the window, or null when it is outside. */
export function markerOf(
  value: string | null,
  window: { from: string; to: string; days: number },
  dayWidth: number
): number | null {
  if (!value) return null;
  const windowStart = parseDate(window.from);
  const point = parseDate(value);
  if (windowStart === null || point === null) return null;
  const offset = dayDiff(windowStart, point);
  if (offset < 0 || offset >= window.days) return null;
  return offset * dayWidth;
}

/** The widest range among the given dates, used by "fit selection". */
export function rangeOf(dates: (string | null)[]): { from: string; to: string } | null {
  const values = dates.filter((value): value is string => !!value).sort();
  if (values.length === 0) return null;
  return { from: values[0] as string, to: values[values.length - 1] as string };
}
