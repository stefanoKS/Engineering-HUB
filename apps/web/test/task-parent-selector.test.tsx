// @vitest-environment jsdom
/** The all-work "New task" flow: the parent selector must fill from the chosen project. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
  };
}
import { I18nProvider } from '../src/i18n';
import { TaskForm } from '../src/screens/TaskForm';
import { queryCache } from '../src/state/cache';

const response = (data: unknown): Response =>
  new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  queryCache.clear();
  vi.unstubAllGlobals();
});

describe('new task parent selector', () => {
  it('loads parent options for the project the manager picked', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes('parent-options')) {
          return response({
            items: [{ id: 'TSK-1', name: 'Browser verified task', path: 'Browser verified task', depth: 1 }],
            total: 1,
            page: 1,
            pageSize: 25,
            totalPages: 1,
            selected: null
          });
        }
        if (String(url).includes('/api/manager/projects/PRJ-A')) {
          return response({ record: { projectId: 'PRJ-A', projectName: 'Alpha' } });
        }
        if (String(url).includes('/api/manager/projects')) {
          return response({ items: [{ projectId: 'PRJ-A', projectName: 'Alpha' }], total: 1, totalPages: 1 });
        }
        return response({ items: [], total: 0, totalPages: 1 });
      })
    );
    render(
      <I18nProvider>
        <TaskForm references={{ members: [], skills: [], subprojects: [] }} onClose={() => undefined} onSaved={() => undefined} />
      </I18nProvider>
    );
    const project = (await screen.findByLabelText('プロジェクト')) as HTMLSelectElement;
    await waitFor(() => expect(project.options.length).toBeGreaterThan(1));
    fireEvent.change(project, { target: { value: 'PRJ-A' } });
    const parent = screen.getByLabelText('親タスク') as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(parent.options).map((option) => option.textContent)).toContain('Browser verified task');
    });
    expect(calls.filter((url) => url.includes('parent-options')).length).toBeGreaterThan(0);
  });
});
