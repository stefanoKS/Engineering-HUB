// @vitest-environment jsdom
/**
 * Task action conflict recovery.
 *
 * "Reload latest" used to refresh the list behind the dialog and leave the dialog holding the
 * superseded revision, so the next confirmation failed again. The reload must re-read the selected
 * task by id and replace the revision the dialog submits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { TasksScreen } from '../src/screens/Tasks';
import { queryCache } from '../src/state/cache';
import { clearDivisionScope, setDivisionScope } from '../src/state/division';

if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

const MANAGER = {
  memberId: 'M-1',
  name: 'Manager',
  email: 'manager@example.invalid',
  role: 'MANAGER' as const,
  active: true,
  verified: true,
  selfServiceEnabled: false
};

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 });
const conflict = () =>
  new Response(
    JSON.stringify({ ok: false, error: { code: 'EDIT_CONFLICT', message: 'changed', retryable: false, correlationId: 'c' } }),
    { status: 409 }
  );

function summary(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'TSK-1',
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
    canWrite: true,
    revision: 2,
    ...overrides
  };
}

function detail(overrides: Record<string, unknown> = {}, children: unknown[] = []) {
  return {
    record: {
      taskId: 'TSK-1',
      taskName: '配線図の更新',
      projectId: 'PRJ-A',
      status: 'In Progress',
      revision: 5,
      ...overrides
    },
    context: { projectId: 'PRJ-A', projectName: 'Alpha', subprojects: [] },
    assignees: [],
    additionalAssigneeIds: [],
    assigneeIds: [],
    assigneeHistory: [],
    confirmations: [],
    deadlineHistory: [],
    children,
    depth: 1,
    canWrite: true
  };
}

type Call = { url: string; method: string; body?: string };

function stubServer(handlers: { detail?: () => Response; complete?: () => Response }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.includes('/references')) return response({ responsibilities: [], members: [], skills: [], subprojects: [] });
      if (url.includes('/complete')) return handlers.complete ? handlers.complete() : response({});
      if (/\/api\/manager\/tasks\/[^/?]+$/.test(url)) return handlers.detail ? handlers.detail() : response(detail());
      return response({ items: [summary()], total: 1, matchedTotal: 1, page: 1, pageSize: 25, totalPages: 1 });
    })
  );
  return calls;
}

const completeCalls = (calls: Call[]): Call[] => calls.filter((call) => call.url.includes('/complete'));

beforeEach(() => {
  setDivisionScope({
    readable: [{ divisionId: 'D1', name: '設計', status: 'Active' }],
    writable: [{ divisionId: 'D1', name: '設計', status: 'Active' }],
    allDivisions: false,
    defaultDivisionId: null
  });
});

afterEach(() => {
  cleanup();
  queryCache.clear();
  clearDivisionScope();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('task completion conflict recovery', () => {
  it('reloads the task by id and confirms again with the current revision', async () => {
    let attempt = 0;
    const calls = stubServer({
      detail: () => response(detail()),
      complete: () => {
        attempt += 1;
        return attempt === 1 ? conflict() : response({ taskId: 'TSK-1', status: 'Done' });
      }
    });
    render(<I18nProvider><TasksScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('配線図の更新');

    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '完了にする' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));

    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();
    expect(JSON.parse(completeCalls(calls)[0]!.body!).revision).toBe(2);

    // The reload reads the record itself, not the page.
    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'GET' && call.url.endsWith('/api/manager/tasks/TSK-1'))).toBe(true));
    expect(
      await within(dialog).findByText('最新の内容を読み込みました。内容を確認してから、もう一度確定してください。')
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    await waitFor(() => expect(completeCalls(calls)).toHaveLength(2));
    expect(JSON.parse(completeCalls(calls)[1]!.body!).revision).toBe(5);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('disables the action when the task became a work container', async () => {
    const calls = stubServer({
      // A task that now has children is a container: it can never be completed directly.
      detail: () => response(detail({}, [{ taskId: 'TSK-CHILD' }])),
      complete: () => conflict()
    });
    render(<I18nProvider><TasksScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('配線図の更新');

    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '完了にする' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));
    expect(
      await within(dialog).findByText('子タスクを持つタスクは直接完了できません。子タスクから完了してください。')
    ).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(true);
    expect(completeCalls(calls)).toHaveLength(1);
  });

  it('reports a failed reload without claiming a fresh revision', async () => {
    const calls = stubServer({
      detail: () => {
        throw new TypeError('offline');
      },
      complete: () => conflict()
    });
    render(<I18nProvider><TasksScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('配線図の更新');

    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '完了にする' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));
    expect(await within(dialog).findByText(/最新の内容を取得できませんでした/)).toBeTruthy();
    expect(within(dialog).queryByText(/最新の内容を読み込みました/)).toBeNull();
    expect(completeCalls(calls)).toHaveLength(1);
  });
});
