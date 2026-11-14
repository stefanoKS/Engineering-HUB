/**
 * Calendar arithmetic and read-only viewport geometry for the timeline.
 *
 * Dates are YYYY-MM-DD values in Asia/Tokyo business terms. Arithmetic uses UTC date parts only,
 * so a browser's local zone and daylight-saving transitions cannot move an item on the chart.
 */

export type TimelineWindow = { from: string; to: string; days: number };
export type TimelinePreset = 'week' | 'fortnight' | 'month' | 'quarter' | 'custom';

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
  const parsed = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return toDate(parsed) === value ? parsed : null;
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

export function windowOf(from: string, to: string): TimelineWindow | null {
  const start = parseDate(from);
  const finish = parseDate(to);
  if (start === null || finish === null || start > finish) return null;
  return { from, to, days: dayDiff(start, finish) + 1 };
}

export function startOfWeek(ms: number): number {
  const date = new Date(ms);
  return addDays(ms, -((date.getUTCDay() + 6) % 7));
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
  return Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1);
}

export function addQuarters(ms: number, quarters: number): number {
  return addMonths(startOfQuarter(ms), quarters * 3);
}

export function endOfQuarter(ms: number): number {
  return endOfMonth(addMonths(startOfQuarter(ms), 2));
}

export function calendarMonthWindow(anchor = todayJst()): TimelineWindow {
  const base = parseDate(anchor) ?? (parseDate(todayJst()) as number);
  const from = startOfMonth(base);
  const to = endOfMonth(base);
  return { from: toDate(from), to: toDate(to), days: dayDiff(from, to) + 1 };
}

/** A calendar quarter: three whole months, so a leap February never shifts the boundary. */
export function calendarQuarterWindow(anchor = todayJst()): TimelineWindow {
  const base = parseDate(anchor) ?? (parseDate(todayJst()) as number);
  const from = startOfQuarter(base);
  const to = endOfQuarter(base);
  return { from: toDate(from), to: toDate(to), days: dayDiff(from, to) + 1 };
}

export function presetFinish(start: string, preset: Exclude<TimelinePreset, 'custom'>): string | null {
  const value = parseDate(start);
  if (value === null) return null;
  if (preset === 'week' || preset === 'fortnight') return toDate(addDays(value, preset === 'week' ? 6 : 13));
  const date = new Date(value);
  const months = preset === 'month' ? 1 : 3;
  const target = addMonths(value, months);
  const last = endOfMonth(target);
  const sameDay = addDays(target, date.getUTCDate() - 1);
  return toDate(sameDay <= last ? addDays(sameDay, -1) : last);
}

/**
 * The window a preset means when it is selected.
 *
 * Week and fortnight are day spans from the anchor. Month and quarter are the calendar unit that
 * contains the anchor, which makes their navigation unambiguous at a month end or in a leap year.
 */
export function presetWindow(
  anchor: string,
  preset: Exclude<TimelinePreset, 'custom'>
): TimelineWindow | null {
  if (parseDate(anchor) === null) return null;
  if (preset === 'month') return calendarMonthWindow(anchor);
  if (preset === 'quarter') return calendarQuarterWindow(anchor);
  const finish = presetFinish(anchor, preset);
  return finish ? windowOf(anchor, finish) : null;
}

function windowFrom(startMs: number, endMs: number): TimelineWindow {
  return { from: toDate(startMs), to: toDate(endMs), days: dayDiff(startMs, endMs) + 1 };
}

/**
 * Moves the visible window one unit. `week`/`fortnight` shift by days and `custom` shifts by its
 * own length; `month`/`quarter` snap to the containing calendar unit and step by that unit. Only
 * the viewport changes - a stored date is never touched.
 */
export function navigateWindow(
  window: TimelineWindow,
  preset: TimelinePreset,
  direction: -1 | 1
): TimelineWindow {
  const from = parseDate(window.from);
  const to = parseDate(window.to);
  if (from === null || to === null) return window;
  if (preset === 'month' || preset === 'quarter') {
    const base = preset === 'month' ? startOfMonth(from) : startOfQuarter(from);
    const next = preset === 'month' ? addMonths(base, direction) : addQuarters(base, direction);
    return windowFrom(next, preset === 'month' ? endOfMonth(next) : endOfQuarter(next));
  }
  const shift = preset === 'week' ? 7 : preset === 'fortnight' ? 14 : window.days;
  return windowFrom(addDays(from, shift * direction), addDays(to, shift * direction));
}

