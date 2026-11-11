// @vitest-environment jsdom
/**
 * V2 branding (シゴトモ / SHIGOTOMO).
 *
 * The product name is not a division name: a division stored as `設計・開発課` keeps that stored
 * value and is rendered exactly as stored, while the application title, the sign-in title and the
 * browser document title follow the selected language.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { LoginScreen } from '../src/screens/Login';
import { DivisionScopeBar } from '../src/components/DivisionScopeBar';
import { App } from '../src/App';
import { clearDivisionScope, setDivisionScope } from '../src/state/division';

function json(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

const session = {
  actor: {
    memberId: 'MEM-ADMIN',
    name: '管理者',
    email: 'admin@example.invalid',
    role: 'ADMIN',
    active: true,
    verified: true,
    selfServiceEnabled: true
  },
  authMode: 'local',
  csrfToken: 'csrf',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  divisions: {
    readable: [{ divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' }],
    writable: [{ divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' }],
    allDivisions: true
  }
};

const emptyOverview = {
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
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  clearDivisionScope();
  document.title = '';
});

describe('application branding', () => {
  it('shows the Japanese brand in the authenticated header and in the document title', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.startsWith('/api/session')
          ? json(session)
          : url.includes('/api/manager/overview')
            ? json(emptyOverview)
            : json({})
      )
    );
    render(
      <I18nProvider>
        <App />
      </I18nProvider>
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'シゴトモ' })).toBeTruthy();
    // The accessible application name of the navigation is the brand too.
    expect(screen.getAllByRole('navigation', { name: 'シゴトモ' }).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.title).toBe('シゴトモ'));
  });

  it('switches the header and the document title to SHIGOTOMO without losing the screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.startsWith('/api/session')
          ? json(session)
          : url.includes('/api/manager/overview')
            ? json(emptyOverview)
            : json({})
      )
    );
    render(
      <I18nProvider>
        <App />
      </I18nProvider>
    );
    const japaneseHeading = await screen.findByRole('heading', { level: 2, name: '概要' });
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'SHIGOTOMO' })).toBeTruthy();
    expect(document.title).toBe('SHIGOTOMO');
    // The language switch never navigates: the same screen heading is still mounted.
    expect(screen.getByRole('heading', { level: 2, name: 'Overview' })).toBe(japaneseHeading);
  });

  it('uses the brand as the sign-in application title and keeps the company logo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          appVersion: '2.0.0',
          environment: 'PRODUCTION',
          googleClientId: '',
          authConfigured: false,
          devSignInEnabled: false
        })
      )
    );
    render(
      <I18nProvider>
        <LoginScreen notice="" onSignedIn={() => undefined} />
      </I18nProvider>
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'シゴトモ' })).toBeTruthy();
    const logo = screen.getByRole('img', { name: '広島化成' }) as HTMLImageElement;
    expect(logo.getAttribute('src')).toBe('/branding/companyLogo.png');
  });

  it('keeps a stored division name while rendering the product brand', () => {
    setDivisionScope({
      readable: [
        { divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' },
        { divisionId: 'DIV-ENG', name: '設計・技術課', status: 'Active' }
      ],
      writable: [],
      allDivisions: false
    });
    render(
      <I18nProvider>
        <DivisionScopeBar />
      </I18nProvider>
    );
    const names = Array.from(document.querySelectorAll('option')).map((option) => option.textContent);
    expect(names).toContain('設計・開発課');
    expect(names).toContain('設計・技術課');
    expect(names).not.toContain('シゴトモ');
  });
});
