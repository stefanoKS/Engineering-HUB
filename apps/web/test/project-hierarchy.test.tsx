// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
// jsdom has no native <dialog>; the Modal component needs these two methods to open and close.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };
}
import { I18nProvider } from '../src/i18n';
import {
  buildProjectHierarchy,
  ProjectDetailScreen,
  ProjectHierarchy,
  type HierarchySubproject
} from '../src/screens/ProjectDetail';
import { DeleteEntityDialog } from '../src/components/DeleteEntityDialog';
import { queryCache } from '../src/state/cache';
import type { TaskSummary } from '@eh/contracts';

afterEach(() => { cleanup(); queryCache.clear(); vi.unstubAllGlobals(); window.localStorage.clear(); });

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));

const ADMIN_ACTOR = { memberId: 'MEM-ADMIN', name: 'Admin', email: 'admin@example.invalid', role: 'ADMIN', active: true, verified: true, selfServiceEnabled: true } as const;
const MANAGER_ACTOR = { ...ADMIN_ACTOR, memberId: 'MEM-MANAGER', name: 'Manager', role: 'MANAGER' } as const;
const MEMBER_ACTOR = { ...ADMIN_ACTOR, memberId: 'MEM-MEMBER', name: 'Member', role: 'MEMBER' } as const;
const VIEWER_ACTOR = { ...ADMIN_ACTOR, memberId: 'MEM-VIEWER', name: 'Viewer', role: 'VIEWER' } as const;

type TaskInput = {
  taskId: string;
  taskName: string;
  subprojectId?: string | null;
  parentTaskId?: string | null;
  status?: string;
};

function task(input: TaskInput): TaskSummary {
  const status = input.status ?? 'In Progress';
  const displayStatus = status === 'Done' ? 'DONE' : status === 'Cancelled' ? 'CANCELLED' : 'IN_PROGRESS';
  return {
    taskId: input.taskId,
    projectId: 'PRJ-A',
    subprojectId: input.subprojectId ?? null,
    parentTaskId: input.parentTaskId ?? null,
    taskName: input.taskName,
    status,
    displayStatus,
    priority: 'Medium',
    dueDate: '2026-12-01',
    plannedStart: null,
    ownerName: 'Owner',
    ownerMemberId: 'MEM-OWNER',
    assigneeNames: ['Owner'],
    container: false,
    progressPercent: null,
    estimatedHours: null,
    actualHours: null,
    reviewState: 'NONE',
    depth: 1,
    revision: 1
  } as unknown as TaskSummary;
}

function subproject(
  subprojectId: string,
  subprojectName: string,
  parentSubprojectId: string | null = null,
  status = 'Active'
): HierarchySubproject {
  return {
    subprojectId,
    subprojectName,
    parentSubprojectId,
    status,
    schedule: { state: 'IN_PROGRESS', missing: 'NONE' },
    deadline: '2026-11-30',
    depth: 1,
    revision: 1
  };
}

/** A two-level project: subproject A (task + nested subproject A1 with its own tasks) and direct work. */
function hierarchyFixture(includeInactive = false) {
  return buildProjectHierarchy({
    subprojects: [
      subproject('SUB-A', 'Area A'),
      subproject('SUB-A1', 'Area A1', 'SUB-A'),
      subproject('SUB-EMPTY', 'Empty area')
    ],
    tasks: [
      task({ taskId: 'T-A1', taskName: 'Area A work', subprojectId: 'SUB-A' }),
      task({ taskId: 'T-A1-CHILD', taskName: 'Area A child', subprojectId: 'SUB-A', parentTaskId: 'T-A1' }),
      task({ taskId: 'T-A1A', taskName: 'Area A1 work', subprojectId: 'SUB-A1', status: 'Done' }),
      task({ taskId: 'T-DIRECT', taskName: 'Direct project work' }),
      task({ taskId: 'T-DIRECT-CHILD', taskName: 'Direct child', parentTaskId: 'T-DIRECT' }),
      task({ taskId: 'T-CANCELLED', taskName: 'Cancelled work', subprojectId: 'SUB-A', status: 'Cancelled' })
    ],
    includeInactive
  });
}

