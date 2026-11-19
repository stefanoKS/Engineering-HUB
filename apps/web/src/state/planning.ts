/**
 * Planning Board client model.
 *
 * One canonical draft object feeds the table, the chart and the review. It lives in page memory
 * only: nothing here writes `localStorage`, `sessionStorage` or IndexedDB. Every helper is pure so
 * an undo/redo entry is a whole previous draft, never a diff that could be applied twice.
 */
import type { PlanDraft, PlanItem, PlanItemType, PlanScheduleMode } from '@eh/contracts';
import { PLAN_CONTRACT_VERSION, PLAN_LIMITS } from '@eh/contracts';
import {
  flattenPlan,
  movePlanItemWithinParent,
  normalizePlanOrder,
  planDateRange,
  reparentPlanItem,
  reorderPlanItem,
  resolvePlanItemSchedule,
  shiftedPlanDates,
  resizedPlanFinish,
  resizedPlanStart,
  durationForStart,
  type PlanRow
} from '@eh/domain';
import { useCallback, useRef, useState } from 'react';

export type PlanDestinationMode = 'NEW_PROJECT' | 'EXISTING_PROJECT';
export type PlanVisibility = 'INTERNAL' | 'RESTRICTED';
export type PlanLifecycle = 'DRAFT' | 'EXPORTED' | 'ARCHIVED';

export type PlanState = {
  planId: string | null;
  revision: number;
  status: PlanLifecycle;
  title: string;
  divisionId: string;
  responsibilityId: string;
  destinationMode: PlanDestinationMode;
  destinationProjectId: string;
  projectOwnerId: string;
  dashboardVisibility: PlanVisibility;
  scheduleMode: PlanScheduleMode;
  items: PlanItem[];
};

export function emptyPlanState(title: string, divisionId: string): PlanState {
  return {
    planId: null,
    revision: 0,
    status: 'DRAFT',
    title,
    divisionId,
    responsibilityId: '',
    destinationMode: 'NEW_PROJECT',
    destinationProjectId: '',
    projectOwnerId: '',
    dashboardVisibility: 'RESTRICTED',
    scheduleMode: 'MANUAL',
    items: []
  };
}

export function planStateFromDraft(draft: PlanDraft): PlanState {
  return {
    planId: draft.planId,
    revision: draft.revision,
    status: draft.status,
    title: draft.title,
    divisionId: draft.divisionId ?? '',
    responsibilityId: draft.responsibilityId ?? '',
    destinationMode: draft.destinationMode,
    destinationProjectId: draft.destinationProjectId ?? '',
    projectOwnerId: draft.projectOwnerId ?? '',
    dashboardVisibility: draft.dashboardVisibility,
    scheduleMode: draft.scheduleMode,
    items: draft.items
  };
}

/** The exact body a save submits. Empty selections become `null`, never a sentinel string. */
export function planBodyOf(state: PlanState): {
  title: string;
  divisionId: string | null;
  responsibilityId: string | null;
  destinationMode: PlanDestinationMode;
  destinationProjectId: string | null;
  projectOwnerId: string | null;
  dashboardVisibility: PlanVisibility;
  scheduleMode: PlanScheduleMode;
  items: PlanItem[];
} {
  return {
    title: state.title.trim(),
    divisionId: state.divisionId || null,
    responsibilityId: state.destinationMode === 'NEW_PROJECT' ? state.responsibilityId || null : null,
    destinationMode: state.destinationMode,
    destinationProjectId:
      state.destinationMode === 'EXISTING_PROJECT' ? state.destinationProjectId || null : null,
    projectOwnerId: state.destinationMode === 'NEW_PROJECT' ? state.projectOwnerId || null : null,
    dashboardVisibility: state.dashboardVisibility,
    scheduleMode: state.scheduleMode,
    items: normalizePlanOrder(state.items)
  };
}

export function newDraftItemId(): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `pi-${suffix}`.slice(0, 64);
}

export function planRows(state: PlanState): PlanRow[] {
  return flattenPlan(state.items);
}

export function childCount(state: PlanState, itemId: string): number {
  return state.items.filter((item) => item.parentItemId === itemId).length;
}

export function itemById(state: PlanState, itemId: string | null): PlanItem | null {
  return itemId ? state.items.find((item) => item.itemId === itemId) ?? null : null;
}

export function siblingsOf(state: PlanState, parentItemId: string | null): PlanItem[] {
  return state.items
    .filter((item) => (item.parentItemId ?? null) === parentItemId)
    .sort((left, right) => left.order - right.order);
}

