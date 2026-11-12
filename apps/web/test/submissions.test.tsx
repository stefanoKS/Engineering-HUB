// @vitest-environment jsdom
/**
 * A submission is tracked by the session, not by the dialog.
 *
 * The cases reproduce the defects this release corrects:
 *
 * - an acknowledgement without a valid request id used to be reported as `RECEIVED`;
 * - a definite refusal left the tracker holding the old identity, so a corrected draft could
 *   never be sent;
 * - dismissing a notice erased the only protection against replaying an uncertain submission;
 * - the delayed-success case used `onClose: () => undefined`, so the dialog never unmounted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { I18nProvider } from '../src/i18n';
import { RequestDialog } from '../src/components/request-dialog';
import { SubmissionNotices } from '../src/components/submission-notices';
import { queryCache } from '../src/state/cache';
import {
  attemptById,
  clearSubmissions,
  dismissSubmission,
  submitRequest,
  useSubmissions
} from '../src/state/submissions';
import { commitMutation } from '../src/state/mutation';

if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

const success = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 });
const failure = (code: string, message: string, status = 400) =>
  new Response(
    JSON.stringify({ ok: false, error: { code, message, retryable: false, correlationId: 'c-test' } }),
    { status }
  );

type Call = { url: string; method: string; body?: string };

function record(calls: Call[], handler: (body: Record<string, unknown>) => Response) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.endsWith('/api/employee/requests') && method === 'POST') return handler(body);
    return success({ items: [] });
  });
}

const posts = (calls: Call[]): Call[] =>
  calls.filter((call) => call.method === 'POST' && call.url.endsWith('/api/employee/requests'));

afterEach(() => {
  cleanup();
  clearSubmissions();
  queryCache.clear();
  vi.unstubAllGlobals();
});

describe('acknowledgement validation', () => {
  async function submitWith(payload: unknown) {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', record(calls, () => success(payload)));
    const outcome = await submitRequest({
      attemptId: 'attempt-1',
      submissionId: 'dialog-1',
      taskId: 'TSK-A',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'done'
    });
    return { outcome, calls };
  }

  it('accepts the authoritative acknowledgement', async () => {
    const { outcome } = await submitWith({
      requestId: 'REQ-1',
      state: 'RECEIVED',
      requestType: 'COMPLETION_REPORT',
      taskId: 'TSK-A',
      submittedAt: '2026-11-11T12:00:00.000Z'
    });
    expect(outcome.status).toBe('settled');
    if (outcome.status !== 'settled') return;
    expect(outcome.attempt.outcome).toBe('RECEIVED');
    expect(outcome.attempt.requestId).toBe('REQ-1');
    expect(outcome.attempt.acknowledgement).toBe('RECEIVED');
  });

  it('accepts an idempotent replay acknowledgement', async () => {
    const { outcome } = await submitWith({
      requestId: 'REQ-1',
      state: 'DUPLICATE',
      requestType: 'COMPLETION_REPORT',
      taskId: 'TSK-A',
      submittedAt: '2026-11-11T12:00:00.000Z'
    });
    if (outcome.status !== 'settled') throw new Error('expected settled');
    expect(outcome.attempt.outcome).toBe('RECEIVED');
    expect(outcome.attempt.acknowledgement).toBe('DUPLICATE');
  });

  it.each([
    ['an empty object', {}],
    ['null data', null],
    ['a missing requestId', { state: 'RECEIVED', requestType: 'COMPLETION_REPORT', taskId: 'TSK-A', submittedAt: 'x' }],
    ['an empty requestId', { requestId: '', state: 'RECEIVED', requestType: 'COMPLETION_REPORT', taskId: 'TSK-A', submittedAt: 'x' }],
    ['a numeric requestId', { requestId: 42, state: 'RECEIVED', requestType: 'COMPLETION_REPORT', taskId: 'TSK-A', submittedAt: 'x' }],
    ['an unknown state', { requestId: 'REQ-1', state: 'MAYBE', requestType: 'COMPLETION_REPORT', taskId: 'TSK-A', submittedAt: 'x' }]
  ])('treats %s as an unknown outcome, never as received', async (_label, payload) => {
    const { outcome } = await submitWith(payload);
    if (outcome.status !== 'settled') throw new Error('expected settled');
    expect(outcome.attempt.outcome).toBe('UNKNOWN');
    expect(outcome.attempt.requestId).toBe('');
    expect(outcome.attempt.failureCode).toBe('INVALID_RESPONSE');
  });

  it('reports an unreadable answer as unknown and never retries it', async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      record(calls, () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }))
    );
    const first = await submitRequest({
      attemptId: 'attempt-x',
      submissionId: 'dialog-x',
      taskId: 'TSK-A',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'done'
    });
    if (first.status !== 'settled') throw new Error('expected settled');
    expect(first.attempt.outcome).toBe('UNKNOWN');
    // A repeat with the same identity is answered from the tracker.
    const second = await submitRequest({
      attemptId: 'attempt-x',
      submissionId: 'dialog-x',
      taskId: 'TSK-A',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'done'
    });
    if (second.status !== 'settled') throw new Error('expected settled');
    expect(second.attempt.outcome).toBe('UNKNOWN');
    expect(posts(calls)).toHaveLength(1);
  });
});

describe('definite refusal versus uncertainty', () => {
  async function submitWithError(code: string, status = 400) {
    vi.stubGlobal('fetch', record([], () => failure(code, 'refused', status)));
    const outcome = await submitRequest({
      attemptId: `attempt-${code}`,
      submissionId: `dialog-${code}`,
      taskId: 'TSK-A',
      requestType: 'DEADLINE_CHANGE',
      requestedDueDate: '2026-12-01'
    });
    if (outcome.status !== 'settled') throw new Error('expected settled');
    return outcome.attempt;
  }

  it('classifies a validation refusal as a correctable refusal', async () => {
    const attempt = await submitWithError('VALIDATION_FAILED');
    expect(attempt.outcome).toBe('REFUSED');
    expect(attempt.message).toContain('refused');
  });

  it.each(['IDEMPOTENCY_REPLAY', 'NETWORK', 'INVALID_RESPONSE'])(
    'treats %s as an uncertain outcome, not a safe refusal',
    async (code) => {
      const attempt = await submitWithError(code, 409);
      expect(attempt.outcome).toBe('UNKNOWN');
      expect(attempt.message).toBe('');
    }
  );
});

describe('dismissal never removes the replay guard', () => {
  it('keeps the attempt after the notice is dismissed', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', record(calls, () => failure('IDEMPOTENCY_REPLAY', 'still processing', 409)));
    await submitRequest({
      attemptId: 'attempt-guard',
      submissionId: 'dialog-guard',
      taskId: 'TSK-A',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'done'
    });
    expect(attemptById('attempt-guard')?.outcome).toBe('UNKNOWN');
    dismissSubmission('attempt-guard');
    // The record is still there, so a repeat cannot silently POST again.
    expect(attemptById('attempt-guard')).toBeTruthy();
    await submitRequest({
      attemptId: 'attempt-guard',
      submissionId: 'dialog-guard',
      taskId: 'TSK-A',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'done'
    });
    expect(posts(calls)).toHaveLength(1);
  });

  it('hides a dismissed notice from the shell but keeps the others', () => {
    function Host(): JSX.Element {
      const submissions = useSubmissions();
      return (
        <div>
          <SubmissionNotices />
          <span data-testid="count">{submissions.length}</span>
        </div>
      );
    }
    render(
      <I18nProvider>
        <Host />
      </I18nProvider>
    );
    return (async () => {
      // A refusal produced by the tracker is shown by the shell.
      vi.stubGlobal('fetch', record([], () => failure('VALIDATION_FAILED', 'refused')));
      await submitRequest({
        attemptId: 'attempt-visible',
        submissionId: 'dialog-visible',
        taskId: 'TSK-A',
        requestType: 'COMPLETION_REPORT',
        completionNote: 'done'
      });
      expect(await screen.findByText(/refused/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'この通知を閉じる' }));
      await waitFor(() => expect(screen.queryByText(/refused/)).toBeNull());
      expect(screen.getByTestId('count').textContent).toBe('1');
    })();
  });
});

describe('correction after a definite refusal', () => {
  it('sends exactly one corrected attempt with a new identity and completes', async () => {
    const calls: Call[] = [];
    let attemptCount = 0;
    vi.stubGlobal(
      'fetch',
      record(calls, (body) => {
        attemptCount += 1;
        // The first attempt is refused; the corrected one is acknowledged.
        if (attemptCount === 1) return failure('VALIDATION_FAILED', '完了メモを入力してください。');
        return success({
          requestId: 'REQ-CORRECTED',
          state: 'RECEIVED',
          requestType: 'COMPLETION_REPORT',
          taskId: String(body.taskId),
          submittedAt: '2026-11-11T12:00:00.000Z'
        });
      })
    );

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

    fireEvent.change(screen.getByLabelText('完了メモ（任意）'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: '申請を送信' }));
    expect(await screen.findByText(/完了メモを入力してください/)).toBeTruthy();
    // The draft is still editable after a definite refusal.
    const note = screen.getByLabelText('完了メモ（任意）') as HTMLTextAreaElement;
    expect(note.value).toBe('first');
    expect(note.disabled).toBe(false);

    fireEvent.change(note, { target: { value: 'corrected' } });
    fireEvent.click(screen.getByRole('button', { name: '申請を送信' }));

    expect(await screen.findByText(/REQ-CORRECTED/)).toBeTruthy();
    const sent = posts(calls);
    expect(sent).toHaveLength(2);
    const firstId = JSON.parse(sent[0]!.body!).clientRequestId;
    const secondId = JSON.parse(sent[1]!.body!).clientRequestId;
    // A corrected attempt is a new attempt: the refused identity is never reused with new content.
    expect(secondId).not.toBe(firstId);
    expect(JSON.parse(sent[1]!.body!).completionNote).toBe('corrected');
  });

  it('never sends twice for one click, and never resubmits a settled attempt', async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      record(calls, (body) =>
        success({
          requestId: 'REQ-ONCE',
          state: 'RECEIVED',
          requestType: 'COMPLETION_REPORT',
          taskId: String(body.taskId),
          submittedAt: '2026-11-11T12:00:00.000Z'
        })
      )
    );

    function Host(): JSX.Element {
      const [open, setOpen] = useState(true);
      // The host mirrors a real screen: it shows the dialog's own outcome line, so the shell stays
      // quiet for an attempt the page has already reported.
      const [notice, setNotice] = useState('');
      return (
        <>
          <SubmissionNotices />
          {notice ? <p data-testid="page-notice">{notice}</p> : null}
          {open ? (
            <RequestDialog
              taskId="TSK-A"
              taskName="Alpha"
              projectName="Alpha"
              currentDeadline={null}
              requestType="COMPLETION_REPORT"
              submissionEnabled
              onClose={() => setOpen(false)}
              onResult={(result) => setNotice(result.text)}
            />
          ) : null}
        </>
      );
    }

    render(
      <I18nProvider>
        <Host />
      </I18nProvider>
    );
    fireEvent.change(screen.getByLabelText('完了メモ（任意）'), { target: { value: 'done' } });
    const button = screen.getByRole('button', { name: '申請を送信' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    // The acknowledgement closes the form; nothing can resubmit it.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/REQ-ONCE/)).toBeTruthy();
    // The page reported it, so the shell does not repeat the same message.
    expect(screen.getByTestId('page-notice').textContent).toContain('REQ-ONCE');
    expect(screen.queryAllByText(/REQ-ONCE/)).toHaveLength(1);
  });
});

describe('submission tracking after the dialog closes', () => {
  /**
   * A stateful host: Close really removes the dialog, while the shell notice stays mounted. The
   * dialog must be gone *before* the server answers, so the notice proves the tracker - not the
   * dialog - delivered the outcome.
   */
  function Host({ onCloseSpy }: { onCloseSpy: () => void }): JSX.Element {
    const [open, setOpen] = useState(true);
    return (
      <>
        <SubmissionNotices />
        {open ? (
          <RequestDialog
            taskId="TSK-A"
            taskName="Alpha"
            projectName="Alpha"
            currentDeadline={null}
            requestType="COMPLETION_REPORT"
            submissionEnabled
            onClose={() => {
              onCloseSpy();
              setOpen(false);
            }}
            onResult={() => undefined}
          />
        ) : (
          <p data-testid="dialog-gone">gone</p>
        )}
      </>
    );
  }

  it('reports a delayed success that arrives after the form was really removed', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => (release = resolve));
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
        if (method === 'POST' && url.endsWith('/api/employee/requests')) return gate;
        return success({ items: [] });
      })
    );
    const onCloseSpy = vi.fn();
    render(
      <I18nProvider>
        <Host onCloseSpy={onCloseSpy} />
      </I18nProvider>
    );

    fireEvent.change(screen.getByLabelText('完了メモ（任意）'), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: '申請を送信' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));

    fireEvent.click(screen.getAllByRole('button', { name: '閉じる' })[0]!);
    await waitFor(() => expect(screen.getByTestId('dialog-gone')).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();

    release(
      success({
        requestId: 'REQ-LATE',
        state: 'RECEIVED',
        requestType: 'COMPLETION_REPORT',
        taskId: 'TSK-A',
        submittedAt: '2026-11-11T12:00:00.000Z'
      })
    );

    expect(await screen.findByText(/REQ-LATE/)).toBeTruthy();
    expect(posts(calls)).toHaveLength(1);
  });

  it('keeps an uncertain outcome in the shell after navigation', async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
        if (method === 'POST' && url.endsWith('/api/employee/requests')) throw new TypeError('connection lost');
        return success({ items: [] });
      })
    );

    function Navigating(): JSX.Element {
      const [here, setHere] = useState<'form' | 'other'>('form');
      return (
        <>
          <SubmissionNotices />
          {here === 'form' ? (
            <>
              <button type="button" onClick={() => setHere('other')}>
                navigate
              </button>
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
            </>
          ) : (
            <p data-testid="other-screen">other</p>
          )}
        </>
      );
    }

    render(
      <I18nProvider>
        <Navigating />
      </I18nProvider>
    );
    fireEvent.change(screen.getByLabelText('完了メモ（任意）'), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: '申請を送信' }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    // Navigate away while the answer is outstanding.
    fireEvent.click(screen.getByRole('button', { name: 'navigate' }));
    await waitFor(() => expect(screen.getByTestId('other-screen')).toBeTruthy());

    expect(await screen.findByText(/送信結果不明/)).toBeTruthy();
    expect(posts(calls)).toHaveLength(1);
  });
});

describe('mutation completion independent of the editor', () => {
  it('applies the cache effect without any component observing the mutation', async () => {
    await queryCache.fetch('manager/tasks?page=1', async () => 'stale');
    const outcome = await commitMutation(async () => 'saved', ['manager/tasks']);
    expect(outcome.status).toBe('committed');
    expect(queryCache.peek<string>('manager/tasks?page=1').data).toBeUndefined();

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

  it('reports an ended session as superseded and performs no effect', async () => {
    await queryCache.fetch('manager/projects', async () => 'private');
    let resolveWrite!: () => void;
    const write = new Promise<void>((resolve) => (resolveWrite = resolve));
    const pending = commitMutation(() => write, ['manager/projects']);
    queryCache.clear();
    resolveWrite();
    const outcome = await pending;
    // The caller must handle this explicitly; it is never an ordinary success value.
    expect(outcome.status).toBe('superseded');
    expect(queryCache.peek<string>('manager/projects').data).toBeUndefined();
  });
});