describe('project hierarchy model', () => {
  it('places a task under its subproject and a parentless task in the direct section', () => {
    const model = hierarchyFixture();
    const areaA = model.subprojects.find((node) => node.subprojectId === 'SUB-A')!;
    expect(areaA.tasks.map((node) => node.task.taskId)).toEqual(['T-A1']);
    expect(model.directTasks.map((node) => node.task.taskId)).toEqual(['T-DIRECT']);
    expect(model.subprojects.map((node) => node.subprojectId)).toEqual(['SUB-A', 'SUB-A1', 'SUB-EMPTY']);
  });

  it('projects legacy subprojects as peers while retaining task nesting', () => {
    const model = hierarchyFixture();
    const areaA = model.subprojects.find((node) => node.subprojectId === 'SUB-A')!;
    expect(areaA.children).toEqual([]);
    expect(model.subprojects.find((node) => node.subprojectId === 'SUB-A1')?.tasks.map((node) => node.task.taskId)).toEqual(['T-A1A']);
    expect(areaA.tasks[0]!.children.map((node) => node.task.taskId)).toEqual(['T-A1-CHILD']);
    expect(model.directTasks[0]!.children.map((node) => node.task.taskId)).toEqual(['T-DIRECT-CHILD']);
  });

  it('projects legacy multi-level subprojects as flat peer folders', () => {
    const model = buildProjectHierarchy({
      subprojects: [
        subproject('S1', 'Root one'),
        subproject('S1-1', 'Root one child', 'S1'),
        subproject('S1-1-1', 'Grandchild', 'S1-1'),
        subproject('S2', 'Root two')
      ],
      tasks: [
        task({ taskId: 'T1', taskName: 'Sibling one', subprojectId: 'S1' }),
        task({ taskId: 'T2', taskName: 'Sibling two', subprojectId: 'S1' }),
        task({ taskId: 'T3', taskName: 'Deep work', subprojectId: 'S1-1-1' })
      ],
      includeInactive: false
    });
    expect(model.subprojects.map((node) => node.subprojectId)).toEqual(['S1-1-1', 'S1', 'S1-1', 'S2']);
    const root = model.subprojects.find((node) => node.subprojectId === 'S1')!;
    expect(root.tasks.map((node) => node.task.taskId)).toEqual(['T1', 'T2']);
    expect(model.subprojects.find((node) => node.subprojectId === 'S1-1-1')?.tasks.map((node) => node.task.taskId)).toEqual(['T3']);
  });

  it('renders an empty subproject with no task rows', () => {
    const model = hierarchyFixture();
    const empty = model.subprojects.find((node) => node.subprojectId === 'SUB-EMPTY')!;
    expect(empty.tasks).toEqual([]);
    expect(empty.children).toEqual([]);
    expect(empty.counts).toEqual({ active: 0, done: 0, total: 0 });
  });

  it('never duplicates a task across sections', () => {
    const model = hierarchyFixture();
    const seen: string[] = [];
    const walkTasks = (nodes: ReturnType<typeof hierarchyFixture>['directTasks']): void => {
      for (const node of nodes) {
        seen.push(node.task.taskId);
        walkTasks(node.children);
      }
    };
    const walkSubprojects = (nodes: typeof model.subprojects): void => {
      for (const node of nodes) {
        walkTasks(node.tasks);
        walkSubprojects(node.children);
      }
    };
    walkSubprojects(model.subprojects);
    walkTasks(model.directTasks);
    expect(seen.length).toBe(new Set(seen).size);
    expect(seen).toContain('T-A1A');
    expect(seen).not.toContain('T-CANCELLED');
  });

  it('counts active and completed work through flat legacy folders without double counting', () => {
    const model = hierarchyFixture();
    const areaA = model.subprojects.find((node) => node.subprojectId === 'SUB-A')!;
    expect(areaA.counts).toEqual({ active: 2, done: 0, total: 2 });
    expect(model.counts).toEqual({ active: 4, done: 1, total: 5 });
    // The parent task counts itself plus its derived child once.
    expect(areaA.tasks[0]!.counts).toEqual({ active: 2, done: 0, total: 2 });
  });

  it('hides cancelled work by default and reveals it on request', () => {
    expect(hierarchyFixture().hiddenTasks).toBe(1);
    const shown = hierarchyFixture(true);
    expect(shown.hiddenTasks).toBe(0);
    const areaA = shown.subprojects.find((node) => node.subprojectId === 'SUB-A')!;
    expect(areaA.tasks.map((node) => node.task.taskId)).toEqual(['T-A1', 'T-CANCELLED']);
  });

  it('hides an archived branch and never re-buckets its tasks as direct work', () => {
    const model = buildProjectHierarchy({
      subprojects: [subproject('SUB-ARCH', 'Archived area', null, 'Archived'), subproject('SUB-LIVE', 'Live area')],
      tasks: [
        task({ taskId: 'T-ARCH', taskName: 'Archived work', subprojectId: 'SUB-ARCH' }),
        task({ taskId: 'T-LIVE', taskName: 'Live work', subprojectId: 'SUB-LIVE' })
      ],
      includeInactive: false
    });
    expect(model.subprojects.map((node) => node.subprojectId)).toEqual(['SUB-LIVE']);
    expect(model.directTasks).toEqual([]);
    expect(model.hiddenTasks).toBe(1);
  });

  it('hides the children of an archived parent even when the child is still active', () => {
    const model = buildProjectHierarchy({
      subprojects: [subproject('SUB-ARCH', 'Archived area', null, 'Archived'), subproject('SUB-CHILD', 'Child area', 'SUB-ARCH')],
      tasks: [task({ taskId: 'T-CHILD', taskName: 'Child work', subprojectId: 'SUB-CHILD' })],
      includeInactive: false
    });
    expect(model.subprojects).toEqual([]);
    expect(model.hiddenTasks).toBe(1);
  });
});

