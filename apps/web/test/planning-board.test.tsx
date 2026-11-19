// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Actor } from '@eh/contracts';
import { api } from '../src/api/client';
import { I18nProvider, useI18n } from '../src/i18n';
import { LanguageSwitch } from '../src/components/ui';
import { PlanningBoardScreen } from '../src/screens/PlanningBoard';
import { queryCache } from '../src/state/cache';
import { clearDivisionScope, setDivisionScope } from '../src/state/division';
import { resetRouteMemory } from '../src/state/navigation';
import {
  addItem,
  assignItems,
  dragPatch,
  emptyPlanState,
  localPlanProblems,
  moveItem,
  removeSubtree,
  updateItem
} from '../src/state/planning';

const actor: Actor = {
  memberId: 'MEM-1',
  name: 'Manager',
  email: 'manager@example.invalid',
  role: 'MANAGER',
  active: true,
  verified: true,
  selfServiceEnabled: true
};

const plansResponse = { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 };
const referencesResponse = {
  responsibilities: [{ id: 'RSP-1', name: '設計分野', status: 'Active', divisionId: 'DIV-DEV' }],
  members: [
    {
      memberId: 'MEM-1',
      name: 'Alice',
      active: true,
      role: 'MANAGER',
      divisionNames: ['設計・開発課'],
      workDivisionIds: ['DIV-DEV']
    },
    {
      memberId: 'MEM-2',
      name: 'Bob',
      active: true,
      role: 'MEMBER',
      divisionNames: ['設計・開発課'],
      workDivisionIds: ['DIV-DEV']
    }
  ],
  skills: [],
  subprojects: []
};

class PointerEventPolyfill extends MouseEvent {
  pointerId: number;
  constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 1;
  }
}

beforeEach(() => {
  (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PointerEventPolyfill;
  window.localStorage.clear();
  resetRouteMemory();
  setDivisionScope({
    readable: [{ divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' }],
    writable: [{ divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' }],
    allDivisions: false,
    defaultDivisionId: 'DIV-DEV'
  });
  vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url.startsWith('/api/manager/plans')) return Promise.resolve(plansResponse);
    if (url.startsWith('/api/manager/references')) return Promise.resolve(referencesResponse);
    return Promise.resolve({});
  });
});

afterEach(() => {
  cleanup();
  queryCache.clear();
  clearDivisionScope();
  vi.restoreAllMocks();
});

function LanguageButton(): JSX.Element {
  const { language, setLanguage } = useI18n();
  return <LanguageSwitch language={language} onChange={setLanguage} />;
}

async function renderBoard(): Promise<void> {
  render(
    <I18nProvider>
      <LanguageButton />
      <PlanningBoardScreen actor={actor} />
    </I18nProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.pb-row:not(.pb-head)')];
}

function barOf(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>('.pb-bar');
}

/** Row inputs are selected by class, because a details panel repeats the same field labels. */
function nameInput(index = 0): HTMLInputElement {
  return document.querySelectorAll<HTMLInputElement>('.pb-name')[index] as HTMLInputElement;
}

function dateInputs(index = 0): { start: HTMLInputElement; finish: HTMLInputElement } {
  const inputs = (rows()[index] as HTMLElement).querySelectorAll<HTMLInputElement>('.pb-date');
  return { start: inputs[0] as HTMLInputElement, finish: inputs[1] as HTMLInputElement };
}

function startInput(index = 0): HTMLInputElement {
  return dateInputs(index).start;
}

function finishInput(index = 0): HTMLInputElement {
  return dateInputs(index).finish;
}

describe('planning board editing', () => {
  it('renders a typed name and a valid date on the bar immediately', async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'サブプロジェクトを追加' }));
    expect(rows()).toHaveLength(1);
    expect(barOf(rows()[0] as HTMLElement)).toBeNull();

    fireEvent.change(nameInput(), { target: { value: '設計' } });
    fireEvent.change(startInput(), { target: { value: '2026-11-02' } });
    fireEvent.change(finishInput(), { target: { value: '2026-11-06' } });
    fireEvent.click(screen.getByRole('button', { name: '全体を表示' }));

    const row = rows()[0] as HTMLElement;
    expect(row.querySelector('.pb-bar-label')?.textContent).toBe('設計');
    const geometry = { left: barOf(row)?.style.left, width: barOf(row)?.style.width };
    expect(geometry.left).not.toBe('');
    expect(Number.parseFloat(geometry.width ?? '0')).toBeGreaterThan(0);

    fireEvent.change(finishInput(), { target: { value: '2026-11-10' } });
    expect(Number.parseFloat(barOf(rows()[0] as HTMLElement)?.style.width ?? '0')).toBeGreaterThan(
      Number.parseFloat(geometry.width ?? '0')
    );
  });

  it('keeps manual order when a date changes and does not change other fields when reordering', async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'サブプロジェクトを追加' }));
    fireEvent.click(screen.getByRole('button', { name: 'サブプロジェクトを追加' }));
    fireEvent.change(nameInput(0), { target: { value: 'Alpha' } });
    fireEvent.change(nameInput(1), { target: { value: 'Beta' } });
    fireEvent.change(finishInput(0), { target: { value: '2026-11-06' } });

    const betaRow = rows()[1] as HTMLElement;
    fireEvent.click(betaRow.querySelector<HTMLElement>('.pb-row-menu .menu-trigger') as HTMLElement);
    fireEvent.click(screen.getByRole('menuitem', { name: '上へ移動' }));
    expect(nameInput(0).value).toBe('Beta');
    expect(finishInput(1).value).toBe('2026-11-06');

    fireEvent.change(finishInput(1), { target: { value: '2026-11-12' } });
    expect(nameInput(0).value).toBe('Beta');
    expect(nameInput(1).value).toBe('Alpha');
    expect(finishInput(0).value).toBe('');
  });

  it('undoes and redoes a typed edit as one logical action', async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'サブプロジェクトを追加' }));
    fireEvent.change(nameInput(), { target: { value: 'Alpha' } });
    expect(nameInput().value).toBe('Alpha');

    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(nameInput().value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'やり直す' }));
    expect(nameInput().value).toBe('Alpha');
  });

  it('keeps the draft through a language change', async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'サブプロジェクトを追加' }));
    fireEvent.change(nameInput(), { target: { value: '設計' } });
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Planning Board' })).toBeTruthy();
    expect((document.querySelectorAll<HTMLInputElement>('.pb-name')[0] as HTMLInputElement).value).toBe('設計');
  });

  it('Escape cancels a bar drag and one release is one undoable change', async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'サブプロジェクトを追加' }));
    fireEvent.change(startInput(), { target: { value: '2026-11-02' } });
    fireEvent.change(finishInput(), { target: { value: '2026-11-06' } });
    fireEvent.click(screen.getByRole('button', { name: '全体を表示' }));
    const bar = barOf(rows()[0] as HTMLElement) as HTMLElement;
    const pixelsPerDay = 10;

    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 100 + pixelsPerDay * 3, pointerId: 1 });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerUp(bar, { clientX: 100 + pixelsPerDay * 3, pointerId: 1 });
    expect(finishInput().value).toBe('2026-11-06');

    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 100 + pixelsPerDay * 3, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 100 + pixelsPerDay * 3, pointerId: 1 });
    expect(startInput().value).toBe('2026-11-05');
    expect(finishInput().value).toBe('2026-11-09');

    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(finishInput().value).toBe('2026-11-06');
  });
});

