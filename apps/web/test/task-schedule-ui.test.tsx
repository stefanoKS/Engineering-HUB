// @vitest-environment jsdom
/**
 * The one task schedule presentation across screens.
 *
 * These tests pin what a reader actually sees: the Status column and the Deadline column of the
 * workload breakdown agree because both read the server-derived state, a stored "Not Started" or
 * "Assigned" value never overrides the derived badge, the same task reads the same way on another
 * screen, a completed task never carries a current "late" badge, both languages are correct, and a
 * page open across Tokyo midnight drops its date-dependent answers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { addDays, businessDate } from '@eh/domain';
import type { Actor } from '@eh/contracts';
import { I18nProvider } from '../src/i18n';
import { WorkloadScreen } from '../src/screens/Workload';
import { TaskDetailScreen } from '../src/screens/TaskDetail';
import { DeadlineCell } from '../src/components/deadline';
import { TaskStatusBadge } from '../src/components/task-status';
import { DATE_DEPENDENT_PREFIXES, queryCache, useQuery } from '../src/state/cache';

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
const yesterday = addDays(today, -1);
const tomorrow = addDays(today, 1);

const response = (data: unknown): Response =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const BOOTSTRAP = {
  references: {
    members: [{ memberId: 'MEM-A', name: 'Aki Tanaka', active: true, role: 'MEMBER' }],
    responsibilities: [{ id: 'RES-1', name: 'Design', status: 'Active' }]
  },
  projects: [{ projectId: 'PRJ-A', projectName: 'Alpha' }]
};

type Row = {
  taskId: string;
  taskName: string;
  status: string;
  displayStatus: string;
  scheduleMissing?: string;
  dueDate: string | null;
  completedDate?: string | null;
};

const ROWS: Row[] = [
  {
    taskId: 'TSK-PLANNED',
    taskName: 'Planned work',
    status: 'Not Started',
    displayStatus: 'PLANNED',
    scheduleMissing: 'NONE',
    dueDate: tomorrow
  },
  {
    taskId: 'TSK-BLOCKED',
    taskName: 'Blocked progress',
    status: 'Blocked',
    displayStatus: 'IN_PROGRESS',
    scheduleMissing: 'FINISH',
    dueDate: null
  },
  {
    taskId: 'TSK-DONE',
    taskName: 'Finished work',
    status: 'Done',
    displayStatus: 'DONE',
    scheduleMissing: 'NONE',
    dueDate: yesterday,
    completedDate: today
  },
  {
    taskId: 'TSK-LATE',
    taskName: 'Late work',
    status: 'In Progress',
    displayStatus: 'OVERDUE',
    scheduleMissing: 'START',
    dueDate: yesterday
  }
];

function drillItem(row: Row) {
  return {
    taskId: row.taskId,
    taskName: row.taskName,
    projectId: 'PRJ-A',
    projectName: 'Alpha',
    subprojectName: null,
    status: row.status,
    displayStatus: row.displayStatus,
    scheduleMissing: row.scheduleMissing,
    dueDate: row.dueDate,
    completedDate: row.completedDate ?? null,
    assigneeNames: ['Aki Tanaka'],
    revision: 1
  };
}

function workloadReport() {
  return {
    mode: 'WEEK',
    start: today,
    end: addDays(today, 6),
    today,
    granularity: 'DAY',
    summary: {
      dueTasks: ROWS.length,
      completedTasks: 1,
      overdueTasks: 1,
      undatedTasks: 0,
      overdueWithinPeriod: 0,
      backlogBeforePeriod: 1,
      uniqueTasks: ROWS.length,
      assignments: ROWS.length
    },
    buckets: [{ key: today, start: today, end: today, dueTasks: ROWS.length, completedTasks: 0, overdueTasks: 1 }],
    employees: [],
    assignmentBasis: 'CURRENT_ASSIGNMENTS',
    generatedAt: '2026-11-05T05:30:00.000Z'
  };
}

function stubWorkload(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('/api/manager/bootstrap')) return response(BOOTSTRAP);
      if (url.includes('/reports/workload/tasks')) {
        return response({
          kind: 'DUE',
          from: today,
          to: addDays(today, 6),
          items: ROWS.map(drillItem),
          total: ROWS.length,
          page: 1,
          pageSize: 20,
          totalPages: 1
        });
      }
      return response(workloadReport());
    })
  );
}

async function openBreakdown(): Promise<HTMLElement> {
  render(
    <I18nProvider>
      <WorkloadScreen actor={MANAGER} />
    </I18nProvider>
  );
  const card = (await screen.findAllByRole('button', { name: /対象期限タスク/ })).find((element) =>
    element.className.includes('kpi-button')
  );
  expect(card).toBeTruthy();
  (card as HTMLElement).click();
  await screen.findByText('Planned work');
  return document.querySelector('table.workload-tasks') as HTMLElement;
}

function rowOf(table: HTMLElement, name: string): HTMLElement {
  const cell = within(table).getByText(name);
  return cell.closest('tr') as HTMLElement;
}

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('workload status and deadline columns', () => {
  it('reads both columns from the same derived state', async () => {
    stubWorkload();
    const table = await openBreakdown();

    const planned = within(rowOf(table, 'Planned work'));
    expect(planned.getByText('予定')).toBeTruthy();
    // The stored workflow value is not the primary schedule badge any more.
    expect(planned.queryByText('未着手')).toBeNull();
    // A deadline that has not passed is never painted as late, and a planned task has a date.
    expect(planned.queryByText('遅延')).toBeNull();
    expect(planned.getByText(tomorrow)).toBeTruthy();

    const blocked = within(rowOf(table, 'Blocked progress'));
    expect(blocked.getByText('進行中')).toBeTruthy();
    // The workflow information is preserved as a secondary line, not as the primary badge.
    expect(blocked.getByText('ワークフロー: ブロック')).toBeTruthy();
    // The missing finish is stated instead of becoming a fake deadline.
    expect(blocked.getByText('終了日未設定')).toBeTruthy();
    expect(blocked.getByText('未設定', { selector: '.deadline-value' })).toBeTruthy();

    const late = within(rowOf(table, 'Late work'));
    expect(late.getByText('遅延')).toBeTruthy();
    // The overdue state lives in the status column; the compact deadline column does not repeat it.
    expect(late.getByText(yesterday)).toBeTruthy();
    expect(late.getAllByText('遅延')).toHaveLength(1);
  });

  it('never paints a completed task as currently late', async () => {
    stubWorkload();
    const table = await openBreakdown();
    const done = within(rowOf(table, 'Finished work'));
    expect(done.getByText('完了')).toBeTruthy();
    expect(done.queryByText('遅延')).toBeNull();
    // The finished-late wording is a separate, historical label.
    expect(done.getByText('期限後に完了')).toBeTruthy();
  });

  it('uses the same label for the same task on the task detail screen', async () => {
    stubWorkload();
    const table = await openBreakdown();
    expect(within(rowOf(table, 'Late work')).getByText('遅延')).toBeTruthy();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.includes('/report-eligibility')) {
          return response({ taskId: 'TSK-LATE', eligible: false, reasons: [], submissionEnabled: true, reporterName: 'Manager' });
        }
        if (url.includes('/references')) return response({ members: [], skills: [], subprojects: [] });
        if (url.includes('/api/employee/requests/mine')) return response({ items: [], submissionEnabled: true });
        if (url.includes('/api/manager/tasks/TSK-LATE')) {
          return response({
            record: {
              taskId: 'TSK-LATE',
              projectId: 'PRJ-A',
              subprojectId: null,
              parentTaskId: null,
              taskName: 'Late work',
              description: '',
              ownerMemberId: 'MEM-A',
              ownerName: 'Aki Tanaka',
              status: 'In Progress',
              displayStatus: 'OVERDUE',
              scheduleMissing: 'START',
              priority: 'Medium',
              plannedStart: null,
              dueDate: yesterday,
              estimatedHours: null,
              actualHours: null,
              progressPercent: null,
              dependencyIds: [],
              acceptanceCriteria: '',
              nextAction: '',
              requiredSkillId: null,
              requiredSkillLevel: null,
              assignmentVersion: 1,
              assignmentApprovedAt: null,
              notificationEnabled: false,
              notificationBaseline: '',
              publicNote: '',
              plannedDurationValue: null,
              plannedDurationUnit: null,
              plannedDurationBasis: null,
              plannedStartSource: null,
              completedAt: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              revision: 1
            },
            context: { projectId: 'PRJ-A', projectName: 'Alpha', subprojects: [] },
            assignees: [],
            additionalAssigneeIds: [],
            assigneeIds: [],
            assigneeHistory: [],
            confirmations: [],
            deadlineHistory: [],
            children: [],
            depth: 1
          });
        }
        return response({ items: [], total: 0, totalPages: 1 });
      })
    );

    const detailView = render(
      <I18nProvider>
        <TaskDetailScreen actor={MANAGER} taskId="TSK-LATE" />
      </I18nProvider>
    );
    await within(detailView.container).findByRole('heading', { name: 'Late work' });
    expect(within(detailView.container).getAllByText('遅延').length).toBeGreaterThan(0);
    // The stored workflow value is labelled as such, never presented as the schedule state.
    expect(within(detailView.container).getByText('ワークフロー状態（保存値）')).toBeTruthy();
  });
});

describe('localized schedule labels', () => {
  it('labels every state in Japanese', () => {
    const { container } = render(
      <I18nProvider>
        <TaskStatusBadge state="PLANNED" missing="NONE" />
        <TaskStatusBadge state="IN_PROGRESS" missing="FINISH" showDetail />
        <TaskStatusBadge state="OVERDUE" missing="NONE" />
        <TaskStatusBadge state="START_NOT_SET" missing="START" showDetail />
        <TaskStatusBadge state="DATES_NOT_SET" missing="BOTH" showDetail />
        <TaskStatusBadge state="INVALID_DATES" missing="NONE" />
        <TaskStatusBadge state="DONE" missing="NONE" />
        <TaskStatusBadge state="CANCELLED" missing="NONE" />
      </I18nProvider>
    );
    for (const label of ['予定', '進行中', '遅延', '開始日未設定', '日程未設定', '日程データ要確認', '完了', '取消']) {
      expect(within(container).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(container).getByText('終了日未設定')).toBeTruthy();
    expect(within(container).getByText('開始日と終了日が未設定')).toBeTruthy();
  });

  it('labels every state in English when the preference says so', () => {
    window.localStorage.setItem('eh.lang', 'en');
    const { container } = render(
      <I18nProvider>
        <TaskStatusBadge state="PLANNED" missing="NONE" />
        <TaskStatusBadge state="IN_PROGRESS" missing="FINISH" showDetail />
        <TaskStatusBadge state="OVERDUE" missing="NONE" />
        <TaskStatusBadge state="START_NOT_SET" missing="START" showDetail />
        <TaskStatusBadge state="DATES_NOT_SET" missing="BOTH" showDetail />
        <TaskStatusBadge state="INVALID_DATES" missing="NONE" />
        <TaskStatusBadge state="DONE" missing="NONE" />
        <TaskStatusBadge state="CANCELLED" missing="NONE" />
      </I18nProvider>
    );
    for (const label of ['Planned', 'In progress', 'Late', 'Start not set', 'Dates not set', 'Check the schedule dates', 'Done', 'Cancelled']) {
      expect(within(container).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(container).getByText('Finish not set')).toBeTruthy();
    expect(within(container).getByText('Start and finish not set')).toBeTruthy();
  });
});

describe('deadline presentation', () => {
  it('keeps done and cancelled above a past deadline', () => {
    const { container } = render(
      <I18nProvider>
        <DeadlineCell dueDate={yesterday} state="DONE" />
        <DeadlineCell dueDate={yesterday} state="CANCELLED" />
        <DeadlineCell dueDate={yesterday} state="INVALID_DATES" />
      </I18nProvider>
    );
    expect(within(container).queryByText('遅延')).toBeNull();
    expect(container.querySelectorAll('.deadline-done').length).toBe(1);
    expect(container.querySelectorAll('.deadline-cancelled').length).toBe(1);
    // A reversed interval is a warning, never a red current-overdue badge.
    expect(container.querySelectorAll('.deadline-open').length).toBe(1);
  });

  it('shows a due-today hint without changing the primary state', () => {
    const { container } = render(
      <I18nProvider>
        <DeadlineCell dueDate={today} state="IN_PROGRESS" />
      </I18nProvider>
    );
    expect(within(container).getByText('今日')).toBeTruthy();
    expect(within(container).queryByText('遅延')).toBeNull();
  });
});

describe('business-date refresh', () => {
  it('drops the date-dependent answers so the mounted read is fetched again', async () => {
    let version = 1;
    const fetcher = vi.fn(async () => response({ version: version }));
    vi.stubGlobal('fetch', fetcher);

    function Probe(): JSX.Element {
      const result = useQuery<{ version: number }>('manager/tasks?probe=1', async () => {
        const answer = await fetcher();
        return (await answer.json()).data as { version: number };
      });
      return <span>{result.data ? `v${result.data.version}` : 'loading'}</span>;
    }

    render(<Probe />);
    await screen.findByText('v1');
    expect(fetcher).toHaveBeenCalledTimes(1);

    version = 2;
    queryCache.invalidate([...DATE_DEPENDENT_PREFIXES]);
    await screen.findByText('v2');
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    // The task list and the workload report are both part of the date-dependent set.
    expect(DATE_DEPENDENT_PREFIXES).toContain('manager/tasks');
    expect(DATE_DEPENDENT_PREFIXES).toContain('manager/workload');
  });
});
