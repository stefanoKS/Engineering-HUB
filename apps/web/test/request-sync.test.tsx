// @vitest-environment jsdom
/**
 * 申請一覧: one automatic import per page entry, one honest synchronisation path, and a complete
 * review summary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { RequestsScreen } from '../src/screens/Requests';
import { queryCache } from '../src/state/cache';
import { clearDivisionScope, selectDivision, setDivisionScope } from '../src/state/division';

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

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));

function request(overrides: Record<string, unknown> = {}) {
  return {
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
    reason: '部品の納期が遅れています',
    explanation: '代替品を手配しています。\n来週には入荷予定です。',
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
    revision: 1,
    ...overrides
  };
}

function queue(overrides: Record<string, unknown> = {}) {
  return {
    page: 1,
    pageSize: 25,
    totalPages: 1,
    items: [request()],
    total: 1,
    imported: { attempted: true, configured: true, imported: 0, duplicates: 0, failed: 0, message: '' },
    ...overrides
  };
}

type Call = { url: string; method: string; body?: string };

function stubServer(handler: { sync?: () => Response; get?: () => Response }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.endsWith('/api/manager/requests/sync')) return handler.sync ? handler.sync() : response(queue());
      return handler.get ? handler.get() : response(queue());
    })
  );
  return calls;
}

const syncCalls = (calls: Call[]): Call[] => calls.filter((call) => call.url.endsWith('/api/manager/requests/sync'));

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
  // The queue and the manual synchronisation both follow the shell's selected division.
  selectDivision('D1');
});

afterEach(() => {
  cleanup();
  queryCache.clear();
  clearDivisionScope();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('request synchronisation', () => {
  it('imports exactly once per page entry and never re-imports on a filter change', async () => {
    const calls = stubServer({});
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    await waitFor(() => expect(syncCalls(calls)).toHaveLength(1));

    fireEvent.click(screen.getByLabelText('処理済みの申請も表示'));
    await waitFor(() => expect(calls.some((call) => call.url.includes('includeDecided=true'))).toBe(true));
    expect(syncCalls(calls)).toHaveLength(1);
  });

  it('sends the selected scope on a manual synchronisation and reports the change honestly', async () => {
    const calls = stubServer({
      sync: () => response(queue({ imported: { attempted: true, configured: true, imported: 2, duplicates: 0, failed: 0, message: '' } }))
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');

    fireEvent.click(screen.getByRole('button', { name: '受信箱を同期' }));
    await waitFor(() => expect(syncCalls(calls)).toHaveLength(2));
    const manual = syncCalls(calls)[1]!;
    expect(JSON.parse(manual.body!)).toMatchObject({ divisionId: 'D1' });
    expect(await screen.findByText('同期しました: 新規 2 件')).toBeTruthy();
  });

  it('never reports a partial import as complete success', async () => {
    stubServer({
      sync: () => response(queue({ imported: { attempted: true, configured: true, imported: 1, duplicates: 0, failed: 3, message: '' } }))
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    expect(await screen.findByText(/一部のみ取り込みました/)).toBeTruthy();
    expect(screen.queryByText(/^同期しました/)).toBeNull();
  });

  it('says that the inbox is not configured instead of claiming success', async () => {
    stubServer({
      sync: () => response(queue({ imported: { attempted: true, configured: false, imported: 0, duplicates: 0, failed: 0, message: '' } }))
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    expect(await screen.findByText(/受信箱が設定されていないため同期できません/)).toBeTruthy();
  });

  it('keeps the queue visible when synchronisation fails', async () => {
    stubServer({
      sync: () => {
        throw new TypeError('offline');
      }
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    expect(await screen.findByText(/同期に失敗しました/)).toBeTruthy();
    expect(screen.getByText('設計レビュー')).toBeTruthy();
  });
});

describe('request review context', () => {
  it('shows the reason, the explanation and the stale reason for a request needing re-review', async () => {
    stubServer({
      get: () =>
        response(
          queue({
            items: [request({ status: 'STALE', staleReason: '期限が申請後に変更されました' })]
          })
        )
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '申請の詳細' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('部品の納期が遅れています')).toBeTruthy();
    expect(within(dialog).getByText(/代替品を手配しています。/)).toBeTruthy();
    expect(within(dialog).getByText('期限が申請後に変更されました')).toBeTruthy();
    // The instant is shown in Tokyo time, not as a raw ISO slice.
    expect(within(dialog).getByText('2026-10-01 18:00')).toBeTruthy();
  });

  it('shows the decision details of an already decided request', async () => {
    stubServer({
      get: () =>
        response(
          queue({
            items: [
              request({
                status: 'APPROVED',
                reviewer: 'Manager',
                decidedAt: '2026-10-02T01:30:00.000Z',
                decisionNote: '了解しました'
              })
            ]
          })
        )
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '申請の詳細' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('了解しました')).toBeTruthy();
    expect(within(dialog).getByText('2026-10-02 10:30')).toBeTruthy();
  });
});

describe('conflict and unknown-outcome recovery', () => {
  it('keeps a conflicting decision open with an explicit reload path', async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method });
        if (url.endsWith('/decide')) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: { code: 'EDIT_CONFLICT', message: 'The request changed', retryable: false, correlationId: 'c-9' }
            }),
            { status: 409 }
          );
        }
        if (url.endsWith('/api/manager/requests/sync')) return response(queue());
        return response(queue());
      })
    );
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));

    // The conflict is described as a conflict, the dialog stays open and a reload is offered.
    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();
    expect(
      within(dialog).getByText('入力内容は保持されています。最新の内容を確認してから、もう一度保存してください。')
    ).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '最新の内容を読み込む' })).toBeTruthy();
    expect(screen.queryByText('The request changed')).toBeNull();
    const before = calls.filter((call) => call.method === 'GET').length;
    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET').length).toBeGreaterThan(before));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