describe('project hierarchy tree', () => {
  const emptyReferences = { responsibilities: [], subprojects: [], skills: [], members: [] };

  function renderTree(canRemoveRecord: boolean, canManage = true) {
    return render(
      <I18nProvider>
        <ProjectHierarchy
          hierarchy={hierarchyFixture()}
          canManage={canManage}
          canRemoveRecord={canRemoveRecord}
          canCreateTask={canManage}
          canCreateSubproject={canManage}
          includeInactive={false}
          onToggleInactive={() => undefined}
          onNewTask={() => undefined}
          onNewSubproject={() => undefined}
          onEditSubproject={() => undefined}
          onDelete={() => undefined}
        />
      </I18nProvider>
    );
  }

  it('renders a subproject header with its tasks directly underneath', () => {
    renderTree(true);
    const header = screen.getByRole('button', { name: 'Area A を閉じる' });
    const branch = header.closest('li')!;
    expect(within(branch).getByText('Area A work')).toBeTruthy();
    expect(within(branch).getByText('Area A child')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Area A1 を閉じる' })).toBeTruthy();
  });

  it('keeps expansion state when the hierarchy object is replaced by a refresh', () => {
    const view = render(
      <I18nProvider>
        <ProjectHierarchy
          hierarchy={hierarchyFixture()}
          canManage
          canRemoveRecord
          canCreateTask
          canCreateSubproject
          includeInactive={false}
          onToggleInactive={() => undefined}
          onNewTask={() => undefined}
          onNewSubproject={() => undefined}
          onEditSubproject={() => undefined}
          onDelete={() => undefined}
        />
      </I18nProvider>
    );
    const toggle = screen.getByRole('button', { name: 'Area A を閉じる' });
    fireEvent.click(toggle);
    expect(screen.queryByText('Area A work')).toBeNull();
    // A save/delete replaces the whole payload; the collapsed branch must stay collapsed.
    view.rerender(
      <I18nProvider>
        <ProjectHierarchy
          hierarchy={hierarchyFixture()}
          canManage
          canRemoveRecord
          canCreateTask
          canCreateSubproject
          includeInactive={false}
          onToggleInactive={() => undefined}
          onNewTask={() => undefined}
          onNewSubproject={() => undefined}
          onEditSubproject={() => undefined}
          onDelete={() => undefined}
        />
      </I18nProvider>
    );
    expect(screen.queryByText('Area A work')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Area A を開く' }));
    expect(screen.getByText('Area A work')).toBeTruthy();
    expect(emptyReferences.members).toEqual([]);
  });

  it('shows action buttons for a manager and delete icons only when allowed', () => {
    const manager = renderTree(false);
    expect(screen.getAllByRole('button', { name: '新規タスク' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '編集' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: /を削除/ })).toHaveLength(0);
    manager.unmount();
    renderTree(true);
    expect(screen.getAllByRole('button', { name: /を削除/ }).length).toBeGreaterThan(0);
  });

  it('offers exactly one New task action for an empty project', () => {
    render(
      <I18nProvider>
        <ProjectHierarchy
          hierarchy={buildProjectHierarchy({ subprojects: [], tasks: [], includeInactive: false })}
          canManage
          canRemoveRecord
          canCreateTask
          canCreateSubproject
          includeInactive={false}
          onToggleInactive={() => undefined}
          onNewTask={() => undefined}
          onNewSubproject={() => undefined}
          onEditSubproject={() => undefined}
          onDelete={() => undefined}
        />
      </I18nProvider>
    );
    expect(screen.getByText('サブプロジェクトもタスクもまだありません。')).toBeTruthy();
    // The header keeps one clear action; the redundant direct-folder row is not rendered.
    expect(screen.getAllByRole('button', { name: '新規タスク' })).toHaveLength(1);
    expect(screen.queryByText('プロジェクト直下のタスクはありません。')).toBeNull();
  });

  it('centres the header checkbox, counts and buttons on one line', () => {
    renderTree(false);
    const header = document.querySelector('.card-header')!;
    const actions = header.querySelector('.card-actions')!;
    expect(actions.querySelector('.inline-checkbox')).not.toBeNull();
    expect(actions.querySelector('.muted.small')).not.toBeNull();
    // A scoped toolbar class keeps the alignment rule away from the other section headers.
    expect(document.querySelector('.hierarchy-toolbar')).not.toBeNull();
  });

  it('renders no create or delete controls for a reader without manager rights', () => {
    renderTree(false, false);
    expect(screen.queryAllByRole('button', { name: '新規タスク' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /を削除/ })).toHaveLength(0);
    expect(screen.queryByLabelText('取消・アーカイブを表示')).toBeNull();
  });

  it('keeps every control keyboard reachable', () => {
    renderTree(true);
    const toggles = screen.getAllByRole('button', { name: /を(閉じる|開く)/ });
    expect(toggles.length).toBeGreaterThan(2);
    for (const toggle of toggles) {
      expect((toggle as HTMLButtonElement).type).toBe('button');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    }
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toContain('#/task/T-A1');
  });
});

describe('delete dialog', () => {
  it('confirms a recoverable removal with one button and the loaded revision', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ removed: true });
      if (url.includes('removal/preflight')) {
        return response({
          entityType: 'TASKS',
          entityId: 'T-A1',
          deletable: true,
          blockers: [],
          dependencyCount: 0,
          descendantCount: 0,
          confirmationText: '',
          revision: 7
        });
      }
      return response({});
    });
    vi.stubGlobal('fetch', fetcher);
    const onDeleted = vi.fn();
    render(
      <I18nProvider>
        <DeleteEntityDialog
          entityType="TASKS"
          entityId="T-A1"
          entityName="Area A work"
          context="Alpha"
          canPurge={false}
          onClose={() => undefined}
          onDeleted={onDeleted}
        />
      </I18nProvider>
    );
    expect(
      await screen.findByText('このタスクを通常の一覧から削除します。記録と履歴は保持され、管理者は後から復元できます。')
    ).toBeTruthy();
    // The approved interaction collects no typed phrase and no reason.
    expect(document.querySelector('.modal input[type="text"], .modal textarea')).toBeNull();
    const submit = screen.getByRole('button', { name: '削除する' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    const call = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(call[0]).toBe('/api/manager/tasks/T-A1/remove');
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      revision: 7,
      confirmed: true
    });
    // A manager is never offered the permanent-erasure control.
    expect(screen.queryByRole('button', { name: '誤作成記録を完全に消去' })).toBeNull();
  });

  it('keeps permanent erasure separate and displays the exact erase plan', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ tombstoneId: 'DEL-1' });
      if (url.includes('deletion/preflight')) {
        return response({
          entityType: 'TASKS',
          entityId: 'T-A1',
          deletable: true,
          blockers: [],
          erasePlan: [
            { code: 'TASK_ROW', count: 1, detail: 'Task row T-A1' },
            { code: 'TASK_ASSIGNEES', count: 2, detail: '2 task assignee relationship row(s)' }
          ],
          dependencyCount: 0,
          descendantCount: 0,
          confirmationText: 'DELETE T-A1',
          revision: 7
        });
      }
      return response({
        entityType: 'TASKS',
        entityId: 'T-A1',
        deletable: true,
        blockers: [],
        dependencyCount: 0,
        descendantCount: 0,
        confirmationText: '',
        revision: 7
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const onDeleted = vi.fn();
    render(
      <I18nProvider>
        <DeleteEntityDialog
          entityType="TASKS"
          entityId="T-A1"
          entityName="Area A work"
          canPurge
          onClose={() => undefined}
          onDeleted={onDeleted}
        />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: '誤作成記録を完全に消去' }));
    expect(await screen.findByText('Task row T-A1')).toBeTruthy();
    expect(screen.getByText('2 task assignee relationship row(s)')).toBeTruthy();
    // The permanent erasure uses the same no-typing confirmation as every other corrective action.
    expect(document.querySelector('.modal input[type="text"], .modal textarea')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '完全に消去する' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    const call = fetcher.mock.calls.find(([url, init]) => url === '/api/admin/tasks/T-A1/purge' && init?.method === 'POST')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      revision: 7,
      confirmed: true
    });
  });

  it('reports blockers and keeps the delete action disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      response({
        entityType: 'SUBPROJECTS',
        entityId: 'SUB-A',
        deletable: false,
        blockers: [{ code: 'HAS_TASKS', detail: '2 task(s) are attached' }],
        dependencyCount: 0,
        descendantCount: 0,
        confirmationText: '',
        revision: 3
      })
    ));
    const reveal = vi.fn();
    render(
      <I18nProvider>
        <DeleteEntityDialog
          entityType="SUBPROJECTS"
          entityId="SUB-A"
          entityName="Area A"
          canPurge={false}
          onClose={() => undefined}
          onDeleted={() => undefined}
          onRevealChildren={reveal}
        />
      </I18nProvider>
    );
    expect(await screen.findByText('タスクが残っています')).toBeTruthy();
    expect(screen.getByText(/2 task\(s\) are attached/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '削除する' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '子を表示' }));
    expect(reveal).toHaveBeenCalled();
  });

  it('reports a conflict as an explicit reload request instead of retrying blindly', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'EDIT_CONFLICT', message: 'The record changed', retryable: false, correlationId: 'c1' }
          }),
          { status: 409 }
        );
      }
      return response({
        entityType: 'TASKS',
        entityId: 'T-A1',
        deletable: true,
        blockers: [],
        dependencyCount: 0,
        descendantCount: 0,
        confirmationText: '',
        revision: 4
      });
    });
    vi.stubGlobal('fetch', fetcher);
    render(
      <I18nProvider>
        <DeleteEntityDialog
          entityType="TASKS"
          entityId="T-A1"
          entityName="Area A work"
          canPurge={false}
          onClose={() => undefined}
          onDeleted={() => undefined}
        />
      </I18nProvider>
    );
    const submit = await screen.findByRole('button', { name: '削除する' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await act(async () => { fireEvent.click(submit); });
    expect(await screen.findByText('The record changed')).toBeTruthy();
    // A conflict offers an explicit reload; it never retries the write by itself.
    expect(screen.getByRole('button', { name: '最新の内容を読み込む' })).toBeTruthy();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});

