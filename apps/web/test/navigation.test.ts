// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@eh/contracts';

const ADMIN = {
  memberId: 'A',
  name: 'Admin',
  email: 'admin@example.invalid',
  role: 'ADMIN',
  active: true,
  verified: true,
  selfServiceEnabled: true
} as Actor;
const MEMBER = { ...ADMIN, memberId: 'M', name: 'Member', role: 'MEMBER' } as Actor;

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, '', '#/overview');
});

describe('smart back navigation', () => {
  it.each([
    ['projects', 'project/P1'],
    ['project/P1', 'task/T1'],
    ['all-work', 'task/T1'],
    ['my-work', 'task/T1']
  ])('returns from %s -> %s with browser history', async (origin, detail) => {
    const navigation = await import('../src/state/navigation');
    navigation.recordRoute(origin);
    window.history.pushState({}, '', `#/${detail}`);
    navigation.recordRoute(detail);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    navigation.backOrFallback(ADMIN, detail.startsWith('project/') ? 'projects' : 'all-work');

    expect(back).toHaveBeenCalledOnce();
  });

  it('replaces a direct task URL with the role-authorized fallback', async () => {
    const navigation = await import('../src/state/navigation');
    window.history.replaceState({}, '', '#/task/T1');
    navigation.recordRoute('task/T1');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    navigation.backOrFallback(MEMBER, 'all-work');

    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/all-work');
  });

  it('falls back to the member project explorer for a directly opened project', async () => {
    const navigation = await import('../src/state/navigation');
    window.history.replaceState({}, '', '#/project/P1');
    navigation.recordRoute('project/P1');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    navigation.backOrFallback(MEMBER, 'projects');

    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/projects');
    back.mockRestore();
  });

  it('never sends a member back to a manager-only route', async () => {
    const navigation = await import('../src/state/navigation');
    navigation.recordRoute('requests');
    window.history.pushState({}, '', '#/task/T1');
    navigation.recordRoute('task/T1');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    navigation.backOrFallback(MEMBER, 'all-work');

    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/all-work');
    expect(navigation.routeAllowed('requests', MEMBER)).toBe(false);
    expect(navigation.routeAllowed('members', MEMBER)).toBe(false);
    // The read-only project explorer is a member route; the management list is not.
    expect(navigation.routeAllowed('projects', MEMBER)).toBe(true);
    expect(navigation.routeAllowed('projects/P1', MEMBER)).toBe(true);
    expect(navigation.routeAllowed('project/P1', MEMBER)).toBe(true);
    expect(navigation.routeAllowed('https://example.invalid', ADMIN)).toBe(false);
  });

  it('keeps route-scoped scroll state in memory only', async () => {
    const navigation = await import('../src/state/navigation');
    navigation.rememberScroll('project/P1', 640);
    expect(navigation.rememberedScroll('project/P1')).toBe(640);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
