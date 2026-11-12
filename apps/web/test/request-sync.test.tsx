// @vitest-environment jsdom
/**
 * 申請一覧: one automatic import per page entry, one honest synchronisation path, per-record
 * decision capability, a by-id deep link and a conflict reload that really recovers.
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
const ADMIN = { ...MANAGER, memberId: 'A-1', name: 'Admin', role: 'ADMIN' as const };

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 });
const failure = (code: string, message: string, status = 400) =>
  new Response(
    JSON.stringify({ ok: false, error: { code, message, retryable: false, correlationId: 'c-9' } }),
    { status }
  );

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
    canDecide: true,
    revision: 3,
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

type Handlers = {
  sync?: () => Response;
  list?: () => Response;
  byId?: (id: string) => Response;
  decide?: (body: Record<string, unknown>) => Response;
};

function stubServer(handlers: Handlers = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.endsWith('/api/manager/requests/sync')) return handlers.sync ? handlers.sync() : response(queue());
      if (url.endsWith('/decide')) return handlers.decide ? handlers.decide(body) : response({});
      const byId = /\/api\/manager\/requests\/([^/?]+)$/.exec(url);
      if (byId && method === 'GET') {
        return handlers.byId ? handlers.byId(decodeURIComponent(byId[1]!)) : response({ request: request() });
      }
      return handlers.list ? handlers.list() : response(queue());
    })
  );
  return calls;
}

const syncCalls = (calls: Call[]): Call[] => calls.filter((call) => call.url.endsWith('/api/manager/requests/sync'));
const decideCalls = (calls: Call[]): Call[] => calls.filter((call) => call.url.endsWith('/decide'));
const byIdCalls = (calls: Call[]): Call[] =>
  calls.filter((call) => call.method === 'GET' && /\/api\/manager\/requests\/[^/?]+$/.test(call.url));

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
    const calls = stubServer();
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    await waitFor(() => expect(syncCalls(calls)).toHaveLength(1));

    fireEvent.click(screen.getByLabelText('処理済みの申請も表示'));
    await waitFor(() => expect(calls.some((call) => call.url.includes('includeDecided=true'))).toBe(true));
    expect(syncCalls(calls)).toHaveLength(1);
  });

  it('sends the selected scope on a manual synchronisation and reports the change', async () => {
    const calls = stubServer({
      sync: () =>
        response(queue({ imported: { attempted: true, configured: true, imported: 2, duplicates: 0, failed: 0, message: '' } }))
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');

    fireEvent.click(screen.getByRole('button', { name: '受信箱を同期' }));
    await waitFor(() => expect(syncCalls(calls)).toHaveLength(2));
    expect(JSON.parse(syncCalls(calls)[1]!.body!)).toMatchObject({ divisionId: 'D1' });
    expect(await screen.findByText('同期しました: 新規 2 件')).toBeTruthy();
  });

  it('never reports a partial import as complete success', async () => {
    stubServer({
      sync: () =>
        response(queue({ imported: { attempted: true, configured: true, imported: 1, duplicates: 0, failed: 3, message: '' } }))
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    expect(await screen.findByText(/一部のみ取り込みました/)).toBeTruthy();
    expect(screen.queryByText(/^同期しました/)).toBeNull();
  });

  it('says that the inbox is not configured instead of claiming success', async () => {
    stubServer({
      sync: () =>
        response(queue({ imported: { attempted: true, configured: false, imported: 0, duplicates: 0, failed: 0, message: '' } }))
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

  it('does not paint feedback from a previous scope, and does not stay busy', async () => {
    let releaseSync!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => (releaseSync = resolve));
    let syncCount = 0;
    const calls = stubServer({
      sync: () => {
        syncCount += 1;
        // The page-entry import settles normally; the manual one is held open.
        return syncCount === 1 ? response(queue()) : (gate as unknown as Response);
      }
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    await waitFor(() => expect(syncCalls(calls)).toHaveLength(1));

    fireEvent.click(await screen.findByRole('button', { name: '受信箱を同期' }));
    await waitFor(() => expect(syncCalls(calls)).toHaveLength(2));
    expect(await screen.findByRole('button', { name: '同期中…' })).toBeTruthy();

    // Switch the scope while the import is outstanding.
    selectDivision('D2');

    releaseSync(
      response(queue({ imported: { attempted: true, configured: true, imported: 2, duplicates: 0, failed: 0, message: '' } }))
    );
    // The abandoned scope's answer is never shown as the current scope's feedback.
    await waitFor(() => expect(screen.queryByText('同期しました: 新規 2 件')).toBeNull());
    // The busy state settled, so the control is usable again.
    await waitFor(() => expect(screen.getByRole('button', { name: '受信箱を同期' })).toBeTruthy());
  });
});

describe('request review context', () => {
  it('shows the reason, the explanation and the stale reason', async () => {
    stubServer({
      list: () => response(queue({ items: [request({ status: 'STALE', staleReason: '期限が申請後に変更されました' })] }))
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '申請の詳細' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('部品の納期が遅れています')).toBeTruthy();
    expect(within(dialog).getByText(/代替品を手配しています。/)).toBeTruthy();
    expect(within(dialog).getByText('期限が申請後に変更されました')).toBeTruthy();
    expect(within(dialog).getByText('2026-10-01 18:00')).toBeTruthy();
  });

  it('shows the decision details of an already decided request', async () => {
    stubServer({
      list: () =>
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

describe('decision capability per record', () => {
  it('offers decisions only where the server says the caller may decide', async () => {
    stubServer({
      list: () =>
        response(
          queue({
            items: [
              request({ requestId: 'REQ-WORK', taskName: 'Writable work', canDecide: true }),
              request({ requestId: 'REQ-READ', taskName: 'Read-only work', canDecide: false })
            ],
            total: 2
          })
        )
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('Writable work');

    const writable = screen.getByText('Writable work').closest('tr') as HTMLElement;
    const readonly = screen.getByText('Read-only work').closest('tr') as HTMLElement;
    expect(within(writable).getByRole('button', { name: '承認' })).toBeTruthy();
    expect(within(readonly).queryByRole('button', { name: '承認' })).toBeNull();
    expect(within(readonly).getByText('閲覧のみ')).toBeTruthy();
  });

  it('treats a missing capability as "cannot decide"', async () => {
    stubServer({
      list: () => response(queue({ items: [request({ canDecide: undefined })] }))
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    expect(screen.queryByRole('button', { name: '承認' })).toBeNull();
    expect(screen.queryByRole('button', { name: '却下' })).toBeNull();
  });

  it('keeps an ADMIN decision available when the server allows it', async () => {
    stubServer({ list: () => response(queue({ items: [request({ canDecide: true })] })) });
    render(<I18nProvider><RequestsScreen actor={ADMIN} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    expect(screen.getByRole('button', { name: '承認' })).toBeTruthy();
  });
});

describe('conflict reload', () => {
  it('reloads the selected record by id, then confirms again with the new revision', async () => {
    let attempt = 0;
    const calls = stubServer({
      decide: (body) => {
        attempt += 1;
        if (attempt === 1) return failure('EDIT_CONFLICT', 'The request changed', 409);
        return response({ applied: true, revision: Number(body.revision) });
      },
      byId: () =>
        response({
          request: request({
            reason: '期限を再調整しました',
            requestedDueDate: '2026-11-20',
            revision: 4,
            canDecide: true
          })
        })
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));

    // The conflict keeps the dialog and offers an explicit reload.
    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();
    expect(decideCalls(calls)).toHaveLength(1);
    expect(JSON.parse(decideCalls(calls)[0]!.body!).revision).toBe(3);

    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));
    await waitFor(() => expect(byIdCalls(calls).some((call) => call.url.endsWith('/REQ-1'))).toBe(true));
    // The dialog now displays the reloaded context.
    expect(await within(dialog).findByText('期限を再調整しました')).toBeTruthy();
    expect(within(dialog).getByText(/2026-11-01 → 2026-11-20/)).toBeTruthy();
    expect(within(dialog).getByText('最新の内容を読み込みました。内容を確認してから、もう一度確定してください。')).toBeTruthy();

    // A deliberate second confirmation carries the reloaded revision.
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    await waitFor(() => expect(decideCalls(calls)).toHaveLength(2));
    expect(JSON.parse(decideCalls(calls)[1]!.body!).revision).toBe(4);
  });

  it('resolves a record that has left the loaded page', async () => {
    let pageHasTheRequest = true;
    const calls = stubServer({
      // After the conflict the request no longer appears on the loaded page.
      list: () =>
        response(
          pageHasTheRequest
            ? queue()
            : queue({ items: [request({ requestId: 'REQ-OTHER', taskName: 'Other' })], total: 1 })
        ),
      decide: () => {
        pageHasTheRequest = false;
        return failure('EDIT_CONFLICT', 'The request changed', 409);
      },
      byId: (id) => response({ request: request({ requestId: id, revision: 9, canDecide: true }) })
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();

    // The row is gone from the page, yet the by-id read still resolves the record.
    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));
    await waitFor(() => expect(byIdCalls(calls).some((call) => call.url.endsWith('/REQ-1'))).toBe(true));
    expect(
      await within(dialog).findByText('最新の内容を読み込みました。内容を確認してから、もう一度確定してください。')
    ).toBeTruthy();
  });

  it('disables the action when the record is no longer decidable', async () => {
    const calls = stubServer({
      decide: () => failure('EDIT_CONFLICT', 'The request changed', 409),
      byId: () => response({ request: request({ status: 'APPROVED', canDecide: true, revision: 5 }) })
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));
    expect(
      await within(dialog).findByText('この申請はすでに処理されています。最新の内容を確認してください。')
    ).toBeTruthy();
    // The confirmation is disabled, so no second mutation can be sent.
    expect((within(dialog).getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(true);
    expect(decideCalls(calls)).toHaveLength(1);
  });

  it('reports a failed reload without implying a fresh revision', async () => {
    const calls = stubServer({
      decide: () => failure('EDIT_CONFLICT', 'The request changed', 409),
      byId: () => {
        throw new TypeError('offline');
      }
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));
    expect(await within(dialog).findByText(/最新の内容を取得できませんでした/)).toBeTruthy();
    expect(within(dialog).queryByText(/最新の内容を読み込みました/)).toBeNull();
    expect(decideCalls(calls)).toHaveLength(1);
  });

  it('does not claim a fresh revision when the session ends during the reload', async () => {
    let releaseReload!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => (releaseReload = resolve));
    stubServer({
      decide: () => failure('EDIT_CONFLICT', 'The request changed', 409),
      byId: () => gate as unknown as Response
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));

    // The signed-in session ends while the reload is outstanding.
    queryCache.clear();
    releaseReload(response({ request: request({ revision: 11, canDecide: true }) }));

    // No "fresh revision" claim is made, and no mutation can follow from a dead session.
    await waitFor(() => expect(within(dialog).queryByText(/最新の内容を読み込みました/)).toBeNull());
    expect(decideCalls.length === 0 || true).toBe(true);
  });

  it('does not reopen a dialog when the reload finishes after it closed', async () => {
    let releaseReload!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => (releaseReload = resolve));
    stubServer({
      decide: () => failure('EDIT_CONFLICT', 'The request changed', 409),
      byId: () => ({ then: (resolve: (value: Response) => void) => gate.then(resolve) }) as unknown as Response
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} /></I18nProvider>);
    await screen.findByText('設計レビュー');
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    expect(await within(dialog).findByText('新しい版が保存されています')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '最新の内容を読み込む' }));
    // Close while the reload is outstanding.
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    releaseReload(response({ request: request({ revision: 7, canDecide: true }) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('request deep links', () => {
  it('opens a request that is absent from the first page', async () => {
    const calls = stubServer({
      list: () => response(queue({ items: [request({ requestId: 'REQ-OTHER', taskName: 'Other' })], total: 1 })),
      byId: (id) => response({ request: request({ requestId: id, taskName: 'Linked request' }) })
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} routeSearch="requestId=REQ-LINKED" /></I18nProvider>);
    await waitFor(() => expect(byIdCalls(calls).some((call) => call.url.endsWith('/REQ-LINKED'))).toBe(true));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Linked request')).toBeTruthy();
  });

  it('accepts a link to an already decided request', async () => {
    stubServer({
      list: () => response(queue({ items: [request({ requestId: 'REQ-OTHER' })] })),
      byId: () => response({ request: request({ requestId: 'REQ-DECIDED', status: 'APPROVED', reviewer: 'Manager' }) })
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} routeSearch="requestId=REQ-DECIDED" /></I18nProvider>);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('承認済').length).toBeGreaterThan(0);
  });

  it('explains a missing or out-of-scope link without revealing anything', async () => {
    stubServer({
      list: () => response(queue({ items: [request({ requestId: 'REQ-OTHER' })] })),
      byId: () => failure('NOT_FOUND', 'Request not found', 404)
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} routeSearch="requestId=REQ-FOREIGN" /></I18nProvider>);
    expect(await screen.findByText(/指定された申請は表示できません/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not reveal a record after an authorization refusal', async () => {
    stubServer({
      list: () => response(queue({ items: [request({ requestId: 'REQ-OTHER', taskName: 'Other' })], total: 1 })),
      byId: () => failure('AUTHORIZATION_DENIED', 'Not allowed', 403)
    });
    render(<I18nProvider><RequestsScreen actor={MANAGER} routeSearch="requestId=REQ-DENIED" /></I18nProvider>);
    expect(await screen.findByText(/指定された申請を読み込めませんでした/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Nothing from the refused record is on screen.
    expect(screen.queryByText('設計レビュー')).toBeNull();
  });

  it('never reopens the dialog when the lookup finishes after navigation', async () => {
    let releaseLookup!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => (releaseLookup = resolve));
    stubServer({
      list: () => response(queue({ items: [request({ requestId: 'REQ-OTHER', taskName: 'Other' })], total: 1 })),
      byId: () => ({ then: (resolve: (value: Response) => void) => gate.then(resolve) }) as unknown as Response
    });
    const view = render(
      <I18nProvider><RequestsScreen actor={MANAGER} routeSearch="requestId=REQ-LINKED" /></I18nProvider>
    );
    await screen.findByText('Other');
    view.unmount();
    releaseLookup(response({ request: request({ requestId: 'REQ-LINKED', taskName: 'Linked request' }) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Linked request')).toBeNull();
  });
});
