// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { TaskForm } from '../src/screens/TaskForm';
import { RequestForm } from '../src/screens/Overview';
import { TasksScreen } from '../src/screens/Tasks';
import { MyWorkScreen } from '../src/screens/MyWork';
import { useEditorState } from '../src/state/editor';
import { queryCache } from '../src/state/cache';
import { ColorPicker } from '../src/components/ColorPicker';
afterEach(() => { cleanup(); queryCache.clear(); vi.unstubAllGlobals(); window.localStorage.clear(); });
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
const MEMBER_ACTOR = {
  memberId: 'MEM-MEMBER',
  name: 'Member',
  email: 'member@example.invalid',
  role: 'MEMBER',
  active: true,
  verified: true,
  selfServiceEnabled: true
} as const;
function Editor(): JSX.Element {
  const [value, set, load] = useEditorState('closed');
  return <><span>{value}</span><button onClick={() => void load(() => fetch('/a').then(r => r.text()))}>A</button><button onClick={() => void load(() => fetch('/b').then(r => r.text()))}>B</button><button onClick={() => set('closed')}>Close</button></>;
}
describe('workflow recovery', () => {
  it('does not paint a superseded editor response or reopen a closed editor', async () => {
    const pending: Record<string, (r: Response) => void> = {};
    vi.stubGlobal('fetch', vi.fn((url: string) => new Promise(resolve => { pending[url] = resolve; })));
    render(<Editor />);
    fireEvent.click(screen.getByText('A')); fireEvent.click(screen.getByText('B'));
    await act(async () => { pending['/b']!(new Response('Record B')); });
    await act(async () => { pending['/a']!(new Response('Record A')); });
    expect(screen.getByText('Record B')).toBeTruthy();
    fireEvent.click(screen.getByText('A')); fireEvent.click(screen.getByText('Close'));
    await act(async () => { pending['/a']!(new Response('Record A')); });
    expect(screen.getByText('closed')).toBeTruthy();
  });
  it('shows only subprojects from the chosen project and explicitly scopes parent requests', async () => {
    const fetcher = vi.fn(async (url: string) => response(url.includes('parent-options') ? { items: [] } : url.includes('/PRJ-A') ? { record: { projectId: 'PRJ-A', projectName: 'Alpha' } } : { items: [{ projectId: 'PRJ-A', projectName: 'Alpha' }], total: 1, totalPages: 1 }));
    vi.stubGlobal('fetch', fetcher);
    render(<I18nProvider><TaskForm initialProjectId="PRJ-A" references={{ members: [], skills: [], subprojects: [
      { id: 'SUB-A', name: 'Correct area', projectId: 'PRJ-A', parentId: null, status: 'Active' },
      { id: 'SUB-B', name: 'Wrong area', projectId: 'PRJ-B', parentId: null, status: 'Active' }
    ] }} onClose={() => undefined} onSaved={() => undefined} /></I18nProvider>);
    expect(await screen.findByText('Correct area')).toBeTruthy();
    expect(screen.queryByText('Wrong area')).toBeNull();
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('subprojectId='))).toBe(true));
  });
  it('retains request text while an uncertain submission is being recovered', () => {
    const onSubmit = vi.fn(async () => undefined);
    const form = (submission: 'idle' | 'unknown') => <I18nProvider><RequestForm taskId="TSK-A" requestType="COMPLETION_REPORT" submission={submission} onCancel={() => undefined} onSubmit={onSubmit} /></I18nProvider>;
    const view = render(form('idle'));
    const fields = screen.getAllByRole('textbox');
    fireEvent.change(fields[0]!, { target: { value: 'Work completed; evidence checked.' } });
    view.rerender(form('unknown'));
    expect((fields[0] as HTMLTextAreaElement).value).toBe('Work completed; evidence checked.');
    fireEvent.click(screen.getByText('再試行'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ completionNote: 'Work completed; evidence checked.' }));
  });
  it('offers named colour buttons with an explicit selected state', () => {
    const change = vi.fn();
    render(<I18nProvider><ColorPicker value="#4F46E5" onChange={change} /></I18nProvider>);
    expect(screen.getByRole('button', { name: '#4F46E5' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '#0D9488' }));
    expect(change).toHaveBeenCalledWith('#0D9488');
  });
});

