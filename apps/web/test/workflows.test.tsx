// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { TaskForm } from '../src/screens/TaskForm';
import { RequestForm } from '../src/screens/Overview';
import { useEditorState } from '../src/state/editor';
import { queryCache } from '../src/state/cache';
import { ColorPicker } from '../src/components/ColorPicker';
afterEach(() => { cleanup(); queryCache.clear(); vi.unstubAllGlobals(); window.localStorage.clear(); });
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
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
