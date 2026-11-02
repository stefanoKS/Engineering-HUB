import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('google-auth-library', () => ({ JWT: class { async authorize() { return { access_token: 'test-token' }; } } }));
import { GoogleCalendarTransport } from '../src/transports';
const transport = () => new GoogleCalendarTransport({ credentialsJson: JSON.stringify({ client_email: 'test@example.invalid', private_key: 'test' }), calendarId: 'test-calendar' });
const input = { eventId: null, identityKey: 'DEVELOPMENT:TASK:TSK-1', summary: 'Task', description: 'Due', startDate: '2026-11-01', endDate: '2026-11-01' };
afterEach(() => vi.unstubAllGlobals());
describe('Calendar ownership and retries', () => {
  it('uses a stable ID and an exclusive next-day end for a one-day event', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const result = await transport().upsertEvent(input);
    const body = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(result.eventId).toMatch(/^eh[0-9a-f]{64}$/);
    expect(body.end.date).toBe('2026-11-02');
    expect(body.id).toBe(result.eventId);
    expect(body.extendedProperties.private.engineeringHubIdentity).toBe(input.identityKey);
  });
  it('refuses a foreign event without issuing a write', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ etag: 'v1', extendedProperties: { private: { engineeringHubIdentity: 'another-app' } } })));
    vi.stubGlobal('fetch', fetcher);
    await expect(transport().upsertEvent({ ...input, eventId: 'foreign' })).rejects.toThrow('OWNERSHIP_REFUSED');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never recreates a missing linked event', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(transport().upsertEvent({ ...input, eventId: 'missing' })).rejects.toThrow('LINK_UNAVAILABLE');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recovers an insertion conflict only after verifying ownership, then uses an etag', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ etag: 'version-1', extendedProperties: { private: { engineeringHubIdentity: input.identityKey } } })))
      .mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await transport().upsertEvent(input);
    expect(fetcher.mock.calls[3]![1].headers['If-Match']).toBe('version-1');
    expect(fetcher.mock.calls[3]![1].method).toBe('PATCH');
  });
});
