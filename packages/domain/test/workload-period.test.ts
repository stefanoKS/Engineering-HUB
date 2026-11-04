/**
 * Report period resolution.
 *
 * The workload report is a calendar-date report: a week runs Monday to Sunday, Saturday and Sunday
 * are ordinary days, no Japanese public holiday is filtered, and every boundary is decided once on
 * the server in Asia/Tokyo terms.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_RANGE_DAYS,
  businessDate,
  diffDays,
  resolveWorkloadPeriod,
  shiftAnchor,
  startOfWorkWeek
} from '../src/index';

describe('period resolution', () => {
  it('resolves one day', () => {
    const period = resolveWorkloadPeriod({ mode: 'DAY', anchor: '2026-11-04', today: '2026-11-04' });
    expect(period).toMatchObject({ start: '2026-11-04', end: '2026-11-04', granularity: 'DAY' });
    expect(period.buckets).toEqual([{ key: '2026-11-04', start: '2026-11-04', end: '2026-11-04' }]);
  });

  it('runs Monday through Sunday and keeps a weekend anchor inside its week', () => {
    const wednesday = resolveWorkloadPeriod({ mode: 'WEEK', anchor: '2026-11-04', today: '2026-11-04' });
    expect(wednesday.start).toBe('2026-11-02');
    expect(wednesday.end).toBe('2026-11-08');
    expect(wednesday.buckets).toHaveLength(7);

    const saturday = resolveWorkloadPeriod({ mode: 'WEEK', anchor: '2026-11-07', today: '2026-11-04' });
    expect(saturday.start).toBe('2026-11-02');
    const sunday = resolveWorkloadPeriod({ mode: 'WEEK', anchor: '2026-11-08', today: '2026-11-04' });
    expect(sunday.start).toBe('2026-11-02');
    expect(startOfWorkWeek('2026-11-09')).toBe('2026-11-09');
  });

  it('resolves month boundaries including a leap-year February', () => {
    expect(resolveWorkloadPeriod({ mode: 'MONTH', anchor: '2026-02-14' })).toMatchObject({
      start: '2026-02-01',
      end: '2026-02-28'
    });
    expect(resolveWorkloadPeriod({ mode: 'MONTH', anchor: '2028-02-10' })).toMatchObject({
      start: '2028-02-01',
      end: '2028-02-29'
    });
    expect(resolveWorkloadPeriod({ mode: 'MONTH', anchor: '2026-12-31' })).toMatchObject({
      start: '2026-12-01',
      end: '2026-12-31'
    });
    expect(resolveWorkloadPeriod({ mode: 'MONTH', anchor: '2026-11-04' }).buckets).toHaveLength(30);
  });

  it('resolves a whole year into twelve monthly buckets', () => {
    const period = resolveWorkloadPeriod({ mode: 'YEAR', anchor: '2026-11-04' });
    expect(period).toMatchObject({ start: '2026-01-01', end: '2026-12-31', granularity: 'MONTH' });
    expect(period.buckets).toHaveLength(12);
    expect(period.buckets[0]).toEqual({ key: '2026-01', start: '2026-01-01', end: '2026-01-31' });
    expect(period.buckets[11]).toEqual({ key: '2026-12', start: '2026-12-01', end: '2026-12-31' });
  });

  it('accepts an inclusive custom range and picks the documented aggregation', () => {
    const daily = resolveWorkloadPeriod({ mode: 'CUSTOM', start: '2026-11-01', end: '2026-11-14' });
    expect(daily.granularity).toBe('DAY');
    expect(daily.buckets).toHaveLength(14);
    expect(daily.end).toBe('2026-11-14');

    const weekly = resolveWorkloadPeriod({ mode: 'CUSTOM', start: '2026-11-01', end: '2026-11-15' });
    expect(weekly.granularity).toBe('WEEK');
    // 2026-11-01 is a Sunday, so the first bucket covers that single day.
    expect(weekly.buckets[0]).toEqual({ key: '2026-10-26', start: '2026-11-01', end: '2026-11-01' });
    expect(weekly.buckets[weekly.buckets.length - 1]?.end).toBe('2026-11-15');

    const monthly = resolveWorkloadPeriod({ mode: 'CUSTOM', start: '2026-01-15', end: '2026-06-15' });
    expect(monthly.granularity).toBe('MONTH');
    expect(monthly.buckets[0]).toEqual({ key: '2026-01', start: '2026-01-15', end: '2026-01-31' });
    expect(monthly.buckets[monthly.buckets.length - 1]).toEqual({
      key: '2026-06',
      start: '2026-06-01',
      end: '2026-06-15'
    });
  });

  it('honours an explicit aggregation for a custom range and covers it exactly once', () => {
    const period = resolveWorkloadPeriod({
      mode: 'CUSTOM',
      start: '2026-11-01',
      end: '2026-11-30',
      granularity: 'WEEK'
    });
    expect(period.granularity).toBe('WEEK');
    expect(period.buckets[0]).toEqual({ key: '2026-10-26', start: '2026-11-01', end: '2026-11-01' });
    expect(period.buckets[period.buckets.length - 1]?.end).toBe('2026-11-30');
    const covered = period.buckets.reduce((total, bucket) => total + diffDays(bucket.start, bucket.end) + 1, 0);
    expect(covered).toBe(30);
  });

  it('rejects an inverted or excessive custom range', () => {
    expect(() => resolveWorkloadPeriod({ mode: 'CUSTOM', start: '2026-11-30', end: '2026-11-01' })).toThrow(
      /start date/
    );
    const tooLong = resolveWorkloadPeriod({ mode: 'CUSTOM', start: '2025-01-01', end: '2026-01-01' });
    expect(tooLong.end).toBe('2026-01-01');
    expect(() => resolveWorkloadPeriod({ mode: 'CUSTOM', start: '2025-01-01', end: '2026-01-02' })).toThrow(
      new RegExp(String(MAX_CUSTOM_RANGE_DAYS))
    );
    expect(() => resolveWorkloadPeriod({ mode: 'CUSTOM', start: '2026-02-30', end: '2026-03-01' })).toThrow(
      /calendar date/
    );
    expect(() => resolveWorkloadPeriod({ mode: 'CUSTOM', start: '2026-11-01' })).toThrow(/end/);
    expect(() => resolveWorkloadPeriod({ mode: 'FORTNIGHT', anchor: '2026-11-01' })).toThrow(/Unknown report mode/);
  });

  it('navigates without touching stored data', () => {
    expect(shiftAnchor('DAY', '2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftAnchor('WEEK', '2026-12-28', 1)).toBe('2027-01-04');
    expect(shiftAnchor('MONTH', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftAnchor('MONTH', '2026-01-31', -1)).toBe('2025-12-01');
    expect(shiftAnchor('YEAR', '2026-12-31', -1)).toBe('2025-01-01');
  });

  it('reads "today" as the Asia/Tokyo calendar date', () => {
    // 16:00 UTC on 1 November is already 2 November in Tokyo.
    expect(businessDate(new Date('2026-11-01T16:00:00Z'))).toBe('2026-11-02');
    const period = resolveWorkloadPeriod({ mode: 'DAY', today: businessDate(new Date('2026-11-01T16:00:00Z')) });
    expect(period.start).toBe('2026-11-02');
  });
});
