// @vitest-environment jsdom
/**
 * Project structure: unfinished work stays in the active presentation and completed leaf work
 * moves into one collapsed section. These tests pin the model (leaf counting, containers,
 * cancelled work, filtering), the disclosure and reveal behaviour, the completion notice and the
 * fact that a failed completion never moves a task.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
}
import { useMemo, useState } from 'react';
import type { Actor, TaskSummary } from '@eh/contracts';
import { I18nProvider, useI18n } from '../src/i18n';
import {
  buildProjectHierarchy,
  ProjectDetailScreen,
  ProjectHierarchy,
  type HierarchySubproject,
  type TaskNode
} from '../src/screens/ProjectDetail';
import { TaskDetailScreen } from '../src/screens/TaskDetail';
import { queryCache } from '../src/state/cache';
import {
  currentMemoryEpoch,
  rememberCompletedTask,
  resetRouteMemory,
  takeCompletedTask
} from '../src/state/navigation';

afterEach(() => {
  cleanup();
  queryCache.clear();
  resetRouteMemory();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const response = (data: unknown): Response =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const refused = (code: string, message: string): Response =>
  new Response(
    JSON.stringify({ ok: false, error: { code, message, retryable: false, correlationId: 'c1' } }),
    { status: 500, headers: { 'content-type': 'application/json' } }
  );

const ADMIN: Actor = {
  memberId: 'MEM-ADMIN',
  name: 'Admin',
  email: 'admin@example.invalid',
  role: 'ADMIN',
  active: true,
  verified: true,
  selfServiceEnabled: true
};

function subproject(id: string, name: string, status = 'Active'): HierarchySubproject {
  return {
    subprojectId: id,
    subprojectName: name,
    parentSubprojectId: null,
    status,
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
  assigneeIds?: string[];
  assigneeNames?: string[];
}): TaskSummary {
  const status = input.status ?? 'In Progress';
  const displayStatus = status === 'Done' ? 'DONE' : status === 'Cancelled' ? 'CANCELLED' : 'IN_PROGRESS';
  return {
    taskId: input.taskId,
    projectId: 'PRJ-A',
    projectName: 'Alpha',
    subprojectId: input.subprojectId ?? null,
    responsibilityId: null,
    parentTaskId: input.parentTaskId ?? null,
    taskName: input.taskName,
    status,
    displayStatus,
    priority: 'Medium',
    ownerMemberId: 'M-OWNER',
    ownerName: 'Owner',
    assigneeNames: input.assigneeNames ?? ['Owner'],
    assigneeIds: input.assigneeIds ?? ['M-OWNER'],
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

function leafIds(nodes: readonly TaskNode[]): string[] {
  return nodes.flatMap((node) => (node.children.length > 0 ? leafIds(node.children) : [node.task.taskId]));
}

const mixedTasks = (): TaskSummary[] => [
  task({ taskId: 'OPEN', taskName: 'Open work', subprojectId: 'SUB-A' }),
  task({ taskId: 'DONE-1', taskName: 'Done one', subprojectId: 'SUB-A', status: 'Done' }),
  task({ taskId: 'DONE-2', taskName: 'Done two', subprojectId: 'SUB-A', status: 'Done' })
];

type HarnessOptions = {
  subprojects: HierarchySubproject[];
  tasks: TaskSummary[];
  includeInactive?: boolean;
  initialQuery?: string;
  initialAssignee?: string;
  initialOpen?: boolean;
  canManage?: boolean;
  canRemoveRecord?: boolean;
  canCreateTask?: boolean;
  canCreateSubproject?: boolean;
  completionNotice?: { taskId: string; taskName: string } | null;
  focusTaskId?: string;
};

function Harness(options: HarnessOptions): JSX.Element {
  const { language, setLanguage } = useI18n();
  const [query, setQuery] = useState(options.initialQuery ?? '');
  const [assignee, setAssignee] = useState(options.initialAssignee ?? '');
  const [open, setOpen] = useState(options.initialOpen ?? false);
  const [notice, setNotice] = useState(options.completionNotice ?? null);
  const hierarchy = useMemo(
    () =>
      buildProjectHierarchy({
        subprojects: options.subprojects,
        tasks: options.tasks,
        includeInactive: options.includeInactive ?? false,
        filter: { query, assigneeId: assignee }
      }),
    [options.subprojects, options.tasks, options.includeInactive, query, assignee]
  );
  return (
    <>
      <button type="button" onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')}>
        lang
      </button>
      <ProjectHierarchy
        hierarchy={hierarchy}
        canManage={options.canManage ?? false}
        canEditSubproject={options.canManage ?? false}
        canRemoveRecord={options.canRemoveRecord ?? false}
        canCreateTask={options.canCreateTask ?? false}
        canCreateSubproject={options.canCreateSubproject ?? false}
        includeInactive={options.includeInactive ?? false}
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
        completionNotice={notice}
        onCompletionNoticeDismiss={() => setNotice(null)}
        focusTaskId={options.focusTaskId}
      />
    </>
  );
}

function renderHarness(options: HarnessOptions) {
  return render(
    <I18nProvider>
      <Harness {...options} />
    </I18nProvider>
  );
}

describe('active and completed model', () => {
  it('separates unfinished and completed leaves and counts each once', () => {
    const model = buildProjectHierarchy({
      subprojects: [subproject('SUB-A', 'Area A')],
      tasks: mixedTasks(),
      includeInactive: false
    });
    const node = model.subprojects[0]!;
    expect(leafIds(node.activeTasks)).toEqual(['OPEN']);
    expect(leafIds(node.completedTasks)).toEqual(['DONE-1', 'DONE-2']);
    expect(node.counts).toEqual({ active: 1, done: 2, total: 3 });
    expect(model.counts).toEqual({ active: 1, done: 2, total: 3 });
    expect(model.completed.count).toBe(2);
    expect(model.completed.groups).toEqual([expect.objectContaining({ key: 'sub:SUB-A', count: 2 })]);
  });

  it('keeps a fully completed subproject in the completed presentation only', () => {
    const model = buildProjectHierarchy({
      subprojects: [subproject('SUB-DONE', 'Finished area')],
      tasks: [task({ taskId: 'D1', taskName: 'Finished work', subprojectId: 'SUB-DONE', status: 'Done' })],
      includeInactive: false
    });
    expect(model.active.subprojects).toHaveLength(0);
    expect(model.completed.groups.map((group) => group.key)).toEqual(['sub:SUB-DONE']);
  });

  it('keeps an empty subproject visible in the active structure', () => {
    const model = buildProjectHierarchy({
      subprojects: [subproject('SUB-EMPTY', 'Empty area')],
      tasks: [],
      includeInactive: false
    });
    expect(model.active.subprojects.map((node) => node.subprojectId)).toEqual(['SUB-EMPTY']);
    expect(model.active.subprojects[0]!.activeTasks).toEqual([]);
  });

  it('splits project-direct work into its own active and completed groups', () => {
    const model = buildProjectHierarchy({
      subprojects: [],
      tasks: [
        task({ taskId: 'D-OPEN', taskName: 'Direct open' }),
        task({ taskId: 'D-DONE', taskName: 'Direct done', status: 'Done' })
      ],
      includeInactive: false
    });
    expect(model.active.showDirect).toBe(true);
    expect(leafIds(model.active.directTasks)).toEqual(['D-OPEN']);
    expect(model.completed.directCount).toBe(1);
    expect(model.completed.groups.map((group) => group.key)).toEqual(['direct']);
  });

  it('keeps ancestor context in both views and ignores a container stored Done status', () => {
    const model = buildProjectHierarchy({
      subprojects: [subproject('SUB-N', 'Nested area')],
      tasks: [
        task({ taskId: 'C', taskName: 'Phase container', subprojectId: 'SUB-N', container: true, status: 'Done' }),
        task({ taskId: 'C-OPEN', taskName: 'Open leaf', subprojectId: 'SUB-N', parentTaskId: 'C' }),
        task({ taskId: 'C-DONE', taskName: 'Done leaf', subprojectId: 'SUB-N', parentTaskId: 'C', status: 'Done' })
      ],
      includeInactive: false
    });
    const node = model.subprojects[0]!;
    expect(leafIds(node.activeTasks)).toEqual(['C-OPEN']);
    expect(leafIds(node.completedTasks)).toEqual(['C-DONE']);
    // The container adds no unit of its own and its stored Done is not completed leaf work.
    expect(node.counts).toEqual({ active: 1, done: 1, total: 2 });
    expect(node.activeTasks[0]!.counts).toEqual({ active: 1, done: 0, total: 1 });
    expect(node.completedTasks[0]!.counts).toEqual({ active: 0, done: 1, total: 1 });
  });

  it('treats cancelled work as inactive, never as completed', () => {
    const input = {
      subprojects: [subproject('SUB-C', 'Cancelled area')],
      tasks: [task({ taskId: 'CAN', taskName: 'Cancelled work', subprojectId: 'SUB-C', status: 'Cancelled' })]
    };
    const hidden = buildProjectHierarchy({ ...input, includeInactive: false });
    expect(hidden.counts).toEqual({ active: 0, done: 0, total: 0 });
    expect(hidden.completed.count).toBe(0);
    // The branch has no visible work, so it stays reachable as an empty active subproject.
    expect(hidden.active.subprojects.map((node) => node.subprojectId)).toEqual(['SUB-C']);
    expect(hidden.hiddenTasks).toBe(1);

    const shown = buildProjectHierarchy({ ...input, includeInactive: true });
    expect(leafIds(shown.active.subprojects[0]!.activeTasks)).toEqual(['CAN']);
    expect(shown.completed.count).toBe(0);
  });

  it('matches an additional assignee by stable member id', () => {
    const model = buildProjectHierarchy({
      subprojects: [subproject('SUB-A', 'Area A')],
      tasks: [
        task({
          taskId: 'T-EXTRA',
          taskName: 'Shared work',
          subprojectId: 'SUB-A',
          assigneeIds: ['M-OWNER', 'M-EXTRA'],
          assigneeNames: ['Extra', 'Owner']
        }),
        task({ taskId: 'T-OWNER', taskName: 'Owner work', subprojectId: 'SUB-A' })
      ],
      includeInactive: false,
      filter: { assigneeId: 'M-EXTRA' }
    });
    expect(leafIds(model.active.subprojects[0]!.activeTasks)).toEqual(['T-EXTRA']);
    expect(model.active.subprojects[0]!.activeCounts).toEqual({ active: 1, done: 0, total: 1 });
  });

  it('finds a completed task that is hidden by the collapsed section', () => {
    const model = buildProjectHierarchy({
      subprojects: [subproject('SUB-A', 'Area A')],
      tasks: mixedTasks(),
      includeInactive: false,
      filter: { query: 'Done one' }
    });
    expect(model.active.subprojects).toHaveLength(0);
    expect(model.completed.matches).toBe(1);
    expect(model.matchedTasks).toBe(1);
    expect(model.completed.groups.map((group) => group.key)).toEqual(['sub:SUB-A']);
  });
});

describe('completed presentation', () => {
  it('is collapsed by default, states N completed leaves and expands on request', () => {
    renderHarness({ subprojects: [subproject('SUB-A', 'Area A')], tasks: mixedTasks() });
    expect(screen.getByText('Open work')).toBeTruthy();
    expect(screen.queryByText('Done one')).toBeNull();
    const toggle = screen.getByRole('button', { name: '完了したタスク (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Done one')).toBeTruthy();
    expect(screen.getByText('Done two')).toBeTruthy();
  });

  it('renders a completed-only subproject inside the completed section', () => {
    renderHarness({
      subprojects: [subproject('SUB-DONE', 'Finished area'), subproject('SUB-EMPTY', 'Empty area')],
      tasks: [task({ taskId: 'D1', taskName: 'Finished work', subprojectId: 'SUB-DONE', status: 'Done' })]
    });
    // The empty active subproject remains visible for adding work.
    expect(screen.getByText('Empty area')).toBeTruthy();
    expect(screen.queryByText('Finished area')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '完了したタスク (1)' }));
    expect(screen.getByText('Finished area')).toBeTruthy();
    expect(screen.getByText('Finished work')).toBeTruthy();
  });

  it('shows project-direct unfinished and completed work in their dedicated group', () => {
    renderHarness({
      subprojects: [],
      tasks: [
        task({ taskId: 'D-OPEN', taskName: 'Direct open' }),
        task({ taskId: 'D-DONE', taskName: 'Direct done', status: 'Done' })
      ]
    });
    expect(screen.getByText('Direct open')).toBeTruthy();
    expect(screen.queryByText('Direct done')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '完了したタスク (1)' }));
    expect(screen.getByText('Direct done')).toBeTruthy();
    // The direct group is named in both presentations.
    expect(screen.getAllByText('プロジェクト直下のタスク').length).toBeGreaterThan(1);
  });

  it('keeps a nested branch readable in both presentations without duplicating leaves', () => {
    renderHarness({
      subprojects: [subproject('SUB-N', 'Nested area')],
      tasks: [
        task({ taskId: 'C', taskName: 'Phase container', subprojectId: 'SUB-N', container: true, status: 'Done' }),
        task({ taskId: 'C-OPEN', taskName: 'Open leaf', subprojectId: 'SUB-N', parentTaskId: 'C' }),
        task({ taskId: 'C-DONE', taskName: 'Done leaf', subprojectId: 'SUB-N', parentTaskId: 'C', status: 'Done' })
      ]
    });
    expect(screen.getByText('Open leaf')).toBeTruthy();
    expect(screen.queryByText('Done leaf')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '完了したタスク (1)' }));
    expect(screen.getAllByText('Phase container')).toHaveLength(2);
    expect(screen.getByText('Done leaf')).toBeTruthy();
    // One leaf per presentation, not two rows for the same completed work.
    expect(screen.getAllByText('Done leaf')).toHaveLength(1);
  });

  it('reveals the correct group from the subproject completed count', async () => {
    renderHarness({ subprojects: [subproject('SUB-A', 'Area A')], tasks: mixedTasks() });
    fireEvent.click(screen.getByRole('button', { name: 'Area A の完了タスク 2 件を表示' }));
    expect(screen.getByRole('button', { name: '完了したタスク (2)' }).getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement?.id).toBe('hierarchy-completed-group-sub:SUB-A'));
  });

  it('keeps the row link to the task detail in both presentations', () => {
    renderHarness({ subprojects: [subproject('SUB-A', 'Area A')], tasks: mixedTasks() });
    expect(screen.getByText('Open work').closest('a')?.getAttribute('href')).toBe('#/task/OPEN');
    fireEvent.click(screen.getByRole('button', { name: '完了したタスク (2)' }));
    expect(screen.getByText('Done one').closest('a')?.getAttribute('href')).toBe('#/task/DONE-1');
  });

  it('keeps the disclosure open across a language change', () => {
    renderHarness({ subprojects: [subproject('SUB-A', 'Area A')], tasks: mixedTasks() });
    fireEvent.click(screen.getByRole('button', { name: '完了したタスク (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'lang' }));
    const toggle = screen.getByRole('button', { name: 'Completed tasks (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Done one')).toBeTruthy();
  });

  it('finds hidden completed work through search and offers an explicit Show action', () => {
    renderHarness({ subprojects: [subproject('SUB-A', 'Area A')], tasks: mixedTasks() });
    fireEvent.change(screen.getByRole('searchbox', { name: 'タスク名で検索' }), { target: { value: 'Done one' } });
    const toggle = screen.getByRole('button', { name: '完了したタスク（一致 1 / 全 2）' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('完了したタスクに 1 件一致しています。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '表示' }));
    expect(screen.getByText('Done one')).toBeTruthy();
    expect(screen.queryByText('Done two')).toBeNull();
    // The filter summary distinguishes matches from the full authorized total.
    expect(screen.getByText(/一致 1 件（進行中 0 · 完了 1）\/ 全体 3 件/)).toBeTruthy();
  });

  it('distinguishes no matching tasks from a genuinely empty project and clears the filters', () => {
    const view = renderHarness({ subprojects: [subproject('SUB-A', 'Area A')], tasks: mixedTasks() });
    fireEvent.change(screen.getByRole('searchbox', { name: 'タスク名で検索' }), { target: { value: 'nothing' } });
    expect(screen.getByText('条件に一致するタスクはありません。')).toBeTruthy();
    // The toolbar and the no-match block both offer the clear action; either one clears.
    fireEvent.click(screen.getAllByRole('button', { name: '絞り込みを解除' })[0]!);
    expect((screen.getByRole('searchbox', { name: 'タスク名で検索' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Open work')).toBeTruthy();
    view.unmount();

    renderHarness({ subprojects: [], tasks: [], initialQuery: 'nothing' });
    expect(screen.getByText('サブプロジェクトもタスクもまだありません。')).toBeTruthy();
    expect(screen.queryByText('条件に一致するタスクはありません。')).toBeNull();
  });

  it('filters by an additional assignee through the bounded option endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (String(input).includes('/api/work/task-assignees')) {
          return response({
            items: [{ memberId: 'M-EXTRA', name: 'Extra', active: true }],
            total: 1,
            page: 1,
            pageSize: 50,
            totalPages: 1
          });
        }
        throw new Error(`Unexpected request: ${input}`);
      })
    );
    renderHarness({
      subprojects: [subproject('SUB-A', 'Area A')],
      tasks: [
        task({
          taskId: 'T-EXTRA',
          taskName: 'Shared work',
          subprojectId: 'SUB-A',
          assigneeIds: ['M-OWNER', 'M-EXTRA'],
          assigneeNames: ['Extra', 'Owner']
        }),
        task({ taskId: 'T-OWNER', taskName: 'Owner work', subprojectId: 'SUB-A' })
      ]
    });
    const select = screen.getByRole('combobox', { name: '担当者' }) as HTMLSelectElement;
    fireEvent.focus(select);
    expect(await screen.findByRole('option', { name: 'Extra' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'M-EXTRA' } });
    await waitFor(() => expect(screen.queryByText('Owner work')).toBeNull());
    expect(screen.getByText('Shared work')).toBeTruthy();
  });

  it('offers no row menu to a reader without a removal capability', () => {
    renderHarness({ subprojects: [subproject('SUB-A', 'Area A')], tasks: mixedTasks() });
    expect(screen.queryAllByRole('button', { name: /の操作/ })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: '新規タスク' })).toHaveLength(0);
  });

  it('keeps removal behind the row menu for an authorized manager', () => {
    renderHarness({
      subprojects: [subproject('SUB-A', 'Area A')],
      tasks: mixedTasks(),
      canManage: true,
      canRemoveRecord: true,
      canCreateTask: true
    });
    expect(screen.getAllByRole('button', { name: '新規タスク' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('menuitem', { name: /一覧から削除/ })).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: /の操作/ })[0]!);
    expect(screen.getAllByRole('menuitem', { name: /一覧から削除/ }).length).toBeGreaterThan(0);
  });

  it('reveals a completed task from an explicit focus id', async () => {
    renderHarness({
      subprojects: [subproject('SUB-A', 'Area A')],
      tasks: mixedTasks(),
      focusTaskId: 'DONE-1'
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '完了したタスク (2)' }).getAttribute('aria-expanded')).toBe('true')
    );
    expect(screen.getByText('Done one')).toBeTruthy();
    expect(document.activeElement?.id).toBe('hierarchy-completed-DONE-1');
  });

  it('explains a confirmed completion and reveals the task in the completed section', () => {
    renderHarness({
      subprojects: [subproject('SUB-A', 'Area A')],
      tasks: mixedTasks(),
      completionNotice: { taskId: 'DONE-1', taskName: 'Done one' }
    });
    expect(screen.getByText('「Done one」を完了しました。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '完了したタスクを表示' }));
    expect(screen.getByRole('button', { name: '完了したタスク (2)' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Done one')).toBeTruthy();
    expect(screen.queryByText('「Done one」を完了しました。')).toBeNull();
  });
});

/* ------------------------------------------------------------------ completion workflow */