describe('planning draft model', () => {
  const base = emptyPlanState('Plan', 'DIV-DEV');

  it('keeps an invalid date as typed input and blocks a save', () => {
    const added = addItem(base, { type: 'TASK', parentItemId: null });
    const broken = updateItem(added.state, added.itemId, { startDate: '2026-13-01' });
    const problems = localPlanProblems(broken);
    expect(problems.map((problem) => problem.messageKey)).toContain('planning.error.date');
    expect(broken.items[0]?.startDate).toBe('2026-13-01');
  });

  it('computes drag patches per mode without changing identifiers or owners', () => {
    const added = addItem(base, { type: 'TASK', parentItemId: null });
    const item = {
      ...added.state.items[0]!,
      startDate: '2026-11-02',
      finishDate: '2026-11-06',
      ownerMemberId: 'MEM-2'
    };
    expect(dragPatch(item, 'MANUAL', 'move', 2)).toMatchObject({
      startDate: '2026-11-04',
      finishDate: '2026-11-08'
    });
    expect(dragPatch(item, 'MANUAL', 'resize-finish', 1)).toMatchObject({
      startDate: '2026-11-02',
      finishDate: '2026-11-07'
    });
    expect(item.ownerMemberId).toBe('MEM-2');
  });

  it('applies a bulk assignment without touching dates or order', () => {
    const first = addItem(base, { type: 'TASK', parentItemId: null });
    const second = addItem(first.state, { type: 'TASK', parentItemId: null, startDate: '2026-11-02' });
    const assigned = assignItems(second.state, [first.itemId], {
      ownerMemberId: 'MEM-1',
      assigneeIds: ['MEM-1', 'MEM-2']
    });
    const updated = assigned.items.find((item) => item.itemId === first.itemId);
    expect(updated).toMatchObject({ ownerMemberId: 'MEM-1', assigneeIds: ['MEM-2'], startDate: null, order: 0 });
    expect(assigned.items.find((item) => item.itemId === second.itemId)?.startDate).toBe('2026-11-02');
  });

  it('removes a branch as one action and keeps sibling order stable', () => {
    const root = addItem(base, { type: 'SUBPROJECT', parentItemId: null });
    const child = addItem(root.state, { type: 'TASK', parentItemId: root.itemId });
    const sibling = addItem(child.state, { type: 'SUBPROJECT', parentItemId: null });
    const removed = removeSubtree(sibling.state, root.itemId);
    expect(removed.removed).toHaveLength(2);
    expect(removed.state.items.map((item) => item.itemId)).toEqual([sibling.itemId]);
    expect(moveItem(removed.state, sibling.itemId, -1).items).toHaveLength(1);
  });
});
