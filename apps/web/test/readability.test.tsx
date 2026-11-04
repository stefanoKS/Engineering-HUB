// @vitest-environment jsdom
/**
 * Readability, deadline emphasis, collapsible requests, 分野 terminology, localized statuses and
 * the workload timeline axis.
 *
 * Everything here is presentation: the stored enum values and identifiers must stay unchanged
 * while Japanese mode shows Japanese labels, a deadline is never buried in muted metadata, and a
 * timeline bucket states both its task count and its date.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addDays, businessDate, startOfWorkWeek } from '@eh/domain';
import type { Actor, MemberRequests, MyWorkList, MyWorkProjectOptions, WorkloadReport } from '@eh/contracts';
import { I18nProvider } from '../src/i18n';
import { DeadlineCell, deadlineTone } from '../src/components/deadline';
import { MyWorkScreen } from '../src/screens/MyWork';
import { OverviewScreen } from '../src/screens/Overview';
import { ResponsibilitiesScreen } from '../src/screens/Responsibilities';
import { WorkloadScreen } from '../src/screens/Workload';
import { queryCache } from '../src/state/cache';

const MEMBER: Actor = {
  memberId: 'MEM-A',
  name: 'Aki Tanaka',
  email: 'aki@example.invalid',
  role: 'MEMBER',
  active: true,
  verified: true,
  selfServiceEnabled: true
};

const MANAGER: Actor = {
  memberId: 'MEM-MANAGER',
  name: 'Manager',
  email: 'manager@example.invalid',
  role: 'MANAGER',
  active: true,
  verified: true,
  selfServiceEnabled: false
};

const response = (data: unknown): Response => new Response(JSON.stringify({ ok: true, data }));

function myWorkItem(overrides: Partial<MyWorkList['items'][number]> = {}): MyWorkList['items'][number] {
  return {
    container: false,
    taskId: 'TSK-1',
    taskName: '稟議資料作成',
    projectId: 'PRJ-A',
    projectName: 'Alpha',
    subprojectName: '試作',
    status: 'In Progress',
    displayStatus: 'OVERDUE',
    priority: 'High',
    dueDate: '2026-11-01',
    progressPercent: 40,
    actualHours: null,
    reviewState: 'NONE',
    lastRequestStatus: '',
    lastRequestType: '',
    pendingRequest: false,
    creationChannel: 'LEGACY',
    completedAt: null,
    revision: 1,
    ...overrides
  };
}

function myWorkList(items: MyWorkList['items']): MyWorkList {
  return { items, total: items.length, activeTotal: items.length, completedTotal: 0 };
}

const PROJECT_OPTIONS: MyWorkProjectOptions = {
  taskCreationEnabled: true,
  items: [
    {
      projectId: 'PRJ-A',
      projectName: 'Alpha',
      responsibilityName: 'Design',
      subprojects: [
        { subprojectId: 'SUB-1', subprojectName: '試作', parentSubprojectId: null, depth: 1 },
        { subprojectId: 'SUB-2', subprojectName: '評価', parentSubprojectId: 'SUB-1', depth: 2 }
      ]
    }
  ]
};

const REQUESTS: MemberRequests = {
  submissionEnabled: true,
  items: [
    {
      requestId: 'REQ-1',
      requestType: 'COMPLETION_REPORT',
      taskId: 'TSK-1',
      taskName: '稟議資料作成',
      projectName: 'Alpha',
      status: 'PENDING',
      submittedAt: '2026-11-02T01:00:00.000Z',
      decidedAt: null,
      decisionNote: '',
      staleReason: '',
      revision: 1
    },
    {
      requestId: 'REQ-2',
      requestType: 'DEADLINE_CHANGE',
      taskId: 'TSK-2',
      taskName: 'CADデータ修正',
      projectName: 'Alpha',
      status: 'REJECTED',
      submittedAt: '2026-10-20T01:00:00.000Z',
      decidedAt: '2026-10-21T01:00:00.000Z',
      decisionNote: '日程を再検討してください。',
      staleReason: '',
      revision: 2
    }
  ]
};

function stubFetch(handlers: { matches: string; data: unknown }[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      const handler = handlers.find((entry) => url.includes(entry.matches));
      if (!handler) return response(null);
      return response(handler.data);
    })
  );
}

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('deadline emphasis', () => {
  it('derives a tone from the stored date and the Asia/Tokyo business date', () => {
    expect(deadlineTone('2026-11-01', { today: '2026-11-04' })).toBe('overdue');
    expect(deadlineTone('2026-11-04', { today: '2026-11-04' })).toBe('today');
    expect(deadlineTone('2026-11-09', { today: '2026-11-04' })).toBe('open');
    expect(deadlineTone(null, { today: '2026-11-04' })).toBe('none');
    expect(deadlineTone('2026-11-01', { displayStatus: 'DONE', today: '2026-11-04' })).toBe('done');
    expect(deadlineTone('2026-11-01', { deadlineState: 'OVERDUE', today: '2026-11-04' })).toBe('overdue');
  });

  it('renders 納期 with an overdue badge, a today badge and 未設定 for a missing date', () => {
    render(
      <I18nProvider>
        <DeadlineCell dueDate="2026-11-01" displayStatus="OVERDUE" />
        <DeadlineCell dueDate={businessDate()} />
        <DeadlineCell dueDate={null} />
      </I18nProvider>
    );
    expect(screen.getAllByText('納期')).toHaveLength(3);
    expect(screen.getByText('2026-11-01')).toBeTruthy();
    expect(screen.getByText('期限超過')).toBeTruthy();
    expect(screen.getByText('今日')).toBeTruthy();
    expect(screen.getByText('未設定')).toBeTruthy();
  });
});

describe('my work readability', () => {
  it('shows a dedicated deadline region instead of burying the date in muted metadata', async () => {
    stubFetch([
      { matches: '/api/employee/my-work/projects', data: PROJECT_OPTIONS },
      { matches: '/api/employee/requests/mine', data: REQUESTS },
      { matches: '/api/employee/my-work?', data: myWorkList([myWorkItem()]) }
    ]);
    render(
      <I18nProvider>
        <MyWorkScreen actor={MEMBER} />
      </I18nProvider>
    );

    const title = await screen.findByRole('link', { name: '稟議資料作成' });
    const row = title.closest('.my-work-row') as HTMLElement;
    expect(row.querySelector('.my-work-row-due .deadline-label')?.textContent).toBe('納期');
    expect(row.querySelector('.my-work-row-due .deadline-value')?.textContent).toBe('2026-11-01');
    expect(row.querySelectorAll('.badge.danger').length).toBeGreaterThan(0);
    // Project and priority stay as secondary metadata, so the name is the strongest element.
    expect(row.querySelector('.my-work-row-meta')?.textContent).toContain('Alpha');
  });

  it('offers both creation forms, one at a time, and keeps the requests collapsed with counts', async () => {
    stubFetch([
      { matches: '/api/employee/my-work/projects', data: PROJECT_OPTIONS },
      { matches: '/api/employee/requests/mine', data: REQUESTS },
      { matches: '/api/employee/my-work?', data: myWorkList([myWorkItem()]) }
    ]);
    render(
      <I18nProvider>
        <MyWorkScreen actor={MEMBER} />
      </I18nProvider>
    );

    // The requests history is collapsed by default but states its totals.
    const toggle = await screen.findByRole('button', { name: '自分の申請を開閉' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('自分の申請');
    expect(toggle.textContent).toContain('2件');
    expect(toggle.textContent).toContain('承認待ち 1件');
    expect(screen.queryByText('REQ-1')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('REQ-1')).toBeTruthy();
    // A long decision note is not shown until that row is opened.
    expect(screen.queryByText(/日程を再検討してください/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '詳細を表示' }));
    expect(await screen.findByText(/日程を再検討してください/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText('REQ-1')).toBeNull();

    // One creation form at a time, and none of them is expanded by default.
    const taskTab = screen.getByRole('button', { name: '新規タスク' });
    const subprojectTab = screen.getByRole('button', { name: '新規サブプロジェクト' });
    expect(taskTab.getAttribute('aria-pressed')).toBe('false');
    expect(subprojectTab.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(subprojectTab);
    expect(subprojectTab.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('親サブプロジェクト（任意）')).toBeTruthy();
    expect(screen.queryByText('優先度')).toBeNull();
    fireEvent.click(taskTab);
    expect(taskTab.getAttribute('aria-pressed')).toBe('true');
    expect(subprojectTab.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('分野 terminology and overview counts', () => {
  it('names responsibilities 分野 and shows counts without a percentage', async () => {
    stubFetch([
      {
        matches: '/api/manager/bootstrap',
        data: { references: { responsibilities: [{ id: 'RSP-1', name: 'Design', status: 'Active' }] } }
      },
      {
        matches: '/api/manager/overview',
        data: {
          scope: { responsibilityId: '', unassigned: false, label: '' },
          counts: {
            workItems: 3,
            containers: 0,
            activeWork: 3,
            openWork: 2,
            overdueWork: 1,
            completedWork: 1,
            cancelledWork: 0
          },
          upcomingWindow: { days: 7, from: '2026-11-04', to: '2026-11-10' },
          overdue: [],
          overdueTotal: 0,
          upcoming: [],
          upcomingTotal: 0,
          responsibilities: [
            {
              responsibilityId: 'RSP-1',
              name: '製品設計',
              color: '#a8182f',
              ownerName: 'Aki Tanaka',
              status: 'Active',
              projectCount: 3,
              openWork: 12,
              overdueWork: 2,
              completedWork: 8,
              cancelledWork: 0,
              containers: 0,
              progressPercent: 62
            }
          ],
          projects: [],
          pendingRequests: [],
          generatedAt: '2026-11-04T00:00:00.000Z'
        }
      }
    ]);
    render(
      <I18nProvider>
        <OverviewScreen actor={MANAGER} />
      </I18nProvider>
    );

    expect(await screen.findByRole('heading', { name: '分野' })).toBeTruthy();
    const card = screen.getByText('製品設計').closest('.area-card') as HTMLElement;
    expect(card.textContent).toContain('未完了の作業');
    expect(card.textContent).toContain('12');
    expect(card.textContent).toContain('完了タスク');
    expect(card.textContent).toContain('8');
    // No percentage and no progress bar on a responsibility card.
    expect(card.textContent).not.toContain('%');
    expect(card.querySelector('.progressbar, .progress-bar, [role="progressbar"]')).toBeNull();
    expect(screen.queryByText('担当領域')).toBeNull();
  });

  it('shows 廃止 for a retired responsibility instead of the stored English value', async () => {
    stubFetch([
      {
        matches: '/api/manager/references',
        data: { members: [] }
      },
      {
        matches: '/api/manager/responsibilities',
        data: {
          items: [
            {
              responsibilityId: 'RSP-2',
              name: '旧分野',
              ownerMemberId: 'MEM-A',
              ownerName: 'Aki Tanaka',
              status: 'Retired',
              color: '',
              sortOrder: 1,
              members: [],
              revision: 1
            }
          ]
        }
      }
    ]);
    render(
      <I18nProvider>
        <ResponsibilitiesScreen actor={MANAGER} />
      </I18nProvider>
    );

    expect(await screen.findByText('廃止')).toBeTruthy();
    expect(screen.queryByText('Retired')).toBeNull();
  });
});

describe('workload timeline axis and today marker', () => {
  const today = businessDate();
  const weekStart = startOfWorkWeek(today);

  function report(overrides: Partial<WorkloadReport> = {}): WorkloadReport {
    return {
      mode: 'WEEK',
      start: weekStart,
      end: addDays(weekStart, 6),
      today,
      granularity: 'DAY',
      summary: {
        dueTasks: 3,
        completedTasks: 1,
        overdueTasks: 1,
        undatedTasks: 0,
        overdueWithinPeriod: 1,
        backlogBeforePeriod: 0,
        uniqueTasks: 3,
        assignments: 3
      },
      buckets: [
        { key: weekStart, start: weekStart, end: weekStart, dueTasks: 0, completedTasks: 0, overdueTasks: 0 },
        { key: addDays(weekStart, 1), start: addDays(weekStart, 1), end: addDays(weekStart, 1), dueTasks: 3, completedTasks: 0, overdueTasks: 1 },
        { key: addDays(weekStart, 2), start: addDays(weekStart, 2), end: addDays(weekStart, 2), dueTasks: 1, completedTasks: 0, overdueTasks: 0 }
      ],
      employees: [],
      assignmentBasis: 'CURRENT_ASSIGNMENTS',
      generatedAt: '2026-11-04T05:30:00.000Z',
      ...overrides
    };
  }

  function stubReport(value: WorkloadReport): void {
    stubFetch([
      {
        matches: '/api/manager/bootstrap',
        data: { references: { members: [], responsibilities: [] }, projects: [] }
      },
      { matches: '/reports/workload', data: value }
    ]);
  }

  it('labels the axis, shows a unit on every count, a date under every bar and the today marker', async () => {
    stubReport(report());
    render(
      <I18nProvider>
        <WorkloadScreen actor={MANAGER} />
      </I18nProvider>
    );

    expect(await screen.findByText('期限タスク数（件）')).toBeTruthy();
    expect(screen.getByText(/^日付 · /)).toBeTruthy();
    // Every bucket keeps its count with a unit, including a zero bucket.
    expect(screen.getByText('0件')).toBeTruthy();
    expect(screen.getByText('3件')).toBeTruthy();
    expect(screen.getByText('1件')).toBeTruthy();
    // Today is marked once, and the bar's tooltip repeats the date and both counts.
    expect(screen.getAllByText('今日')).toHaveLength(1);
    const bars = document.querySelectorAll('.timeline-bar');
    expect(bars).toHaveLength(3);
    expect(document.querySelectorAll('.timeline-bar.is-today')).toHaveLength(1);
    const todayBar = document.querySelector('.timeline-bar.is-today') as HTMLElement;
    expect(todayBar.textContent).toContain('今日');
    const todayBucket = report().buckets.find((bucket) => bucket.start <= today && today <= bucket.end)!;
    const tooltip = todayBar.querySelector('button')?.getAttribute('title') ?? '';
    expect(tooltip).toContain(`期限タスク: ${todayBucket.dueTasks}件`);
    expect(tooltip).toContain(`期限超過を含む: ${todayBucket.overdueTasks}件`);
    expect(screen.queryByText('今日は選択期間外です。')).toBeNull();
  });

  it('states that today is outside the selected period instead of drawing a misleading marker', async () => {
    const nextWeek = addDays(weekStart, 7);
    stubReport(
      report({
        start: nextWeek,
        end: addDays(nextWeek, 6),
        buckets: [
          { key: nextWeek, start: nextWeek, end: nextWeek, dueTasks: 2, completedTasks: 0, overdueTasks: 0 }
        ]
      })
    );
    render(
      <I18nProvider>
        <WorkloadScreen actor={MANAGER} />
      </I18nProvider>
    );

    expect(await screen.findByText('今日は選択期間外です。')).toBeTruthy();
    expect(document.querySelectorAll('.timeline-bar.is-today')).toHaveLength(0);
  });

  it('keeps an all-zero period readable with its dates and the today marker', async () => {
    stubReport(
      report({
        buckets: [
          { key: weekStart, start: weekStart, end: weekStart, dueTasks: 0, completedTasks: 0, overdueTasks: 0 },
          { key: addDays(weekStart, 1), start: addDays(weekStart, 1), end: addDays(weekStart, 1), dueTasks: 0, completedTasks: 0, overdueTasks: 0 }
        ]
      })
    );
    render(
      <I18nProvider>
        <WorkloadScreen actor={MANAGER} />
      </I18nProvider>
    );

    await waitFor(() => expect(document.querySelectorAll('.timeline-bar')).toHaveLength(2));
    expect(screen.getAllByText('0件')).toHaveLength(2);
    expect(screen.queryByText('該当するタスクはありません。')).toBeNull();
  });
});
