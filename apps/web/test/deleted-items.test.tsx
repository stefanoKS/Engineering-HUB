// @vitest-environment jsdom
/**
 * The ADMIN Deleted Items view and the no-typing confirmation surface.
 *
 * jsdom proves behaviour, not layout: the action-column geometry is asserted in the real browser
 * journey (`scripts/browser-smoke.mjs`), because a jsdom rectangle says nothing about the rendered
 * table.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
// jsdom has no native <dialog>; the Modal component needs these two methods to open and close.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };
}
import { I18nProvider } from '../src/i18n';
import { DeletedItemsScreen } from '../src/screens/DeletedItems';
import { ActionConfirmDialog } from '../src/components/ActionConfirmDialog';
import { queryCache } from '../src/state/cache';
import type { Actor } from '@eh/contracts';

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));

const ADMIN: Actor = {
  memberId: 'MEM-ADMIN',
  name: 'Admin',
  email: 'admin@example.invalid',
  role: 'ADMIN',
  active: true,
  verified: true,
  selfServiceEnabled: true
};

const deletedTask = {
  entityType: 'TASKS' as const,
  entityId: 'T-DEL',
  name: 'Removed work',
  projectId: 'PRJ-A',
  projectName: 'Alpha',
  location: 'Delivery area',
  deletedAt: '2026-11-01T02:00:00.000Z',
  deletedByMemberId: 'MEM-MANAGER',
  deletedByName: 'Manager',
  reason: 'Recoverable removal confirmed with the in-application confirmation button (no typed phrase and no free-text reason were collected)',
  confirmationSource: 'BUTTON',
  revision: 4,
  restorable: true,
  blockers: []
};

const blockedTask = {
  ...deletedTask,
  entityId: 'T-BLOCKED',
  name: 'Blocked work',
  location: '',
  restorable: false,
  blockers: [{ code: 'PARENT_DELETED', detail: 'The subproject of this task is removed; restore the subproject first' }]
};

const legacyTask = {
  ...deletedTask,
  entityId: 'T-LEGACY',
  name: 'Legacy removed',
  deletedByMemberId: null,
  deletedByName: null,
  reason: null,
  confirmationSource: null,
  restorable: true
};

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20, totalPages: 1 });

describe('Deleted items', () => {
  it('lists removed records with their location, recorded evidence and restore state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(page([deletedTask, blockedTask, legacyTask]))));
    render(<I18nProvider><DeletedItemsScreen actor={ADMIN} /></I18nProvider>);
    expect(await screen.findByText('Removed work')).toBeTruthy();
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delivery area').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Manager').length).toBeGreaterThan(0);
    // A blocked record states why, and its restore control is unavailable.
    expect(screen.getByText('復元できません')).toBeTruthy();
    expect(screen.getByText('親の記録が削除されています')).toBeTruthy();    // Missing historical metadata is labelled, never invented.
    expect(screen.getAllByText('記録なし').length).toBeGreaterThan(0);
    const blockedRow = screen.getByText('Blocked work').closest('tr')!;
    expect((blockedRow.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(['ADMIN', 'MANAGER'] as const)('%s restores the selected record through one button and no typing', async role => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/restore-preflight')) {
        return response({ entityType: 'TASKS', entityId: 'T-DEL', name: 'Removed work', restorable: true, blockers: [], revision: 4 });
      }
      if (init?.method === 'POST') return response({ entityType: 'TASKS', entityId: 'T-DEL', revision: 5, alreadyRestored: false });
      return response(page([deletedTask]));
    });
    vi.stubGlobal('fetch', fetcher);
    render(<I18nProvider><DeletedItemsScreen actor={{ ...ADMIN, role }} /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '復元' }));
    const dialog = await screen.findByRole('dialog');
    // The confirmation asks for one button: no phrase and no reason field.
    expect(dialog.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(within(dialog).getByText(/この記録を元の場所に復元します/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '復元する' }));
    });
    await waitFor(() => expect(screen.getByText('「Removed work」を復元しました。')).toBeTruthy());
    const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(posted[0]).toBe('/api/admin/tasks/T-DEL/restore');
    expect(JSON.parse(String(posted[1]!.body))).toEqual({ revision: 4, confirmed: true });
  });

  it('sends one restore when the button is activated twice in the same tick', async () => {    let release: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/restore-preflight')) {
        return response({ entityType: 'TASKS', entityId: 'T-DEL', name: 'Removed work', restorable: true, blockers: [], revision: 4 });
      }
      if (init?.method === 'POST') return pending;
      return response(page([deletedTask]));
    });
    vi.stubGlobal('fetch', fetcher);
    render(<I18nProvider><DeletedItemsScreen actor={ADMIN} /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '復元' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: '復元する' });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    await act(async () => {
      release(response({ entityType: 'TASKS', entityId: 'T-DEL', revision: 5, alreadyRestored: false }));
    });
  });

  it('paints nothing when the session ends while the restore is in flight', async () => {
    let release: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/restore-preflight')) {
        return response({ entityType: 'TASKS', entityId: 'T-DEL', name: 'Removed work', restorable: true, blockers: [], revision: 4 });
      }
      if (init?.method === 'POST') return pending;
      return response(page([deletedTask]));
    });
    vi.stubGlobal('fetch', fetcher);
    render(<I18nProvider><DeletedItemsScreen actor={ADMIN} /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '復元' }));
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '復元する' }));
    });
    // The signed-in session ended while the write was in flight.
    queryCache.clear();
    await act(async () => {
      release(response({ entityType: 'TASKS', entityId: 'T-DEL', revision: 5, alreadyRestored: false }));
    });
    // The write itself still succeeded, but no notice is painted into the next session.
    expect(screen.queryByText(/を復元しました/)).toBeNull();
  });
});

describe('the no-typing confirmation surface', () => {
  it('cancels without a mutation and keeps focus and Escape working', async () => {
    const onConfirm = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    render(
      <I18nProvider>
        <ActionConfirmDialog
          title="Remove task"
          recordName="Area A work"
          context="Alpha"
          warning="Remove this task from normal views; the record is retained."
          confirmLabel="Delete"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </I18nProvider>
    );
    expect(screen.getByText('Area A work')).toBeTruthy();
    expect(screen.getByText('Remove this task from normal views; the record is retained.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    // Escape is handled by the dialog's cancel event, which the Modal routes to the same handler.
    fireEvent.keyDown(document.querySelector('dialog')!, { key: 'Escape' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('reports an unobservable outcome without retrying or closing', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('The request could not be sent');
    });
    const onCancel = vi.fn();
    render(
      <I18nProvider>
        <ActionConfirmDialog
          title="Restore record"
          recordName="Removed work"
          warning="Restores this record to its original place."
          confirmLabel="Restore"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // Nothing is retried and the dialog stays open for a deliberate decision.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
  });

  it('closes safely when the dialog unmounts during a pending write', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onConfirm = vi.fn(() => pending);
    const view = render(
      <I18nProvider>
        <ActionConfirmDialog
          title="Reopen task"
          recordName="Finished work"
          warning="Reverses the current completion of this task."
          confirmLabel="Reopen task"
          onCancel={() => undefined}
          onConfirm={onConfirm}
        />
      </I18nProvider>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reopen task' }));
    });
    view.unmount();
    release();
    // The write still settles; unmounting never throws and never starts a second attempt.
    await act(async () => {
      await pending;
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
