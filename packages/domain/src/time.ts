/**
 * Asia/Tokyo business dates.
 *
 * A calendar date (deadline, start, completion) is a `YYYY-MM-DD` string and never an instant,
 * so a server in another time zone cannot shift it by a day. An instant is a Date/ISO timestamp.
 */
export const BUSINESS_TIME_ZONE = 'Asia/Tokyo';
const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** The business date of an instant (what "today" means to a manager in Japan). */
export function businessDate(instant: Date = new Date()): string {
  return formatter.format(instant);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function toUtc(date: string): Date {
  if (!isIsoDate(date)) throw new Error(`Invalid calendar date: ${date}`);
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, amount: number): string {
  return fromUtc(new Date(toUtc(date).getTime() + amount * DAY_MS));
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

export function compareDates(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(date: string): number {
  return toUtc(date).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const day = weekday(date);
  return day === 0 || day === 6;
}

export type Holiday = { date: string; name?: string };

export type WorkingCalendar = {
  isWorkingDay(date: string): boolean;
  /** The closest working day at or before `date` (inclusive) / strictly before it. */
  previousWorkingDay(date: string, inclusive: boolean): string;
  addWorkingDays(date: string, amount: number): string;
  workingDaysBetween(from: string, to: string): number;
};

export function createCalendar(holidays: readonly Holiday[] = []): WorkingCalendar {
  const blocked = new Set(holidays.map((entry) => entry.date));
  function isWorkingDay(date: string): boolean {
    return isIsoDate(date) && !isWeekend(date) && !blocked.has(date);
  }
  function previousWorkingDay(date: string, inclusive: boolean): string {
    let current = inclusive ? date : addDays(date, -1);
    let guard = 0;
    while (!isWorkingDay(current)) {
      current = addDays(current, -1);
      if (++guard > 400) throw new Error('No working day found within 400 days');
    }
    return current;
  }
  function addWorkingDays(date: string, amount: number): string {
    let current = date;
    let remaining = Math.abs(amount);
    const step = amount < 0 ? -1 : 1;
    let guard = 0;
    while (remaining > 0) {
      current = addDays(current, step);
      if (isWorkingDay(current)) remaining -= 1;
      if (++guard > 5000) throw new Error('Working day walk exceeded a safe bound');
    }
    return current;
  }
  function workingDaysBetween(from: string, to: string): number {
    if (from > to) return -workingDaysBetween(to, from);
    let count = 0;
    let current = from;
    let guard = 0;
    while (current < to) {
      if (isWorkingDay(current)) count += 1;
      current = addDays(current, 1);
      if (++guard > 5000) throw new Error('Working day walk exceeded a safe bound');
    }
    return count;
  }
  return { isWorkingDay, previousWorkingDay, addWorkingDays, workingDaysBetween };
}

/**
 * Normalizes a stored or supplied value to a calendar date, keeping "unknown" as null.
 * V1 stored dates as formatted text; a migrated value such as 2026/03/04 must not be
 * silently reinterpreted as an instant.
 */
export function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : fromUtc(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (isIsoDate(text)) return text;
  const separators = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/;
  const match = separators.exec(text);
  if (match) {
    const [, y, m, d] = match as unknown as [string, string, string, string];
    const candidate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return isIsoDate(candidate) ? candidate : null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : fromUtc(parsed);
}

export function nowIso(instant: Date = new Date()): string {
  return instant.toISOString();
}

/** Business-day window used by "due soon" indicators. */
export function deadlineState(
  deadline: string | null,
  status: string,
  today: string = businessDate(),
  dueSoonDays = 7
): 'NONE' | 'OK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' {
  if (status === 'Done' || status === 'Completed') return 'COMPLETED';
  if (!deadline) return 'NONE';
  if (deadline < today) return 'OVERDUE';
  if (diffDays(today, deadline) <= dueSoonDays) return 'DUE_SOON';
  return 'OK';
}