const taskDetail = (status: string, displayStatus: string) => ({
  record: {
    taskId: 'TSK-1',
    projectId: 'PRJ-A',
    subprojectId: 'SUB-A',
    parentTaskId: null,
    taskName: 'Finished work',
    description: '',
    ownerMemberId: 'M-OWNER',
    ownerName: 'Owner',
    status,
    displayStatus,
    scheduleMissing: null,
    priority: 'Medium',
    plannedStart: null,
    dueDate: '2026-12-01',
    estimatedHours: null,
    actualHours: null,
    progressPercent: 0,
    dependencyIds: [],
    acceptanceCriteria: '',
    nextAction: '',
    requiredSkillId: null,
    requiredSkillLevel: null,
    assignmentVersion: 1,
    assignmentApprovedAt: null,
    notificationEnabled: false,
    notificationBaseline: '',
    publicNote: '',
    plannedDurationValue: null,
    plannedDurationUnit: null,
    plannedDurationBasis: null,
    plannedStartSource: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 2,
    creationChannel: 'MANAGER'
  },
  context: { projectId: 'PRJ-A', projectName: 'Alpha', subprojects: [] },
  assignees: [],
  additionalAssigneeIds: [],
  assigneeIds: [],
  assigneeHistory: [],
  confirmations: [],
  deadlineHistory: [],
  children: [],
  depth: 1,
  canWrite: true
});