/**
 * Brings the Tokyo business date into view without changing the zoom.
 *
 * A dedicated period preset means the calendar unit that contains today. A day-span preset keeps
 * its length; when today is already visible the window is returned unchanged instead of jumping.
 */
export function todayWindow(
  window: TimelineWindow,
  preset: TimelinePreset,
  today: string = todayJst()
): TimelineWindow {
  if (preset === 'month') return calendarMonthWindow(today);
  if (preset === 'quarter') return calendarQuarterWindow(today);
  const day = parseDate(today);
  const from = parseDate(window.from);
  const to = parseDate(window.to);
  if (day === null || from === null || to === null) return window;
  if (day >= from && day <= to) return window;
  const start = addDays(day, -Math.floor((window.days - 1) / 2));
  return windowFrom(start, addDays(start, window.days - 1));
}

export function dateToPixel(value: string, window: TimelineWindow, pixelsPerDay: number): number | null {
  const start = parseDate(window.from);
  const date = parseDate(value);
  if (start === null || date === null || !Number.isFinite(pixelsPerDay)) return null;
  return dayDiff(start, date) * pixelsPerDay;
}

export function pixelToDate(pixel: number, window: TimelineWindow, pixelsPerDay: number): string | null {
  const start = parseDate(window.from);
  if (start === null || !Number.isFinite(pixel) || !Number.isFinite(pixelsPerDay) || pixelsPerDay <= 0) return null;
  const offset = Math.min(window.days - 1, Math.max(0, Math.floor(pixel / pixelsPerDay)));
  return toDate(addDays(start, offset));
}

/** A clamped pixel span for an inclusive range, or null when it falls outside the visible window. */
export function spanOf(
  start: string | null,
  end: string | null,
  window: TimelineWindow,
  pixelsPerDay: number
): { left: number; width: number; clampedStart: boolean; clampedEnd: boolean } | null {
  if (!start && !end) return null;
  const windowStart = parseDate(window.from);
  const windowEnd = parseDate(window.to);
  const startMs = start ? parseDate(start) : parseDate(end as string);
  const endMs = end ? parseDate(end) : startMs;
  if (windowStart === null || windowEnd === null || startMs === null || endMs === null || endMs < windowStart || startMs > windowEnd) return null;
  const from = Math.max(startMs, windowStart);
  const to = Math.min(endMs, windowEnd);
  return {
    left: dayDiff(windowStart, from) * pixelsPerDay,
    width: (dayDiff(from, to) + 1) * pixelsPerDay,
    clampedStart: startMs < windowStart,
    clampedEnd: endMs > windowEnd
  };
}

/**
 * Bar geometry in CSS pixels.
 *
 * The height is a chart-wide token (`--tl-bar-height` in `styles.css` carries the same value for
 * the drawn element); the small number the design asks for is the *horizontal* width of a point
 * mark (a deadline-only or same-day record), not the height of every bar. A point mark is centred
 * in its day cell and a very short duration keeps a minimum visible width without changing a
 * single date.
 */
export const TIMELINE_BAR = {
  height: 12,
  pointWidth: 3,
  minWidth: 6
} as const;

export type BarGeometry = {
  left: number;
  width: number;
  point: boolean;
  clampedStart: boolean;
  clampedEnd: boolean;
};

export function barGeometry(
  start: string | null,
  finish: string | null,
  window: TimelineWindow,
  pixelsPerDay: number
): BarGeometry | null {
  const span = spanOf(start, finish, window, pixelsPerDay);
  if (!span) return null;
  const total = window.days * pixelsPerDay;
  if (!Number.isFinite(total) || total <= 0) return null;
  const point = !!start && !!finish && start === finish;
  if (point) {
    const width = Math.min(TIMELINE_BAR.pointWidth, total);
    const centre = span.left + span.width / 2 - width / 2;
    return {
      left: Math.min(Math.max(0, centre), Math.max(0, total - width)),
      width,
      point: true,
      clampedStart: span.clampedStart,
      clampedEnd: span.clampedEnd
    };
  }
  const width = Math.min(Math.max(span.width, TIMELINE_BAR.minWidth), total);
  return {
    left: Math.min(Math.max(0, span.left), Math.max(0, total - width)),
    width,
    point: false,
    clampedStart: span.clampedStart,
    clampedEnd: span.clampedEnd
  };
}

