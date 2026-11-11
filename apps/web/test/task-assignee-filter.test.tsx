// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Actor } from '@eh/contracts';
import { I18nProvider, useI18n } from '../src/i18n';
import { TasksScreen } from '../src/screens/Tasks';
import { queryCache } from '../src/state/cache';

const actor: Actor = { memberId: 'VIEW', name: 'Viewer', email: '', role: 'VIEWER', active: true, verified: true, selfServiceEnabled: false };
const response = (data: unknown): Response => new Response(JSON.stringify({ ok: true, data }), { status: 200 });
const task = (taskId: string, name: string, parentTaskId: string | null, container: boolean, contextOnly = false) => ({
  taskId, taskName: name, parentTaskId, container, contextOnly, projectId: 'P', projectName: 'Project',
  depth: parentTaskId ? 2 : 1, status: 'In Progress', displayStatus: 'IN_PROGRESS', ownerName: 'Owner',
  assigneeNames: [], dueDate: null, reviewState: 'NONE', revision: 1
});

function LanguageButton(): JSX.Element {
  const { setLanguage } = useI18n();
  return <button type="button" onClick={() => setLanguage('en')}>English</button>;
}

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('task assignee selector', () => {
  it('defaults to all, passes the selected stable ID to list and branches, and preserves it in English', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(String(input), 'http://localhost');
      calls.push(url.pathname + url.search);
      if (url.pathname === '/api/work/task-assignees') return response({
        items: [
          { memberId: 'M1', name: 'Same', active: true, divisionNames: ['設計・開発課'] },
          { memberId: 'M2', name: 'Same', active: false, divisionNames: ['生産・技術課'] }
        ],
        total: 2, page: 1, pageSize: 25, totalPages: 1
      });
      if (url.pathname === '/api/work/projects') return response({ items: [], responsibilities: [], total: 0, totalPages: 0 });
      if (url.pathname === '/api/work/tasks') {
        const selected = url.searchParams.get('assigneeMemberId');
        const parent = url.searchParams.get('treeParentId');
        const items = parent ? [task('CHILD', 'Matching child', 'PARENT', false)] :
          [task('PARENT', selected ? 'Context parent' : 'Unfiltered parent', null, true, !!selected)];
        return response({ items, matchedTotal: 1, total: 1, page: 1, pageSize: 25, totalPages: 1 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const view = render(<I18nProvider><LanguageButton /><TasksScreen actor={actor} readOnly /></I18nProvider>);
    await screen.findByText('Unfiltered parent');
    const selector = await screen.findByRole('combobox', { name: '担当者' }) as HTMLSelectElement;
    expect(selector.value).toBe('');
    // The stable ID stays the option value; the label never shows it, and the division name tells
    // two people who share a display name apart.
    expect(within(selector).getByRole('option', { name: 'Same — 設計・開発課' })).toBeTruthy();
    expect(within(selector).getByRole('option', { name: 'Same — 生産・技術課 (無効)' })).toBeTruthy();
    // The stable identifier stays the option value (a request parameter), never the visible label.
    expect([...selector.options].map(option => option.textContent).join(' ')).not.toContain('M1');
    expect(calls.some(url => url.includes('/api/work/tasks?') && !url.includes('assigneeMemberId'))).toBe(true);
    fireEvent.change(selector, { target: { value: 'M2' } });
    await screen.findByText('Context parent');
    expect(screen.getByText('階層表示のみ')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Context parent/ }));
    await screen.findByText('Matching child');
    expect(calls.some(url => url.includes('treeParentId=PARENT') && url.includes('assigneeMemberId=M2'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect((screen.getByRole('combobox', { name: 'Assignee' }) as HTMLSelectElement).value).toBe('M2');
    expect(screen.getByText('Hierarchy context only')).toBeTruthy();
    view.unmount();
    render(<I18nProvider><LanguageButton /><TasksScreen actor={actor} readOnly /></I18nProvider>);
    expect((await screen.findByRole('combobox', { name: 'Assignee' }) as HTMLSelectElement).value).toBe('M2');
    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee' }), { target: { value: '' } });
    await waitFor(() => expect(screen.getByText('Unfiltered parent')).toBeTruthy());
  });

  it('resets page on selection and does not paint a late answer from the previous filter', async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(String(input), 'http://localhost');
      calls.push(url.pathname + url.search);
      if (url.pathname === '/api/work/task-assignees') return response({
        items: [{ memberId: 'M1', name: 'One', active: true }, { memberId: 'M2', name: 'Two', active: true }],
        total: 2, page: 1, pageSize: 25, totalPages: 1
      });
      if (url.pathname === '/api/work/projects') return response({ items: [], responsibilities: [], total: 0, totalPages: 0 });
      if (url.pathname === '/api/work/tasks') {
        const selected = url.searchParams.get('assigneeMemberId');
        if (selected === 'M1') return new Promise<Response>(resolve => { resolveOld = resolve; });
        const name = selected === 'M2' ? 'Current result' : `Page ${url.searchParams.get('page')}`;
        return response({ items: [task('ROW', name, null, false)], total: 2, matchedTotal: 2, page: Number(url.searchParams.get('page')), pageSize: 1, totalPages: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<I18nProvider><TasksScreen actor={actor} readOnly routeSearch="workState=OPEN" /></I18nProvider>);
    await screen.findByText('Page 1');
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByText('Page 2');
    const selector = screen.getByRole('combobox', { name: '担当者' }) as HTMLSelectElement;
    const user = userEvent.setup();
    selector.focus();
    expect(document.activeElement).toBe(selector);
    await user.selectOptions(selector, 'M1');
    await waitFor(() => expect(resolveOld).toBeDefined());
    await user.selectOptions(selector, 'M2');
    await screen.findByText('Current result');
    expect(calls.some(url => url.includes('assigneeMemberId=M2') && url.includes('page=1'))).toBe(true);
    await act(async () => { resolveOld?.(response({ items: [task('OLD', 'Stale result', null, false)], total: 1, matchedTotal: 1, page: 1, pageSize: 25, totalPages: 1 })); });
    expect(screen.queryByText('Stale result')).toBeNull();
    expect(screen.getByText('Current result')).toBeTruthy();
  });

  it('reports an invalid reference response instead of rendering an empty selector', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      if (url.includes('/api/work/task-assignees')) return response({});
      if (url.includes('/api/work/projects')) return response({ items: [], responsibilities: [], total: 0, totalPages: 0 });
      if (url.includes('/api/work/tasks')) return response({ items: [], total: 0, matchedTotal: 0, page: 1, pageSize: 25, totalPages: 0 });
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<I18nProvider><TasksScreen actor={actor} readOnly routeSearch="workState=OPEN" /></I18nProvider>);
    expect(await screen.findByText(/INVALID_RESPONSE/)).toBeTruthy();
  });
});
