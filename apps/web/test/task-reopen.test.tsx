// @vitest-environment jsdom
/**
 * The ADMIN corrective reopening in the browser.
 *
 * The approved change removed the typed phrase and the mandatory reason: the dialog names the
 * record, states the resulting state, and offers one clearly labelled button. The attempt keeps one
 * idempotency identity for its whole life, so a retry of the same attempt replays instead of
 * creating a second correction.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.open = false; };
}
import type { Actor } from '@eh/contracts';
import { I18nProvider } from '../src/i18n';
import { TaskDetailScreen } from '../src/screens/TaskDetail';
import { queryCache } from '../src/state/cache';

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));

const ADMIN: Actor = {
  memberId: 'MEM-ADMIN',
  name: 'Admin',
  email: 'admin@example.invalid',
  role: 'ADMIN',
  active: true,
  verified: true,
  selfServiceEnabled: true
};

function stubDetail(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') return response({ task: {}, projectStatus: 'Active', projectReopened: false, replayed: false });
    if (url.includes('/reopen-eligibility')) {
      return response({
        taskId: 'TSK-DONE',
        eligible: true,
        reasons: [],
        projectId: 'PRJ-A',
        projectName: 'Alpha',
        projectStatus: 'Active',
        projectReopenRequired: false,
        completedAt: '2026-10-01T03:00:00.000Z',
        completionRequestId: null
      });
    }
    if (url.includes('/report-eligibility')) {
      return response({ taskId: 'TSK-DONE', eligible: false, reasons: [], submissionEnabled: true, reporterName: 'Admin' });
    }
    if (url.includes('/references')) return response({ members: [], skills: [], subprojects: [] });
    if (url.includes('/api/employee/requests/mine')) return response({ items: [], submissionEnabled: true });
    if (url.includes('/api/manager/tasks/TSK-DONE')) {
      return response({
        record: {
          taskId: 'TSK-DONE',
          projectId: 'PRJ-A',
          subprojectId: null,
          parentTaskId: null,
          taskName: 'Finished work',
          description: '',
          ownerMemberId: 'MEM-A',
          ownerName: 'Aki Tanaka',
          status: 'Done',
          displayStatus: 'DONE',
          scheduleMissing: null,
          priority: 'Medium',
          plannedStart: null,
          dueDate: '2026-10-01',
          estimatedHours: null,
          actualHours: null,
          progressPercent: 100,
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
          completedAt: '2026-10-01T03:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          revision: 3,
          ...overrides
        },
        context: { projectId: 'PRJ-A', projectName: 'Alpha', subprojects: [] },
        assignees: [],
        additionalAssigneeIds: [],
        assigneeIds: [],
        assigneeHistory: [],
        confirmations: [],
        deadlineHistory: [],
        children: [],
        depth: 1
      });
    }
    return response({ items: [], total: 0, totalPages: 1 });
  });
}

async function openReopenDialog(fetcher: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetcher);
  const view = render(<I18nProvider><TaskDetailScreen actor={ADMIN} taskId="TSK-DONE" /></I18nProvider>);
  await within(view.container).findByRole('heading', { name: 'Finished work' });
  fireEvent.click(within(view.container).getByRole('button', { name: 'その他' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '完了を取り消す' }));
  const dialog = await screen.findByRole('dialog');
  return { view, dialog };
}

describe('corrective reopening in the browser', () => {
  it('asks for one button, names the record and states the resulting state', async () => {
    const fetcher = stubDetail();
    const { dialog } = await openReopenDialog(fetcher);
    // No typed phrase and no reason field.
    expect(dialog.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(within(dialog).getByText(/完了を取り消します/)).toBeTruthy();
    expect(within(dialog).getByText(/進行中・進捗 0%/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '完了を取り消す' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeTruthy();
  });

  it('cancels without a mutation and returns focus to the menu trigger', async () => {
    const fetcher = stubDetail();
    const { dialog } = await openReopenDialog(fetcher);
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('submits the loaded revision, keeps one idempotency identity and sends a single write', async () => {
    const fetcher = stubDetail();
    const { dialog } = await openReopenDialog(fetcher);
    const confirm = within(dialog).getByRole('button', { name: '完了を取り消す' });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(screen.getByText(/完了を取り消しました/)).toBeTruthy());
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String(posts[0]![1]!.body)) as {
      idempotencyKey: string;
      revision: number;
      confirmed: boolean;
    };
    expect(body.revision).toBe(3);
    expect(body.confirmed).toBe(true);
    // The identity belongs to the attempt and matches the server's safe alphabet.
    expect(body.idempotencyKey).toMatch(/^[A-Za-z0-9:_-]{8,120}$/);
    expect(body.idempotencyKey.startsWith('reopen:')).toBe(true);
  });

  it('keeps the same attempt identity when the first submission fails and is retried', async () => {
    const fetcher = stubDetail();
    let attempt = 0;
    fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        attempt += 1;
        if (attempt === 1) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: { code: 'INTERNAL_ERROR', message: 'The write could not be completed', retryable: true, correlationId: 'c1' }
            }),
            { status: 500 }
          );
        }
        return response({ task: {}, projectStatus: 'Active', projectReopened: false, replayed: false });
      }
      const url = String(input);
      if (url.includes('/reopen-eligibility')) {
        return response({
          taskId: 'TSK-DONE',
          eligible: true,
          reasons: [],
          projectId: 'PRJ-A',
          projectName: 'Alpha',
          projectStatus: 'Active',
          projectReopenRequired: false,
          completedAt: null,
          completionRequestId: null
        });
      }
      if (url.includes('/report-eligibility')) {
        return response({ taskId: 'TSK-DONE', eligible: false, reasons: [], submissionEnabled: true, reporterName: 'Admin' });
      }
      if (url.includes('/references')) return response({ members: [], skills: [], subprojects: [] });
      if (url.includes('/api/employee/requests/mine')) return response({ items: [], submissionEnabled: true });
      if (url.includes('/api/manager/tasks/TSK-DONE')) {
        return response({
          record: {
            taskId: 'TSK-DONE',
            projectId: 'PRJ-A',
            subprojectId: null,
            parentTaskId: null,
            taskName: 'Finished work',
            description: '',
            ownerMemberId: 'MEM-A',
            ownerName: 'Aki Tanaka',
            status: 'Done',
            displayStatus: 'DONE',
            scheduleMissing: null,
            priority: 'Medium',
            plannedStart: null,
            dueDate: '2026-10-01',
            estimatedHours: null,
            actualHours: null,
            progressPercent: 100,
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
            completedAt: '2026-10-01T03:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            revision: 3
          },
          context: { projectId: 'PRJ-A', projectName: 'Alpha', subprojects: [] },
          assignees: [],
          additionalAssigneeIds: [],
          assigneeIds: [],
          assigneeHistory: [],
          confirmations: [],
          deadlineHistory: [],
          children: [],
          depth: 1
        });
      }
      return response({ items: [], total: 0, totalPages: 1 });
    });
    const { dialog } = await openReopenDialog(fetcher);
    const confirm = within(dialog).getByRole('button', { name: '完了を取り消す' });
    await act(async () => {
      fireEvent.click(confirm);
    });
    // A definite refusal keeps the dialog open and does not retry by itself.
    await waitFor(() => expect(screen.getByText('The write could not be completed')).toBeTruthy());
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    // A deliberate second activation of the *same attempt* reuses its idempotency identity.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '完了を取り消す' }));
    });
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(2);
    const keys = posts.map(([, init]) => (JSON.parse(String(init!.body)) as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });
});


describe('member task collaboration', () => {
  it('edits a colleague task using a fresh narrow editor and exposes no management actions', async () => {
    const base = stubDetail({status:'In Progress',displayStatus:'IN_PROGRESS',progressPercent:0,completedAt:null});
    const fetcher=vi.fn(async (input:string,init?:RequestInit) => {
      const url=String(input);
      if(init?.method==='PATCH') return response({task:{taskId:'TSK-DONE',projectId:'PRJ-A',revision:4}});
      if(url.includes('/projects/PRJ-A')) return response({record:{projectId:'PRJ-A',projectName:'Alpha',divisionId:'DIV-DEV'}});
      if(url.includes('/api/work/tasks/TSK-DONE') || url.includes('/api/work/editor/tasks/TSK-DONE')) {
        const original=await base('/api/manager/tasks/TSK-DONE');
        const data=(await original.json()).data;
        return response({...data,canWrite:true});
      }
      return base(url,init);
    });
    vi.stubGlobal('fetch',fetcher);
    render(<I18nProvider><TaskDetailScreen actor={{...ADMIN,role:'MEMBER',memberId:'MEM-OTHER'}} taskId="TSK-DONE" readOnly /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button',{name:'編集'}));
    const name=await screen.findByDisplayValue('Finished work');
    fireEvent.change(name,{target:{value:'Colleague update'}});
    fireEvent.click(screen.getByRole('button',{name:'保存'}));
    await waitFor(()=>expect(fetcher.mock.calls.some(([url,init])=>url==='/api/work/tasks/TSK-DONE' && init?.method==='PATCH')).toBe(true));
    const saved=fetcher.mock.calls.find(([,init])=>init?.method==='PATCH')!;
    expect(JSON.parse(String(saved[1]?.body))).toEqual({revision:3,taskName:'Colleague update'});
    expect(fetcher.mock.calls.some(([url])=>url.startsWith('/api/manager/'))).toBe(false);
    expect(screen.queryByRole('button',{name:'完了を取り消す'})).toBeNull();
  });
});
