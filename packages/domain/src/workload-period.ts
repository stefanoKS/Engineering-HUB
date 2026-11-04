/**
 * Report periods for the date-based workload report.
 *
 * A period is a pair of inclusive Asia/Tokyo calendar dates resolved on the server, plus the
 * buckets the timeline draws. Nothing here counts working days, filters Japanese public holidays
 * or converts a duration into hours: a Saturday deadline is an ordinary calendar day, exactly as
 * it is stored.
 */
import { DomainError } from './errors';
import { addDays, businessDate, diffDays, fromUtc, isIsoDate, weekday } from './time';

export const WORKLOAD_MODES = ['DAY', 'WEEK', 'MONTH', 'YEAR', 'CUSTOM'] as const;
export type WorkloadMode = (typeof WORKLOAD_MODES)[number];

export const WORKLOAD_GRANULARITIES = ['DAY', 'WEEK', 'MONTH'] as const;
export type WorkloadGranularity = (typeof WORKLOAD_GRANULARITIES)[number];

/** Inclusive custom range limit; a manager never asks a bounded query to scan a decade. */
export const MAX_CUSTOM_RANGE_DAYS = 366;

export type WorkloadPeriodInput = {
  mode?: string | null;
  anchor?: string | null;
  start?: string | null;
  end?: string | null;
  granularity?: string | null;
  today?: string;
};

export type WorkloadBucket = { key: string; start: string; end: string };

export type WorkloadPeriod = {
  mode: WorkloadMode;
  start: string;
  end: string;
  granularity: WorkloadGranularity;
  buckets: WorkloadBucket[];
};

function requireDate(value: string | null | undefined, field: string): string {
  if (!isIsoDate(value)) {
    throw new DomainError('VALIDATION_FAILED', `${field} must be a calendar date (YYYY-MM-DD)`, { field });
  }
  return value;
}

/** Monday of the ISO working week that contains `date`; used for week boundaries only. */
export function startOfWorkWeek(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const [year, month] = date.split('-').map(Number) as [number, number, number];
  return fromUtc(new Date(Date.UTC(year, month, 0)));
}

/** Moves an anchor by whole days, weeks, months or years without touching stored data. */
export function shiftAnchor(mode: WorkloadMode, anchor: string, amount: number): string {
  switch (mode) {
    case 'DAY':
      return addDays(anchor, amount);
    case 'WEEK':
      return addDays(anchor, amount * 7);
    case 'MONTH': {
      const [year, month] = anchor.split('-').map(Number) as [number, number, number];
      return fromUtc(new Date(Date.UTC(year, month - 1 + amount, 1)));
    }
    case 'YEAR':
      return `${String(Number(anchor.slice(0, 4)) + amount).padStart(4, '0')}-01-01`;
    default:
      return anchor;
  }
}

export function defaultGranularity(days: number): WorkloadGranularity {
  if (days <= 14) return 'DAY';
  if (days <= 90) return 'WEEK';
  return 'MONTH';
}

/**
 * Splits an inclusive range into readable buckets. A partial first or last bucket keeps its real
 * bounds, so the sum of the bucket counts equals the period counts.
 */
export function buildBuckets(start: string, end: string, granularity: WorkloadGranularity): WorkloadBucket[] {
  if (start > end) throw new DomainError('VALIDATION_FAILED', 'The report start must not be after its end');
  const buckets: WorkloadBucket[] = [];
  let cursor = granularity === 'MONTH' ? startOfMonth(start) : granularity === 'WEEK' ? startOfWorkWeek(start) : start;
  let guard = 0;
  while (cursor <= end) {
    if (++guard > 400) {
      throw new DomainError('VALIDATION_FAILED', 'The report range is too large for the selected granularity');
    }
    const bucketEnd = granularity === 'DAY' ? cursor : granularity === 'WEEK' ? addDays(cursor, 6) : endOfMonth(cursor);
    buckets.push({
      key: granularity === 'MONTH' ? cursor.slice(0, 7) : cursor,
      start: cursor < start ? start : cursor,
      end: bucketEnd > end ? end : bucketEnd
    });
    cursor = granularity === 'DAY' ? addDays(cursor, 1) : addDays(bucketEnd, 1);
  }
  return buckets;
}

/** Resolves the requested mode to one inclusive range. Every date decision happens here. */
export function resolveWorkloadPeriod(input: WorkloadPeriodInput = {}): WorkloadPeriod {
  const today = input.today ?? businessDate();
  const mode = String(input.mode ?? 'WEEK').trim().toUpperCase() as WorkloadMode;
  if (!(WORKLOAD_MODES as readonly string[]).includes(mode)) {
    throw new DomainError('VALIDATION_FAILED', `Unknown report mode: ${String(input.mode)}`, { field: 'mode' });
  }
  const anchor = input.anchor ? requireDate(input.anchor, 'anchor') : today;

  let start: string;
  let end: string;
  switch (mode) {
    case 'DAY':
      start = anchor;
      end = anchor;
      break;
    case 'WEEK': {
      start = startOfWorkWeek(anchor);
      end = addDays(start, 6);
      break;
    }
    case 'MONTH':
      start = startOfMonth(anchor);
      end = endOfMonth(anchor);
      break;
    case 'YEAR':
      start = `${anchor.slice(0, 4)}-01-01`;
      end = `${anchor.slice(0, 4)}-12-31`;
      break;
    default: {
      start = requireDate(input.start, 'start');
      end = requireDate(input.end, 'end');
      if (start > end) {
        throw new DomainError('VALIDATION_FAILED', 'The start date must be on or before the end date', {
          field: 'start'
        });
      }
      if (diffDays(start, end) + 1 > MAX_CUSTOM_RANGE_DAYS) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `A custom range is limited to ${MAX_CUSTOM_RANGE_DAYS} days`,
          { field: 'end', maxDays: MAX_CUSTOM_RANGE_DAYS }
        );
      }
      break;
    }
  }

  const days = diffDays(start, end) + 1;
  const granularity =
    mode === 'YEAR'
      ? 'MONTH'
      : mode === 'CUSTOM' && input.granularity
        ? parseGranularity(input.granularity)
        : mode === 'CUSTOM'
          ? defaultGranularity(days)
          : 'DAY';

  return { mode, start, end, granularity, buckets: buildBuckets(start, end, granularity) };
}

function parseGranularity(value: string): WorkloadGranularity {
  const normalized = String(value).trim().toUpperCase() as WorkloadGranularity;
  if (!(WORKLOAD_GRANULARITIES as readonly string[]).includes(normalized)) {
    throw new DomainError('VALIDATION_FAILED', `Unknown granularity: ${value}`, { field: 'granularity' });
  }
  return normalized;
}
