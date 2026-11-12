// @vitest-environment jsdom
/**
 * Usability release: guided creation, contextual child tasks, a consistent completion report,
 * reviewable requests, findable personal work, typed administration and readable errors.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
// jsdom has no native <dialog>; the Modal component needs these two methods to open and close.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
}
import { I18nProvider } from '../src/i18n';
import { TaskForm } from '../src/screens/TaskForm';
import { TaskDetailScreen } from '../src/screens/TaskDetail';
import { MyWorkScreen } from '../src/screens/MyWork';
import { RequestsScreen } from '../src/screens/Requests';
import { AutomationScreen } from '../src/screens/Automation';
import { StatusScreen } from '../src/screens/Status';
import { App } from '../src/App';
import { ErrorBox } from '../src/components/ui';
import { ApiFailure } from '../src/api/client';
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
  window.history.replaceState({}, '', '/');
});

const ACTOR_BASE = {
  name: 'User',
  email: 'user@example.invalid',
  active: true,
  verified: true,
  selfServiceEnabled: true
} as const;
const MANAGER_ACTOR = { ...ACTOR_BASE, memberId: 'MEM-MANAGER', role: 'MANAGER' } as const;
const ADMIN_ACTOR = { ...ACTOR_BASE, memberId: 'MEM-ADMIN', role: 'ADMIN' } as const;
const MEMBER_ACTOR = { ...ACTOR_BASE, memberId: 'MEM-MEMBER', role: 'MEMBER' } as const;
const VIEWER_ACTOR = { ...ACTOR_BASE, memberId: 'MEM-VIEWER', role: 'VIEWER' } as const;

const TASK_RECORD = {
  taskId: 'TSK-1',
  projectId: 'PRJ-A',
  subprojectId: null,
  parentTaskId: null,
  taskName: '親タスク',
  description: '説明',
  ownerMemberId: 'MEM-MEMBER',
  ownerName: 'Ann',
  status: 'In Progress',
  displayStatus: 'IN_PROGRESS',
  priority: 'Medium',
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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  revision: 1
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    record: TASK_RECORD,
    context: { projectId: 'PRJ-A', projectName: 'Alpha', subprojects: [] },
    assignees: [
      {
        memberId: 'MEM-MEMBER',
        name: 'Ann',
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
    children: [],
    depth: 1,
    ...overrides
  };
}

function stubTaskDetail(payload: unknown, blockedReasons?: string[]): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/report-eligibility')) {
      const reasons =
        blockedReasons ?? ((payload as { children?: unknown[] } | null)?.children?.length ? ['CONTAINER'] : []);
      return response({
        taskId: 'TSK-1',
        eligible: reasons.length === 0,
        reasons,
        submissionEnabled: true,
        reporterName: 'User'
      });
    }
    if (url.includes('/api/work/tasks/') || url.includes('/api/manager/tasks/')) return response(payload);
    if (url.includes('/references')) return response({ members: [], skills: [], subprojects: [] });
    if (url.includes('/api/employee/requests/mine')) return response({ items: [], submissionEnabled: true });
    if (url.includes('/api/manager/projects/PRJ-A')) {
      return response({ record: { projectId: 'PRJ-A', projectName: 'Alpha' } });
    }
    return response({ items: [], total: 0, totalPages: 1 });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
describe('guided task creation', () => {
  it('keeps the location, assignees and priority for the next task and rotates the idempotency key', async () => {
    const posts: Record<string, unknown>[] = [];
    let created = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('parent-options')) return response({ items: [] });
        if (url.includes('/api/manager/projects/PRJ-A')) {
          return response({ record: { projectId: 'PRJ-A', projectName: 'Alpha', divisionId: 'DIV-DEV' } });
        }
        if ((init?.method ?? 'GET') === 'POST' && url.includes('/api/manager/tasks')) {
          posts.push(JSON.parse(String(init?.body ?? '{}')));
          created += 1;
          return response({ task: { ...TASK_RECORD, taskId: `TSK-${created}`, taskName: `Task ${created}` } });
        }
        return response({ items: [], total: 0, totalPages: 1 });
      })
    );
    const onSaved = vi.fn();
    render(
      <I18nProvider>
        <TaskForm
          initialProjectId="PRJ-A"
          references={{ members: [{ memberId: 'MEM-MEMBER', name: 'Ann', active: true, workDivisionIds: ['DIV-DEV'] }], skills: [], subprojects: [] }}
          onClose={() => undefined}
          onSaved={onSaved}
        />
      </I18nProvider>
    );

    const name = (await screen.findByLabelText(/タスク名/)) as HTMLInputElement;
    const deadline = screen.getByLabelText(/終了日/) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Task one' } });
    fireEvent.change(deadline, { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: /Ann/ }));
    fireEvent.click(screen.getByRole('button', { name: '続けて作成' }));

    expect(await screen.findByText('作成しました。作成先・担当者・優先度を引き継いでいます。')).toBeTruthy();
    // Only task-specific values are cleared; the location and the deliberate selection remain.
    expect(name.value).toBe('');
    expect(deadline.value).toBe('');
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(posts[0]!.assigneeIds).toEqual(['MEM-MEMBER']);
    expect(posts[0]!.projectId).toBe('PRJ-A');

    fireEvent.change(name, { target: { value: 'Task two' } });
    fireEvent.change(deadline, { target: { value: '2026-12-02' } });
    fireEvent.click(screen.getByRole('button', { name: '続けて作成' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.idempotencyKey).not.toBe(posts[0]!.idempotencyKey);
  });

  it('shows why creation is disabled instead of a silent disabled button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('parent-options')
          ? response({ items: [] })
          : response({ record: { projectId: 'PRJ-A', projectName: 'Alpha' } })
      )
    );
    render(
      <I18nProvider>
        <TaskForm initialProjectId="PRJ-A" references={{ members: [], skills: [], subprojects: [] }} onClose={() => undefined} onSaved={() => undefined} />
      </I18nProvider>
    );
    expect(await screen.findByText('このままでは登録できません')).toBeTruthy();
    expect(screen.getByText('タスク名を入力してください。')).toBeTruthy();
    expect(screen.getByText('期限を入力してください。')).toBeTruthy();
  });
});

describe('contextual child tasks', () => {
  it('preselects the task as parent and shows the readable location', async () => {
    stubTaskDetail(detail());
    render(
      <I18nProvider>
        <TaskDetailScreen actor={MANAGER_ACTOR as never} taskId="TSK-1" />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: '子タスクを追加' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Alpha / 親タスク')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '作成先を変更' }));
    const parent = within(dialog).getByLabelText('親タスク') as HTMLSelectElement;
    await waitFor(() => expect(parent.value).toBe('TSK-1'));
  });

  it('explains the task depth limit and refuses the action', async () => {
    stubTaskDetail(detail({ depth: 3 }));
    render(
      <I18nProvider>
        <TaskDetailScreen actor={MANAGER_ACTOR as never} taskId="TSK-1" />
      </I18nProvider>
    );
    const add = await screen.findByRole('button', { name: '子タスクを追加' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('タスクは3階層までです。このタスクには子タスクを追加できません。')).toBeTruthy();
  });
});

describe('member completion reporting on task detail', () => {
  it('offers the existing completion report to an assigned member', async () => {
    stubTaskDetail(detail());
    render(
      <I18nProvider>
        <TaskDetailScreen actor={MEMBER_ACTOR as never} taskId="TSK-1" readOnly />
      </I18nProvider>
    );
    const report = await screen.findByRole('button', { name: '完了報告' });
    expect((report as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(report);
    expect(await screen.findByText('完了メモ（任意）')).toBeTruthy();
  });

  it('refuses a container report and explains why', async () => {
    stubTaskDetail(
      detail({
        children: [
          {
            taskId: 'TSK-2',
            projectId: 'PRJ-A',
            projectName: 'Alpha',
            subprojectId: null,
            responsibilityId: null,
            parentTaskId: 'TSK-1',
            taskName: '子タスク',
            status: 'In Progress',
            displayStatus: 'IN_PROGRESS',
            priority: 'Medium',
            ownerMemberId: null,
            ownerName: '',
            assigneeNames: [],
            assigneeIds: [],
            dueDate: null,
            plannedStart: null,
            progressPercent: null,
            container: false,
            depth: 2,
            reviewState: 'NONE',
            overdue: false,
            deadlineState: 'NONE',
            revision: 1
          }
        ]
      })
    );
    render(
      <I18nProvider>
        <TaskDetailScreen actor={MEMBER_ACTOR as never} taskId="TSK-1" readOnly />
      </I18nProvider>
    );
    // A container is never offered a completion action; the reason is still explained.
    expect(screen.queryByRole('button', { name: '完了報告' })).toBeNull();
    expect(await screen.findByText('子タスクを持つタスクは直接完了できません。子タスクを完了してください。')).toBeTruthy();
  });

  it('never shows the report to a VIEWER', async () => {
    stubTaskDetail(detail());
    render(
      <I18nProvider>
        <TaskDetailScreen actor={VIEWER_ACTOR as never} taskId="TSK-1" readOnly />
      </I18nProvider>
    );
    await screen.findByRole('heading', { name: '親タスク' });
    expect(screen.queryByRole('button', { name: '完了報告' })).toBeNull();
    expect(screen.queryByRole('button', { name: '編集' })).toBeNull();
    expect(screen.queryByRole('button', { name: '子タスクを追加' })).toBeNull();
  });
});

describe('personal work filters', () => {
  function myWorkList(items: unknown[], unfiltered = 0) {
    return {
      items,
      total: items.length,
      activeTotal: items.length,
      completedTotal: 0,
      unfilteredActiveTotal: unfiltered,
      projects: [{ projectId: 'PRJ-A', projectName: 'Alpha' }]
    };
  }

  it('filters on the server and distinguishes no assignment from no match', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('/api/employee/my-work/projects')) return response({ items: [], taskCreationEnabled: true });
        if (url.includes('/api/employee/requests/mine')) return response({ items: [], submissionEnabled: true });
        if (url.includes('/api/employee/my-work?')) return response(myWorkList([], 2));
        return response({});
      })
    );
    render(
      <I18nProvider>
        <MyWorkScreen actor={MEMBER_ACTOR as never} />
      </I18nProvider>
    );
    expect(await screen.findByText('担当タスクはありません。')).toBeTruthy();
    const search = screen.getByLabelText('タスク名で検索');
    fireEvent.change(search, { target: { value: '稟議' } });
    await waitFor(() => expect(calls.some((url) => url.includes('query=%E7%A8%9F%E8%AD%B0'))).toBe(true));
    expect(await screen.findByText('条件に一致するタスクはありません。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '絞り込みを解除' }));
    // The unfiltered answer comes back from the cache; the filter summary disappears.
    expect(await screen.findByText('担当タスクはありません。')).toBeTruthy();
    expect(screen.queryByText(/絞り込み中/)).toBeNull();
  });
});

describe('request review', () => {
  it('shows the task, its context and the reporter before a decision', async () => {
    const queue = {
      page: 1,
      pageSize: 25,
      totalPages: 1,
      total: 1,
      items: [
        {
          requestId: 'REQ-1',
          taskName: '設計レビュー',
          projectName: 'Alpha',
          subprojectName: '試作',
          requestType: 'DEADLINE_CHANGE',
          taskId: 'TSK-1',
          projectId: 'PRJ-A',
          requesterName: 'Ann',
          submittedAt: '2026-10-01T09:00:00.000Z',
          originalDueDate: '2026-11-01',
          requestedDueDate: '2026-11-15',
          reason: '',
          explanation: '',
          completionNote: '',
          status: 'PENDING',
          reviewer: '',
          decidedAt: null,
          decisionNote: '',
          taskRevisionAtSubmission: '1',
          dueDateAtSubmission: '2026-11-01',
          reportedCompletionAt: null,
          acceptedCompletionAt: null,
          inboxRequestId: '',
          importedAt: null,
          snapshotVersion: '1',
          staleReason: '',
          requesterMemberId: null,
          // The server resolves the decision capability per record; without it the interface
          // offers no decision at all.
          canDecide: true,
          revision: 1
        }
      ],
      imported: { attempted: true, configured: true, imported: 0, duplicates: 0, failed: 0, message: '' }
    };
    vi.stubGlobal('fetch', vi.fn(async () => response(queue)));
    render(
      <I18nProvider>
        <RequestsScreen actor={MANAGER_ACTOR as never} />
      </I18nProvider>
    );
    expect(await screen.findByText('設計レビュー')).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('試作')).toBeTruthy();
    expect(screen.getByText('Ann')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '却下' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('却下はこの申請を終了します。タスクの期限や状態は変わりません。')).toBeTruthy();
    expect(within(dialog).getByText('設計レビュー')).toBeTruthy();
  });
});

describe('administration presentation', () => {
  const automation = {
    settings: [
      {
        key: 'EMAIL_MODE',
        value: 'OFF',
        description: 'OFF, PREVIEW or LIVE outbound mail mode',
        updatedAt: '2026-10-01T00:00:00.000Z',
        updatedBy: 'ADMIN',
        adminOnly: true,
        approved: true
      },
      {
        key: 'ASSIGNMENT_EMAIL_ENABLED',
        value: 'false',
        description: 'Notify on an approved assignment',
        updatedAt: '2026-10-01T00:00:00.000Z',
        updatedBy: 'ADMIN',
        adminOnly: false,
        approved: true
      }
    ],
    revision: 'rev-1',
    effectiveEmailMode: 'OFF',
    emergencyStop: true,
    liveRequirements: []
  };

  it('gives a manager a genuine read-only view', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(automation)));
    render(
      <I18nProvider>
        <AutomationScreen actor={MANAGER_ACTOR as never} />
      </I18nProvider>
    );
    expect(await screen.findByText('管理者のみ変更できます。表示は現在の設定値です。')).toBeTruthy();
    expect((screen.getByLabelText('EMAIL_MODE') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '設定を保存' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives an administrator typed controls and keeps the emergency stop available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(automation)));
    render(
      <I18nProvider>
        <AutomationScreen actor={ADMIN_ACTOR as never} />
      </I18nProvider>
    );
    await screen.findByText('EMAIL_MODE');
    expect((screen.getByLabelText('EMAIL_MODE') as HTMLSelectElement).disabled).toBe(false);
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    expect(screen.queryByText('管理者のみ変更できます。表示は現在の設定値です。')).toBeNull();
  });

  it('leads with operational health and keeps internals in a disclosure', async () => {
    const status = {
      status: 'ok',
      version: '2.0.0',
      schemaVersion: 8,
      environment: 'DEVELOPMENT',
      database: 'ok',
      outbox: { pending: 0, leased: 0, failed: 0, oldestPendingAt: null },
      emailMode: 'OFF',
      emergencyStop: true,
      calendarEnabled: false,
      dashboardPublicationEnabled: false,
      lastBackupAt: null,
      lastBackupOk: false,
      backup: null,
      valid: true,
      errorCount: 0,
      rowCounts: { tasks: 3 },
      appVersion: '2.0.0',
      migrationVersion: 8,
      contractVersion: '1.6',
      requestSubmissionEnabled: false
    };
    const publication = {
      enabled: false,
      contractVersion: '1.6',
      lastPublishedAt: null,
      lastResult: '',
      lastError: '',
      rows: { tasks: 0 },
      hash: '',
      activeSlot: 'NONE',
      destinationConfigured: false
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => response(url.includes('/publication') ? publication : status))
    );
    render(
      <I18nProvider>
        <StatusScreen actor={MANAGER_ACTOR as never} />
      </I18nProvider>
    );
    expect(await screen.findByText('運用状態')).toBeTruthy();
    expect(screen.getByText('バックアップ')).toBeTruthy();
    expect(screen.getByText('内部情報')).toBeTruthy();
    // A manager is never sent to the ADMIN-only account administration.
    expect(screen.queryByRole('link', { name: 'アカウント管理へ' })).toBeNull();
  });
});

describe('readable errors', () => {
  it('explains a conflict without offering a blind retry', () => {
    render(
      <I18nProvider>
        <ErrorBox error={new ApiFailure({ code: 'EDIT_CONFLICT', message: 'stale revision' })} onRetry={() => undefined} />
      </I18nProvider>
    );
    expect(screen.getByText('新しい版が保存されています')).toBeTruthy();
    expect(screen.getByText(/上書きせず/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '再試行' })).toBeNull();
  });

  it('explains an uncertain outcome and never labels it as a harmless retry', () => {
    render(
      <I18nProvider>
        <ErrorBox error={new ApiFailure({ code: 'NETWORK', message: 'offline' })} onRetry={() => undefined} />
      </I18nProvider>
    );
    expect(screen.getByText('結果を確認できませんでした')).toBeTruthy();
    expect(screen.getByText(/自動では再送しません/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });

  it('names an authorization refusal', () => {
    render(
      <I18nProvider>
        <ErrorBox error={new ApiFailure({ code: 'AUTHORIZATION_DENIED', message: 'denied' })} />
      </I18nProvider>
    );
    expect(screen.getByText('権限がありません')).toBeTruthy();
  });
});

describe('navigation groups', () => {
  it('keeps every frequent destination directly reachable under a group heading', async () => {
    window.history.replaceState({}, '', '#/my-work');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/session')) {
          return response({
            actor: ADMIN_ACTOR,
            authMode: 'local',
            csrfToken: 'csrf',
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          });
        }
        if (url.includes('/api/employee/my-work/projects')) return response({ items: [], taskCreationEnabled: false });
        if (url.includes('/api/employee/requests/mine')) return response({ items: [], submissionEnabled: false });
        if (url.includes('/api/employee/my-work/project-filter')) {
          return response({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 1, selected: null });
        }
        if (url.includes('/api/employee/my-work')) {
          return response({
            items: [],
            total: 0,
            activeTotal: 0,
            completedTotal: 0,
            unfilteredActiveTotal: 0
          });
        }
        return response({});
      })
    );
    render(
      <I18nProvider>
        <App />
      </I18nProvider>
    );
    // The navigation groups read Daily work / Team / Management; identifiers stay unchanged.
    expect(await screen.findByText('日常業務')).toBeTruthy();
    expect(screen.getByText('チーム')).toBeTruthy();
    expect(screen.getByText('管理')).toBeTruthy();
    expect(screen.getByRole('link', { name: '自分の担当タスク' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'すべてのタスク' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'プロジェクト' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'タイムライン' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '申請一覧' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '分野' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'メンバー' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'スキル' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '担当・期限レポート' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '自動化設定' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '状態・公開' })).toBeTruthy();
  });
});