export type AddItemInput = {
  type: PlanItemType;
  parentItemId: string | null;
  name?: string;
  startDate?: string | null;
  finishDate?: string | null;
  afterItemId?: string | null;
};

export function addItem(state: PlanState, input: AddItemInput): { state: PlanState; itemId: string } {
  if (state.items.length >= PLAN_LIMITS.maxItems) {
    throw new Error(`A plan is limited to ${PLAN_LIMITS.maxItems} items`);
  }
  const itemId = newDraftItemId();
  const siblings = siblingsOf(state, input.parentItemId);
  const afterIndex = input.afterItemId
    ? siblings.findIndex((entry) => entry.itemId === input.afterItemId)
    : siblings.length - 1;
  const order = afterIndex >= 0 ? afterIndex + 1 : siblings.length;
  const item: PlanItem = {
    itemId,
    type: input.type,
    parentItemId: input.parentItemId,
    order,
    name: input.name ?? '',
    startDate: input.startDate ?? null,
    finishDate: input.finishDate ?? null,
    durationValue: null,
    durationUnit: null,
    durationBasis: null,
    ownerMemberId: null,
    assigneeIds: []
  };
  const items = [...state.items, item];
  const next = normalizePlanOrder(shiftSiblingOrders(items, input.parentItemId, order));
  return { state: { ...state, items: next }, itemId };
}

/** Opens a gap at `position` inside one sibling group without touching any other field. */
function shiftSiblingOrders(items: PlanItem[], parentItemId: string | null, position: number): PlanItem[] {
  return items.map((item) => {
    if ((item.parentItemId ?? null) !== parentItemId) return item;
    return item.order >= position ? { ...item, order: item.order + 1 } : item;
  });
}

export function updateItem(state: PlanState, itemId: string, patch: Partial<PlanItem>): PlanState {
  return {
    ...state,
    items: state.items.map((item) => (item.itemId === itemId ? { ...item, ...patch, itemId } : item))
  };
}

/** Removes an item *and its descendants* as one undoable action; identifiers are never reused. */
export function removeSubtree(state: PlanState, itemId: string): { state: PlanState; removed: string[] } {
  const removed = new Set<string>([itemId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of state.items) {
      if (item.parentItemId && removed.has(item.parentItemId) && !removed.has(item.itemId)) {
        removed.add(item.itemId);
        changed = true;
      }
    }
  }
  return {
    state: { ...state, items: normalizePlanOrder(state.items.filter((item) => !removed.has(item.itemId))) },
    removed: [...removed]
  };
}

export function moveItem(state: PlanState, itemId: string, direction: -1 | 1): PlanState {
  return { ...state, items: movePlanItemWithinParent(state.items, itemId, direction) };
}

export function reorderItem(state: PlanState, itemId: string, targetIndex: number): PlanState {
  return { ...state, items: reorderPlanItem(state.items, itemId, targetIndex) };
}

export function reparentItem(state: PlanState, itemId: string, parentItemId: string | null): PlanState {
  return { ...state, items: reparentPlanItem(state.items, itemId, parentItemId, 'END') };
}

export function indentItem(state: PlanState, itemId: string): PlanState {
  const item = itemById(state, itemId);
  if (!item) return state;
  const siblings = siblingsOf(state, item.parentItemId);
  const position = siblings.findIndex((entry) => entry.itemId === itemId);
  if (position <= 0) return state;
  const previous = siblings[position - 1] as PlanItem;
  if (item.type === 'SUBPROJECT' && previous.type !== 'SUBPROJECT') return state;
  return reparentItem(state, itemId, previous.itemId);
}

export function outdentItem(state: PlanState, itemId: string): PlanState {
  const item = itemById(state, itemId);
  if (!item || !item.parentItemId) return state;
  const parent = itemById(state, item.parentItemId);
  if (!parent) return state;
  return reparentItem(state, itemId, parent.parentItemId);
}

export type DragKind = 'move' | 'resize-start' | 'resize-finish';

/**
 * The date patch one completed drag applies.
 *
 * Manual mode moves both endpoints; duration mode moves the deadline and derives the start, and
 * its left edge adjusts the required duration instead of writing a start.
 */