describe('member self-service work', () => {
  function projects() {
    return {
      taskCreationEnabled: true,
      items: [
        {
          projectId: 'PRJ-A',
          projectName: 'Alpha',
          responsibilityName: 'Area',
          subprojects: [{ subprojectId: 'SUB-A', subprojectName: 'Phase 1' }]
        }
      ]
    };
  }

  function stubWork(options: { submissionEnabled: boolean; items?: unknown[] }) {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (method === 'POST' && url.endsWith('/api/employee/requests')) return response({ requestId: 'REQ-NEW' });
      if (url.includes('/projects')) return response(projects());
      if (url.includes('/requests/mine')) return response({ items: [], submissionEnabled: options.submissionEnabled });
      if (method === 'POST' && url.endsWith('/api/employee/my-work')) return response({ taskId: 'TSK-NEW', replayed: false });
      return response({ items: options.items ?? [], total: options.items?.length ?? 0 });
    });
    vi.stubGlobal('fetch', fetcher);
    return calls;
  }

  it('creates a task from the member form without sending an owner or an assignee', async () => {
    vi.stubGlobal('crypto', {}); // Plain HTTP LAN may not expose randomUUID.
    const calls = stubWork({ submissionEnabled: true });
    render(<I18nProvider><MyWorkScreen actor={MEMBER_ACTOR} /></I18nProvider>);
    expect(await screen.findByText('Alpha / Area')).toBeTruthy();

    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'PRJ-A' } });
    fireEvent.change(screen.getByLabelText('タスク名'), { target: { value: '配線図の更新' } });
    fireEvent.change(screen.getByLabelText('期限'), { target: { value: '2026-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'タスクを作成' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    const posted = JSON.parse(calls.find((call) => call.method === 'POST')!.body!) as Record<string, unknown>;
    expect(posted).toMatchObject({ projectId: 'PRJ-A', taskName: '配線図の更新', deadline: '2026-05-01' });
    expect(posted).not.toHaveProperty('ownerMemberId');
    expect(posted).not.toHaveProperty('assigneeIds');
    expect(posted).not.toHaveProperty('status');
    expect(await screen.findByText(/タスクを作成しました/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('タスク名'), { target: { value: 'Second task' } });
    fireEvent.change(screen.getByLabelText('期限'), { target: { value: '2026-05-04' } });
    fireEvent.click(screen.getByRole('button', { name: 'タスクを作成' }));
    await waitFor(() => expect(calls.filter(call => call.method === 'POST')).toHaveLength(2));
    const second = JSON.parse(calls.filter(call => call.method === 'POST')[1]!.body!);
    expect(second.idempotencyKey).not.toBe(posted.idempotencyKey);
  });

  it('disables the completion report while request submission is closed', async () => {
    stubWork({ submissionEnabled: false });
    render(<I18nProvider><MyWorkScreen actor={MEMBER_ACTOR} /></I18nProvider>);
    expect(await screen.findByText(/申請の受付は停止しています/)).toBeTruthy();
  });

  it('submits a completion report without claiming that the task is done', async () => {
    const calls=stubWork({submissionEnabled:true,items:[{container:false,taskId:'TSK-REPORT',taskName:'Report work',projectId:'PRJ-A',projectName:'Alpha',subprojectName:'',status:'Not Started',displayStatus:'IN_PROGRESS',priority:'Medium',dueDate:null,progressPercent:0,actualHours:0,reviewState:'NONE',lastRequestStatus:'',lastRequestType:'',pendingRequest:false,creationChannel:'MEMBER',completedAt:null,revision:1}]});
    render(<I18nProvider><MyWorkScreen actor={MEMBER_ACTOR} /></I18nProvider>);
    await screen.findByText('Report work');
    fireEvent.click(screen.getByRole('button',{name:'完了報告'}));
    const note=screen.getAllByRole('textbox').at(-1)!;
    fireEvent.change(note,{target:{value:'Checked the result'}});
    fireEvent.click(screen.getByRole('button',{name:'報告を送信'}));
    await waitFor(()=>expect(calls.some(call=>call.url.endsWith('/api/employee/requests')&&call.method==='POST')).toBe(true));
    const posted=JSON.parse(calls.find(call=>call.url.endsWith('/api/employee/requests')&&call.method==='POST')!.body!);
    expect(posted).toMatchObject({taskId:'TSK-REPORT',requestType:'COMPLETION_REPORT',completionNote:'Checked the result'});
    expect(posted).not.toHaveProperty('requesterName');
    expect(await screen.findByText(/REQ-NEW/)).toBeTruthy();
    expect(screen.getByText(/進行中|In progress/)).toBeTruthy();
  });

  it('offers no second completion report while one is pending', async () => {
    stubWork({
      submissionEnabled: true,
      items: [
        {
          container: false,
          taskId: 'TSK-1',
          taskName: '配線確認',
          projectId: 'PRJ-A',
          projectName: 'Alpha',
          subprojectName: '',
          status: 'In Progress',
          displayStatus: 'IN_PROGRESS',
          priority: 'Medium',
          dueDate: '2026-05-01',
          progressPercent: 40,
          actualHours: 2,
          reviewState: 'PENDING',
          lastRequestStatus: 'PENDING',
          lastRequestType: 'COMPLETION_REPORT',
          pendingRequest: true,
          creationChannel: 'MEMBER',
          completedAt: null,
          revision: 3
        }
      ]
    });
    render(<I18nProvider><MyWorkScreen actor={MEMBER_ACTOR} /></I18nProvider>);
    expect(await screen.findByText('配線確認')).toBeTruthy();
    expect(screen.getAllByText('承認待ち').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: '完了報告' }) as HTMLButtonElement).disabled).toBe(true);
  });
});


