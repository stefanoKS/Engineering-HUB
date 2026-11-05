// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Actor } from '@eh/contracts';
import { api } from '../src/api/client';
import { I18nProvider } from '../src/i18n';
import { TimelineScreen } from '../src/screens/Timeline';
import { calendarMonthWindow } from '../src/components/timeline-dates';
import { queryCache } from '../src/state/cache';

const actor: Actor = {
  memberId: 'MEM-TEST', name: 'Test', email: 'test@example.invalid', role: 'VIEWER',
  active: true, verified: true, selfServiceEnabled: false
};
const row = {
  projectId: 'PRJ-TEST', projectName: 'Synthetic project', responsibilityId: null,
  responsibilityName: '', status: 'Active', plannedStart: '2026-11-05', forecastEnd: null,
  committedDeadline: '2026-11-20', progressPercent: null, openWork: 1, completedWork: 0,
  childRange: { start: null, end: null, datedItems: 0, totalItems: 0 }, undated: false
  , scheduleStart: '2026-11-05', scheduleFinish: '2026-11-20', dateState: 'RANGE', dateSource: 'EXPLICIT'
};
const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 25,
  total: items.length,
  totalPages: 1,
  responsibilities: [],
  fitRange: items.length ? { start: '2026-11-05', end: '2026-11-20' } : null
});

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('timeline asynchronous chart', () => {
  it('hides a folder task until its own chevron is expanded', async () => {
    const branch = {
      project: row,
      subprojects: [{
        subprojectId: 'SUB-TEST', projectId: row.projectId, parentSubprojectId: null,
        subprojectName: 'Synthetic folder', status: 'Active', plannedStart: null, plannedEnd: null,
        deadline: null, depth: 1, childRange: row.childRange, undated: true
      }],
      tasks: [{
        taskId: 'TASK-TEST', projectId: row.projectId, subprojectId: 'SUB-TEST', parentTaskId: null,
        taskName: 'Synthetic folder task', status: 'Not Started', displayStatus: 'IN_PROGRESS',
        plannedStart: null, dueDate: '2026-11-20', completedAt: null, container: false,
        depth: 1, progressPercent: 0, childRange: row.childRange, undated: false, inconsistent: false
      }],
      truncated: false, taskTotal: 1
    };
    vi.spyOn(api, 'get').mockImplementation((url) =>
      Promise.resolve(url.startsWith('/api/work/timeline?projectId=') ? branch : page(url.startsWith('/api/work/timeline') ? [row] : []))
    );
    render(<I18nProvider><TimelineScreen actor={actor} initialAnchor="2026-11-05" /></I18nProvider>);
    await screen.findAllByText('Synthetic project');
    fireEvent.click(screen.getByRole('button', { name: '展開' }));
    await waitFor(() => expect(document.querySelector('.tl-kind-subproject .tl-label')?.textContent).toBe('Synthetic folder'));
    expect(document.querySelector('.tl-kind-task .tl-label')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展開' }));
    expect(document.querySelector('.tl-kind-task .tl-label')?.textContent).toBe('Synthetic folder task');
    const toggles = screen.getAllByRole('button', { name: '折りたたむ' });
    fireEvent.click(toggles[1]!);
    fireEvent.click(toggles[0]!);
  });

  it('observes after delayed data, reattaches after empty results and keeps presets read-only', async () => {
    let resolveOverview!: (value: unknown) => void;
    let pending = true;
    let items: unknown[] = [row, { ...row, projectId: 'PRJ-START', projectName: 'Start only', committedDeadline: null }];
    const calls: string[] = [];
    const writes = (['post', 'patch', 'put', 'del'] as const).map((method) => vi.spyOn(api, method));
    vi.spyOn(api, 'get').mockImplementation((url) => {
      calls.push(url);
      if (url.startsWith('/api/work/timeline')) {
        if (pending) return new Promise((resolve) => { resolveOverview = resolve; });
        return Promise.resolve(page(items));
      }
      return Promise.resolve(page([]));
    });
    let width = 700;
    const observers: { callback: ResizeObserverCallback; disconnected: boolean; observe: ReturnType<typeof vi.fn> }[] = [];
    class Observer {
      record: (typeof observers)[number];
      observe: ReturnType<typeof vi.fn>;
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, disconnected: false, observe: vi.fn() };
        this.observe = this.record.observe;
        observers.push(this.record);
      }
      disconnect() { this.record.disconnected = true; }
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', Observer);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 40, width: this.classList.contains('tl-axis') ? width : 0, height: 40, toJSON: () => ({}) };
    });
    const view = render(<I18nProvider><TimelineScreen actor={actor} initialAnchor="2026-11-05" /></I18nProvider>);
    expect(document.querySelector('.tl-axis')).toBeNull();
    await waitFor(() => expect(resolveOverview).toBeDefined());
    await act(async () => { pending = false; resolveOverview(page(items)); });
    await waitFor(() => expect(document.querySelectorAll('.tl-scale-cell').length).toBeGreaterThan(0));
    expect(document.querySelector('.tl-bar')?.getAttribute('title')).toContain('2026-11-05');
    expect(document.querySelector('.tl-start')).toBeNull();
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '7日間' }));
    expect(screen.getByLabelText('表示開始日')).toHaveProperty('value', '2026-11-01');
    expect(screen.getByLabelText('表示終了日')).toHaveProperty('value', '2026-11-07');
    fireEvent.change(screen.getByLabelText('表示開始日'), { target: { value: '2026-11-05' } });
    expect(screen.getByLabelText('表示終了日')).toHaveProperty('value', '2026-11-11');
    fireEvent.change(screen.getByLabelText('表示終了日'), { target: { value: '2026-11-20' } });
    expect(screen.getByRole('button', { name: 'カスタム' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText('表示開始日'), { target: { value: '' } });
    expect(screen.getByText(/2026-11-05 – 2026-11-20/)).toBeTruthy();
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, altKey: true });
    document.querySelector('.tl-cell-track')?.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '2週間' }));
    expect(screen.getByLabelText('表示開始日')).toHaveProperty('value', '2026-11-05');
    expect(screen.getByLabelText('表示終了日')).toHaveProperty('value', '2026-11-18');
    fireEvent.click(screen.getByRole('button', { name: '全体を表示' }));
    expect(screen.getByRole('button', { name: 'カスタム' }).getAttribute('aria-pressed')).toBe('true');
    const completed = screen.getByRole('checkbox', { name: '完了した作業も表示' });
    fireEvent.click(completed);
    fireEvent.click(screen.getByRole('button', { name: '表示期間をリセット' }));
    expect(screen.getByLabelText('表示開始日')).toHaveProperty('value', calendarMonthWindow().from);
    expect(screen.getByLabelText('表示終了日')).toHaveProperty('value', calendarMonthWindow().to);
    expect(completed).not.toHaveProperty('checked', true);

    width = 480;
    act(() => observers[0]?.callback([], {} as ResizeObserver));
    await waitFor(() => expect(document.querySelector('.tl-axis')?.getBoundingClientRect().width).toBe(480));
    items = [];
    act(() => queryCache.invalidate(['work/timeline:overview']));
    await waitFor(() => expect(document.querySelector('.tl-axis')).toBeNull());
    expect(observers[0]?.disconnected).toBe(true);
    items = [row];
    act(() => queryCache.invalidate(['work/timeline:overview']));
    await waitFor(() => expect(document.querySelectorAll('.tl-scale-cell').length).toBeGreaterThan(0));
    expect(observers.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((url) => url.startsWith('/api/work/'))).toBe(true);
    writes.forEach((write) => expect(write).not.toHaveBeenCalled());
    view.unmount();
    expect(observers[1]?.disconnected).toBe(true);
    act(() => observers[1]?.callback([], {} as ResizeObserver));
    const reopened = render(<I18nProvider><TimelineScreen actor={actor} /></I18nProvider>);
    await waitFor(() => expect(document.querySelectorAll('.tl-scale-cell').length).toBeGreaterThan(0));
    const newest = observers.at(-1);
    expect(newest).toBeDefined();
    reopened.unmount();
    expect(newest?.disconnected).toBe(true);
  });
});