const projectDetail = (done: boolean) => ({
  record: {
    projectId: 'PRJ-A',
    projectName: 'Alpha',
    description: '',
    responsibilityName: 'Area',
    projectOwnerName: 'Owner',
    status: 'Active',
    schedule: { state: 'IN_PROGRESS', missing: 'NONE' },
    priority: 'Medium',
    committedDeadline: null,
    progressPercent: done ? 100 : 0,
    health: 'OK',
    dashboardVisibility: 'INTERNAL',
    revision: 1
  },
  progress: {
    tasks: 1,
    containers: 0,
    leaves: 1,
    doneLeaves: done ? 1 : 0,
    cancelledLeaves: 0,
    weightTotal: 1,
    weightDone: done ? 1 : 0,
    percent: done ? 100 : 0,
    unknownEffort: 0
  },
  subprojects: [
    {
      subprojectId: 'SUB-A',
      subprojectName: 'Area A',
      description: '',
      parentSubprojectId: null,
      status: 'Active',
      schedule: { state: 'IN_PROGRESS', missing: 'NONE' },
      deadline: '2026-12-01',
      depth: 1,
      revision: 1,
      progress: { percent: done ? 100 : 0, leaves: 1, doneLeaves: done ? 1 : 0 }
    }
  ],
  tasks: [
    {
      ...task({ taskId: 'TSK-1', taskName: 'Finished work', subprojectId: 'SUB-A', status: done ? 'Done' : 'In Progress' })
    }
  ],
  milestones: [],
  phases: []
});

