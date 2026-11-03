/**
 * Derived task status and the A-D skill grade mapping.
 *
 * These are the two display rules the simplified screens depend on: a deadline alone decides
 * 進行中 / 期限超過 and a stored integer level is only ever shown as a letter grade.
 */
import { describe, expect, it } from 'vitest';
import {
  businessDate,
  displayTaskStatus,
  formatSkillGrade,
  gradeToLevel,
  isActiveDisplayStatus,
  levelToGrade,
  SKILL_GRADES
} from '../src/index';

describe('derived task status', () => {
  it('uses the Tokyo calendar date for yesterday, today and tomorrow', () => {
    expect(displayTaskStatus({ status: 'In Progress', dueDate: '2026-11-04' }, '2026-11-05')).toBe('OVERDUE');
    expect(displayTaskStatus({ status: 'In Progress', dueDate: '2026-11-05' }, '2026-11-05')).toBe('IN_PROGRESS');
    expect(displayTaskStatus({ status: 'In Progress', dueDate: '2026-11-06' }, '2026-11-05')).toBe('IN_PROGRESS');
  });

  it('handles month and year boundaries and weekend deadlines as ordinary dates', () => {
    expect(displayTaskStatus({ status: 'Assigned', dueDate: '2026-10-31' }, '2026-11-01')).toBe('OVERDUE');
    expect(displayTaskStatus({ status: 'Assigned', dueDate: '2026-12-31' }, '2027-01-01')).toBe('OVERDUE');
    // Saturday 2026-11-07 and Sunday 2026-11-08 are valid deadlines, not special cases.
    expect(displayTaskStatus({ status: 'Not Started', dueDate: '2026-11-07' }, '2026-11-07')).toBe('IN_PROGRESS');
    expect(displayTaskStatus({ status: 'Not Started', dueDate: '2026-11-08' }, '2026-11-09')).toBe('OVERDUE');
    // A Japanese public holiday (Culture Day) behaves like any other calendar date.
    expect(displayTaskStatus({ status: 'On Hold', dueDate: '2026-11-03' }, '2026-11-03')).toBe('IN_PROGRESS');
  });

  it('lets Done win over an overdue deadline and keeps cancelled work out of active lists', () => {
    expect(displayTaskStatus({ status: 'Done', dueDate: '2026-11-05' }, '2026-11-08')).toBe('DONE');
    expect(displayTaskStatus({ status: 'Cancelled', dueDate: '2026-11-05' }, '2026-11-08')).toBe('CANCELLED');
    expect(isActiveDisplayStatus('CANCELLED')).toBe(false);
    expect(isActiveDisplayStatus('DONE')).toBe(false);
    expect(isActiveDisplayStatus('OVERDUE')).toBe(true);
  });

  it('maps every legacy open status to the unfinished state', () => {
    for (const status of ['Not Started', 'Assigned', 'In Progress', 'Blocked', 'On Hold']) {
      expect(displayTaskStatus({ status, dueDate: '2030-01-01' }, '2026-11-05')).toBe('IN_PROGRESS');
    }
    expect(displayTaskStatus({ status: 'In Progress', dueDate: null }, '2026-11-05')).toBe('IN_PROGRESS');
  });

  it('derives the Tokyo business date from an instant without a UTC day shift', () => {
    // 2026-11-04T15:30Z is already 2026-11-05 in Tokyo.
    expect(businessDate(new Date('2026-11-04T15:30:00.000Z'))).toBe('2026-11-05');
    expect(businessDate(new Date('2026-11-04T14:59:00.000Z'))).toBe('2026-11-04');
  });
});

describe('A-D skill grades', () => {
  it('maps grades to the stored integer levels and back', () => {
    expect(SKILL_GRADES.map((grade) => gradeToLevel(grade))).toEqual([4, 3, 2, 1]);
    expect(levelToGrade(4)).toBe('A');
    expect(levelToGrade(3)).toBe('B');
    expect(levelToGrade(2)).toBe('C');
    expect(levelToGrade(1)).toBe('D');
  });

  it('keeps 0 and null as not assessed instead of the lowest grade', () => {
    expect(gradeToLevel('')).toBe(0);
    expect(gradeToLevel('NOT_ASSESSED')).toBe(0);
    expect(levelToGrade(0)).toBeNull();
    expect(levelToGrade(null)).toBeNull();
    expect(levelToGrade(undefined)).toBeNull();
    expect(formatSkillGrade(0, '未評価')).toBe('未評価');
    expect(formatSkillGrade(3, '未評価')).toBe('B');
  });

  it('refuses an unknown grade or an out-of-range level', () => {
    expect(() => gradeToLevel('E')).toThrow(/A, B, C, D/);
    expect(() => gradeToLevel(5)).toThrow(/A, B, C, D/);
    expect(() => levelToGrade(5)).toThrow(/0-4/);
    expect(() => levelToGrade(-1)).toThrow(/0-4/);
  });
});