describe('project detail roles', () => {
  const detailPayload = {
    record: {
      projectId: 'PRJ-A',
      projectName: 'Alpha',
      responsibilityName: 'Area',
      projectOwnerName: 'Owner',
      status: 'Active',
      priority: 'Medium',
      committedDeadline: null,
      progressPercent: 40,
      health: 'OK',
      dashboardVisibility: 'INTERNAL'
    },
    progress: { percent: 40, leaves: 2, doneLeaves: 1, unknownEffort: 0 },
    subprojects: [
      {
        ...subproject('SUB-A', 'Area A'),
        projectId: 'PRJ-A',
        ownerId: null,
        ownerName: 'Owner',
        plannedStart: null,
        plannedEnd: null,
        progressPercent: null,
        estimatedHours: null,
        nextAction: '',
        status: 'Active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        progress: { percent: 40, leaves: 2, doneLeaves: 1, unknownEffort: 0 }
      }
    ],
    tasks: [task({ taskId: 'T-A1', taskName: 'Area A work', subprojectId: 'SUB-A' })],
    milestones: [],
    phases: []
  };

  const emptyPreflight = {
    entityType: 'TASKS',
    entityId: 'T-A1',
    deletable: false,
    blockers: [{ code: 'NOT_FOUND_OR_DELETED', detail: 'The record is not available' }],
    dependencyCount: 0,
    descendantCount: 0,
    confirmationText: '',
    revision: 1
  };

  function stubManagerApi() {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('removal/preflight') ? response(emptyPreflight) : url.includes('/references') ? response({ responsibilities: [], subprojects: [], skills: [], members: [] }) : response(detailPayload)
    ));
  }

  it('gives ADMIN edit, create and delete actions', async () => {
    stubManagerApi();
    render(<I18nProvider><ProjectDetailScreen actor={ADMIN_ACTOR as never} projectId="PRJ-A" /></I18nProvider>);
    expect(await screen.findByRole('heading', { name: /Alpha/ })).toBeTruthy();
    expect(await screen.findByText('Area A work')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /を削除/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '新規タスク' }).length).toBeGreaterThan(0);
  });

  it('gives MANAGER recoverable removal and creation but never a permanent erasure', async () => {
    stubManagerApi();
    render(<I18nProvider><ProjectDetailScreen actor={MANAGER_ACTOR as never} projectId="PRJ-A" /></I18nProvider>);
    expect(await screen.findByText('Area A work')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '編集' }).length).toBeGreaterThan(0);
    // The approved change: a manager removes work inside a division it may write in ...
    expect(screen.getAllByRole('button', { name: /を削除/ }).length).toBeGreaterThan(0);
    // ... and the permanent erasure stays an ADMIN control.
    fireEvent.click(screen.getAllByRole('button', { name: /を削除/ })[0]!);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '誤作成記録を完全に消去' })).toBeNull();
  });

  it('renders MEMBER and VIEWER a read-only hierarchy without actions', async () => {
    for (const [actor, canCreate] of [
      [MEMBER_ACTOR, true],
      [VIEWER_ACTOR, false]
    ] as const) {
      stubManagerApi();
      const view = render(<I18nProvider><ProjectDetailScreen actor={actor as never} projectId="PRJ-A" readOnly /></I18nProvider>);
      expect(await screen.findByText('Area A work')).toBeTruthy();
      expect(screen.queryAllByRole('button', { name: /を削除/ })).toHaveLength(0);
      // A MEMBER files new work here; a VIEWER stays read-only.
      const createButtons = screen.queryAllByRole('button', { name: '新規タスク' });
      if (canCreate) expect(createButtons.length).toBeGreaterThan(0);
      else expect(createButtons).toHaveLength(0);
      expect(screen.queryAllByRole('button', { name: '編集' })).toHaveLength(0);
      view.unmount();
      queryCache.clear();
    }
  });

  it('opens the task form with the subproject preselected', async () => {
    const page = { items: [{ projectId: 'PRJ-A', projectName: 'Alpha' }], total: 1, totalPages: 1 };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('removal/preflight')) return response({});
      if (url.includes('/references')) {
        return response({
          responsibilities: [],
          subprojects: [{ id: 'SUB-A', name: 'Area A', projectId: 'PRJ-A', status: 'Active', parentId: null }],
          skills: [],
          members: []
        });
      }
      if (url.includes('parent-options')) return response({ items: [] });
      if (url.includes('/api/manager/projects/PRJ-A')) return response(detailPayload);
      if (url.includes('/api/manager/projects')) return response(page);
      return response(detailPayload);
    }));
    render(<I18nProvider><ProjectDetailScreen actor={ADMIN_ACTOR as never} projectId="PRJ-A" /></I18nProvider>);
    const subprojectBranch = (await screen.findByRole('button', { name: 'Area A を閉じる' })).closest('li')!;
    fireEvent.click(within(subprojectBranch).getByRole('button', { name: '新規タスク' }));
    const dialog = await screen.findByRole('dialog');
    // The contextual location is shown as a readable path; no reselect is required.
    expect(within(dialog).getByText('Alpha / Area A')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '作成先を変更' }));
    const subprojectSelect = within(dialog).getByLabelText('サブプロジェクト') as HTMLSelectElement;
    await waitFor(() => expect(subprojectSelect.value).toBe('SUB-A'));
    expect(within(dialog).getByRole('button', { name: 'この作成先のまま' })).toBeTruthy();
  });
});


