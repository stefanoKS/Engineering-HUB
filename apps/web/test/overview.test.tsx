// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Actor } from '@eh/contracts';
import { I18nProvider } from '../src/i18n';
import { OverviewScreen } from '../src/screens/Overview';
import { taskNavigationFilters } from '../src/screens/Tasks';
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

const response = (data: unknown): Response => new Response(JSON.stringify({ ok: true, data }));

function overview(days: 7 | 14 | 30) {
  return {
    scope: { responsibilityId: '', unassigned: false, label: '' },
    counts: {
      workItems: 3,
      containers: 1,
      activeWork: 2,
      openWork: 2,
      overdueWork: 1,
      completedWork: 1,
      cancelledWork: 0
    },
    upcomingWindow: { days, from: '2026-11-04', to: days === 7 ? '2026-11-10' : '2026-12-03' },
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

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
});

describe('overview navigation and period state', () => {
  it('defaults to seven days, remembers a selection and maps KPI cards to explicit filters', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/bootstrap')) {
        return response({ references: { responsibilities: [{ id: 'RSP-1', name: 'Design', status: 'Active' }] } });
      }
      const days = url.includes('upcomingDays=30') ? 30 : 7;
      return response(overview(days));
    }));

    const first = render(<I18nProvider><OverviewScreen actor={MANAGER} /></I18nProvider>);
    await waitFor(() => expect(calls.some((url) => url.includes('upcomingDays=7'))).toBe(true));
    const period = screen.getByLabelText('表示期間') as HTMLSelectElement;
    expect(period.value).toBe('7');
    fireEvent.change(period, { target: { value: '30' } });
    await waitFor(() => expect(calls.some((url) => url.includes('upcomingDays=30'))).toBe(true));

    first.unmount();
    render(<I18nProvider><OverviewScreen actor={MANAGER} /></I18nProvider>);
    expect((await screen.findByLabelText('表示期間') as HTMLSelectElement).value).toBe('30');

    fireEvent.change(screen.getByLabelText('表示範囲'), { target: { value: 'RSP-1' } });
    fireEvent.click(await screen.findByRole('button', { name: '未完了の作業: 2' }));
    expect(window.location.hash).toBe('#/all-work?workState=OPEN&responsibilityId=RSP-1');
    fireEvent.click(screen.getByRole('button', { name: '期限超過: 1' }));
    expect(window.location.hash).toBe('#/all-work?displayStatus=OVERDUE&responsibilityId=RSP-1');
    fireEvent.click(screen.getByRole('button', { name: '完了（履歴）: 1' }));
    expect(window.location.hash).toBe('#/all-work?displayStatus=DONE&responsibilityId=RSP-1');
  });

  it('validates explicit All Work navigation filters and ignores unsupported values', () => {
    expect(taskNavigationFilters('workState=OPEN&responsibilityId=RSP-1')).toMatchObject({
      explicit: true,
      workState: 'OPEN',
      responsibilityId: 'RSP-1',
      unassigned: false
    });
    expect(taskNavigationFilters('displayStatus=UNKNOWN&unassigned=true')).toMatchObject({
      explicit: true,
      displayStatus: '',
      unassigned: true
    });
  });
});

describe('crimson theme', () => {
  it('uses the approved brand palette without changing semantic status colors', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles.css'), 'utf8').toLowerCase();
    expect(css).toContain('--ui-accent: #a8182f');
    expect(css).toContain('--ui-accent-hover: #871326');
    expect(css).toContain('--ui-accent-soft: #fbecef');
    expect(css).toContain('--ui-bg: #fcf7f8');
    expect(css).toContain('--info: #176b87');
    expect(css).toContain('--green: #13745c');
    expect(css).not.toContain('#4f46e5');
    expect(css).not.toContain('#6366f1');
  });
});
