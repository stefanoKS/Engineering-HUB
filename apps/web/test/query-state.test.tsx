// @vitest-environment jsdom
/**
 * Read states and the menu keyboard contract.
 *
 * The cases pin the two failure modes this release removes: a screen that says "loading" after a
 * failed request, and a background refresh failure that replaces readable data with an error page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { FreshnessLine, QueryState, RefreshWarning } from '../src/components/query-state';
import { Menu } from '../src/components/ui';
import { queryCache } from '../src/state/cache';

afterEach(() => {
  cleanup();
  queryCache.clear();
});

const wrap = (node: JSX.Element): JSX.Element => <I18nProvider>{node}</I18nProvider>;

describe('query state presentation', () => {
  it('shows a loading line only while the first answer is pending', () => {
    render(
      wrap(<QueryState query={{ data: undefined, loading: true, refreshing: false, updatedAt: 0, refresh: () => undefined }}>{() => <p>rows</p>}</QueryState>)
    );
    expect(screen.getByRole('status').textContent).toContain('読み込み中');
    expect(screen.queryByText('rows')).toBeNull();
  });

  it('offers a retry after an initial failure instead of loading forever', () => {
    const refresh = vi.fn();
    render(
      wrap(
        <QueryState
          query={{ data: undefined, error: new Error('boom'), loading: false, refreshing: false, updatedAt: 0, refresh }}
        >
          {() => <p>rows</p>}
        </QueryState>
      )
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('keeps the existing data and warns when a background refresh fails', () => {
    const refresh = vi.fn();
    render(
      wrap(
        <>
          <RefreshWarning error={new Error('offline')} onRetry={refresh} />
          <QueryState
            query={{ data: { rows: 2 }, error: new Error('offline'), loading: false, refreshing: false, updatedAt: Date.now(), refresh }}
          >
            {(data) => <p>rows: {data.rows}</p>}
          </QueryState>
        </>
      )
    );
    expect(screen.getByText('rows: 2')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('最新の取得に失敗しました');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('labels a refresh and the last successful update instead of claiming live data', () => {
    render(wrap(<FreshnessLine updatedAt={0} refreshing onRefresh={() => undefined} />));
    expect(screen.getByText('更新中…')).toBeTruthy();

    cleanup();
    render(wrap(<FreshnessLine updatedAt={Date.parse('2026-11-11T05:04:00.000Z')} onRefresh={() => undefined} />));
    expect(screen.getByText(/最終更新 14:04/)).toBeTruthy();
  });
});

describe('cache key isolation', () => {
  it('never serves one key’s payload under another key', async () => {
    await queryCache.fetch('scope/a', async () => 'A');
    await queryCache.fetch('scope/b', async () => 'B');
    expect(queryCache.peek<string>('scope/a').data).toBe('A');
    expect(queryCache.peek<string>('scope/b').data).toBe('B');
  });

  it('keeps the last payload while a mounted key refetches', async () => {
    await queryCache.fetch('scope/mounted', async () => 'first');
    let resolveRefresh!: (value: string) => void;
    const loader = (): Promise<string> => new Promise<string>((resolve) => (resolveRefresh = resolve));
    queryCache.activate('scope/mounted', loader);
    queryCache.invalidate(['scope/mounted']);
    // The visible payload survives the invalidation; the entry reports itself as refreshing.
    expect(queryCache.peek<string>('scope/mounted').data).toBe('first');
    expect(queryCache.peek<string>('scope/mounted').refreshing).toBe(true);
    resolveRefresh('second');
    await waitFor(() => expect(queryCache.peek<string>('scope/mounted').data).toBe('second'));
    queryCache.deactivate('scope/mounted');
  });

  it('advances the session epoch when the session ends', () => {
    const before = queryCache.sessionEpoch;
    queryCache.clear();
    expect(queryCache.sessionEpoch).toBe(before + 1);
  });
});

describe('cache retention and eviction', () => {
  // The documented policy: the retention target applies to inactive, settled entries.
  const RETENTION = 240;

  async function fillInactive(prefix: string, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await queryCache.fetch(`${prefix}/${index}`, async () => index);
    }
  }

  it('never evicts a payload an active consumer is displaying', async () => {
    await queryCache.fetch('active/key', async () => 'visible');
    queryCache.activate('active/key', async () => 'visible');

    await fillInactive('inactive', RETENTION + 40);

    // The displayed payload survives, and the oldest inactive entries are the ones dropped.
    expect(queryCache.peek<string>('active/key').data).toBe('visible');
    expect(queryCache.peek<number>('inactive/0').data).toBeUndefined();
    expect(queryCache.peek<number>(`inactive/${RETENTION + 39}`).data).toBe(RETENTION + 39);
    queryCache.deactivate('active/key');
  });

  it('makes an entry eligible again once the last consumer leaves', async () => {
    await queryCache.fetch('multi/key', async () => 'kept');
    queryCache.activate('multi/key', async () => 'kept');
    queryCache.activate('multi/key', async () => 'kept');
    queryCache.deactivate('multi/key');

    await fillInactive('second', RETENTION + 20);
    // One consumer left: it is still active.
    expect(queryCache.peek<string>('multi/key').data).toBe('kept');

    queryCache.deactivate('multi/key');
    await queryCache.fetch('trigger/one', async () => 'x');
    await fillInactive('third', RETENTION + 20);
    expect(queryCache.peek<string>('multi/key').data).toBeUndefined();
  });

  it('keeps ownership of an in-flight read that is not evicted', async () => {
    const pending = queryCache.fetch('pending/key', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'resolved';
    });
    await fillInactive('while-pending', RETENTION + 10);
    await pending;
    // If the entry had been evicted the completion would have been dropped.
    expect(queryCache.peek<string>('pending/key').data).toBe('resolved');
  });

  it('removes every private payload on a session clear', async () => {
    await queryCache.fetch('private/one', async () => 'secret');
    queryCache.activate('private/one', async () => 'secret');
    queryCache.clear();
    expect(queryCache.peek<string>('private/one').data).toBeUndefined();
    queryCache.deactivate('private/one');
  });
});

describe('menu keyboard contract', () => {
  function renderMenu(): void {
    render(
      wrap(
        <Menu label="その他">
          {(close) => (
            <>
              <button type="button" role="menuitem" onClick={close}>
                first
              </button>
              <button type="button" role="menuitem" disabled>
                disabled
              </button>
              <button type="button" role="menuitem" onClick={close}>
                last
              </button>
            </>
          )}
        </Menu>
      )
    );
  }

  it('moves through the enabled items and wraps at both ends', async () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'その他' });
    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('first'));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    // The disabled item is skipped, so the second enabled item is the last one.
    expect(document.activeElement?.textContent).toBe('last');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('first');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('last');
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement?.textContent).toBe('first');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('last');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'その他' });
    fireEvent.click(trigger);
    await screen.findByRole('menu');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('opens with ArrowDown from the trigger', async () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'その他' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(await screen.findByRole('menu')).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('first'));
  });
});
