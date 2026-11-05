/**
 * The derived project schedule status and the narrowed lifecycle transitions.
 *
 * Only an explicit completion, cancellation or archive is stored. Everything else a manager sees
 * (計画前 / 進行中 / 遅延 / 日程未設定 ...) is calculated from the plan dates and today's Asia/Tokyo
 * business date, so no nightly job rewrites a status and no audit row is produced by time passing.
 */
import { describe, expect, it } from 'vitest';
import {
  assertProjectCreationStatus,
  assertProjectLifecycleChange,
  projectScheduleStatus
} from '../src/index';

const today = '2026-11-05';

const project = (overrides: Partial<Parameters<typeof projectScheduleStatus>[0]> = {}) => ({
  status: 'Active',
  plannedStart: '2026-11-01',
  committedDeadline: '2026-11-30',
  ...overrides
});

describe('derived project schedule status', () => {
  it('prefers the stored terminal decisions in order', () => {
    expect(projectScheduleStatus(project({ status: 'Archived' }), today).state).toBe('ARCHIVED');
    expect(projectScheduleStatus(project({ status: 'Active', archivedAt: '2026-10-01T00:00:00Z' }), today).state).toBe(
      'ARCHIVED'
    );
    expect(projectScheduleStatus(project({ status: 'Cancelled' }), today).state).toBe('CANCELLED');
    // Completed wins over a deadline that has already passed.
    expect(
      projectScheduleStatus(project({ status: 'Completed', plannedStart: null, committedDeadline: '2026-01-01' }), today)
        .state
    ).toBe('COMPLETED');
  });

  it('reports unusable dates instead of a guessed state', () => {
    expect(
      projectScheduleStatus(project({ plannedStart: '2026-12-01', committedDeadline: '2026-11-01' }), today).state
    ).toBe('INVALID_DATES');
    expect(projectScheduleStatus(project({ plannedStart: null, committedDeadline: null }), today)).toEqual({
      state: 'DATES_NOT_SET',
      missing: 'BOTH'
    });
  });

  it('uses an inclusive finish day and the Tokyo business date', () => {
    const schedule = project({ plannedStart: '2026-11-01', committedDeadline: '2026-11-05' });
    expect(projectScheduleStatus(schedule, '2026-11-05').state).toBe('IN_PROGRESS');
    expect(projectScheduleStatus(schedule, '2026-11-06').state).toBe('LATE');
    expect(
      projectScheduleStatus(project({ plannedStart: '2026-12-01', committedDeadline: '2026-12-20' }), today).state
    ).toBe('PLANNED');
    expect(projectScheduleStatus(project({ plannedStart: '2026-11-05' }), today).state).toBe('IN_PROGRESS');
  });

  it('states a missing boundary instead of inventing one', () => {
    expect(projectScheduleStatus(project({ committedDeadline: null }), '2026-10-31')).toEqual({
      state: 'PLANNED',
      missing: 'FINISH'
    });
    expect(projectScheduleStatus(project({ committedDeadline: null }), '2026-11-02')).toEqual({
      state: 'IN_PROGRESS',
      missing: 'FINISH'
    });
    expect(projectScheduleStatus(project({ plannedStart: null }), '2026-11-30')).toEqual({
      state: 'START_NOT_SET',
      missing: 'START'
    });
    // A finish-only plan that has already passed is still late, not "in progress".
    expect(projectScheduleStatus(project({ plannedStart: null }), '2026-12-01')).toEqual({
      state: 'LATE',
      missing: 'START'
    });
  });

  it('treats a legacy non-terminal stored value as ordinary work', () => {
    expect(projectScheduleStatus(project({ status: 'Planned' }), today).state).toBe('IN_PROGRESS');
    expect(projectScheduleStatus(project({ status: 'On Hold' }), today).state).toBe('IN_PROGRESS');
  });
});

describe('project lifecycle transitions', () => {
  it('refuses an ordinary edit between non-terminal states', () => {
    expect(() => assertProjectLifecycleChange('Active', 'Planned')).toThrowError(/derived from the schedule/);
    expect(() => assertProjectLifecycleChange('Active', 'On Hold')).toThrowError(/derived from the schedule/);
    expect(() => assertProjectLifecycleChange('Active', 'Archived')).toThrowError(/their own confirmed action/);
  });

  it('refuses to reopen a completed project or to touch an archived one', () => {
    expect(() => assertProjectLifecycleChange('Completed', 'Active')).toThrowError(/not reopened/);
    expect(() => assertProjectLifecycleChange('Archived', 'Active')).toThrowError(/their own confirmed action/);
  });

  it('allows the explicit completion, cancellation and reactivation decisions', () => {
    expect(() => assertProjectLifecycleChange('Active', 'Completed')).not.toThrow();
    expect(() => assertProjectLifecycleChange('Active', 'Cancelled')).not.toThrow();
    expect(() => assertProjectLifecycleChange('Cancelled', 'Active')).not.toThrow();
    expect(() => assertProjectLifecycleChange('Active', 'Active')).not.toThrow();
  });

  it('refuses a new project that would begin in a terminal state', () => {
    expect(() => assertProjectCreationStatus(undefined)).not.toThrow();
    expect(() => assertProjectCreationStatus('Active')).not.toThrow();
    expect(() => assertProjectCreationStatus('Planned')).not.toThrow();
    expect(() => assertProjectCreationStatus('Completed')).toThrowError(/cannot start as/);
    expect(() => assertProjectCreationStatus('Archived')).toThrowError(/cannot start as/);
  });
});
