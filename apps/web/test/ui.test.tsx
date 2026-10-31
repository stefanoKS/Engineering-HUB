// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, useI18n } from '../src/i18n';
import { LanguageSwitch } from '../src/components/ui';
import { APP_NAME, dictionarySize, t } from '@eh/i18n';

afterEach(() => {
  cleanup();
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
