// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, useI18n } from '../src/i18n';
import { LanguageSwitch } from '../src/components/ui';
import { LoginScreen } from '../src/screens/Login';
import { AssigneePicker } from '../src/components/AssigneePicker';
import { APP_NAME, dictionarySize, t } from '@eh/i18n';
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
