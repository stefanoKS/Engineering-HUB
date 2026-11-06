// @vitest-environment jsdom
/**
 * MEMBER and VIEWER read-only experience.
 *
 * These tests pin the properties the explorer release promises: the Projects navigation entry and
 * a direct `#/projects` route for both reader roles, the read-only explorer calling
 * `/api/work/projects` and never `/api/manager/projects`, project and subproject descriptions
 * rendered as text, the task description section, and the absence of management controls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { App } from '../src/App';
import { ProjectDetailScreen } from '../src/screens/ProjectDetail';
import { TaskDetailScreen } from '../src/screens/TaskDetail';
import { WorkProjectsScreen } from '../src/screens/WorkProjects';
import { queryCache } from '../src/state/cache';

function response(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

const ACTOR_BASE = {
  name: 'Reader',
  email: 'reader@example.invalid',
  active: true,
  verified: true,
  selfServiceEnabled: true
} as const;

const MEMBER_ACTOR = { ...ACTOR_BASE, memberId: 'MEM-MEMBER', role: 'MEMBER' } as const;
const VIEWER_ACTOR = { ...ACTOR_BASE, memberId: 'MEM-VIEWER', role: 'VIEWER' } as const;

function session(actor: typeof MEMBER_ACTOR | typeof VIEWER_ACTOR) {
  return {
    actor,
    authMode: 'local',
    csrfToken: 'csrf',
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
}

const PROJECT_LIST = {
  items: [
    {
      projectId: 'PRJ-A',
      projectName: '5Q45 次期DG',
      description: '車載バッテリー筐体の設計\n第二フェーズを含む',
      responsibilityName: '設計',
      projectOwnerName: '田中 太郎',
      status: 'Active',
      priority: 'High',
      committedDeadline: '2026-12-20',
      progressPercent: 40,
      health: 'OK',
      activeTaskCount: 3,
      overdueTaskCount: 1,
      completedTaskCount: 2
    }
  ],
  responsibilities: [{ responsibilityId: 'RES-1', name: '設計' }],
  total: 1,
  page: 1,
  pageSize: 24,
  totalPages: 1
};

const ROLLUP = {
  tasks: 1,
  containers: 0,
  leaves: 1,
  doneLeaves: 0,
  cancelledLeaves: 0,
  weightTotal: 1,
  weightDone: 0,
  percent: 0,
  unknownEffort: 0
};

const PROJECT_DETAIL = {
  record: {
    projectId: 'PRJ-A',
    projectName: '5Q45 次期DG',
    description: '車載バッテリー筐体の設計\n第二フェーズを含む',
    responsibilityName: '設計',
    projectOwnerName: '田中 太郎',
    status: 'Active',
    priority: 'High',
    committedDeadline: '2026-12-20',
    progressPercent: 40,
    health: 'OK',
    activeTaskCount: 1,
    completedTaskCount: 0
  },
  progress: ROLLUP,
  subprojects: [
    {
      subprojectId: 'SUB-A',
      subprojectName: '帳票類提出',
      description: 'APQP 提出書類一式の準備\n承認後に次工程へ',
      parentSubprojectId: null,
      status: 'Active',
      deadline: '2026-12-01',
      depth: 1,
      progress: ROLLUP
    }
  ],
  tasks: [
    {
      taskId: 'T-A1',
      projectId: 'PRJ-A',
      projectName: '5Q45 次期DG',
      subprojectId: 'SUB-A',
      responsibilityId: 'RES-1',
      parentTaskId: null,
      taskName: 'APQP提出',
      status: 'In Progress',
      displayStatus: 'IN_PROGRESS',
      priority: 'Medium',
      ownerMemberId: 'MEM-MEMBER',
      ownerName: '読者',
      assigneeNames: ['読者'],
      assigneeIds: ['MEM-MEMBER'],
      dueDate: '2026-12-01',
      plannedStart: null,
      progressPercent: null,
      container: false,
      depth: 1,
      reviewState: 'NONE',
      overdue: false,
      deadlineState: 'OK',
      revision: 2
    }
  ]
};

const TASK_DETAIL = {
  record: {
    taskId: 'T-A1',
    projectId: 'PRJ-A',
    subprojectId: 'SUB-A',
    parentTaskId: null,
    taskName: 'APQP提出',
    description: '提出書類の最終確認\n押印後に提出する',
    ownerMemberId: 'MEM-MEMBER',
    ownerName: '読者',
    status: 'In Progress',
    displayStatus: 'IN_PROGRESS',
    priority: 'High',
    plannedStart: null,
    dueDate: '2026-12-01',
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
    createdByMemberId: null,
    creationChannel: 'LEGACY',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 2
  },
  context: {
    projectId: 'PRJ-A',
    projectName: '5Q45 次期DG',
    subprojects: [{ subprojectId: 'SUB-A', subprojectName: '帳票類提出' }]
  },
  assignees: [
    {
      memberId: 'MEM-MEMBER',
      name: '読者',
      active: true,
      assignedAt: '2026-01-01T00:00:00.000Z',
      assignedBy: '',
      primary: true
    }
  ],
  additionalAssigneeIds: [],
  assigneeIds: ['MEM-MEMBER'],
  assigneeHistory: [],
  confirmations: [],
  deadlineHistory: [],
  children: []
};

function stubApi(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async (url: string) => {
    const path = url.split('?')[0] ?? '';
    if (path in routes) return response(routes[path]);
    return response({});
  });
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}

describe('member project navigation', () => {
  it.each([
    ['MEMBER', MEMBER_ACTOR],
    ['VIEWER', VIEWER_ACTOR]
  ])('shows Projects in navigation and opens #/projects for a %s', async (_role, actor) => {
    window.history.replaceState({}, '', '#/projects');
    const fetchStub = stubApi({
      '/api/session': session(actor),
      '/api/work/projects': PROJECT_LIST
    });
    render(
      <I18nProvider>
        <App />
      </I18nProvider>
    );

    expect(await screen.findByRole('link', { name: 'プロジェクト' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: '5Q45 次期DG' })).toBeTruthy();
    // The explorer reads the work projection only; the management list is never called.
    const called = fetchStub.mock.calls.map((call) => String(call[0]));
    expect(called.some((url) => url.startsWith('/api/work/projects'))).toBe(true);
    expect(called.some((url) => url.startsWith('/api/manager/projects'))).toBe(false);
    // A direct address keeps the reader on the explorer instead of redirecting to My Work.
    expect(window.location.hash).toBe('#/projects');
  });

  it('keeps the search term when the explorer is left and reopened', async () => {
    stubApi({ '/api/session': session(MEMBER_ACTOR), '/api/work/projects': PROJECT_LIST });
    const first = render(
      <I18nProvider>
        <WorkProjectsScreen actor={MEMBER_ACTOR as never} />
      </I18nProvider>
    );
    const search = (await screen.findByLabelText('プロジェクト名で検索')) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'DG' } });
    expect(search.value).toBe('DG');
    first.unmount();
    render(
      <I18nProvider>
        <WorkProjectsScreen actor={MEMBER_ACTOR as never} />
      </I18nProvider>
    );
    const reopened = (await screen.findByLabelText('プロジェクト名で検索')) as HTMLInputElement;
    expect(reopened.value).toBe('DG');
  });
});

describe('read-only project detail', () => {
  it('shows the project description, the subproject preview and no management control', async () => {
    stubApi({ '/api/work/projects/PRJ-A': PROJECT_DETAIL });
    const view = render(
      <I18nProvider>
        <ProjectDetailScreen actor={MEMBER_ACTOR as never} projectId="PRJ-A" readOnly />
      </I18nProvider>
    );

    expect(await screen.findByText(/車載バッテリー筐体の設計/)).toBeTruthy();
    expect(screen.getByText(/APQP 提出書類一式の準備/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '編集' })).toBeNull();
    // A MEMBER may file new work from this page but never edit, archive or remove a record.
    expect(screen.getAllByRole('button', { name: '新規タスク' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '新規サブプロジェクト' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /を削除/ })).toBeNull();
    expect(screen.getByRole('navigation', { name: '現在地' })).toBeTruthy();

    // One shared Back control, rendered first so it sits at the top-left of the content column.
    const back = screen.getByRole('button', { name: '← 戻る' });
    expect(back.className).toBe('link-button back-button');
    const screenColumn = view.container.querySelector('.screen');
    expect(screenColumn?.firstElementChild).toBe(back);

    // The full subproject description is readable without leaving the page.
    fireEvent.click(screen.getByRole('button', { name: '詳細を見る' }));
    expect(screen.getByRole('button', { name: '詳細を閉じる' })).toBeTruthy();
    expect(screen.getByText(/承認後に次工程へ/)).toBeTruthy();
  });

  it('states that an empty project description is empty instead of showing a blank panel', async () => {
    stubApi({
      '/api/work/projects/PRJ-A': {
        ...PROJECT_DETAIL,
        record: { ...PROJECT_DETAIL.record, description: '' },
        subprojects: []
      }
    });
    render(
      <I18nProvider>
        <ProjectDetailScreen actor={VIEWER_ACTOR as never} projectId="PRJ-A" readOnly />
      </I18nProvider>
    );
    expect(await screen.findByText('説明なし')).toBeTruthy();
    // A VIEWER gains no creation, edit or delete capability.
    expect(screen.queryByRole('button', { name: '新規タスク' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新規サブプロジェクト' })).toBeNull();
  });
});

describe('read-only task detail', () => {
  it('renders the task description, the project path and no manager workflow section', async () => {
    stubApi({ '/api/work/tasks/T-A1': TASK_DETAIL });
    const view = render(
      <I18nProvider>
        <TaskDetailScreen actor={MEMBER_ACTOR as never} taskId="T-A1" readOnly />
      </I18nProvider>
    );

    expect(await screen.findByText('作業内容・説明')).toBeTruthy();
    // The same single Back control, first in the content column so it stays at the top-left.
    const back = screen.getByRole('button', { name: '← 戻る' });
    expect(back.className).toBe('link-button back-button');
    expect(view.container.querySelector('.screen')?.firstElementChild).toBe(back);
    expect(screen.getByText(/提出書類の最終確認/)).toBeTruthy();
    // Both lines of the multi-line description are rendered, and the break is preserved.
    expect(screen.getByText(/押印後に提出する/)).toBeTruthy();
    expect(screen.getByText(/提出書類の最終確認/).textContent).toContain('\n');
    expect(screen.getAllByRole('link', { name: '5Q45 次期DG' }).length).toBeGreaterThan(0);
    // The subproject path appears in the breadcrumb and the header line.
    expect(screen.getAllByText(/帳票類提出/).length).toBeGreaterThan(0);
    // Manager-only sections are not rendered at all for a reader.
    expect(screen.queryByText('期限の変更履歴')).toBeNull();
    expect(screen.queryByText('日程を確定')).toBeNull();
    expect(screen.queryByRole('button', { name: '編集' })).toBeNull();
    expect(screen.queryByRole('button', { name: '割当を承認' })).toBeNull();
    await waitFor(() => expect(screen.queryByText('説明なし')).toBeNull());
  });

  it('states that an empty task description is empty', async () => {
    stubApi({ '/api/work/tasks/T-A1': { ...TASK_DETAIL, record: { ...TASK_DETAIL.record, description: '' } } });
    render(
      <I18nProvider>
        <TaskDetailScreen actor={VIEWER_ACTOR as never} taskId="T-A1" readOnly />
      </I18nProvider>
    );
    expect(await screen.findByText('作業内容・説明')).toBeTruthy();
    expect(screen.getByText('説明なし')).toBeTruthy();
  });
});
