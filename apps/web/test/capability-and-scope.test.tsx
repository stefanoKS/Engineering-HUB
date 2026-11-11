// @vitest-environment jsdom
/**
 * Record-level action availability and the division scope-transition policy.
 *
 * These are the two interfaces that used to be decided from the role and the shell's selected
 * division alone: a manager with read-only access to a division was still offered the editor, and
 * a scope change left a page number and a selection that belonged to the previous scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { TasksScreen } from '../src/screens/Tasks';
import { ProjectsScreen } from '../src/screens/Projects';
import { queryCache } from '../src/state/cache';
import { clearDivisionScope, selectDivision, setDivisionScope } from '../src/state/division';

const MANAGER = {
  memberId: 'M-1',
  name: 'Manager',
  email: 'manager@example.invalid',
  role: 'MANAGER' as const,
  active: true,
  verified: true,
  selfServiceEnabled: false
};
const ADMIN = { ...MANAGER, memberId: 'A-1', name: 'Admin', role: 'ADMIN' as const };

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));

function task(overrides: Record<string, unknown>) {
  return {
    taskId: 'T-1',
    taskName: '配線図の更新',
    projectId: 'PRJ-A',
    projectName: 'Alpha',
    subprojectId: null,
    responsibilityId: null,
    parentTaskId: null,
    status: 'In Progress',
    displayStatus: 'IN_PROGRESS',
    priority: 'Medium',
    ownerMemberId: null,
    ownerName: 'Ann',
    assigneeNames: [],
    assigneeIds: [],
    dueDate: '2026-12-01',
    plannedStart: null,
    progressPercent: 40,
    container: false,
    depth: 1,
    reviewState: 'NONE',
    overdue: false,
    deadlineState: 'OK',
    revision: 1,
    ...overrides
  };
}

function stubTasks(items: unknown[]) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('/references')) return response({ responsibilities: [], members: [], skills: [], subprojects: [] });
      if (url.includes('/api/manager/projects?'))
        return response({
          items: [{ projectId: 'PRJ-A', projectName: 'Alpha' }],
          total: 1,
          page: 1,
          totalPages: 1
        });
      return response({ items, total: items.length, matchedTotal: items.length, page: 1, pageSize: 25, totalPages: 3 });
    })
  );
  return calls;
}

beforeEach(() => {
  setDivisionScope({
    readable: [
      { divisionId: 'D1', name: '設計', status: 'Active' },
      { divisionId: 'D2', name: '製造', status: 'Active' }
    ],
    writable: [{ divisionId: 'D1', name: '設計', status: 'Active' }],
    allDivisions: false,
    defaultDivisionId: null
  });
});

afterEach(() => {
  cleanup();
  queryCache.clear();
  clearDivisionScope();
  // The division store is module state; restore the "one readable" default for the next case.
  setDivisionScope({
    readable: [{ divisionId: 'D1', name: '設計', status: 'Active' }],
    writable: [{ divisionId: 'D1', name: '設計', status: 'Active' }],
    allDivisions: false,
    defaultDivisionId: null
  });
  clearDivisionScope();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('record-level write availability', () => {
  it('offers no editor for a task in a division the manager may only read', async () => {
    stubTasks([task({ canWrite: false })]);
    render(<I18nProvider><TasksScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('配線図の更新');
    expect(screen.queryByRole('button', { name: '編集' })).toBeNull();
    expect(screen.getByText('閲覧のみ')).toBeTruthy();
  });

  it('offers the editor for a task in a writable division', async () => {
    stubTasks([task({ canWrite: true })]);
    render(<I18nProvider><TasksScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('配線図の更新');
    expect(screen.getByRole('button', { name: '編集' })).toBeTruthy();
    expect(screen.queryByText('閲覧のみ')).toBeNull();
  });

  it('keeps an ADMIN able to act on unmapped work', async () => {
    stubTasks([task({ canWrite: true })]);
    render(<I18nProvider><TasksScreen actor={ADMIN} /></I18nProvider>);
    await screen.findByText('配線図の更新');
    expect(screen.getByRole('button', { name: '編集' })).toBeTruthy();
  });

  it('offers no project editor when the record is read-only for this manager', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/references')) return response({ responsibilities: [], members: [] });
        return response({
          items: [
            {
              projectId: 'PRJ-A',
              projectName: 'Alpha',
              divisionId: 'D2',
              divisionName: '製造',
              responsibilityId: null,
              responsibilityName: '',
              projectOwnerId: null,
              status: 'Active',
              schedule: { state: 'IN_PROGRESS', missing: 'NONE' },
              priority: 'Medium',
              committedDeadline: '2026-12-01',
              deadlineState: 'OK',
              progressPercent: 40,
              health: 'OK',
              nextAction: '',
              dashboardVisibility: 'RESTRICTED',
              containerCount: 0,
              openWork: 1,
              overdueWork: 0,
              canWrite: false,
              revision: 1
            }
          ],
          total: 1,
          groupTotals: [],
          page: 1,
          pageSize: 25,
          totalPages: 1
        });
      })
    );
    render(<I18nProvider><ProjectsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('Alpha');
    expect(screen.queryByRole('button', { name: '編集' })).toBeNull();
    expect(screen.getAllByText('閲覧のみ').length).toBeGreaterThan(0);
  });
});

describe('division scope transitions', () => {
  it('restarts at page 1 and drops a selection that belonged to the previous scope', async () => {
    const calls = stubTasks([task({ canWrite: true })]);
    render(<I18nProvider><TasksScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('配線図の更新');

    // Page 2, then a project selection.
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await waitFor(() => expect(calls.some((call) => call.url.includes('page=2'))).toBe(true));
    fireEvent.change(screen.getByLabelText('プロジェクト'), { target: { value: 'PRJ-A' } });
    await waitFor(() => expect(calls.some((call) => call.url.includes('projectId=PRJ-A'))).toBe(true));

    // A division change starts the list again: no page=2 and no projectId.
    selectDivision('D2');
    await waitFor(() => {
      const last = [...calls].reverse().find((call) => call.url.startsWith('/api/manager/tasks'));
      expect(last?.url).toBeTruthy();
      expect(last!.url).not.toContain('page=2');
      expect(last!.url).not.toContain('projectId=');
    });
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('never displays a superseded scope answer', async () => {
    let releaseSlow!: (value: Response) => void;
    const slow = new Promise<Response>((resolve) => (releaseSlow = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/references')) return response({ responsibilities: [], members: [], skills: [], subprojects: [] });
        if (url.includes('divisionId=D1')) return slow;
        return response({ items: [task({ taskId: 'T-2', taskName: '製造の作業', canWrite: true })], total: 1, matchedTotal: 1, page: 1, pageSize: 25, totalPages: 1 });
      })
    );
    render(<I18nProvider><TasksScreen actor={MANAGER} /></I18nProvider>);
    selectDivision('D2');
    expect(await screen.findByText('製造の作業')).toBeTruthy();

    // The abandoned division-A answer arrives late and must not paint.
    releaseSlow(response({ items: [task({ taskId: 'T-9', taskName: '設計の作業', canWrite: true })], total: 1, matchedTotal: 1, page: 1, pageSize: 25, totalPages: 1 }));
    await waitFor(() => expect(screen.queryByText('設計の作業')).toBeNull());
    expect(screen.getByText('製造の作業')).toBeTruthy();
  });
});
