// @vitest-environment jsdom
/**
 * The project screen shows the derived schedule status and keeps table layout intact.
 *
 * The reported defects: the stored "Active/On hold" dropdown drove the status column, and a
 * `display: flex` on a `<td>` broke the row separators. These cases pin the badge, the filter that
 * is sent to the server, the wrapped action cell and the absence of an editable status dropdown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Actor, ProjectSummary } from '@eh/contracts';
import { I18nProvider } from '../src/i18n';
import { ProjectsScreen } from '../src/screens/Projects';
import { queryCache } from '../src/state/cache';

const MANAGER: Actor = {
  memberId: 'MEM-MANAGER',
  name: 'Manager',
  email: 'manager@example.invalid',
  role: 'MANAGER',
  active: true,
  verified: true,
  selfServiceEnabled: false
};

const project = (overrides: Partial<ProjectSummary> = {}): ProjectSummary => ({
  projectId: 'PRJ-A',
  projectName: 'Alpha',
  responsibilityId: 'RSP-1',
  responsibilityName: '設計',
  projectOwnerId: 'MEM-MANAGER',
  status: 'Active',
  schedule: { state: 'LATE', missing: 'NONE' },
  priority: 'High',
  committedDeadline: '2026-10-01',
  deadlineState: 'OVERDUE',
  progressPercent: 40,
  health: 'RED',
  nextAction: 'Review the plan',
  dashboardVisibility: 'INTERNAL',
  containerCount: 0,
  openWork: 2,
  overdueWork: 1,
  revision: 1,
  ...overrides
});

const response = (data: unknown): Response =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const calls: string[] = [];

function stubApi(items: ProjectSummary[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/manager/references')) {
        return response({
          responsibilities: [{ id: 'RSP-1', name: '設計', status: 'Active' }],
          members: [{ memberId: 'MEM-MANAGER', name: 'Manager', active: true }]
        });
      }
      if (url.includes('/api/manager/projects')) {
        return response({
          items: items.map((item) => ({ ...item, _revision: item.revision })),
          total: items.length,
          groupTotals: [{ responsibilityId: 'RSP-1', total: items.length }],
          page: 1,
          pageSize: 25,
          totalPages: 1
        });
      }
      return response(null);
    })
  );
}

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  calls.length = 0;
  window.localStorage.clear();
});

describe('project list presentation', () => {
  it('shows the derived schedule badge instead of the stored lifecycle value', async () => {
    stubApi([project(), project({ projectId: 'PRJ-B', projectName: 'Beta', schedule: { state: 'IN_PROGRESS', missing: 'FINISH' } })]);
    render(
      <I18nProvider>
        <ProjectsScreen actor={MANAGER} />
      </I18nProvider>
    );
    await screen.findByText('Alpha');
    // The filter offers the same labels, so the assertion is scoped to the table itself.
    const table = within(document.querySelector('table') as HTMLElement);
    expect(table.getByText('遅延')).toBeTruthy();
    expect(table.getByText('進行中')).toBeTruthy();
  });

  it('keeps the table cell a table cell and puts the button row inside it', async () => {
    stubApi([project()]);
    render(
      <I18nProvider>
        <ProjectsScreen actor={MANAGER} />
      </I18nProvider>
    );
    await screen.findByText('Alpha');
    expect(document.querySelector('td.actions')).toBeNull();
    const cell = document.querySelector('td.project-actions-cell');
    expect(cell).not.toBeNull();
    expect(cell?.querySelector(':scope > div.actions')).not.toBeNull();
    expect(within(cell as HTMLElement).getByRole('button', { name: '編集' })).toBeTruthy();
  });

  it('sends the derived schedule filter to the server', async () => {
    stubApi([project()]);
    render(
      <I18nProvider>
        <ProjectsScreen actor={MANAGER} />
      </I18nProvider>
    );
    await screen.findByText('Alpha');
    const filter = document.querySelectorAll('.compact-toolbar select')[1] as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: 'LATE' } });
    await waitFor(() => expect(calls.some((url) => url.includes('schedule=LATE'))).toBe(true));
  });

  it('no longer offers Planned, In progress or On hold in the project form', async () => {
    stubApi([project()]);
    render(
      <I18nProvider>
        <ProjectsScreen actor={MANAGER} />
      </I18nProvider>
    );
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: '新規プロジェクト' }));
    const dialog = await screen.findByRole('dialog');
    const statusSelect = within(dialog)
      .getAllByRole('combobox')
      .find((element) => Array.from((element as HTMLSelectElement).options).some((option) => option.value === 'Planned'));
    expect(statusSelect).toBeUndefined();
    // A new project defaults to INTERNAL and can still be set to RESTRICTED.
    expect(within(dialog).getByText('社内公開 (INTERNAL)')).toBeTruthy();
    expect(within(dialog).getByText(/RESTRICTED/)).toBeTruthy();
  });
});
