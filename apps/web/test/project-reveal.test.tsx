// @vitest-environment jsdom
/**
 * Project structure reveal and assignee filter.
 *
 * One reveal operation serves the completion notice, the completed-count buttons and `?task=<id>`:
 * it resolves stable IDs, opens the right presentation, expands the ancestors it needs, clears a
 * filter that would hide the row (with a notice), and only then moves focus. A background refresh
 * never requests a reveal and therefore never steals focus. DOM ids are unique per presentation, so
 * a container that appears as context in both is addressable exactly once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import type { TaskSummary } from '@eh/contracts';
import { I18nProvider } from '../src/i18n';
import {
  buildProjectHierarchy,
  ProjectHierarchy,
  type HierarchySubproject
} from '../src/screens/ProjectDetail';
import { TaskAssigneePicker } from '../src/components/TaskAssigneePicker';
import { queryCache } from '../src/state/cache';

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
});

const response = (data: unknown): Response =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

function subproject(id: string, name: string): HierarchySubproject {
  return {
    subprojectId: id,
    subprojectName: name,
    parentSubprojectId: null,
    status: 'Active',
    schedule: { state: 'IN_PROGRESS', missing: 'NONE' },
    deadline: '2026-11-30',
    depth: 1,
    revision: 1
  };
}

function task(input: {
  taskId: string;
  taskName: string;
  subprojectId?: string | null;
  parentTaskId?: string | null;
  status?: string;
  container?: boolean;
}): TaskSummary {
  const status = input.status ?? 'In Progress';
  return {
    taskId: input.taskId,
    projectId: 'PRJ-A',
    projectName: 'Alpha',
    subprojectId: input.subprojectId ?? null,
    responsibilityId: null,
    parentTaskId: input.parentTaskId ?? null,
    taskName: input.taskName,
    status,
    displayStatus: status === 'Done' ? 'DONE' : 'IN_PROGRESS',
    priority: 'Medium',
    ownerMemberId: 'M-OWNER',
    ownerName: 'Owner',
    assigneeNames: ['Owner'],
    assigneeIds: ['M-OWNER'],
    dueDate: '2026-12-01',
    plannedStart: null,
    progressPercent: null,
    container: input.container ?? false,
    depth: 1,
    reviewState: 'NONE',
    overdue: false,
    deadlineState: 'OK',
    revision: 1
  } as unknown as TaskSummary;
}

type HarnessProps = {
  subprojects: HierarchySubproject[];
  tasks: TaskSummary[];
  focusTaskId?: string;
  initialQuery?: string;
  initialCollapsed?: string[];
};

function Harness(props: HarnessProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(props.initialCollapsed ?? []));
  const [query, setQuery] = useState(props.initialQuery ?? '');
  const [assignee, setAssignee] = useState('');
  const [open, setOpen] = useState(false);
  const hierarchy = useMemo(
    () =>
      buildProjectHierarchy({
        subprojects: props.subprojects,
        tasks: props.tasks,
        includeInactive: false,
        filter: { query, assigneeId: assignee }
      }),
    [props.subprojects, props.tasks, query, assignee]
  );
  return (
    <ProjectHierarchy
      hierarchy={hierarchy}
      canManage={false}
      canEditSubproject={false}
      canRemoveRecord={false}
      canCreateTask={false}
      canCreateSubproject={false}
      includeInactive={false}
      collapsed={collapsed}
      onToggle={(key) =>
        setCollapsed((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })
      }
      onExpand={(keys) =>
        setCollapsed((current) => {
          const next = new Set(current);
          for (const key of keys) next.delete(key);
          return next;
        })
      }
      onToggleInactive={() => undefined}
      onNewTask={() => undefined}
      onNewSubproject={() => undefined}
      onEditSubproject={() => undefined}
      onDelete={() => undefined}
      searchQuery={query}
      onSearchQueryChange={setQuery}
      assigneeId={assignee}
      onAssigneeChange={setAssignee}
      completedOpen={open}
      onCompletedOpenChange={setOpen}
      focusTaskId={props.focusTaskId}
    />
  );
}

const renderHarness = (props: HarnessProps) =>
  render(
    <I18nProvider>
      <Harness {...props} />
    </I18nProvider>
  );

const nestedProject = () => ({
  subprojects: [subproject('SUB-A', 'Area A')],
  tasks: [
    task({ taskId: 'C', taskName: 'Phase container', subprojectId: 'SUB-A', container: true }),
    task({ taskId: 'L', taskName: 'Deep leaf', subprojectId: 'SUB-A', parentTaskId: 'C' })
  ]
});

describe('one reveal operation', () => {
  it('expands collapsed ancestors and focuses the active row', async () => {
    renderHarness({ ...nestedProject(), focusTaskId: 'L', initialCollapsed: ['sub:SUB-A', 'task:C'] });
    await waitFor(() => expect(document.activeElement?.id).toBe('hierarchy-active-L'));
    expect(screen.getByText('Deep leaf')).toBeTruthy();
    // Only the requested branch is opened; expansion stays the user's to change afterwards.
    expect(screen.getByRole('button', { name: 'Area A を閉じる' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the completed presentation for a completed leaf under a container', async () => {
    renderHarness({
      subprojects: [subproject('SUB-A', 'Area A')],
      tasks: [
        task({ taskId: 'C', taskName: 'Done container', subprojectId: 'SUB-A', container: true, status: 'Done' }),
        task({ taskId: 'D-1', taskName: 'Finished leaf', subprojectId: 'SUB-A', parentTaskId: 'C', status: 'Done' })
      ],
      focusTaskId: 'D-1'
    });
    await waitFor(() => expect(document.activeElement?.id).toBe('hierarchy-completed-D-1'));
    expect(screen.getByRole('button', { name: '完了したタスク (1)' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('clears a filter that would exclude the target and says so', async () => {
    renderHarness({ ...nestedProject(), focusTaskId: 'L', initialQuery: 'no such task' });
    await waitFor(() => expect(document.activeElement?.id).toBe('hierarchy-active-L'));
    expect(screen.getByText('選択したタスクを表示するため、絞り込みを解除しました。')).toBeTruthy();
    expect((screen.getByRole('searchbox', { name: 'タスク名で検索' }) as HTMLInputElement).value).toBe('');
  });

  it('reports an unavailable task instead of pretending to reveal it', async () => {
    renderHarness({ ...nestedProject(), focusTaskId: 'MISSING' });
    await waitFor(() =>
      expect(screen.getByText('このタスクはこのプロジェクトで表示できません。')).toBeTruthy()
    );
    expect(document.getElementById('hierarchy-active-MISSING')).toBeNull();
  });

  it('never steals focus when a background refresh replaces the hierarchy', async () => {
    const base = nestedProject();
    const view = renderHarness({ ...base, focusTaskId: 'L' });
    await waitFor(() => expect(document.activeElement?.id).toBe('hierarchy-active-L'));
    const search = screen.getByRole('searchbox', { name: 'タスク名で検索' });
    search.focus();
    // A refresh hands over a new payload while the addressed task id stays the same.
    view.rerender(
      <I18nProvider>
        <Harness
          subprojects={base.subprojects}
          tasks={base.tasks.map((entry) => ({ ...entry }))}
          focusTaskId="L"
        />
      </I18nProvider>
    );
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    expect(document.activeElement).toBe(search);
  });

  it('uses a unique DOM id when a container appears in both presentations', () => {
    renderHarness({
      subprojects: [subproject('SUB-A', 'Area A')],
      tasks: [
        task({ taskId: 'C', taskName: 'Shared container', subprojectId: 'SUB-A', container: true, status: 'Done' }),
        task({ taskId: 'OPEN', taskName: 'Open child', subprojectId: 'SUB-A', parentTaskId: 'C' }),
        task({ taskId: 'DONE', taskName: 'Done child', subprojectId: 'SUB-A', parentTaskId: 'C', status: 'Done' })
      ]
    });
    fireEvent.click(screen.getByRole('button', { name: '完了したタスク (1)' }));
    expect(document.getElementById('hierarchy-active-C')).not.toBeNull();
    expect(document.getElementById('hierarchy-completed-C')).not.toBeNull();
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('searchable assignee filter', () => {
  function stubMembers(): ReturnType<typeof vi.fn> {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(String(input), 'http://localhost');
      const query = url.searchParams.get('query') ?? '';
      const page = Number(url.searchParams.get('page') ?? '1');
      const memberId = url.searchParams.get('memberId');
      const all = Array.from({ length: 26 }, (_, index) => ({
        memberId: `M-${String(index + 1).padStart(2, '0')}`,
        name: `Member ${String(index + 1).padStart(2, '0')}`,
        active: true
      }));
      if (memberId) {
        const found = all.filter((entry) => entry.memberId === memberId);
        return response({ items: found, total: found.length, page: 1, pageSize: 1, totalPages: 1 });
      }
      const matching = query
        ? all.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase()))
        : all;
      const pageSize = 25;
      const start = (page - 1) * pageSize;
      return response({
        items: matching.slice(start, start + pageSize),
        total: matching.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(matching.length / pageSize))
      });
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }

  it('reaches a member beyond the first page and submits the stable id', async () => {
    stubMembers();
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <TaskAssigneePicker value="" onChange={onChange} />
      </I18nProvider>
    );
    await screen.findByRole('option', { name: 'Member 25' });
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await screen.findByRole('option', { name: 'Member 26' });
    fireEvent.change(screen.getByRole('combobox', { name: '担当者' }), { target: { value: 'M-26' } });
    expect(onChange).toHaveBeenCalledWith('M-26');
  });

  it('keeps the selected member visible while a search narrows the options', async () => {
    stubMembers();
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <TaskAssigneePicker value="M-05" onChange={onChange} />
      </I18nProvider>
    );
    const select = screen.getByRole('combobox', { name: '担当者' }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('M-05'));
    fireEvent.change(screen.getByRole('searchbox', { name: '担当者を検索' }), { target: { value: 'Member 26' } });
    await screen.findByRole('option', { name: 'Member 26' });
    // The current selection survives paging and searching, and nothing is submitted by the search.
    expect(select.value).toBe('M-05');
    expect(within(select).getByRole('option', { name: 'Member 05' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
