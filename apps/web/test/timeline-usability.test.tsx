// @vitest-environment jsdom
/**
 * Timeline usability: correct date meanings, one toolbar, project attention filters and the
 * inspection panel. The fixtures carry plan, deadline, completion and derived group spans as four
 * separate facts, exactly as the read-only projection sends them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Actor } from '@eh/contracts';
import { I18nProvider, useI18n } from '../src/i18n';
import { TimelineScreen } from '../src/screens/Timeline';
import { queryCache } from '../src/state/cache';
import { clearDivisionScope, selectDivision, setDivisionScope } from '../src/state/division';
import { resetRouteMemory } from '../src/state/navigation';

afterEach(() => {
  cleanup();
  queryCache.clear();
  resetRouteMemory();
  clearDivisionScope();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const response = (data: unknown): Response =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const refused = (code: string, message: string, retryable = true): Response =>
  new Response(
    JSON.stringify({ ok: false, error: { code, message, retryable, correlationId: 'c1' } }),
    { status: 500, headers: { 'content-type': 'application/json' } }
  );

const MEMBER: Actor = {
  memberId: 'MEM-1',
  name: 'Member',
  email: 'member@example.co.jp',
  role: 'MEMBER',
  active: true,
  verified: true,
  selfServiceEnabled: true
};

const childRange = (start: string | null, end: string | null, dated: number, total: number) => ({
  start,
  end,
  datedItems: dated,
  totalItems: total
});

const projectRow = (name = 'Visible project') => ({
  projectId: 'PRJ-V',
  projectName: name,
  responsibilityId: null,
  responsibilityName: '',
  status: 'Active',
  schedule: { state: 'IN_PROGRESS', missing: 'NONE' },
  plannedStart: '2026-03-01',
  forecastEnd: '2026-06-30',
  committedDeadline: '2026-07-15',
  progressPercent: 40,
  openWork: 3,
  completedWork: 1,
  childRange: childRange('2026-02-01', '2026-12-05', 6, 7),
  undated: false,
  scheduleStart: '2026-03-01',
  scheduleFinish: '2026-07-15',
  dateState: 'RANGE',
  dateSource: 'EXPLICIT'
});

function taskRow(input: Record<string, unknown>) {
  return {
    projectId: 'PRJ-V',
    subprojectId: 'SUB-V1',
    parentTaskId: null,
    status: 'In Progress',
    displayStatus: 'IN_PROGRESS',
    completedAt: null,
    container: false,
    depth: 1,
    progressPercent: null,
    childRange: childRange(null, null, 0, 0),
    undated: false,
    inconsistent: false,
    reviewState: 'NONE',
    assigneeNames: [],
    plannedStart: null,
    dueDate: null,
    scheduleStart: null,
    scheduleFinish: null,
    dateState: 'UNDATED',
    dateSource: 'NONE',
    ...input
  };
}

const BRANCH = {
  project: projectRow(),
  subprojects: [
    {
      subprojectId: 'SUB-V1',
      projectId: 'PRJ-V',
      parentSubprojectId: null,
      subprojectName: 'Prototype',
      status: 'Active',
      schedule: { state: 'IN_PROGRESS', missing: 'NONE' },
      plannedStart: '2026-03-05',
      plannedEnd: '2026-04-20',
      deadline: '2026-04-25',
      depth: 1,
      childRange: childRange('2026-03-01', '2026-03-20', 3, 6),
      undated: false,
      scheduleStart: '2026-03-01',
      scheduleFinish: '2026-03-20',
      dateState: 'RANGE',
      dateSource: 'DERIVED'
    }
  ],
  tasks: [
    taskRow({
      taskId: 'T-CONTAINER',
      taskName: 'Phase container',
      container: true,
      status: 'Done',
      dueDate: '2026-06-30',
      childRange: childRange('2026-03-01', '2026-03-10', 1, 1),
      scheduleStart: '2026-03-01',
      scheduleFinish: '2026-03-10',
      dateState: 'RANGE',
      dateSource: 'DERIVED'
    }),
    taskRow({
      taskId: 'T-MATCH',
      taskName: 'Overdue child',
      parentTaskId: 'T-CONTAINER',
      displayStatus: 'OVERDUE',
      plannedStart: '2026-03-01',
      dueDate: '2026-03-10',
      scheduleStart: '2026-03-01',
      scheduleFinish: '2026-03-10',
      dateState: 'RANGE',
      dateSource: 'EXPLICIT'
    }),
    taskRow({
      taskId: 'T-PLAN',
      taskName: 'Planned work',
      plannedStart: '2026-03-10',
      dueDate: '2026-03-20',
      scheduleStart: '2026-03-10',
      scheduleFinish: '2026-03-20',
      dateState: 'RANGE',
      dateSource: 'EXPLICIT',
      assigneeNames: ['Alice']
    }),
    taskRow({
      taskId: 'T-DUE',
      taskName: 'Deadline only',
      dueDate: '2026-03-18',
      scheduleStart: '2026-03-18',
      scheduleFinish: '2026-03-18',
      dateState: 'FINISH_ONLY',
      dateSource: 'EXPLICIT'
    }),
    taskRow({
      taskId: 'T-DONE',
      taskName: 'Finished work',
      status: 'Done',
      displayStatus: 'DONE',
      plannedStart: '2026-02-01',
      dueDate: '2026-02-10',
      completedAt: '2026-02-11T02:00:00.000Z',
      scheduleStart: '2026-02-01',
      scheduleFinish: '2026-02-10',
      dateState: 'RANGE',
      dateSource: 'EXPLICIT'
    }),
    taskRow({
      taskId: 'T-REVIEW',
      taskName: 'Review work',
      plannedStart: '2026-03-14',
      dueDate: '2026-03-15',
      scheduleStart: '2026-03-14',
      scheduleFinish: '2026-03-15',
      dateState: 'RANGE',
      dateSource: 'EXPLICIT',
      reviewState: 'PENDING'
    }),
    taskRow({
      taskId: 'T-OFF',
      taskName: 'Far work',
      plannedStart: '2026-12-01',
      dueDate: '2026-12-05',
      scheduleStart: '2026-12-01',
      scheduleFinish: '2026-12-05',
      dateState: 'RANGE',
      dateSource: 'EXPLICIT'
    }),
    taskRow({
      taskId: 'T-NONE',
      taskName: 'No dates',
      subprojectId: null,
      dateState: 'UNDATED',
      dateSource: 'NONE',
      undated: true
    })
  ],
  truncated: false,
  taskTotal: 8,
  fitRange: { start: '2026-02-01', end: '2026-12-05' }
};

const ATTENTION = {
  projectId: 'PRJ-V',
  today: '2026-03-15',
  dueSoon: { from: '2026-03-15', to: '2026-03-21' },
  includesOutsideChart: true,
  buckets: [
    { key: 'ALL', count: 5, taskIds: [], contextTaskIds: [], contextSubprojectIds: [] },
    {
      key: 'OVERDUE',
      count: 1,
      taskIds: ['T-MATCH'],
      contextTaskIds: ['T-CONTAINER'],
      contextSubprojectIds: ['SUB-V1']
    },
    { key: 'DUE_SOON', count: 1, taskIds: ['T-REVIEW'], contextTaskIds: [], contextSubprojectIds: ['SUB-V1'] },
    { key: 'REVIEW', count: 1, taskIds: ['T-REVIEW'], contextTaskIds: [], contextSubprojectIds: ['SUB-V1'] },
    { key: 'MISSING_DATES', count: 1, taskIds: ['T-NONE'], contextTaskIds: [], contextSubprojectIds: [] }
  ]
};

function stubTimeline(overrides: {
  branch?: (attempt: number) => Response;
  overview?: (url: URL) => Promise<Response> | Response;
} = {}) {
  let attempts = 0;
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname.endsWith('/attention')) return response(ATTENTION);
    if (url.pathname === '/api/work/timeline' && url.searchParams.get('projectId')) {
      attempts += 1;
      if (overrides.branch) return overrides.branch(attempts);
      return response(BRANCH);
    }
    if (url.pathname === '/api/work/timeline') {
      if (overrides.overview) return overrides.overview(url);
      return response({
        items: [projectRow()],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
        responsibilities: [],
        fitRange: { start: '2026-02-01', end: '2026-12-05' }
      });
    }
    if (url.pathname === '/api/work/projects') {
      return response({
        items: [],
        responsibilities: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 0
      });
    }
    return response({ items: [], total: 0, totalPages: 1 });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

const callsTo = (fetcher: ReturnType<typeof vi.fn>, part: string) =>
  fetcher.mock.calls.filter(([input]) => String(input).includes(part));

function renderTimeline(props: { projectId?: string; subprojectId?: string; anchor?: string } = {}) {
  return render(
    <I18nProvider>
      <TimelineScreen
        actor={MEMBER}
        initialProjectId={props.projectId}
        initialSubprojectId={props.subprojectId}
        initialAnchor={props.anchor ?? '2026-03-05'}
      />
    </I18nProvider>
  );
}

const chartText = (text: string): boolean =>
  document.querySelector('.tl-scroller')?.textContent?.includes(text) ?? false;

async function expandPrototype(): Promise<void> {
  await waitFor(() => expect(document.querySelector('.tl-kind-subproject')).not.toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '展開' }));
  await waitFor(() => expect(document.querySelectorAll('.tl-kind-task').length).toBeGreaterThan(0));
}

describe('timeline date meanings', () => {
  it('keeps a plan, a deadline and a recorded completion separate in the list', async () => {
    stubTimeline();
    renderTimeline({ projectId: 'PRJ-V' });
    await expandPrototype();
    const row = [...document.querySelectorAll('.timeline-list tbody tr')].find((element) =>
      element.textContent?.includes('Finished work')
    );
    expect(row).toBeTruthy();
    const cells = [...(row as HTMLElement).querySelectorAll('td')].map((cell) => cell.textContent ?? '');
    expect(cells[1]).toBe('2026-02-01 → 2026-02-10');
    expect(cells[2]).toBe('2026-02-10');
    expect(cells[3]).toBe('2026-02-11');
  });

  it('shows the committed deadline and its source in the inspection panel', async () => {
    stubTimeline();
    renderTimeline({ projectId: 'PRJ-V' });
    await expandPrototype();
    fireEvent.click(screen.getByRole('button', { name: '内容: Planned work' }));
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByText('2026-03-10 → 2026-03-20')).toBeTruthy();
    expect(within(panel).getByText('2026-03-20')).toBeTruthy();
    expect(within(panel).getByText('保存された予定')).toBeTruthy();
    expect(within(panel).getByText('Alice')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'タスクを開く' }).getAttribute('href')).toBe('#/task/T-PLAN');
  });

  it('renders a deadline-only record as a commitment marker, not a schedule', async () => {
    stubTimeline();
    renderTimeline({ projectId: 'PRJ-V' });
    await expandPrototype();
    const bar = document.querySelector('.tl-bar[title*="2026-03-18"]');
    expect(bar?.classList.contains('is-deadline-only')).toBe(true);
    expect(document.querySelector('.tl-bar-diamond')).not.toBeNull();
    // The derived group span is an outlined bracket, never a solid plan or a deadline.
    const group = document.querySelector('.tl-bar.is-group');
    expect(group).not.toBeNull();
  });
});

describe('project attention filters', () => {
  it('shows server counts, keeps them independent of expansion and filters to matches plus context', async () => {
    const fetcher = stubTimeline();
    renderTimeline({ projectId: 'PRJ-V' });
    await expandPrototype();
    const overdue = screen.getByRole('button', { name: /期限超過/ });
    expect(within(overdue).getByText('1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /7日以内/ })).toBeTruthy();
    // The seven-day interval is stated explicitly from the server answer.
    expect(
      screen.getByText(/7日以内: 2026-03-15〜2026-03-21/)
    ).toBeTruthy();
    // Expanding a branch adds no read and changes no count.
    expect(callsTo(fetcher, '/attention')).toHaveLength(1);

    fireEvent.click(overdue);
    await waitFor(() => expect(chartText('Overdue child')).toBe(true));
    expect(chartText('Review work')).toBe(false);
    // The ancestor container is retained once as context and never counted as work.
    expect(
      within(document.querySelector('.tl-scroller') as HTMLElement).getAllByText('Phase container')
    ).toHaveLength(1);
    expect(chartText('Finished work')).toBe(false);
    expect(screen.getByText('1 件の一致する作業と、その親を表示しています。')).toBeTruthy();
    // One-step return to all schedules.
    fireEvent.click(screen.getByRole('button', { name: /すべての予定/ }));
    await waitFor(() => expect(chartText('Review work')).toBe(true));
  });

  it('states the real date condition of unscheduled work', async () => {
    stubTimeline();
    renderTimeline({ projectId: 'PRJ-V' });
    await expandPrototype();
    expect(document.querySelector('.undated-work')?.textContent).toContain('No dates');
    expect(document.querySelector('.undated-work')?.textContent).toContain('日付が保存されていません');
  });
});

describe('inspection panel interaction', () => {
  it('moves focus into the panel, closes on Escape and restores the invoker', async () => {
    stubTimeline();
    renderTimeline({ projectId: 'PRJ-V' });
    await expandPrototype();
    const invoker = screen.getByRole('button', { name: '内容: Planned work' });
    invoker.focus();
    fireEvent.click(invoker);
    const heading = within(screen.getByRole('dialog')).getByRole('heading', { name: 'Planned work' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(invoker);
  });
});

describe('period controls', () => {
  it('brings an offscreen schedule into view deliberately', async () => {
    stubTimeline();
    renderTimeline({ projectId: 'PRJ-V' });
    await expandPrototype();
    const row = [...document.querySelectorAll('.tl-kind-task')].find((element) =>
      element.textContent?.includes('Far work')
    ) as HTMLElement;
    expect(row.textContent).toContain('画面外');
    fireEvent.click(within(row).getByRole('button', { name: '表示' }));
    expect((screen.getByLabelText('表示終了日') as HTMLInputElement).value.startsWith('2026-12')).toBe(true);
  });

  it('steps to the next calendar month and back again without changing a stored date', async () => {
    stubTimeline();
    renderTimeline({ projectId: 'PRJ-V' });
    await expandPrototype();
    fireEvent.click(screen.getByRole('button', { name: '1か月' }));
    expect(document.querySelector('.timeline-range')?.textContent).toBe('2026-03-01 – 2026-03-31');
    fireEvent.click(screen.getByRole('button', { name: /次へ/ }));
    expect(document.querySelector('.timeline-range')?.textContent).toBe('2026-04-01 – 2026-04-30');
    fireEvent.click(screen.getByRole('button', { name: /前へ/ }));
    expect(document.querySelector('.timeline-range')?.textContent).toBe('2026-03-01 – 2026-03-31');
  });
});

describe('chart and agenda', () => {
  it('shows the same authorized rows and keeps the mode across a language switch', async () => {
    stubTimeline();
    function Shell(): JSX.Element {
      const { language, setLanguage } = useI18n();
      return (
        <>
          <button type="button" onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')}>
            lang
          </button>
          <TimelineScreen actor={MEMBER} initialProjectId="PRJ-V" initialAnchor="2026-03-05" />
        </>
      );
    }
    render(
      <I18nProvider>
        <Shell />
      </I18nProvider>
    );
    await expandPrototype();
    fireEvent.click(screen.getByRole('button', { name: '予定表' }));
    expect(screen.getByRole('button', { name: '予定表' }).getAttribute('aria-pressed')).toBe('true');
    // The agenda labels due and completed dates explicitly.
    expect(screen.getAllByText('完了').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Far work' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'lang' }));
    expect(screen.getByRole('button', { name: 'Agenda' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Far work' })).toBeTruthy();
  });
});

describe('branch failures and division scope', () => {
  it('shows an error with a working retry for an expanded branch', async () => {
    const fetcher = stubTimeline({
      branch: (attempt) => (attempt === 1 ? refused('INTERNAL_ERROR', 'boom') : response(BRANCH))
    });
    renderTimeline();
    await waitFor(() => expect(document.querySelector('.tl-kind-project .tl-label')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '展開' }));
    const retry = await screen.findByRole('button', { name: '再試行' });
    expect(screen.queryByText('階層を読み込み中…')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(document.querySelector('.tl-kind-subproject')).not.toBeNull());
    expect(callsTo(fetcher, 'projectId=PRJ-V').length).toBeGreaterThanOrEqual(2);
  });

  it('sends the selected division with every scoped request', async () => {
    setDivisionScope({
      readable: [
        { divisionId: 'DIV-1', name: 'Division one', status: 'Active' },
        { divisionId: 'DIV-2', name: 'Division two', status: 'Active' }
      ],
      writable: [],
      allDivisions: false
    });
    act(() => selectDivision('DIV-1'));
    const fetcher = stubTimeline();
    renderTimeline({ projectId: 'PRJ-V' });
    await waitFor(() => expect(document.querySelector('.tl-kind-project .tl-label')).not.toBeNull());
    const withDivision = (part: string) =>
      fetcher.mock.calls.filter(
        ([input]) => String(input).includes(part) && String(input).includes('divisionId=DIV-1')
      ).length;
    expect(withDivision('/api/work/timeline')).toBeGreaterThan(0);
    expect(withDivision('/attention'), JSON.stringify(fetcher.mock.calls.map((call) => String(call[0])))).toBeGreaterThan(0);
  });

  it('never paints a superseded division answer', async () => {
    setDivisionScope({
      readable: [
        { divisionId: 'DIV-1', name: 'Division one', status: 'Active' },
        { divisionId: 'DIV-2', name: 'Division two', status: 'Active' }
      ],
      writable: [],
      allDivisions: false
    });
    let resolveFirst: (value: Response) => void = () => undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    stubTimeline({
      overview: (url) => {
        const division = url.searchParams.get('divisionId');
        if (division === 'DIV-1') return first;
        if (division === 'DIV-2') {
          return response({
            items: [projectRow('Second division project')],
            total: 1,
            page: 1,
            pageSize: 25,
            totalPages: 1,
            responsibilities: [],
            fitRange: null
          });
        }
        return response({
          items: [projectRow('All divisions project')],
          total: 1,
          page: 1,
          pageSize: 25,
          totalPages: 1,
          responsibilities: [],
          fitRange: null
        });
      }
    });
    renderTimeline();
    await waitFor(() => expect(document.querySelector('.tl-kind-project .tl-label')?.textContent).toBe('All divisions project'));
    act(() => selectDivision('DIV-1'));
    act(() => selectDivision('DIV-2'));
    await waitFor(() => expect(document.querySelector('.tl-kind-project .tl-label')?.textContent).toBe('Second division project'));
    await act(async () => {
      resolveFirst(
        response({
          items: [projectRow('First division project')],
          total: 1,
          page: 1,
          pageSize: 25,
          totalPages: 1,
          responsibilities: [],
          fitRange: null
        })
      );
    });
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(screen.queryAllByText('First division project')).toHaveLength(0);
    expect(document.querySelector('.tl-kind-project .tl-label')?.textContent).toBe('Second division project');
  });

  it('initializes the subproject filter from a deep link', async () => {
    const fetcher = stubTimeline();
    renderTimeline({ projectId: 'PRJ-V', subprojectId: 'SUB-V1' });
    await waitFor(() => expect(document.querySelector('.tl-kind-subproject')).not.toBeNull());
    expect((screen.getByLabelText('サブプロジェクトを選択') as HTMLSelectElement).value).toBe('SUB-V1');
    expect(
      fetcher.mock.calls.some(
        ([input]) => String(input).includes('/api/work/timeline') && String(input).includes('subprojectId=SUB-V1')
      )
    ).toBe(true);
  });
});
