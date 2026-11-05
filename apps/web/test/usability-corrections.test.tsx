// @vitest-environment jsdom
/**
 * Usability corrections: search restoration, page resets, clean characters, a real collapsed
 * "Change location", contextual project names, modal focus and the read-only timeline.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
}
import { I18nProvider } from '../src/i18n';
import { MyWorkScreen } from '../src/screens/MyWork';
import { TaskForm } from '../src/screens/TaskForm';
import { TimelineScreen } from '../src/screens/Timeline';
import { Modal } from '../src/components/ui';
import { TextInput } from '../src/components/forms';
import { queryCache } from '../src/state/cache';

const response = (data: unknown): Response =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const MEMBER = {
  memberId: 'MEM-1',
  name: 'Member',
  email: 'member@example.co.jp',
  role: 'MEMBER',
  active: true,
  verified: true,
  selfServiceEnabled: true
} as const;

function workItem(taskId: string, taskName: string, dueDate: string | null) {
  return {
    container: false,
    taskId,
    taskName,
    projectId: 'PRJ-A',
    projectName: 'Alpha',
    subprojectName: '試作',
    status: 'In Progress',
    displayStatus: 'IN_PROGRESS',
    priority: 'High',
    dueDate,
    progressPercent: 10,
    actualHours: null,
    reviewState: 'NONE',
    lastRequestStatus: '',
    lastRequestType: '',
    pendingRequest: false,
    creationChannel: 'LEGACY',
    completedAt: null,
    revision: 1
  };
}

function stubMyWork(overrides: { pages?: Record<string, unknown> } = {}): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/api/employee/my-work/project-filter')) {
      return response({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 1, selected: null });
    }
    if (url.includes('/api/employee/requests/mine')) return response({ items: [], submissionEnabled: true });
    if (url.includes('/api/employee/my-work')) {
      const key = Object.keys(overrides.pages ?? {}).find((entry) => url.includes(entry));
      if (key) return response(overrides.pages![key]);
      return response({
        items: [workItem('TSK-1', '稟議資料作成', '2026-11-10')],
        total: 40,
        activeTotal: 40,
        completedTotal: 0,
        unfilteredActiveTotal: 40
      });
    }
    return response({ items: [], total: 0, pages: 1 });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('My Work search restoration', () => {
  it('restores the visible search field from the remembered query and keeps the filtered request', async () => {
    const fetcher = stubMyWork();
    const first = render(<I18nProvider><MyWorkScreen actor={MEMBER as never} /></I18nProvider>);
    const input = (await screen.findByPlaceholderText('タスク名で検索')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '稟議' } });
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([url]) => String(url).includes(`query=${encodeURIComponent('稟議')}`))).toBe(true)
    );
    first.unmount();

    // Returning to the screen restores both the input and the applied query instead of clearing it.
    queryCache.clear();
    const second = stubMyWork();
    render(<I18nProvider><MyWorkScreen actor={MEMBER as never} /></I18nProvider>);
    const restored = (await screen.findByPlaceholderText('タスク名で検索')) as HTMLInputElement;
    expect(restored.value).toBe('稟議');
    await waitFor(() =>
      expect(
        second.mock.calls.some(([url]) => String(url).includes(`query=${encodeURIComponent('稟議')}`))
      ).toBe(true)
    );
  });

  it('resets the active and the completed page when a filter changes', async () => {
    const fetcher = stubMyWork();
    render(<I18nProvider><MyWorkScreen actor={MEMBER as never} /></I18nProvider>);
    await screen.findByText('稟議資料作成');
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true)
    );
    fetcher.mockClear();
    fireEvent.click(screen.getByLabelText('期限超過'));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url]) => String(url).includes('page=1') && String(url).includes('overdue=true')
        )
      ).toBe(true)
    );
    // The previous page number never addresses the new result set.
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(false);
  });

  it('renders clean arrows and separators instead of damaged characters', async () => {
    stubMyWork();
    render(<I18nProvider><MyWorkScreen actor={MEMBER as never} /></I18nProvider>);
    const toggle = await screen.findByRole('button', { name: /完了したタスク/ });
    expect(toggle.textContent).toContain('▶');
    expect(toggle.textContent).not.toMatch(/[笆ﾂ繧]/);
    const meta = document.querySelector('.my-work-row-meta');
    expect(meta?.textContent).toContain('·');
    expect(meta?.textContent).not.toContain('ﾂ');
  });
});

describe('Change location', () => {
  const references = {
    members: [],
    skills: [],
    subprojects: [{ id: 'SUB-A', name: 'Correct area', projectId: 'PRJ-A', parentId: null, status: 'Active' }]
  };

  function stubForm(): ReturnType<typeof vi.fn> {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('parent-options')) {
        return response({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 1, selected: null });
      }
      if (url.includes('/api/manager/projects/PRJ-A')) {
        return response({ record: { projectId: 'PRJ-A', projectName: 'Alpha' } });
      }
      if (url.includes('/api/manager/projects/PRJ-B')) {
        return response({ record: { projectId: 'PRJ-B', projectName: 'Beta' } });
      }
      if (url.includes('/api/manager/projects')) {
        return response({
          items: [
            { projectId: 'PRJ-A', projectName: 'Alpha' },
            { projectId: 'PRJ-B', projectName: 'Beta' }
          ],
          total: 2,
          totalPages: 1
        });
      }
      return response({ items: [], total: 0, totalPages: 1 });
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }

  it('shows only the readable location until the section is expanded, and never changes values', async () => {
    const fetcher = stubForm();
    render(
      <I18nProvider>
        <TaskForm
          initialProjectId="PRJ-A"
          initialSubprojectId="SUB-A"
          context={{ projectName: 'Alpha', subprojectPath: 'Correct area' }}
          references={references}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>
    );
    // Collapsed: a readable summary and one control, no location editors and no project search.
    expect(await screen.findByText('Alpha / Correct area')).toBeTruthy();
    expect(screen.queryByLabelText('プロジェクト')).toBeNull();
    expect(screen.queryByLabelText('親タスク')).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('parent-options'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '作成先を変更' }));
    expect(await screen.findByLabelText('親タスク')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'この作成先のまま' }));
    // Closing the section restores the summary and changes nothing.
    expect(screen.queryByLabelText('親タスク')).toBeNull();
    expect(screen.getByText('Alpha / Correct area')).toBeTruthy();
  });

  it('resolves the name of a newly chosen project instead of keeping the original context', async () => {
    stubForm();
    render(
      <I18nProvider>
        <TaskForm
          initialProjectId="PRJ-A"
          context={{ projectName: 'Alpha' }}
          references={references}
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: '作成先を変更' }));
    const select = (await screen.findByLabelText('プロジェクト')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: 'PRJ-B' } });
    // The summary follows the newly selected project, never the one that opened the form.
    await waitFor(() => expect(document.querySelector('.location-path')?.textContent).toBe('Beta'));
  });
});

describe('modal focus', () => {
  it('focuses the first editable field instead of the header close button', async () => {
    render(
      <I18nProvider>
        <Modal title="Editor" onClose={() => undefined}>
          <div>
            <span>説明</span>
            <input aria-label="最初の項目" />
            <input aria-label="二番目の項目" />
          </div>
        </Modal>
      </I18nProvider>
    );
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('最初の項目'));
  });

  it('honours an explicit preferred target and returns focus on close', async () => {
    function Harness(): JSX.Element {
      return (
        <I18nProvider>
          <button type="button">opener</button>
          <Modal title="Editor" onClose={() => undefined}>
            <div>
              <input aria-label="最初の項目" />
              <TextInput value="" onChange={() => undefined} autoFocus ariaLabel="優先項目" />
            </div>
          </Modal>
        </I18nProvider>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('優先項目'));
  });

  it('does not focus a disabled field', async () => {
    render(
      <I18nProvider>
        <Modal title="Editor" onClose={() => undefined}>
          <div>
            <input aria-label="無効な項目" disabled />
            <textarea aria-label="有効な項目" />
          </div>
        </Modal>
      </I18nProvider>
    );
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('有効な項目'));
  });
});

const TIMELINE_PROJECT = {
  projectId: 'PRJ-V',
  projectName: 'Visible project',
  responsibilityId: 'RSP-T',
  responsibilityName: 'Design area',
  status: 'Active',
  plannedStart: '2026-03-01',
  forecastEnd: '2026-06-30',
  committedDeadline: '2026-07-15',
  progressPercent: 40,
  openWork: 2,
  completedWork: 0,
  childRange: { start: '2026-03-05', end: '2026-09-10', datedItems: 3, totalItems: 5 },
  undated: false
};

const TIMELINE_BRANCH = {
  project: TIMELINE_PROJECT,
  subprojects: [
    {
      subprojectId: 'SUB-V1',
      projectId: 'PRJ-V',
      parentSubprojectId: null,
      subprojectName: 'Prototype',
      status: 'Active',
      plannedStart: '2026-03-05',
      plannedEnd: '2026-04-20',
      deadline: '2026-04-25',
      depth: 1,
      childRange: { start: '2026-03-10', end: '2026-03-20', datedItems: 1, totalItems: 2 },
      undated: false
    }
  ],
  tasks: [
    {
      taskId: 'TSK-PLAN',
      projectId: 'PRJ-V',
      subprojectId: 'SUB-V1',
      parentTaskId: null,
      taskName: 'Planned work',
      status: 'In Progress',
      displayStatus: 'IN_PROGRESS',
      plannedStart: '2026-03-10',
      dueDate: '2026-03-20',
      completedAt: null,
      container: false,
      depth: 1,
      progressPercent: 30,
      childRange: { start: '2026-03-10', end: '2026-03-20', datedItems: 1, totalItems: 1 },
      undated: false,
      inconsistent: false
    },
    {
      taskId: 'TSK-DUE',
      projectId: 'PRJ-V',
      subprojectId: null,
      parentTaskId: null,
      taskName: 'Deadline only',
      status: 'Assigned',
      displayStatus: 'IN_PROGRESS',
      plannedStart: null,
      dueDate: '2026-05-01',
      completedAt: null,
      container: false,
      depth: 1,
      progressPercent: 0,
      childRange: { start: '2026-05-01', end: '2026-05-01', datedItems: 1, totalItems: 1 },
      undated: false,
      inconsistent: false
    },
    {
      taskId: 'TSK-NONE',
      projectId: 'PRJ-V',
      subprojectId: null,
      parentTaskId: null,
      taskName: 'No dates',
      status: 'Not Started',
      displayStatus: 'IN_PROGRESS',
      plannedStart: null,
      dueDate: null,
      completedAt: null,
      container: false,
      depth: 1,
      progressPercent: 0,
      childRange: { start: null, end: null, datedItems: 0, totalItems: 1 },
      undated: true,
      inconsistent: false
    },
    {
      taskId: 'TSK-ODD',
      projectId: 'PRJ-V',
      subprojectId: null,
      parentTaskId: null,
      taskName: 'Inconsistent dates',
      status: 'Assigned',
      displayStatus: 'IN_PROGRESS',
      plannedStart: '2026-08-20',
      dueDate: '2026-08-01',
      completedAt: null,
      container: false,
      depth: 1,
      progressPercent: 0,
      childRange: { start: '2026-08-01', end: '2026-08-20', datedItems: 1, totalItems: 1 },
      undated: false,
      inconsistent: true
    }
  ],
  truncated: false,
  taskTotal: 4
};

function stubTimeline(): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async (url: string) => {
    const target = String(url);
    if (target.includes('/api/work/timeline') && target.includes('projectId=')) return response(TIMELINE_BRANCH);
    if (target.includes('/api/work/timeline')) {
      return response({
        items: [TIMELINE_PROJECT],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
        responsibilities: [{ responsibilityId: 'RSP-T', name: 'Design area' }]
      });
    }
    if (target.includes('/api/work/projects')) {
      return response({
        items: [],
        responsibilities: [{ responsibilityId: 'RSP-T', name: 'Design area' }],
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

describe('read-only timeline', () => {
  it('starts on project summaries and loads a branch only when expanded', async () => {
    const fetcher = stubTimeline();
    render(<I18nProvider><TimelineScreen actor={MEMBER as never} /></I18nProvider>);
    await waitFor(() => expect(document.querySelectorAll('.tl-kind-project').length).toBe(1));
    expect(document.querySelector('.tl-kind-project .tl-label')?.textContent).toBe('Visible project');
    // The legend names every visual meaning.
    const legend = within(document.querySelector('.timeline-legend') as HTMLElement);
    expect(legend.getByText('予定（開始〜終了）')).toBeTruthy();
    expect(legend.getByText('期限')).toBeTruthy();
    expect(legend.getByText('子項目の期間')).toBeTruthy();
    expect(legend.getByText('完了日')).toBeTruthy();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('projectId=PRJ-V'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '展開' }));
    await waitFor(() => expect(document.querySelectorAll('.tl-kind-subproject').length).toBe(1));
    expect(within(document.querySelector('.tl-scroller') as HTMLElement).getAllByText('Prototype').length).toBeGreaterThan(0);
  });

  it('separates a plan, a deadline-only task, an undated task and an inconsistent record', async () => {
    stubTimeline();
    render(
      <I18nProvider>
        <TimelineScreen actor={MEMBER as never} initialProjectId="PRJ-V" initialAnchor="2026-03-15" />
      </I18nProvider>
    );
    await waitFor(() => expect(document.querySelectorAll('.tl-kind-subproject').length).toBe(1));
    // A planned bar exists for the planned task; the deadline-only task has a marker, not a plan.
    expect(document.querySelectorAll('.tl-bar').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.tl-deadline').length).toBeGreaterThan(0);
    // The dashed child range is visibly a different object from the planned bar.
    expect(document.querySelectorAll('.tl-span').length).toBeGreaterThan(0);
    // Undated work stays visible with an explanation instead of disappearing.
    expect(screen.getByText('日付が保存されていないため、この行は期間を表示しません。')).toBeTruthy();
    expect(document.querySelector('.tl-kind-task .tl-label')?.textContent).toBeDefined();
    // A stored inconsistency is reported, not corrected.
    expect(screen.getByText('開始日が期限より後になっています。値は自動で修正しません。')).toBeTruthy();
    // The text representation carries the same dates for assistive use.
    expect(screen.getByText(/開始日未設定 → 2026-05-01/)).toBeTruthy();
  });

  it('produces no write request while it is viewed', async () => {
    const fetcher = stubTimeline();
    render(
      <I18nProvider>
        <TimelineScreen actor={MEMBER as never} initialProjectId="PRJ-V" initialAnchor="2026-03-15" />
      </I18nProvider>
    );
    await waitFor(() => expect(document.querySelectorAll('.tl-kind-task').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /内容/ })[0]!);
    const writes = fetcher.mock.calls.filter(([, init]) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      return method !== 'GET';
    });
    expect(writes).toHaveLength(0);
  });
});
