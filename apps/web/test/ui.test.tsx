// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, useI18n } from '../src/i18n';
import { LanguageSwitch } from '../src/components/ui';
import { LoginScreen } from '../src/screens/Login';
import { App } from '../src/App';
import { AssigneePicker } from '../src/components/AssigneePicker';
import { APP_BRAND, APP_NAME, brandName, dictionarySize, t } from '@eh/i18n';
import { formatSkillGrade } from '@eh/domain';

function configResponse(config: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, data: config }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function Probe(): JSX.Element {
  const { language, t: translate, setLanguage } = useI18n();
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="open-work">{translate('overview.openWork')}</span>
      <LanguageSwitch language={language} onChange={setLanguage} />
    </div>
  );
}

describe('localization', () => {
  it('defaults to Japanese and switches to English, persisting the choice locally', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    expect(screen.getByTestId('language').textContent).toBe('ja');
    expect(screen.getByTestId('open-work').textContent).toBe('未完了の作業');
    fireEvent.click(screen.getByText('English'));
    expect(screen.getByTestId('language').textContent).toBe('en');
    expect(screen.getByTestId('open-work').textContent).toBe('Open work');
    expect(window.localStorage.getItem('eh.lang')).toBe('en');
  });

  it('reuses the V1 dictionary with full ja/en parity', () => {
    expect(dictionarySize('ja')).toBeGreaterThan(900);
    expect(dictionarySize('ja')).toBe(dictionarySize('en'));
    // The generated dictionary keeps the V1 product name; the V2 brand is a separate value.
    expect(APP_NAME).toBe('設計・開発課 管理');
    expect(t('ja', 'app.name')).toBe(APP_NAME);
    expect(brandName('ja')).toBe('シゴトモ');
    expect(brandName('en')).toBe('SHIGOTOMO');
    expect(APP_BRAND.ja).not.toBe(APP_NAME);
  });

  it('returns the key for a missing entry instead of a silent blank', () => {
    expect(t('ja', 'nonexistent.key')).toBe('nonexistent.key');
    expect(t('ja', 'app.name')).not.toBe('app.name');
  });
});

describe('sign-in configuration', () => {
  it('shows an actionable error when no sign-in method is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        configResponse({
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
    expect(await screen.findByText(/Google サインインが未設定/)).toBeTruthy();
    expect(screen.queryByText('開発用サインイン（この環境のみ）')).toBeNull();
  });

  it('shows the development fixture only when the server enables it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        configResponse({
          appVersion: '2.0.0',
          environment: 'DEVELOPMENT',
          googleClientId: 'public-client-id.apps.googleusercontent.com',
          authConfigured: true,
          devSignInEnabled: true
        })
      )
    );
    render(
      <I18nProvider>
        <LoginScreen notice="" onSignedIn={() => undefined} />
      </I18nProvider>
    );
    expect(await screen.findByText('開発用サインイン（この環境のみ）')).toBeTruthy();
  });

  it('reports an unreadable configuration instead of showing an empty login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }))
    );
    render(
      <I18nProvider>
        <LoginScreen notice="" onSignedIn={() => undefined} />
      </I18nProvider>
    );
    expect(await screen.findByText(/サインイン設定の応答が不正でした/)).toBeTruthy();
    // A failed load never falls back to Google instructions: the mode is unknown, not "google".
    expect(screen.queryByText('会社の Google アカウントでサインインしてください。')).toBeNull();
  });

  it('shows the employee-ID form in local mode and the Google wording in google mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        configResponse({
          appVersion: '2.0.0',
          environment: 'PRODUCTION',
          authMode: 'local',
          googleClientId: '',
          authConfigured: true,
          devSignInEnabled: false
        })
      )
    );
    const local = render(
      <I18nProvider>
        <LoginScreen notice="" onSignedIn={() => undefined} />
      </I18nProvider>
    );
    expect(await screen.findByText('社員番号とパスワードでログインしてください。')).toBeTruthy();
    expect(await screen.findByLabelText('社員番号')).toBeTruthy();
    expect(screen.queryByText('会社の Google アカウントでサインインしてください。')).toBeNull();
    local.unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        configResponse({
          appVersion: '2.0.0',
          environment: 'PRODUCTION',
          authMode: 'google',
          googleClientId: 'public-client-id.apps.googleusercontent.com',
          authConfigured: true,
          devSignInEnabled: false
        })
      )
    );
    render(
      <I18nProvider>
        <LoginScreen notice="" onSignedIn={() => undefined} />
      </I18nProvider>
    );
    expect(await screen.findByText('会社の Google アカウントでサインインしてください。')).toBeTruthy();
    expect(screen.queryByLabelText('社員番号')).toBeNull();
  });

  it('names a database readiness failure instead of a credential problem, and offers a retry', async () => {
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: 'DATABASE_MIGRATION_REQUIRED',
                message: 'The database schema does not match this build.',
                retryable: false,
                correlationId: 'c-1'
              }
            }),
            { status: 503, headers: { 'content-type': 'application/json' } }
          );
        }
        return configResponse({
          appVersion: '2.0.0',
          environment: 'PRODUCTION',
          authMode: 'local',
          googleClientId: '',
          authConfigured: true,
          devSignInEnabled: false
        });
      })
    );
    render(
      <I18nProvider>
        <LoginScreen notice="" onSignedIn={() => undefined} />
      </I18nProvider>
    );
    expect(await screen.findByText(/データベースのスキーマがこのビルドと一致していません/)).toBeTruthy();
    expect(screen.queryByText('会社の Google アカウントでサインインしてください。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByLabelText('社員番号')).toBeTruthy();
  });
});