export function dragPatch(
  item: PlanItem,
  mode: PlanScheduleMode,
  kind: DragKind,
  deltaDays: number
): Partial<PlanItem> {
  if (kind === 'move') return shiftedPlanDates(item, mode, deltaDays);
  if (kind === 'resize-start') {
    if (mode === 'DURATION') {
      const schedule = resolvePlanItemSchedule(item, mode);
      if (!schedule.start || !schedule.finish) return {};
      const nextStart = shiftIso(schedule.start, deltaDays);
      const duration = durationForStart(nextStart, schedule.finish, item.durationBasis);
      return duration
        ? {
            durationValue: duration.durationValue,
            durationUnit: duration.durationUnit,
            durationBasis: duration.durationBasis
          }
        : {};
    }
    return resizedPlanStart(item, mode, deltaDays);
  }
  return resizedPlanFinish(item, mode, deltaDays);
}

function shiftIso(value: string, days: number): string {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

export function assignItems(
  state: PlanState,
  itemIds: readonly string[],
  input: { ownerMemberId?: string | null; assigneeIds?: string[] }
): PlanState {
  const selected = new Set(itemIds);
  return {
    ...state,
    items: state.items.map((item) => {
      if (!selected.has(item.itemId)) return item;
      const ownerMemberId = input.ownerMemberId !== undefined ? input.ownerMemberId : item.ownerMemberId;
      let assigneeIds = input.assigneeIds !== undefined ? [...input.assigneeIds] : [...item.assigneeIds];
      if (ownerMemberId) assigneeIds = assigneeIds.filter((id) => id !== ownerMemberId);
      return { ...item, ownerMemberId, assigneeIds: [...new Set(assigneeIds)] };
    })
  };
}

export type LocalPlanProblem = { itemId: string | null; field: string; messageKey: string };

/**
 * Problems the *browser* can see before a save: a plan needs a title, and a date field must be
 * either empty or a real calendar date. An invalid date keeps its typed text and blocks a save
 * instead of being silently replaced by an empty value.
 */
export function localPlanProblems(state: PlanState): LocalPlanProblem[] {
  const problems: LocalPlanProblem[] = [];
  if (!state.title.trim()) problems.push({ itemId: null, field: 'title', messageKey: 'planning.error.title' });
  for (const item of state.items) {
    for (const field of ['startDate', 'finishDate'] as const) {
      const value = item[field];
      if (value && !isRealDate(value)) {
        problems.push({ itemId: item.itemId, field, messageKey: 'planning.error.date' });
      }
    }
    if (item.name.length > PLAN_LIMITS.maxNameLength) {
      problems.push({ itemId: item.itemId, field: 'name', messageKey: 'planning.error.nameLength' });
    }
  }
  return problems;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function planRange(state: PlanState): { from: string; to: string } | null {
  return planDateRange(state.items, state.scheduleMode);
}

/* ------------------------------- undo/redo ------------------------------- */

export type PlanHistory = {
  present: PlanState;
  canUndo: boolean;
  canRedo: boolean;
  /** Applies a new state and records the previous one as one undoable action. */
  commit: (next: PlanState) => void;
  /** Applies a local-only state (drag preview) without changing the history. */
  replace: (next: PlanState) => void;
  undo: () => void;
  redo: () => void;
  reset: (next: PlanState) => void;
};

const HISTORY_LIMIT = 60;

export function usePlanHistory(initial: PlanState): PlanHistory {
  const [past, setPast] = useState<PlanState[]>([]);
  const [present, setPresent] = useState<PlanState>(initial);
  const [future, setFuture] = useState<PlanState[]>([]);
  const presentRef = useRef(present);
  presentRef.current = present;

  const commit = useCallback((next: PlanState) => {
    setPast((entries) => [...entries.slice(-(HISTORY_LIMIT - 1)), presentRef.current]);
    setFuture([]);
    setPresent(next);
  }, []);
  const replace = useCallback((next: PlanState) => setPresent(next), []);
  const undo = useCallback(() => {
    setPast((entries) => {
      if (!entries.length) return entries;
      const previous = entries[entries.length - 1] as PlanState;
      setFuture((current) => [presentRef.current, ...current].slice(0, HISTORY_LIMIT));
      setPresent(previous);
      return entries.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((entries) => {
      if (!entries.length) return entries;
      const next = entries[0] as PlanState;
      setPast((current) => [...current.slice(-(HISTORY_LIMIT - 1)), presentRef.current]);
      setPresent(next);
      return entries.slice(1);
    });
  }, []);
  const reset = useCallback((next: PlanState) => {
    setPast([]);
    setFuture([]);
    setPresent(next);
  }, []);

  return { present, canUndo: past.length > 0, canRedo: future.length > 0, commit, replace, undo, redo, reset };
}

export { PLAN_CONTRACT_VERSION, PLAN_LIMITS };