export function markerOf(value: string | null, window: TimelineWindow, pixelsPerDay: number): number | null {
  if (!value) return null;
  const offset = dateToPixel(value, window, pixelsPerDay);
  return offset === null || offset < 0 || offset >= window.days * pixelsPerDay ? null : offset;
}

export function rangeOf(dates: (string | null)[]): { from: string; to: string } | null {
  const values = dates.filter((value): value is string => !!value && parseDate(value) !== null).sort();
  return values.length ? { from: values[0] as string, to: values[values.length - 1] as string } : null;
}

export type AxisTick = { key: string; label: string; left: number; weekend: boolean; major: boolean; alignEnd?: boolean };

/** Calendar-aligned labels with a density derived from the drawable width, not a fixed day size. */
export function axisTicks(window: TimelineWindow, width: number, locale: string): AxisTick[] {
  const start = parseDate(window.from);
  if (start === null || width <= 0) return [];
  const pixelsPerDay = width / window.days;
  const format = (date: Date, options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
  const daily = pixelsPerDay >= 22;
  const weekly = !daily && pixelsPerDay * 7 >= 75;
  const monthly = !daily && !weekly && pixelsPerDay * 30 >= 75;
  const quarterly = !daily && !weekly && !monthly && pixelsPerDay * 91 >= 75;
  const first =
    daily ? start :
    weekly ? startOfWeek(start) :
    monthly ? startOfMonth(start) :
    quarterly ? startOfQuarter(start) :
    Date.UTC(new Date(start).getUTCFullYear(), 0, 1);
  const step = daily ? (value: number) => addDays(value, 1) :
    weekly ? (value: number) => addDays(value, 7) :
    monthly ? (value: number) => addMonths(value, 1) :
    quarterly ? (value: number) => addQuarters(value, 1) :
    (value: number) => Date.UTC(new Date(value).getUTCFullYear() + 1, 0, 1);
  const ticks: AxisTick[] = [];
  const end = parseDate(window.to) as number;
  const formatTick = (value: number, boundary: boolean): AxisTick => {
    const date = new Date(value);
    return {
      key: toDate(value),
      label: boundary ? format(date, { month: 'numeric', day: 'numeric' }) :
        daily ? format(date, { day: 'numeric' }) :
        weekly ? format(date, { month: 'short', day: 'numeric' }) :
        monthly ? format(date, { month: 'short' }) :
        quarterly ? `Q${Math.floor(date.getUTCMonth() / 3) + 1}` :
        format(date, { year: 'numeric' }),
      left: dayDiff(start, value) * pixelsPerDay,
      weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
      major: date.getUTCDate() === 1
    };
  };
  for (let value = first; value <= end && ticks.length < 200; value = step(value)) {
    if (value < start) continue;
    const offset = dayDiff(start, value) * pixelsPerDay;
    if (offset >= width) break;
    ticks.push(formatTick(value, false));
  }
  const boundaryWidth = 60;
  if (window.days === 1) return [formatTick(start, true)];
  if (daily) return ticks;
  if (width < boundaryWidth * 2) return [formatTick(start, true)];
  const firstTick = formatTick(start, true);
  const lastTick = formatTick(end, true);
  lastTick.alignEnd = true;
  return [firstTick, ...ticks.filter((tick) => tick.left >= boundaryWidth && tick.left < lastTick.left - boundaryWidth - 35), lastTick];
}

/** Bounded month/year context, independent of browser timezone. */
export function axisContext(window: TimelineWindow, width: number, locale: string): AxisTick[] {
  const start = parseDate(window.from);
  const end = parseDate(window.to);
  if (start === null || end === null || width <= 0) return [];
  const format = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', timeZone: 'UTC' });
  const step = Math.max(1, Math.ceil(window.days / 30 / Math.max(1, Math.floor(width / 120))));
  const result: AxisTick[] = [];
  for (let value = startOfMonth(start); value <= end && result.length < 100; value = addMonths(value, step)) {
    const left = Math.max(0, dayDiff(start, value) * width / window.days);
    if (result.length && left > width - 120) continue;
    if (result.length && left - (result[result.length - 1]?.left ?? 0) < 120) continue;
    result.push({ key: toDate(value), label: format.format(new Date(value)), left, weekend: false, major: true });
  }
  return result;
}