describe('supplied branding assets', () => {
  it('shows the company logo above the local sign-in form, without the department logo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        configResponse({
          appVersion: '2.0.0',
          environment: 'DEVELOPMENT',
          authMode: 'local',
          googleClientId: '',
          authConfigured: true,
          devSignInEnabled: false
        })
      )
    );
    render(
      <I18nProvider>
        <LoginScreen notice="" onSignedIn={() => undefined} />
      </I18nProvider>
    );
    const logo = (await screen.findByRole('img', { name: '広島化成' })) as HTMLImageElement;
    expect(logo.getAttribute('src')).toBe('/branding/companyLogo.png');
    expect(logo.className).toBe('company-login-logo');
    expect(screen.queryByRole('img', { name: '広島化成 製品設計課' })).toBeNull();
    const signIn = await screen.findByRole('button', { name: 'ログイン' });
    expect(logo.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the department logo in the authenticated header instead of the company logo', async () => {    const session = {
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
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/session')) return configResponse(session);
        // The landing overview reads its own projection; the header assertions never depend on it,
        // but a malformed payload must not unmount the shell mid-test.
        if (url.includes('/api/manager/overview')) {
          return configResponse({
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
        return configResponse({});
      })
    );
    render(
      <I18nProvider>
        <App />
      </I18nProvider>
    );
    const logo = (await screen.findByRole('img', { name: '広島化成 工業用品 業務管理' })) as HTMLImageElement;
    expect(logo.getAttribute('src')).toBe('/branding/industrialName.png');
    expect(logo.className).toBe('industrial-logo');
    expect(screen.queryByRole('img', { name: '広島化成' })).toBeNull();
    expect(screen.getByRole('button', { name: 'English' })).toBeTruthy();
    // Sign-out lives inside the account menu, not in the header row.
    expect(screen.queryByRole('button', { name: 'サインアウト' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /管理者/ }));
    expect(await screen.findByRole('menuitem', { name: 'サインアウト' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'パスワード変更' })).toBeTruthy();
  });
});

describe('unified assignee picker', () => {
  const members = [
    { memberId: 'MEM-B', name: '佐藤 花子', active: true, employeeId: '0012' },
    { memberId: 'MEM-A', name: '田中 太郎', active: true, employeeId: '0011' },
    { memberId: 'MEM-C', name: '無効 者', active: false, employeeId: '0013' }
  ];

  it('moves a member between panels, keeps a stable order and never duplicates', () => {
    function Harness(): JSX.Element {
      const [selected, setSelected] = useState<string[]>([]);
      return <AssigneePicker members={members} selectedIds={selected} onChange={setSelected} />;
    }
    const view = render(<I18nProvider><Harness /></I18nProvider>);
    // Only active members are offered, sorted by name (佐藤 before 田中).
    const available = () => Array.from(view.container.querySelectorAll('.assignee-option .assignee-name')).map((node) => node.textContent);
    expect(available()).toEqual(['佐藤 花子', '田中 太郎']);

    fireEvent.click(screen.getByRole('button', { name: '選択可能なメンバー: 田中 太郎' }));
    expect(available()).toEqual(['佐藤 花子']);
    expect(view.container.querySelectorAll('.chip')).toHaveLength(1);
    expect(view.container.querySelector('.chip')?.textContent).toBe('田中 太郎×');

    fireEvent.click(screen.getByRole('button', { name: '田中 太郎 を外す' }));
    // The removed member returns to its original sorted position.
    expect(available()).toEqual(['佐藤 花子', '田中 太郎']);
    expect(view.container.querySelectorAll('.chip')).toHaveLength(0);
  });

  it('shows the search filter against name and employee number', () => {
    render(
      <I18nProvider>
        <AssigneePicker members={members} selectedIds={[]} onChange={() => undefined} />
      </I18nProvider>
    );
    fireEvent.change(screen.getByLabelText('氏名・社員番号で検索'), { target: { value: '0012' } });
    expect(screen.getByText('佐藤 花子')).toBeTruthy();
    expect(screen.queryByText('田中 太郎')).toBeNull();
  });

  it('renders A-D grades and keeps an unassessed level as 未評価', () => {
    expect([4, 3, 2, 1, 0, null].map((level) => formatSkillGrade(level))).toEqual(['A', 'B', 'C', 'D', '未評価', '未評価']);
    expect(formatSkillGrade(3, 'Not assessed')).toBe('B');
  });
});
