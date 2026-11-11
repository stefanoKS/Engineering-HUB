// @vitest-environment jsdom
/**
 * The overview follows the shell's division switch.
 *
 * Both overview variants must request, cache and render one scope: the cards, the lists and the
 * drilldown links. A late answer from an older selection must never repaint the newer one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Actor } from '@eh/contracts';
import { I18nProvider } from '../src/i18n';
import { OverviewScreen } from '../src/screens/Overview';
import { DivisionScopeBar } from '../src/components/DivisionScopeBar';
import { clearDivisionScope, setDivisionScope } from '../src/state/division';
import { queryCache } from '../src/state/cache';

const MANAGER: Actor = {
  memberId: 'MEM-1',
  name: 'Manager',
  email: 'manager@example.invalid',
  role: 'MANAGER',
  active: true,
  verified: true,
  selfServiceEnabled: true
};

const DEV = 'DIV-DEV';
const ENG = 'DIV-ENG';

const response = (data: unknown): Response => new Response(JSON.stringify({ ok: true, data }));

function overview(openWork: number) {
  return {
    scope: { responsibilityId: '', unassigned: false, label: '' },
    counts: {
      workItems: openWork,
      containers: 0,
      activeWork: openWork,
      openWork,
      overdueWork: 0,
      completedWork: 0,
      cancelledWork: 0
    },
    upcomingWindow: { days: 7, from: '2026-11-04', to: '2026-11-10' },
    overdue: [],
    overdueTotal: 0,
    upcoming: [],
    upcomingTotal: 0,
    responsibilities: [],
    projects: [],
    pendingRequests: [],
    generatedAt: '2026-11-04T00:00:00.000Z'
  };
}

const COUNTS: Record<string, number> = { all: 5, [DEV]: 2, [ENG]: 3 };

const ADMIN: Actor = { ...MANAGER, memberId: 'MEM-9', name: 'Admin', role: 'ADMIN' };

/** The smallest payload that satisfies the mapping preview contract the banner validates against. */
function unmappedView(projects: number, responsibilities: number) {
  return {
    counts: {
      responsibilities,
      projects,
      archivedResponsibilities: 0,
      archivedProjects: 0,
      tasks: 0,
      subprojects: 0
    },
    items: [],
    page: 1,
    pageSize: 1,
    total: projects + responsibilities,
    totalPages: 1,
    selection: { divisionId: null, responsibilityIds: [], projectIds: [] },
    divisions: [{ divisionId: DEV, name: '設計・開発課' }],
    backup: { required: true, verified: false, backupId: null, createdAt: null, message: 'No verified backup' },
    batchLimit: 100,
    generatedAt: '2026-11-04T00:00:00.000Z'
  };
}

function scopeState() {
  setDivisionScope({
    readable: [
      { divisionId: DEV, name: '設計・開発課', status: 'Active' },
      { divisionId: ENG, name: '設計・技術課', status: 'Active' }
    ],
    writable: [{ divisionId: DEV, name: '設計・開発課', status: 'Active' }],
    allDivisions: false
  });
}

beforeEach(() => {
  queryCache.clear();
  scopeState();
});

afterEach(() => {
  cleanup();
  queryCache.clear();
  clearDivisionScope();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

function stubOverview(handler?: (url: string) => Promise<Response> | undefined) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/bootstrap')) {
        return response({
          references: {
            responsibilities: [
              { id: 'RSP-DEV', name: '開発分野', status: 'Active', divisionId: DEV },
              { id: 'RSP-ENG', name: '技術分野', status: 'Active', divisionId: ENG }
            ]
          }
        });
      }
      const custom = handler?.(url);
      if (custom) return custom;
      const division = url.includes(`divisionId=${DEV}`)
        ? DEV
        : url.includes(`divisionId=${ENG}`)
          ? ENG
          : 'all';
      return response(overview(COUNTS[division]!));
    })
  );
  return { calls };
}

function renderOverview() {
  return render(
    <I18nProvider>
      <DivisionScopeBar />
      <OverviewScreen actor={MANAGER} />
    </I18nProvider>
  );
}