describe('collapsible task tree', () => {
  it('opens children directly below their parent and preserves nested expansion after collapse', async () => {
    const task=(taskId:string,taskName:string,parentTaskId:string|null,depth:number,container:boolean)=>({taskId,taskName,parentTaskId,depth,container,projectId:'PRJ-TREE',projectName:'Tree',status:'Not Started',displayStatus:'IN_PROGRESS',priority:'Medium',ownerName:'',assigneeNames:[],assigneeIds:[],dueDate:null,progressPercent:0,overdue:false,reviewState:'NONE',revision:1});
    const root=task('ROOT','Root',null,1,true),child=task('CHILD','Child','ROOT',2,true),leaf=task('LEAF','Leaf','CHILD',3,false),other=task('OTHER','Other',null,1,false);
    const fetcher=vi.fn(async(url:string)=>{
      if(url.includes('/references'))return response({members:[],skills:[],subprojects:[]});
      if(url.includes('/projects'))return response({items:[],total:0,totalPages:1});
      const parent=new URL(url,'http://test').searchParams.get('treeParentId');
      const items=parent==='ROOT'?[child]:parent==='CHILD'?[leaf]:[root,other];
      return response({items,total:items.length,matchedTotal:4,page:1,pageSize:25,totalPages:1});
    });
    vi.stubGlobal('fetch',fetcher);
    const view=render(<I18nProvider><TasksScreen actor={{memberId:'A',name:'Admin',email:'fixture@example.invalid',role:'ADMIN',active:true,verified:true,selfServiceEnabled:false}} /></I18nProvider>);
    await screen.findByText('Root');
    expect(screen.queryByText('Child')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Root の子タスクを開く'}));
    await screen.findByText('Child');
    fireEvent.click(screen.getByRole('button',{name:'Child の子タスクを開く'}));
    await screen.findByText('Leaf');
    expect(Array.from(view.container.querySelectorAll('tr[data-task-id]')).map(row=>row.getAttribute('data-task-id'))).toEqual(['ROOT','CHILD','LEAF','OTHER']);
    fireEvent.click(screen.getByRole('button',{name:'Root の子タスクを閉じる'}));
    expect(screen.queryByText('Child')).toBeNull();
    expect(screen.queryByText('Leaf')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Root の子タスクを開く'}));
    await screen.findByText('Leaf');
    expect(screen.getByRole('button',{name:'Child の子タスクを閉じる'}).getAttribute('aria-expanded')).toBe('true');
    expect(fetcher.mock.calls.filter(([url])=>url.includes('treeParentId=ROOT'))).toHaveLength(1);
  });
});