function stubCompletion(post: (url: string) => Response): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') return post(url);
    if (url.includes('/report-eligibility')) {
      return response({ taskId: 'TSK-1', eligible: true, reasons: [], submissionEnabled: true, reporterName: 'Admin' });
    }
    if (url.includes('/reopen-eligibility')) {
      return response({
        taskId: 'TSK-1',
        eligible: false,
        reasons: ['NOT_COMPLETED'],
        projectId: 'PRJ-A',
        projectName: 'Alpha',
        projectStatus: 'Active',
        projectReopenRequired: false,
        completedAt: null,
        completionRequestId: null
      });
    }
    if (url.includes('/api/employee/requests/mine')) return response({ items: [], submissionEnabled: true });
    if (url.includes('/references') || url.includes('/api/manager/references')) {
      return response({ members: [], skills: [], subprojects: [], responsibilities: [] });
    }
    if (url.includes('/api/manager/tasks/TSK-1')) return response(taskDetail('In Progress', 'IN_PROGRESS'));
    if (url.includes('/api/manager/projects/PRJ-A')) return response(projectDetail(true));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

async function confirmDirectCompletion(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: '完了にする' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
}

describe('completion feedback', () => {
  it('drops a completion notice that belongs to an ended session', () => {
    const epoch = currentMemoryEpoch();
    resetRouteMemory();
    rememberCompletedTask('PRJ-A', 'TSK-1', 'Finished work', epoch);
    expect(takeCompletedTask('PRJ-A')).toBeNull();
  });

  it('does not move a task or write a notice when the completion is refused', async () => {
    stubCompletion(() => refused('INTERNAL', 'The completion could not be saved'));
    render(<I18nProvider><TaskDetailScreen actor={ADMIN} taskId="TSK-1" /></I18nProvider>);
    await confirmDirectCompletion();
    expect(await screen.findByText('The completion could not be saved')).toBeTruthy();
    // The refused write is never presented as a successful completion.
    expect(takeCompletedTask('PRJ-A')).toBeNull();
  });

  it('honours an explicit ?task= address on the project route', async () => {
    stubCompletion(() => response({}));
    render(
      <I18nProvider>
        <ProjectDetailScreen actor={ADMIN} projectId="PRJ-A" routeSearch="task=TSK-1" />
      </I18nProvider>
    );
    const toggle = await screen.findByRole('button', { name: '完了したタスク (1)' });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getAllByText('Finished work').length).toBeGreaterThan(0);
  });

  it('writes the notice only after a confirmed completion and reveals it on the project page', async () => {
    stubCompletion(() => response({ task: { ...taskDetail('Done', 'DONE').record } }));
    const taskView = render(<I18nProvider><TaskDetailScreen actor={ADMIN} taskId="TSK-1" /></I18nProvider>);
    await confirmDirectCompletion();
    await waitFor(() =>
      expect(
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
          ([url, init]) => String(url) === '/api/manager/tasks/TSK-1/complete' && init?.method === 'POST'
        )
      ).toBe(true)
    );
    taskView.unmount();
    queryCache.clear();

    render(<I18nProvider><ProjectDetailScreen actor={ADMIN} projectId="PRJ-A" /></I18nProvider>);
    expect(await screen.findByText('「Finished work」を完了しました。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '完了したタスクを表示' }));
    expect(screen.getByRole('button', { name: '完了したタスク (1)' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText('Finished work').length).toBeGreaterThan(0);
  });
});