describe('overview division scope', () => {
  it('requests the selected division and keeps cards, lists and drilldowns in one scope', async () => {
    const { calls } = stubOverview();
    renderOverview();
    // The aggregate read scope first: no division identifier at all.
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 5' })).toBeTruthy());
    expect(calls.filter((url) => url.includes('/api/manager/overview')).some((url) => url.includes('divisionId='))).toBe(false);

    const select = screen.getByLabelText('表示する課') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: DEV } });
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 2' })).toBeTruthy());
    expect(calls.some((url) => url.includes(`/api/manager/overview`) && url.includes(`divisionId=${DEV}`))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '未完了の作業: 2' }));
    expect(window.location.hash).toBe(`#/all-work?workState=OPEN&divisionId=${DEV}`);

    fireEvent.change(select, { target: { value: ENG } });
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 3' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '期限超過: 0' }));
    expect(window.location.hash).toBe(`#/all-work?displayStatus=OVERDUE&divisionId=${ENG}`);

    // Back to the aggregate read scope: the authorized total returns.
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 5' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '完了（履歴）: 0' }));
    expect(window.location.hash).toBe('#/all-work?displayStatus=DONE');
  });

  it('requests only a division the caller may read', async () => {
    const { calls } = stubOverview();
    renderOverview();
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 5' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('表示する課'), { target: { value: DEV } });
    await waitFor(() => expect(calls.some((url) => url.includes(`divisionId=${DEV}`))).toBe(true));
    const requested = calls
      .map((url) => /divisionId=([^&]+)/.exec(url)?.[1])
      .filter((value): value is string => !!value);
    expect(requested.every((divisionId) => divisionId === DEV)).toBe(true);
  });

  it('clears a responsibility that the newly selected division does not contain', async () => {
    stubOverview();
    renderOverview();
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 5' })).toBeTruthy());
    const responsibility = screen.getByLabelText('表示範囲') as HTMLSelectElement;
    fireEvent.change(screen.getByLabelText('表示する課'), { target: { value: DEV } });
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 2' })).toBeTruthy());
    fireEvent.change(responsibility, { target: { value: 'RSP-DEV' } });
    await waitFor(() => expect(responsibility.value).toBe('RSP-DEV'));

    fireEvent.change(screen.getByLabelText('表示する課'), { target: { value: ENG } });
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 3' })).toBeTruthy());
    const afterSwitch = screen.getByLabelText('表示範囲') as HTMLSelectElement;
    expect(afterSwitch.value).toBe('');
  });

  it('cannot repaint with a late answer from an older selection', async () => {
    let releaseDev: () => void = () => undefined;
    const devGate = new Promise<void>((resolve) => {
      releaseDev = resolve;
    });
    stubOverview((url) => {
      if (url.includes(`/api/manager/overview`) && url.includes(`divisionId=${DEV}`)) {
        return devGate.then(() => response(overview(COUNTS[DEV]!)));
      }
      return undefined;
    });
    renderOverview();
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 5' })).toBeTruthy());

    fireEvent.change(screen.getByLabelText('表示する課'), { target: { value: DEV } });
    fireEvent.change(screen.getByLabelText('表示する課'), { target: { value: ENG } });
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 3' })).toBeTruthy());

    // The older answer arrives after the newer one; it owns a different cache key and must not
    // replace what the current selection renders.
    releaseDev();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole('button', { name: '未完了の作業: 3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '未完了の作業: 2' })).toBeNull();
  });
});

describe('overview unmapped remediation hint', () => {
  it('tells an ADMIN how many records still have no division', async () => {
    stubOverview((url) =>
      url.includes('/api/admin/divisions/unmapped')
        ? Promise.resolve(response(unmappedView(2, 1)))
        : undefined
    );
    render(
      <I18nProvider>
        <OverviewScreen actor={ADMIN} />
      </I18nProvider>
    );
    expect(await screen.findByText(/課が未設定の記録が 3 件あります/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '未分類の割り当てを開く' }).getAttribute('href')).toBe('#/divisions');
    // The hint is additive: the aggregate figures keep their own authorized read scope.
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 5' })).toBeTruthy());
  });

  it('shows nothing when every record is mapped', async () => {
    stubOverview((url) =>
      url.includes('/api/admin/divisions/unmapped')
        ? Promise.resolve(response(unmappedView(0, 0)))
        : undefined
    );
    render(
      <I18nProvider>
        <OverviewScreen actor={ADMIN} />
      </I18nProvider>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 5' })).toBeTruthy());
    expect(screen.queryByText(/課が未設定の記録が/)).toBeNull();
  });

  it('never asks a non-ADMIN account about unmapped work', async () => {
    const { calls } = stubOverview();
    renderOverview();
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 5' })).toBeTruthy());
    expect(calls.some((url) => url.includes('/api/admin/divisions/unmapped'))).toBe(false);
    expect(screen.queryByText(/課が未設定の記録が/)).toBeNull();
  });

  it('keeps the overview readable when the remediation read is invalid', async () => {
    stubOverview((url) =>
      url.includes('/api/admin/divisions/unmapped')
        ? Promise.resolve(response({ counts: { projects: 'many' } }))
        : undefined
    );
    render(
      <I18nProvider>
        <OverviewScreen actor={ADMIN} />
      </I18nProvider>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了の作業: 5' })).toBeTruthy());
    expect(screen.queryByText(/課が未設定の記録が/)).toBeNull();
  });
});
