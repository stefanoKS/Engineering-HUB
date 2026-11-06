/**
 * The canonical task schedule display rule.
 *
 * Every screen, report and published aggregate resolves its badge here, so these cases are the
 * contract: terminal states win, the Finish day is inclusive, a missing boundary is stated instead
 * of invented, and an unusable interval is a warning rather than a hidden date.
 */
import { describe, expect, it } from 'vitest';
import { businessDate, displayTaskStatus, isActiveDisplayStatus, taskScheduleStatus } from '../src/index';

const open = (plannedStart: string | null, dueDate: string | null, status = 'In Progress') => ({
  status,
  plannedStart,
  dueDate
});

describe('task schedule display status', () => {
  it('is planned before the start day and in progress from the start day', () => {
    expect(taskScheduleStatus(open('2026-11-10', '2026-11-20'), '2026-11-09')).toEqual({
      state: 'PLANNED',
      missing: 'NONE'
    });
    expect(taskScheduleStatus(open('2026-11-10', '2026-11-20'), '2026-11-10').state).toBe('IN_PROGRESS');
  });

  it('is in progress between the start and the finish, and on the finish day itself', () => {
    expect(taskScheduleStatus(open('2026-11-10', '2026-11-20'), '2026-11-15').state).toBe('IN_PROGRESS');
    expect(taskScheduleStatus(open('2026-11-10', '2026-11-20'), '2026-11-20').state).toBe('IN_PROGRESS');
  });

  it('is late only from the day after the finish', () => {
    expect(taskScheduleStatus(open('2026-11-10', '2026-11-20'), '2026-11-21')).toEqual({
      state: 'OVERDUE',
      missing: 'NONE'
    });
  });

  it('handles a same-day task: planned before, in progress on, late after', () => {
    expect(taskScheduleStatus(open('2026-11-20', '2026-11-20'), '2026-11-19').state).toBe('PLANNED');
    expect(taskScheduleStatus(open('2026-11-20', '2026-11-20'), '2026-11-20').state).toBe('IN_PROGRESS');
    expect(taskScheduleStatus(open('2026-11-20', '2026-11-20'), '2026-11-21').state).toBe('OVERDUE');
    // A same-day task is never displayed as both planned and late.
    expect(isActiveDisplayStatus(displayTaskStatus(open('2026-11-20', '2026-11-20'), '2026-11-20'))).toBe(true);
  });

  it('reports a finish-only schedule as start not set, and still becomes late after it', () => {
    expect(taskScheduleStatus(open(null, '2026-11-20'), '2026-11-01')).toEqual({
      state: 'START_NOT_SET',
      missing: 'START'
    });
    expect(taskScheduleStatus(open(null, '2026-11-20'), '2026-11-20').state).toBe('START_NOT_SET');
    expect(taskScheduleStatus(open(null, '2026-11-20'), '2026-11-21')).toEqual({
      state: 'OVERDUE',
      missing: 'START'
    });
    // A finish-only task is never displayed as in progress, whatever its stored status says.
    for (const status of ['Not Started', 'Assigned', 'In Progress', 'Blocked', 'On Hold']) {
      expect(displayTaskStatus(open(null, '2026-11-20', status), '2026-11-01')).toBe('START_NOT_SET');
    }
  });

  it('reports a start-only schedule as planned or in progress and states the missing finish', () => {
    expect(taskScheduleStatus(open('2026-11-10', null), '2026-11-01')).toEqual({
      state: 'PLANNED',
      missing: 'FINISH'
    });
    expect(taskScheduleStatus(open('2026-11-10', null), '2026-11-10')).toEqual({
      state: 'IN_PROGRESS',
      missing: 'FINISH'
    });
    expect(taskScheduleStatus(open('2026-11-10', null), '2026-12-31')).toEqual({
      state: 'IN_PROGRESS',
      missing: 'FINISH'
    });
  });

  it('states both dates as missing when the schedule has neither', () => {
    expect(taskScheduleStatus(open(null, null), '2026-11-05')).toEqual({
      state: 'DATES_NOT_SET',
      missing: 'BOTH'
    });
    expect(isActiveDisplayStatus('DATES_NOT_SET')).toBe(true);
  });

  it('warns about a reversed interval without swapping or inventing a date', () => {
    expect(taskScheduleStatus(open('2026-11-20', '2026-11-10'), '2026-11-15')).toEqual({
      state: 'INVALID_DATES',
      missing: 'NONE'
    });
    // Even when the reversed finish is already in the past the interval stays the visible problem.
    expect(taskScheduleStatus(open('2026-11-20', '2026-11-10'), '2026-12-01').state).toBe('INVALID_DATES');
  });

  it('lets done win over a past finish, with or without a completion timestamp', () => {
    expect(taskScheduleStatus(open('2026-11-01', '2026-11-05', 'Done'), '2026-12-01')).toEqual({
      state: 'DONE',
      missing: 'NONE'
    });
    // A legacy completed row has no completion timestamp; the stored status still decides.
    expect(displayTaskStatus(open(null, '2026-11-05', 'Done'), '2026-12-01')).toBe('DONE');
  });

  it('lets cancelled win over a past finish', () => {
    expect(taskScheduleStatus(open('2026-11-01', '2026-11-05', 'Cancelled'), '2026-12-01')).toEqual({
      state: 'CANCELLED',
      missing: 'NONE'
    });
    expect(isActiveDisplayStatus('CANCELLED')).toBe(false);
  });

  it('takes the business date from the Tokyo calendar, not the browser time zone', () => {
    // 2026-11-20T14:59Z is still 2026-11-20 in Tokyo; 15:00Z is already 2026-11-21.
    const finish = '2026-11-20';
    const task = open('2026-11-01', finish);
    expect(businessDate(new Date('2026-11-20T14:59:00.000Z'))).toBe('2026-11-20');
    expect(taskScheduleStatus(task, businessDate(new Date('2026-11-20T14:59:00.000Z'))).state).toBe('IN_PROGRESS');
    expect(businessDate(new Date('2026-11-20T15:00:00.000Z'))).toBe('2026-11-21');
    expect(taskScheduleStatus(task, businessDate(new Date('2026-11-20T15:00:00.000Z'))).state).toBe('OVERDUE');
  });
});
