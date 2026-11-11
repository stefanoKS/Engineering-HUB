/**
 * One formatting rule for every displayed instant and date.
 *
 * Two different kinds of value reach the interface and they must never be treated the same way:
 *
 * - an **instant** (an ISO timestamp such as `submittedAt`) is displayed in Asia/Tokyo, because the
 *   department plans and reviews in that zone. A timestamp that is stored as UTC therefore shows
 *   the Tokyo wall-clock time and can fall on the next Tokyo calendar day;
 * - a **date only** value (`Due_Date`, `plannedStart`) carries no time and no zone. It is displayed
 *   exactly as stored, so a deadline never shifts by a day because the browser is west of UTC.
 *
 * Stored strings are never rewritten; these helpers only format for display.
 */

const TOKYO_TIME_ZONE = 'Asia/Tokyo';

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TOKYO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TOKYO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TOKYO_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsOf(format: Intl.DateTimeFormat, value: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(value)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

/** A stored date-only value, unchanged. An unparseable value is returned as stored. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const match = DATE_ONLY.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  if (!isRealDate(Number(year), Number(month), Number(day))) return value;
  return value;
}

/**
 * A stored instant, rendered as an Asia/Tokyo wall-clock value (`YYYY-MM-DD HH:mm`).
 *
 * An unparseable value is returned as stored rather than replaced with a fabricated date, so a
 * contract violation stays visible instead of silently showing "today".
 */
export function formatTokyoTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  const parts = partsOf(TIME_FORMAT, instant);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** The Asia/Tokyo clock time of an instant, for a same-day "updated at 14:05" label. */
export function formatTokyoClock(value: string | null | undefined): string {
  if (!value) return '';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  const parts = partsOf(CLOCK_FORMAT, instant);
  return `${parts.hour}:${parts.minute}`;
}

/** The Asia/Tokyo calendar date of an instant, for grouping a timestamp by business day. */
export function tokyoCalendarDate(value: string | null | undefined): string {
  if (!value) return '';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  const parts = partsOf(DATE_FORMAT, instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * An age in whole minutes, used only to decide how a freshness label reads. It never becomes a
 * stored value and it never depends on the browser's locale.
 */
export function minutesSince(updatedAt: number, now: number = Date.now()): number {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 0;
  return Math.max(0, Math.floor((now - updatedAt) / 60_000));
}
