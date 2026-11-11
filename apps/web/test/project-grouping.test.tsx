// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { ProjectTable, type ProjectRowView } from '../src/components/project-table';

const row = (id: string, area: string | null, progress: number | null): ProjectRowView => ({
  projectId: id,
  projectName: id,
  responsibilityId: area,
  responsibilityName: area ? 'Design' : '',
  schedule: { state: 'IN_PROGRESS', missing: 'NONE' },
  priority: 'Medium',
  committedDeadline: null,
  progressPercent: progress,
  openWork: 1,
  overdueWork: 0
});

afterEach(cleanup);

describe('project grouping', () => {
  it('uses the whole-scope total, hides the redundant column, and collapses with a button', () => {
    const toggle = vi.fn();
    const props = {
      items: [row('PRJ-A', 'R-1', 42), row('PRJ-B', null, null)],
      groupTotals: [{ responsibilityId: 'R-1', total: 8 }, { responsibilityId: null, total: 1 }],
      grouped: true,
      sort: 'name' as const,
      direction: 'asc' as const,
      onSort: vi.fn(),
      collapsedGroups: new Set<string>(),
      onToggleGroup: toggle,
      showActions: false
    };
    const renderTable = (collapsedGroups: Set<string>, grouped = true) => (
      <I18nProvider><ProjectTable {...props} grouped={grouped} collapsedGroups={collapsedGroups} /></I18nProvider>
    );
    const { rerender } = render(renderTable(new Set()));
    expect(document.querySelectorAll('thead th')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /分野/ }));
    expect(props.onSort).toHaveBeenCalledWith('responsibility');
    const heading = screen.getByRole('button', { name: /Design.*8 件/ });
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/続きは他のページ/)).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(within(screen.getByText('PRJ-B').closest('tr') as HTMLElement).queryByText('0%')).toBeNull();
    fireEvent.click(heading);
    expect(toggle).toHaveBeenCalledWith('R-1');
    rerender(renderTable(new Set(['R-1'])));
    expect(screen.queryByText('PRJ-A')).toBeNull();
    expect(screen.getByRole('button', { name: /Design.*8 件/ }).getAttribute('aria-expanded')).toBe('false');
    rerender(renderTable(new Set(), false));
    expect(screen.getAllByText('Design').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('thead th')).toHaveLength(5);
  });

  it('keeps area and project colors stable when the page order changes', () => {
    const props = {
      groupTotals: [{ responsibilityId: 'R-1', total: 2 }],
      grouped: true,
      sort: 'name' as const,
      direction: 'asc' as const,
      onSort: vi.fn(),
      collapsedGroups: new Set<string>(),
      onToggleGroup: vi.fn(),
      showActions: false
    };
    const view = (items: ProjectRowView[]) => <I18nProvider><ProjectTable {...props} items={items} /></I18nProvider>;
    const { rerender } = render(view([row('PRJ-A', 'R-1', 10), row('PRJ-B', 'R-1', 20)]));
    const areaStyle = document.querySelector('.project-group-heading')?.getAttribute('style');
    const projectStyle = screen.getByText('PRJ-A').closest('tr')?.getAttribute('style');
    rerender(view([row('PRJ-B', 'R-1', 20), row('PRJ-A', 'R-1', 10)]));
    expect(document.querySelector('.project-group-heading')?.getAttribute('style')).toBe(areaStyle);
    expect(screen.getByText('PRJ-A').closest('tr')?.getAttribute('style')).toBe(projectStyle);
  });
});