it('offers member subproject editing and recoverable deletion only in a writable project', async () => {
  const project={record:{projectId:'PRJ-A',projectName:'Alpha',description:'',responsibilityName:'Area',projectOwnerName:'Other',status:'Active',schedule:{state:'IN_PROGRESS',missing:'NONE'},priority:'Medium',committedDeadline:null,progressPercent:null,health:''},canWrite:true,progress:{percent:0,leaves:1,doneLeaves:0,unknownEffort:0},subprojects:[subproject('SUB-A','Colleague subproject')],tasks:[]};
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('/api/work/projects/PRJ-A'))return response(project);
    if(url.includes('/api/work/editor/subprojects/SUB-A'))return response({record:{subprojectId:'SUB-A',projectId:'PRJ-A',subprojectName:'Colleague subproject',description:'',ownerId:null,status:'Active',estimatedHours:null,nextAction:'',revision:7}});
    if(url.includes('/references'))return response({members:[],skills:[],subprojects:[]});
    return response({});
  });
  vi.stubGlobal('fetch',fetcher);
  render(<I18nProvider><ProjectDetailScreen actor={MEMBER_ACTOR} projectId="PRJ-A" readOnly /></I18nProvider>);
  const edit=await screen.findByRole('button',{name:'編集'});
  fireEvent.click(edit);
  expect(await screen.findByDisplayValue('Colleague subproject')).toBeTruthy();
  expect(fetcher.mock.calls.some(([url])=>url.includes('/api/work/editor/subprojects/SUB-A'))).toBe(true);
});
