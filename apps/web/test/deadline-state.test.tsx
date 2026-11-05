// @vitest-environment jsdom
/**
 * Deadline presentation follows the authoritative display state.
 *
 * The reported defect: a task whose stored status was Done and whose deadline had already passed
 * was painted as 期限超過 because the caller omitted the lifecycle state and the component fell back
 * to comparing dates. These cases pin the precedence (done, cancelled, late) and the separate
 * "completed late" label that never turns into an overdue badge.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import {
  isCompletedLate,
  DeadlineCell,
  deadlineStateOf,
  deadlineTone,
  DateValue
} from '../src/components/deadline';

afterEach(cleanup);

const screenshot = { dueDate: '2026-11-04', completedOn: '2026-11-04', today: '2026-11-05' };

describe('deadline state precedence', () => {
  it('never shows a done task as overdue, even yesterday', () => {
    expect(deadlineTone(screenshot.dueDate, 'DONE', screenshot.today)).toBe('done');
    expect(deadlineTone('2026-10-01', 'DONE', screenshot.today)).toBe('done');
  });

  it('labels a late completion separately instead of as overdue', () => {
    expect(deadlineTone('2026-11-04', 'DONE', '2026-11-05')).toBe('done');
    expect(isCompletedLate('2026-11-04', '2026-11-10')).toBe(true);
    expect(isCompletedLate('2026-11-04', '2026-11-04')).toBe(false);
    // A missing completion timestamp never invents a lateness label.
    expect(isCompletedLate('2026-11-04', null)).toBe(false);
  });

  it('never shows cancelled or archived work as current overdue', () => {
    expect(deadlineTone('2026-01-01', 'CANCELLED', '2026-11-05')).toBe('cancelled');
    expect(deadlineTone('2026-01-01', 'ARCHIVED', '2026-11-05')).toBe('cancelled');
  });

  it('keeps an eligible open task overdue, due today and upcoming', () => {
    expect(deadlineTone('2026-11-04', 'OVERDUE', '2026-11-05')).toBe('overdue');
    expect(deadlineTone('2026-11-05', 'IN_PROGRESS', '2026-11-05')).toBe('today');
    expect(deadlineTone('2026-11-20', 'IN_PROGRESS', '2026-11-05')).toBe('open');
  });

  it('maps the derived project schedule state onto the same presentation', () => {
    expect(deadlineStateOf({ state: 'COMPLETED', missing: 'NONE' })).toBe('DONE');
    expect(deadlineStateOf({ state: 'CANCELLED', missing: 'NONE' })).toBe('CANCELLED');
    expect(deadlineStateOf({ state: 'ARCHIVED', missing: 'NONE' })).toBe('ARCHIVED');
    expect(deadlineStateOf({ state: 'LATE', missing: 'NONE' })).toBe('OVERDUE');
    expect(deadlineStateOf({ state: 'IN_PROGRESS', missing: 'NONE' })).toBe('IN_PROGRESS');
  });
});

describe('deadline rendering', () => {
  it('shows the screenshot case as done, without an overdue badge', () => {
    render(
      <I18nProvider>
        <DeadlineCell dueDate={screenshot.dueDate} state="DONE" completedOn={screenshot.completedOn} />
      </I18nProvider>
    );
    expect(screen.queryByText('期限超過')).toBeNull();
    expect(document.querySelector('.deadline')?.className).toContain('deadline-done');
  });

  it('states a late completion with its own label', () => {
    render(
      <I18nProvider>
        <DeadlineCell dueDate="2026-11-04" state="DONE" completedOn="2026-11-09" />
      </I18nProvider>
    );
    expect(screen.getByText('期限後に完了')).toBeTruthy();
    expect(screen.queryByText('期限超過')).toBeNull();
  });

  it('shows no lifecycle badge for a plain stored date', () => {
    render(
      <I18nProvider>
        <DateValue value="2026-11-04" />
      </I18nProvider>
    );
    expect(screen.getByText('2026-11-04')).toBeTruthy();
    expect(screen.queryByText('期限超過')).toBeNull();
  });
});
