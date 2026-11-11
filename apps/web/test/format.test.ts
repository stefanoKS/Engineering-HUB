/**
 * Display formatting: instants are Tokyo wall-clock values, date-only values never shift.
 */
import { describe, expect, it } from 'vitest';
import {
  formatDateOnly,
  formatTokyoClock,
  formatTokyoTimestamp,
  minutesSince,
  tokyoCalendarDate
} from '../src/state/format';

describe('Asia/Tokyo timestamp formatting', () => {
  it('shows a UTC instant on the next Tokyo calendar day', () => {
    // 16:30 UTC on 10 November is 01:30 on 11 November in Tokyo (UTC+9, no DST).
    expect(formatTokyoTimestamp('2026-11-10T16:30:00.000Z')).toBe('2026-11-11 01:30');
    expect(tokyoCalendarDate('2026-11-10T16:30:00.000Z')).toBe('2026-11-11');
  });

  it('keeps the same Tokyo day for an instant just before the boundary', () => {
    expect(formatTokyoTimestamp('2026-11-10T14:59:00.000Z')).toBe('2026-11-10 23:59');
  });

  it('renders midnight as 00:00, not 24:00', () => {
    expect(formatTokyoTimestamp('2026-11-10T15:00:00.000Z')).toBe('2026-11-11 00:00');
  });

  it('returns the stored string unchanged when it is not a parseable instant', () => {
    expect(formatTokyoTimestamp('not-a-date')).toBe('not-a-date');
    expect(formatTokyoTimestamp('')).toBe('');
    expect(formatTokyoTimestamp(null)).toBe('');
  });

  it('formats a clock time for the last-updated label', () => {
    expect(formatTokyoClock('2026-11-11T05:04:00.000Z')).toBe('14:04');
    expect(formatTokyoClock('nope')).toBe('');
  });
});

describe('date-only formatting', () => {
  it('never moves a stored deadline, whatever the browser timezone is', () => {
    for (const value of ['2026-01-01', '2026-03-01', '2026-11-15']) {
      expect(formatDateOnly(value)).toBe(value);
    }
  });

  it('returns a malformed or impossible date as stored, so the defect stays visible', () => {
    expect(formatDateOnly('2026-02-31')).toBe('2026-02-31');
    expect(formatDateOnly('2026/11/15')).toBe('2026/11/15');
    expect(formatDateOnly('')).toBe('');
  });
});

describe('freshness arithmetic', () => {
  it('counts whole minutes and never returns a negative age', () => {
    const now = Date.parse('2026-11-11T10:00:00.000Z');
    expect(minutesSince(now - 90_000, now)).toBe(1);
    expect(minutesSince(now + 60_000, now)).toBe(0);
    expect(minutesSince(0, now)).toBe(0);
  });
});
