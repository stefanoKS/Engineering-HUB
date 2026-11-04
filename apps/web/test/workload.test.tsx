// @vitest-environment jsdom
/**
 * Date-based workload report screen.
 *
 * The screen must ask the server for one resolved period, keep the member table tied to that
 * period, open a paginated breakdown from a card or an employee row, and refuse an impossible
 * custom range without sending a request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addDays, businessDate, startOfWorkWeek } from '@eh/domain';
import type { Actor, WorkloadReport, WorkloadTaskPage } from '@eh/contracts';
import { I18nProvider } from '../src/i18n';
import { WorkloadScreen } from '../src/screens/Workload';
import { queryCache } from '../src/state/cache';

const MANAGER: Actor = {
  memberId: 'MEM-MANAGER',
  name: 'Manager',
  email: 'manager@example.co.jp',
  role: 'MANAGER',
  active: true,
  verified: true,
  selfServiceEnabled: false
};

const today = businessDate();
const weekStart = startOfWorkWeek(today);
const weekEnd = addDays(weekStart, 6);

const BOOTSTRAP = {
  references: {
    members: [
      { memberId: 'MEM-A', name: 'Aki Tanaka', active: true, role: 'MEMBER' },
      { memberId: 'MEM-B', name: 'Ben Suzuki', active: true, role: 'MEMBER' }
    ],
    responsibilities: [{ id: 'RES-1', name: 'Design', status: 'Active' }]
  },
  projects: [{ projectId: 'PRJ-A', projectName: 'Alpha' }]
};

function report(): WorkloadReport {
  return {
    mode: 'WEEK',
    start: weekStart,
    end: weekEnd,
    today,
    granularity: 'DAY',
    summary: {
      dueTasks: 3,
      completedTasks: 1,
      overdueTasks: 2,
      undatedTasks: 1,
      overdueWithinPeriod: 1,
      backlogBeforePeriod: 2,
      uniqueTasks: 5,
      assignments: 6
    },
    buckets: [
      { key: weekStart, start: weekStart, end: weekStart, dueTasks: 2, completedTasks: 0, overdueTasks: 1 },
      { key: addDays(weekStart, 1), start: addDays(weekStart, 1), end: addDays(weekStart, 1), dueTasks: 1, completedTasks: 1, overdueTasks: 0 }
    ],
    employees: [
      {
        memberId: 'MEM-A',
        memberName: 'Aki Tanaka',
        active: true,
        dueTasks: 2,
        completedTasks: 1,
        overdueTasks: 1,
        undatedTasks: 0
      }
    ],
    assignmentBasis: 'CURRENT_ASSIGNMENTS',
    generatedAt: '2026-11-04T05:30:00.000Z'
  };
}

function drillPage(): WorkloadTaskPage {
  return {
    kind: 'DUE',
    from: weekStart,
    to: weekEnd,
    items: [
      {
        taskId: 'TSK-1',
        taskName: 'Design review',
        projectId: 'PRJ-A',
        projectName: 'Alpha',
        subprojectName: null,
        status: 'In Progress',
        dueDate: today,
        completedDate: null,
        assigneeNames: ['Aki Tanaka'],
        revision: 1
      }
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1
  };
}

function stubApi(urls: string[] = []): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async (input: string) => {
    urls.push(String(input));
    if (String(input).includes('/api/manager/bootstrap')) {
      return new Response(JSON.stringify({ ok: true, data: BOOTSTRAP }), { status: 200 });
    }
    if (String(input).includes('/reports/workload/tasks')) {
      return new Response(JSON.stringify({ ok: true, data: drillPage() }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, data: report() }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function renderScreen(): void {
  render(
    <I18nProvider>
      <WorkloadScreen actor={MANAGER} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('date-based workload report', () => {
  it('shows the five modes, the summary cards and the member table for the resolved week', async () => {
    stubApi();
    renderScreen();

    expect(await screen.findByRole('button', { name: 'Aki Tanaka のタスクを表示' })).toBeTruthy();
    for (const mode of ['日', '週', '月', '年', 'カスタム']) {
      expect(screen.getByRole('button', { name: mode })).toBeTruthy();
    }
    // The four cards carry task counts only: no hour, capacity or utilisation figure exists.
    expect(screen.getAllByText('対象期限タスク').length).toBeGreaterThan(0);
    expect(screen.getAllByText('期間内完了').length).toBeGreaterThan(0);
    expect(screen.getAllByText('期限超過').length).toBeGreaterThan(0);
    expect(screen.getAllByText('期限未設定').length).toBeGreaterThan(0);
    expect(screen.queryByText(/負荷率|残作業/)).toBeNull();
    // The report states that it groups current assignments by the selected dates.
    expect(screen.getByText(/現在の割当を/)).toBeTruthy();
  });

  it('asks the server for the period of the selected mode', async () => {
    const urls: string[] = [];
    stubApi(urls);
    renderScreen();
    await screen.findByRole('button', { name: 'Aki Tanaka のタスクを表示' });

    fireEvent.click(screen.getByRole('button', { name: '月' }));
    await waitFor(() =>
      expect(urls.some((url) => url.includes('/api/manager/reports/workload?') && url.includes('mode=MONTH'))).toBe(true)
    );
  });

  it('opens a paginated breakdown from a summary card', async () => {
    const urls: string[] = [];
    stubApi(urls);
    renderScreen();
    await screen.findByRole('button', { name: 'Aki Tanaka のタスクを表示' });

    const dueCard = screen
      .getAllByRole('button', { name: /対象期限タスク/ })
      .find((element) => element.className.includes('kpi-button'));
    expect(dueCard).toBeTruthy();
    fireEvent.click(dueCard!);

    expect(await screen.findByText('Design review')).toBeTruthy();
    const request = urls.find((url) => url.includes('/reports/workload/tasks'));
    expect(request).toBeTruthy();
    expect(request).toMatch(/kind=DUE/);
    expect(request).toMatch(/page=1/);
    expect(screen.getAllByText('プロジェクト').length).toBeGreaterThan(0);
  });

  it('expands one employee row into that member’s tasks', async () => {
    const urls: string[] = [];
    stubApi(urls);
    renderScreen();
    await screen.findByRole('button', { name: 'Aki Tanaka のタスクを表示' });

    fireEvent.click(screen.getByRole('button', { name: 'Aki Tanaka のタスクを表示' }));
    await waitFor(() => {
      const request = urls.find((url) => url.includes('/reports/workload/tasks'));
      expect(request).toMatch(/memberId=MEM-A/);
    });
    expect(await screen.findByText('Design review')).toBeTruthy();
  });

  it('refuses an inverted custom range without sending a request', async () => {
    const urls: string[] = [];
    stubApi(urls);
    renderScreen();
    await screen.findByRole('button', { name: 'Aki Tanaka のタスクを表示' });

    fireEvent.click(screen.getByRole('button', { name: 'カスタム' }));
    await waitFor(() => expect(urls.some((url) => url.includes('mode=CUSTOM'))).toBe(true));
    const sentSoFar = urls.length;

    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: addDays(today, 10) } });
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: addDays(today, 1) } });

    expect(await screen.findByText('開始日は終了日以前の日付を指定してください。')).toBeTruthy();
    // The impossible range is refused in the browser: no further report request is made.
    expect(urls.length).toBe(sentSoFar);
    expect(urls.some((url) => url.includes(addDays(today, 10)))).toBe(false);
  });

  it('keeps the selected mode when the screen is left and reopened', async () => {
    stubApi();
    const view = renderScreen;
    void view;
    const first = render(
      <I18nProvider>
        <WorkloadScreen actor={MANAGER} />
      </I18nProvider>
    );
    // Start from a defined mode so the assertion below does not depend on an earlier test.
    fireEvent.click(await screen.findByRole('button', { name: '週' }));
    await screen.findByRole('button', { name: 'Aki Tanaka のタスクを表示' });
    fireEvent.click(screen.getByRole('button', { name: '年' }));
    first.unmount();
    cleanup();

    renderScreen();
    const year = await screen.findByRole('button', { name: '年' });
    expect(year.getAttribute('aria-pressed')).toBe('true');
  });
});
