// @vitest-environment jsdom
/**
 * The application shell and the compact first-screen controls.
 *
 * These tests assert behaviour, not pixels: which navigation surface exists at which width, that a
 * menu and a drawer close with Escape and give focus back, and that a collapsed filter disclosure
 * still says which filters are applied.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { App } from '../src/App';
import { BlockedReasons } from '../src/components/forms';
import { Menu } from '../src/components/ui';
import { MyWorkScreen } from '../src/screens/MyWork';
import { queryCache } from '../src/state/cache';

const ADMIN = {
  actor: {
    memberId: 'MEM-ADMIN',
    name: '管理者',
    email: 'admin@example.invalid',
    role: 'ADMIN' as const,
    active: true,
    verified: true,
    selfServiceEnabled: true
  },
  authMode: 'local' as const,
  csrfToken: 'csrf',
  expiresAt: new Date(Date.now() + 60_000).toISOString()
};

function response(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function stubViewport(desktop: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  }));
}

function stubApp(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/session')) return response(ADMIN);
      if (url.includes('/api/manager/bootstrap')) return response({ references: { responsibilities: [] } });
      if (url.includes('/api/manager/overview')) {
        return response({
          scope: { responsibilityId: '', unassigned: false, label: '' },
          counts: {
            workItems: 0,
            containers: 0,
            activeWork: 0,
            openWork: 0,
            overdueWork: 0,
            completedWork: 0,
            cancelledWork: 0
          },
          upcomingWindow: { days: 7, from: '2026-11-05', to: '2026-11-11' },
          overdue: [],
          overdueTotal: 0,
          upcoming: [],
          upcomingTotal: 0,
          responsibilities: [],
          projects: [],
          pendingRequests: [],
          generatedAt: '2026-11-05T00:00:00.000Z'
        });
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
}

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.location.hash = '';
});

describe('application shell', () => {
  it('shows the grouped sidebar at desktop width and no drawer', async () => {
    stubViewport(true);
    stubApp();
    render(<I18nProvider><App /></I18nProvider>);

    expect(await screen.findByRole('link', { name: '概要' })).toBeTruthy();
    expect(document.querySelector('.app-sidebar')).not.toBeNull();
    expect(document.querySelector('.drawer-open')).toBeNull();
    expect(screen.queryByRole('button', { name: 'メニュー' })).toBeNull();
    // Groups without a visible destination are not rendered.
    expect(document.querySelectorAll('.nav-group').length).toBe(3);
  });

  it('replaces the sidebar with a drawer below 1100px and closes it with Escape', async () => {
    stubViewport(false);
    stubApp();
    render(<I18nProvider><App /></I18nProvider>);

    const toggle = await screen.findByRole('button', { name: 'メニュー' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The desktop navigation is not rendered beside the content at this width.
    expect(document.querySelector('.app-sidebar')).toBeNull();

    fireEvent.click(toggle);
    const drawer = document.querySelector('.app-sidebar.drawer-open') as HTMLElement;
    expect(drawer).not.toBeNull();
    expect(within(drawer).getByRole('link', { name: 'すべてのタスク' })).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.app-sidebar.drawer-open')).toBeNull());
    // Focus returns to the control that opened the drawer.
    expect(document.activeElement).toBe(toggle);
  });

  it('closes the drawer after navigation', async () => {
    stubViewport(false);
    stubApp();
    render(<I18nProvider><App /></I18nProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'メニュー' }));
    const drawer = document.querySelector('.app-sidebar.drawer-open') as HTMLElement;
    fireEvent.click(within(drawer).getByRole('link', { name: 'タイムライン' }));
    await waitFor(() => expect(document.querySelector('.app-sidebar.drawer-open')).toBeNull());
  });
});

describe('disclosure menu', () => {
  it('opens on demand, closes with Escape and returns focus to its trigger', async () => {
    render(
      <I18nProvider>
        <Menu label="その他">{(close) => <button type="button" role="menuitem" onClick={close}>削除</button>}</Menu>
      </I18nProvider>
    );
    const trigger = screen.getByRole('button', { name: 'その他' });
    // A closed menu leaves no unreachable control in the tab order.
    expect(screen.queryByRole('menuitem', { name: '削除' })).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: '削除' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: '削除' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when a pointer lands outside it', async () => {
    render(
      <I18nProvider>
        <div>
          <Menu label="その他">{(close) => <button type="button" role="menuitem" onClick={close}>削除</button>}</Menu>
          <button type="button">outside</button>
        </div>
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'その他' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: '削除' })).toBeNull());
  });
});

describe('My Work first screen', () => {
  const item = {
    container: false,
    taskId: 'TSK-1',
    taskName: '筐体の強度検討',
    projectId: 'PRJ-A',
    projectName: '車載バッテリー筐体',
    subprojectName: '',
    status: 'In Progress',
    displayStatus: 'IN_PROGRESS',
    priority: 'Medium',
    dueDate: '2026-12-01',
    progressPercent: 0,
    actualHours: 0,
    reviewState: 'NONE',
    lastRequestStatus: '',
    lastRequestType: '',
    pendingRequest: false,
    creationChannel: 'MANAGER',
    completedAt: null,
    revision: 1
  };

  function stubMyWork(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/employee/requests/mine')) return response({ items: [], submissionEnabled: true });
        if (url.includes('/projects')) return response({ items: [], taskCreationEnabled: false });
        return response({ items: [item], total: 1, activeTotal: 2, completedTotal: 1, unfilteredActiveTotal: 2 });
      })
    );
  }

  it('puts the title, the total and the help disclosure on one compact row', async () => {
    stubMyWork();
    render(<I18nProvider><MyWorkScreen actor={ADMIN.actor as never} /></I18nProvider>);

    expect(await screen.findByText('筐体の強度検討')).toBeTruthy();
    const heading = document.querySelector('.page-heading') as HTMLElement;
    expect(within(heading).getByRole('heading', { name: '自分の担当タスク' })).toBeTruthy();
    expect(within(heading).getByText('全 2 件')).toBeTruthy();
    expect(within(heading).getByText('使い方')).toBeTruthy();
    // The task and its main action are present without opening anything.
    expect(screen.getByRole('link', { name: '詳細を開く' }).getAttribute('href')).toBe('#/task/TSK-1');
    expect(screen.getByRole('link', { name: '車載バッテリー筐体' }).getAttribute('href')).toBe('#/project/PRJ-A');
  });

  it('keeps the applied filters readable while the filter disclosure is closed', async () => {
    stubMyWork();
    render(<I18nProvider><MyWorkScreen actor={ADMIN.actor as never} /></I18nProvider>);

    expect(await screen.findByText('筐体の強度検討')).toBeTruthy();
    const summary = screen.getByText('絞り込み');
    const disclosure = summary.closest('details') as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);

    const overdue = within(disclosure).getByRole('checkbox', { name: '期限超過' });
    fireEvent.click(overdue);
    expect(disclosure.open).toBe(false);

    const active = document.querySelector('.active-filter-summary') as HTMLElement;
    expect(active).not.toBeNull();
    expect(within(active).getByText('期限超過')).toBeTruthy();
  });
});

describe('neutral editor state', () => {
  it('states that nothing changed instead of reporting a refusal', () => {
    render(<I18nProvider><BlockedReasons reasons={['変更はありません。']} /></I18nProvider>);
    expect(screen.getByText('変更はありません。')).toBeTruthy();
    expect(screen.queryByText('このままでは登録できません')).toBeNull();
  });

  it('still explains the concrete reasons a submit is blocked', () => {
    render(<I18nProvider><BlockedReasons reasons={['タスク名を入力してください。']} /></I18nProvider>);
    expect(screen.getByText('このままでは登録できません')).toBeTruthy();
    expect(screen.getByText('タスク名を入力してください。')).toBeTruthy();
  });
});
