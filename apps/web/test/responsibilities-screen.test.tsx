// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
// jsdom has no native <dialog>; the Modal component needs these two methods to open and close.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };
}
import { I18nProvider } from '../src/i18n';
import { ResponsibilitiesScreen } from '../src/screens/Responsibilities';
import { queryCache } from '../src/state/cache';

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));

const ADMIN = {
  memberId: 'MEM-ADMIN',
  name: 'Admin',
  email: 'admin@example.invalid',
  role: 'ADMIN' as const,
  active: true,
  verified: true,
  selfServiceEnabled: true
};

const MANAGER = { ...ADMIN, memberId: 'MEM-MANAGER', role: 'MANAGER' as const };

function responsibility(id: string, name: string, status: 'Active' | 'Retired') {
  return {
    responsibilityId: id,
    name,
    description: '',
    ownerMemberId: null,
    ownerName: '',
    status,
    sortOrder: 0,
    color: '#4F46E5',
    retiredAt: status === 'Retired' ? '2026-01-01T00:00:00.000Z' : null,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    additionalMemberIds: [],
    members: [],
    _revision: 1
  };
}

type Call = { url: string; method: string; body?: string };

function stubApi(options: {
  items: ReturnType<typeof responsibility>[];
  preflight?: unknown;
}) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.includes('/delete-preflight')) return response(options.preflight);
    if (method === 'DELETE') return response({ entityId: 'RSP-A', tombstoneId: 'DEL-1' });
    if (url.endsWith('/api/manager/responsibilities')) return response({ items: options.items });
    if (url.includes('/api/manager/references')) return response({ members: [] });
    return response({});
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

function renderScreen(actor: typeof ADMIN | typeof MANAGER) {
  return render(
    <I18nProvider>
      <ResponsibilitiesScreen actor={actor} />
    </I18nProvider>
  );
}

describe('responsibility management list', () => {
  it('hides retired areas by default and reveals them with the toggle', async () => {
    stubApi({
      items: [responsibility('RSP-A', '開発 製品・設計', 'Active'), responsibility('RSP-R', '旧分野', 'Retired')]
    });
    renderScreen(ADMIN);
    expect(await screen.findByText('開発 製品・設計')).toBeTruthy();
    expect(screen.queryByText('旧分野')).toBeNull();

    fireEvent.click(screen.getByLabelText('廃止済みを表示'));
    expect(await screen.findByText('旧分野')).toBeTruthy();
    expect(screen.getByText('開発 製品・設計')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('廃止済みを表示'));
    await waitFor(() => expect(screen.queryByText('旧分野')).toBeNull());
  });

  it('shows an actionable empty state when every area is retired', async () => {
    stubApi({ items: [responsibility('RSP-R', '旧分野', 'Retired')] });
    renderScreen(ADMIN);
    expect(
      await screen.findByText('有効な分野がありません。「廃止済みを表示」で廃止した分野を確認できます。')
    ).toBeTruthy();
  });
});

describe('responsibility deletion permissions', () => {
  it('offers the delete action to ADMIN only', async () => {
    stubApi({ items: [responsibility('RSP-A', 'Alpha', 'Active')] });
    const admin = renderScreen(ADMIN);
    expect(await screen.findByRole('button', { name: '分野を削除' })).toBeTruthy();
    admin.unmount();
    queryCache.clear();

    renderScreen(MANAGER);
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '分野を削除' })).toBeNull();
    // The manager keeps edit and retire.
    expect(screen.getByRole('button', { name: '編集' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '廃止' })).toBeTruthy();
  });

  it('blocks the deletion of a referenced area and offers retirement instead', async () => {
    const calls = stubApi({
      items: [responsibility('RSP-A', '開発 製品・設計', 'Active')],
      preflight: {
        entityType: 'RESPONSIBILITIES',
        entityId: 'RSP-A',
        name: '開発 製品・設計',
        status: 'Active',
        deletable: false,
        blockers: [{ code: 'PROJECTS_REFERENCED', detail: '3 project row(s) still name this responsibility' }],
        projectCount: 3,
        archivedProjectCount: 0,
        deletedProjectCount: 0,
        activeMemberCount: 0,
        historicalMemberCount: 0,
        auditReferenceCount: 0,
        publishedReferenceCount: 0,
        activeJobCount: 0,
        erasePlan: [],
        confirmationText: 'DELETE RSP-A',
        revision: 1
      }
    });
    renderScreen(ADMIN);
    fireEvent.click(await screen.findByRole('button', { name: '分野を削除' }));
    expect(await screen.findByText('関連プロジェクト: 3件')).toBeTruthy();
    expect(screen.queryByText('削除する')).toBeNull();
    expect(screen.getByRole('button', { name: '廃止する' })).toBeTruthy();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('deletes an unused area after one confirmation and derives the typed phrase', async () => {
    const calls = stubApi({
      items: [responsibility('RSP-A', '開発 製品・設計', 'Active')],
      preflight: {
        entityType: 'RESPONSIBILITIES',
        entityId: 'RSP-A',
        name: '開発 製品・設計',
        status: 'Active',
        deletable: true,
        blockers: [],
        projectCount: 0,
        archivedProjectCount: 0,
        deletedProjectCount: 0,
        activeMemberCount: 0,
        historicalMemberCount: 0,
        auditReferenceCount: 0,
        publishedReferenceCount: 0,
        activeJobCount: 0,
        erasePlan: [{ code: 'RESPONSIBILITY_ROW', count: 1, detail: 'Responsibility row RSP-A' }],
        confirmationText: 'DELETE RSP-A',
        revision: 3
      }
    });
    renderScreen(ADMIN);
    fireEvent.click(await screen.findByRole('button', { name: '分野を削除' }));
    expect(await screen.findByText('「開発 製品・設計」を削除しますか？この操作は元に戻せません。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
    const deletion = calls.find((call) => call.method === 'DELETE')!;
    expect(deletion.url).toBe('/api/admin/responsibilities/RSP-A');
    expect(JSON.parse(deletion.body!)).toEqual({
      revision: 3,
      confirmed: true,
      confirmation: 'DELETE RSP-A'
    });
    expect(await screen.findByText('「開発 製品・設計」を削除しました。')).toBeTruthy();
    // The list is re-read once so the deleted row cannot linger in the cached payload.
    await waitFor(() =>
      expect(calls.filter((call) => call.url.endsWith('/api/manager/responsibilities')).length).toBeGreaterThan(1)
    );
  });
});
