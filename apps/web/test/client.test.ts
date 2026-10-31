import { describe, expect, it, vi } from 'vitest';
import { api, ApiFailure, setCsrfToken, sessionEvents } from '../src/api/client';
import { queryCache } from '../src/state/cache';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('api client', () => {
  it('returns the envelope data and sends the CSRF header on mutations', async () => {
    setCsrfToken('csrf-1');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ ok: true, data: { value: 1 } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await api.post<{ value: number }>('/api/x', { a: 1 });
    expect(result.value).toBe(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1');
    expect(init.credentials).toBe('same-origin');
    vi.unstubAllGlobals();
  });

  it('classifies an authorization denial and emits one session-lost event', async () => {
    const listener = vi.fn();
    sessionEvents.addEventListener('session-lost', listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            error: {
              code: 'AUTHORIZATION_DENIED',
              message: 'denied',
              retryable: false,
              correlationId: 'c-1'
            }
          },
          403
        )
      )
    );
    await expect(api.get('/api/x')).rejects.toBeInstanceOf(ApiFailure);
    expect(listener).toHaveBeenCalledTimes(1);
    sessionEvents.removeEventListener('session-lost', listener);
    vi.unstubAllGlobals();
  });

  it('never treats a timeout or a network failure as a denial', async () => {
    const listener = vi.fn();
    sessionEvents.addEventListener('session-lost', listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('timeout');
      })
    );
    await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
    expect(listener).not.toHaveBeenCalled();
    sessionEvents.removeEventListener('session-lost', listener);
    vi.unstubAllGlobals();
  });

  it('reports an invalid response instead of an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    vi.unstubAllGlobals();
  });

  it('keeps an edit conflict distinct from a denial', async () => {
    const listener = vi.fn();
    sessionEvents.addEventListener('session-lost', listener);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            error: { code: 'EDIT_CONFLICT', message: 'stale', retryable: false, correlationId: 'c-2' }
          },
          409
        )
      )
    );
    const failure = await api.patch('/api/x', {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect((failure as ApiFailure).isConflict).toBe(true);
    expect((failure as ApiFailure).isDenied).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    sessionEvents.removeEventListener('session-lost', listener);
    vi.unstubAllGlobals();
  });
});

describe('query cache', () => {
  it('deduplicates an in-flight read', async () => {
    let calls = 0;
    const loader = async (): Promise<number> => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 42;
    };
    const [a, b] = await Promise.all([
      queryCache.fetch('dedupe', loader),
      queryCache.fetch('dedupe', loader)
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
  });

  it('supersedes an in-flight read when a newer save invalidates the prefix', async () => {
    let release: (value: string) => void = () => undefined;
    const slow = new Promise<string>((resolve) => {
      release = resolve;
    });
    const pending = queryCache.fetch('tasks/slow', () => slow);
    queryCache.invalidate(['tasks']);
    release('stale');
    await pending;
    expect(queryCache.peek<string>('tasks/slow').data).toBeUndefined();
    const fresh = await queryCache.fetch('tasks/slow', async () => 'fresh');
    expect(fresh).toBe('fresh');
    expect(queryCache.peek<string>('tasks/slow').data).toBe('fresh');
  });

  it('invalidates in-flight keys even when no payload was cached yet', async () => {
    const generationBefore = queryCache.generation;
    queryCache.invalidate(['tasks']);
    expect(queryCache.generation).toBeGreaterThan(generationBefore);
  });
});
