import { describe, expect, it } from 'vitest';
import {
  axisTicks,
  axisContext,
  barGeometry,
  dateToPixel,
  markerOf,
  pixelToDate,
  presetFinish,
  spanOf,
  TIMELINE_BAR,
  windowOf
} from '../src/components/timeline-dates';

const year = windowOf('2026-01-01', '2026-12-31')!;

describe('timeline viewport geometry', () => {
  it('uses inclusive date endpoints and keeps date/pixel conversion consistent', () => {
    const week = windowOf('2026-02-01', '2026-02-07')!;
    expect(dateToPixel('2026-02-01', week, 20)).toBe(0);
    expect(dateToPixel('2026-02-07', week, 20)).toBe(120);
    expect(pixelToDate(0, week, 20)).toBe('2026-02-01');
    expect(pixelToDate(139, week, 20)).toBe('2026-02-07');
    expect(spanOf('2026-02-01', '2026-02-07', week, 20)).toMatchObject({ left: 0, width: 140 });
    expect(markerOf('2026-02-07', week, 20)).toBe(120);
  });

  it('keeps a same-day selection valid', () => {
    const day = windowOf('2028-02-29', '2028-02-29')!;
    expect(day.days).toBe(1);
    expect(axisTicks(day, 300, 'en-US')).toHaveLength(1);
  });

  it('uses inclusive preset endpoints and explicit calendar month arithmetic', () => {
    expect(presetFinish('2026-11-05', 'week')).toBe('2026-11-11');
    expect(presetFinish('2026-11-05', 'fortnight')).toBe('2026-11-18');
    expect(presetFinish('2026-11-05', 'month')).toBe('2026-12-04');
    expect(presetFinish('2026-01-31', 'month')).toBe('2026-02-28');
    expect(presetFinish('2028-01-31', 'month')).toBe('2028-02-29');
    expect(presetFinish('2026-12-31', 'month')).toBe('2027-01-30');
    expect(presetFinish('', 'month')).toBeNull();
  });

  it('generates bounded calendar-aligned labels at adaptive densities', () => {
    const threeYears = windowOf('2026-01-01', '2028-12-31')!;
    const ticks = axisTicks(threeYears, 900, 'en-US');
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThan(20);
    expect(ticks[0]?.key).toBe('2026-01-01');
    expect(ticks.at(-1)?.left).toBe(dateToPixel(threeYears.to, threeYears, 900 / threeYears.days));
    expect(ticks.at(-1)?.alignEnd).toBe(true);
    expect(axisTicks(windowOf('2026-01-01', '2026-01-31')!, 2000, 'ja-JP')).toHaveLength(31);
    expect(axisTicks(windowOf('2026-03-04', '2026-03-05')!, 100, 'ja-JP')).not.toHaveLength(0);
    expect(axisTicks(windowOf('2026-11-05', '2026-11-18')!, 840, 'en-US')).toHaveLength(14);
    expect(axisContext(windowOf('2026-12-20', '2027-02-01')!, 900, 'ja-JP').length).toBeGreaterThan(1);
  });

  it('fails safely for invalid dates and zero-width geometry', () => {
    expect(windowOf('2026-02-30', '2026-03-01')).toBeNull();
    expect(pixelToDate(1, year, 0)).toBeNull();
    expect(axisTicks(year, 0, 'en-US')).toEqual([]);
  });
});

describe('timeline bar geometry', () => {
  const week = windowOf('2026-11-01', '2026-11-07')!;
  const pixelsPerDay = 100;

  it('gives a deadline-only or same-day record a 3px point mark, not a whole day cell', () => {
    // A finish-only record repeats its finish as both display endpoints on the server.
    const point = barGeometry('2026-11-03', '2026-11-03', week, pixelsPerDay)!;
    expect(point.point).toBe(true);
    expect(point.width).toBe(TIMELINE_BAR.pointWidth);
    expect(point.width).toBe(3);
    // Centred in its own day cell: 200 + 50 - 1.5.
    expect(point.left).toBe(248.5);
  });

  it('keeps an ordinary duration bar a readable 12px tall and at least a visible width', () => {
    expect(TIMELINE_BAR.height).toBe(12);
    const bar = barGeometry('2026-11-02', '2026-11-04', week, pixelsPerDay)!;
    expect(bar.point).toBe(false);
    expect(bar.left).toBe(100);
    expect(bar.width).toBe(300);
    // A two-day range in a one-year window would be a hairline; it keeps a minimum width.
    const yearWindow = windowOf('2026-01-01', '2026-12-31')!;
    const short = barGeometry('2026-06-01', '2026-06-02', yearWindow, 900 / yearWindow.days)!;
    expect(short.width).toBe(TIMELINE_BAR.minWidth);
    expect(short.width).toBeGreaterThanOrEqual(6);
  });

  it('keeps a boundary mark inside the chart and never fakes out-of-range work', () => {
    const firstDay = barGeometry('2026-11-01', '2026-11-01', week, pixelsPerDay)!;
    expect(firstDay.left).toBe(48.5);
    const lastDay = barGeometry('2026-11-07', '2026-11-07', week, pixelsPerDay)!;
    expect(lastDay.left + lastDay.width).toBeLessThanOrEqual(week.days * pixelsPerDay);
    const crossingEnd = barGeometry('2026-11-06', '2026-11-09', week, pixelsPerDay)!;
    expect(crossingEnd.clampedEnd).toBe(true);
    expect(crossingEnd.left + crossingEnd.width).toBe(week.days * pixelsPerDay);
    // Entirely outside the window: no bar at all, so no fake boundary mark appears.
    expect(barGeometry('2026-12-01', '2026-12-03', week, pixelsPerDay)).toBeNull();
    expect(barGeometry('2026-10-01', '2026-10-03', week, pixelsPerDay)).toBeNull();
  });

  it('keeps the row centre stable for a multi-line name', () => {
    // The mark is vertically centred by CSS (`top: 50%` + `translateY(-50%)`), so its geometry
    // never depends on the row height that a wrapped name produces.
    const geometry = barGeometry('2026-11-02', '2026-11-05', week, pixelsPerDay)!;
    expect(Object.keys(geometry).sort()).toEqual(['clampedEnd', 'clampedStart', 'left', 'point', 'width']);
  });
});
