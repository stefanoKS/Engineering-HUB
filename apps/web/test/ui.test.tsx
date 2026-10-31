// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, useI18n } from '../src/i18n';
import { LanguageSwitch } from '../src/components/ui';
import { LoginScreen } from '../src/screens/Login';
import { APP_NAME, dictionarySize, t } from '@eh/i18n';

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
    expect(APP_NAME).toBe('設計・開発課 管理');
    expect(t('ja', 'app.name')).toBe(APP_NAME);
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
    expect(await screen.findByText(/サインイン設定を読み込めませんでした/)).toBeTruthy();
  });
});
