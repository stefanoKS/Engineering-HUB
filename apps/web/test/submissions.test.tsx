// @vitest-environment jsdom
/**
 * A submission is tracked by the session, not by the dialog.
 *
 * The cases reproduce the two behaviours this release corrects: a request whose answer arrives
 * after the dialog closed used to vanish, and cache effects used to depend on a mounted component.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { RequestDialog } from '../src/components/request-dialog';
import { SubmissionNotices } from '../src/components/submission-notices';
import { queryCache } from '../src/state/cache';
import { clearSubmissions, submitRequest } from '../src/state/submissions';
import { commitMutation } from '../src/state/mutation';

if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));

afterEach(() => {
  cleanup();
  clearSubmissions();
  queryCache.clear();
  vi.unstubAllGlobals();
});

describe('submission tracking after the dialog closes', () => {
  it('reports a delayed success that arrives after the form was closed', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => (release = resolve));
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST' && url.endsWith('/api/employee/requests')) return gate;
      return response({ items: [] });
    });
    vi.stubGlobal('fetch', fetcher);

    render(
      <I18nProvider>
        <SubmissionNotices />
        <RequestDialog
          taskId="TSK-A"
          taskName="Alpha"
          projectName="Alpha"
          currentDeadline={null}
          requestType="COMPLETION_REPORT"
          submissionEnabled
          onClose={() => undefined}
          onResult={() => undefined}
        />
      </I18nProvider>
    );

    fireEvent.change(screen.getByLabelText('完了メモ（任意）'), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: '申請を送信' }));
    await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(0));

    // The dialog is closed while the answer is still outstanding; the request is not cancelled.
    fireEvent.click(screen.getAllByRole('button', { name: '閉じる' })[0]!);
    release(response({ requestId: 'REQ-LATE' }));

    expect(await screen.findByText(/REQ-LATE/)).toBeTruthy();
    // Exactly one submission was sent: closing the form never replays it.
    expect(fetcher.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
  });

  it('keeps an unobservable outcome unknown and never retries it', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('connection lost');
    });
    vi.stubGlobal('fetch', fetcher);
    const first = await submitRequest({
      submissionId: 'client-1',
      taskId: 'TSK-A',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'done'
    });
    expect(first.state).toBe('UNKNOWN');
    // A second call with the same identity is answered from the tracker, not re-sent.
    const second = await submitRequest({
      submissionId: 'client-1',
      taskId: 'TSK-A',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'done'
    });
    expect(second.state).toBe('UNKNOWN');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a definite refusal from an uncertain outcome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: { code: 'VALIDATION_FAILED', message: 'The requested deadline is invalid', retryable: false, correlationId: 'c-1' }
            }),
            { status: 400 }
          )
      )
    );
    const refused = await submitRequest({
      submissionId: 'client-2',
      taskId: 'TSK-B',
      requestType: 'DEADLINE_CHANGE',
      requestedDueDate: '2026-11-01'
    });
    expect(refused.state).toBe('REFUSED');
    expect(refused.message).toContain('invalid');
  });
});

describe('mutation completion independent of the editor', () => {
  it('applies the cache effect without any component observing the mutation', async () => {
    // A key nobody is watching is dropped, so the next reader gets a fresh answer.
    await queryCache.fetch('manager/tasks?page=1', async () => 'stale');
    await commitMutation(async () => undefined, ['manager/tasks']);
    expect(queryCache.peek<string>('manager/tasks?page=1').data).toBeUndefined();

    // A mounted key keeps its payload and refetches in place instead of blanking the screen.
    await queryCache.fetch('manager/projects', async () => 'kept');
    let calls = 0;
    queryCache.activate('manager/projects', async () => {
      calls += 1;
      return 'fresh';
    });
    await commitMutation(async () => undefined, ['manager/projects']);
    await waitFor(() => expect(calls).toBe(1));
    expect(queryCache.peek<string>('manager/projects').data).toBe('fresh');
    queryCache.deactivate('manager/projects');
  });

  it('performs no cache effect after the session ended', async () => {
    await queryCache.fetch('manager/projects', async () => 'private');
    let resolveWrite!: () => void;
    const write = new Promise<void>((resolve) => (resolveWrite = resolve));
    const pending = commitMutation(() => write, ['manager/projects']);
    queryCache.clear();
    resolveWrite();
    await pending;
    expect(queryCache.peek<string>('manager/projects').data).toBeUndefined();
  });
});
