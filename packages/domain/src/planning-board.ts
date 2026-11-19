/**
 * Planning Board (計画ボード) draft rules.
 *
 * One canonical set of pure functions decides the draft hierarchy, the manual order and the
 * schedule of every plan item. The browser renders from the same rules, so the table, the Gantt
 * chart and the export review cannot drift apart.
 *
 * The rules deliberately reuse the operational limits (`MAX_SUBPROJECT_DEPTH`,
 * `MAX_TASK_DEPTH`) and the one duration derivation (`planFromDuration`). A draft is never an
 * operational record: nothing here writes, progresses, approves or notifies.
 */
import type { PlanItem, PlanItemType, PlanScheduleMode } from '@eh/contracts';
import { PLAN_LIMITS } from '@eh/contracts';
import { DomainError } from './errors';
import { MAX_SUBPROJECT_DEPTH, MAX_TASK_DEPTH } from './hierarchy';
import { planFromDuration } from './planning';
import { addDays, createCalendar, diffDays, isIsoDate, isWeekend, type WorkingCalendar } from './time';

export type PlanIssueCode =
  | 'DUPLICATE_ID'
  | 'UNKNOWN_PARENT'
  | 'SELF_PARENT'
  | 'CYCLE'
  | 'INVALID_PARENT_TYPE'
  | 'SUBPROJECT_DEPTH'
  | 'TASK_DEPTH'
  | 'TOO_MANY_ITEMS';

export type PlanIssue = { itemId: string | null; code: PlanIssueCode; message: string };

export type PlanIndex = {
  byId: Map<string, PlanItem>;
  children: Map<string, PlanItem[]>;
};

/** One stable index for the whole draft; sibling lists are ordered by the manual order. */
export function buildPlanIndex(items: readonly PlanItem[]): PlanIndex {
  const byId = new Map<string, PlanItem>();
  const children = new Map<string, PlanItem[]>();
  for (const item of items) {
    if (!item.itemId || byId.has(item.itemId)) continue;
    byId.set(item.itemId, item);
  }
  for (const item of byId.values()) {
    const key = item.parentItemId ?? '';
    const list = children.get(key) ?? [];
    list.push(item);
    children.set(key, list);
  }
  for (const list of children.values()) list.sort(compareSiblings);
  return { byId, children };
}

function compareSiblings(left: PlanItem, right: PlanItem): number {
  return (
    left.order - right.order ||
    left.name.localeCompare(right.name, 'ja') ||
    left.itemId.localeCompare(right.itemId)
  );
}

export function planSiblings(index: PlanIndex, parentItemId: string | null): PlanItem[] {
  return [...(index.children.get(parentItemId ?? '') ?? [])];
}

/** A bounded ancestor walk; a malformed link raises rather than recursing. */
export function planAncestors(itemId: string, index: PlanIndex): PlanItem[] {
  const result: PlanItem[] = [];
  const seen = new Set<string>([itemId]);
  let current = index.byId.get(itemId)?.parentItemId ?? null;
  let guard = 0;
  while (current) {
    if (seen.has(current)) throw new DomainError('HIERARCHY_CYCLE', 'The plan hierarchy links form a cycle');
    seen.add(current);
    const parent = index.byId.get(current);
    if (!parent) break;
    result.push(parent);
    current = parent.parentItemId;
    if (++guard > 64) throw new DomainError('HIERARCHY_CYCLE', 'The hierarchy walk exceeded a safe bound');
  }
  return result;
}

/** The subproject a task belongs to, or null for a direct project task. */
export function nearestSubprojectId(itemId: string, index: PlanIndex): string | null {
  return planAncestors(itemId, index).find((entry) => entry.type === 'SUBPROJECT')?.itemId ?? null;
}

export function planItemLevel(itemId: string, index: PlanIndex): number {
  return planAncestors(itemId, index).length + 1;
}

export type PlanRow = { item: PlanItem; depth: number; path: string[] };

/**
 * The visible order of the whole draft, parents before their descendants.
 *
 * A node whose parent is missing or that sits in a cycle is still listed (at the root) so it can be
 * repaired instead of silently disappearing. Nothing is truncated.
 */
export function flattenPlan(items: readonly PlanItem[]): PlanRow[] {
  const index = buildPlanIndex(items);
  const rows: PlanRow[] = [];
  const visited = new Set<string>();
  const walk = (item: PlanItem, depth: number, trail: Set<string>, path: string[]): void => {
    if (visited.has(item.itemId) || trail.has(item.itemId)) return;
    visited.add(item.itemId);
    trail.add(item.itemId);
    const nextPath = [...path, item.name];
    rows.push({ item, depth, path: nextPath });
    for (const child of planSiblings(index, item.itemId)) walk(child, depth + 1, trail, nextPath);
    trail.delete(item.itemId);
  };
  for (const root of planSiblings(index, null)) walk(root, 1, new Set(), []);
  const remaining = items
    .filter((item) => index.byId.get(item.itemId) === item && !visited.has(item.itemId))
    .sort(compareSiblings);
  for (const item of remaining) walk(item, 1, new Set(), []);
  return rows;
}

/** Structural issues that make a draft unusable for export, without throwing. */
export function planHierarchyIssues(items: readonly PlanItem[]): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (items.length > PLAN_LIMITS.maxItems) {
    issues.push({
      itemId: null,
      code: 'TOO_MANY_ITEMS',
      message: `A plan is limited to ${PLAN_LIMITS.maxItems} items`
    });
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.itemId)) {
      issues.push({ itemId: item.itemId, code: 'DUPLICATE_ID', message: 'The same draft item appears twice' });
    }
    seen.add(item.itemId);
    if (item.parentItemId === item.itemId) {
      issues.push({ itemId: item.itemId, code: 'SELF_PARENT', message: 'An item cannot be its own parent' });
    }
  }
  const index = buildPlanIndex(items);
  for (const item of index.byId.values()) {
    const parent = item.parentItemId ? index.byId.get(item.parentItemId) : null;
    if (item.parentItemId && !parent) {
      issues.push({ itemId: item.itemId, code: 'UNKNOWN_PARENT', message: 'The parent item is missing' });
      continue;
    }
    if (parent) {
      const allowed =
        item.type === 'SUBPROJECT'
          ? parent.type === 'SUBPROJECT'
          : parent.type === 'SUBPROJECT' || parent.type === 'TASK';
      if (!allowed) {
        issues.push({
          itemId: item.itemId,
          code: 'INVALID_PARENT_TYPE',
          message:
            item.type === 'SUBPROJECT'
              ? 'A subproject can only be nested under another subproject'
              : 'A task can only be nested under a subproject or another task'
        });
      }
    }
    let ancestors: PlanItem[];
    try {
      ancestors = planAncestors(item.itemId, index);
    } catch {
      issues.push({ itemId: item.itemId, code: 'CYCLE', message: 'The hierarchy links form a cycle' });
      continue;
    }
    if (item.type === 'SUBPROJECT') {
      const subprojectDepth = ancestors.filter((entry) => entry.type === 'SUBPROJECT').length + 1;
      if (subprojectDepth > MAX_SUBPROJECT_DEPTH) {
        issues.push({
          itemId: item.itemId,
          code: 'SUBPROJECT_DEPTH',
          message: `Subprojects are limited to ${MAX_SUBPROJECT_DEPTH} levels`
        });
      }
    } else {
      const taskDepth = ancestors.filter((entry) => entry.type === 'TASK').length + 1;
      if (taskDepth > MAX_TASK_DEPTH) {
        issues.push({
          itemId: item.itemId,
          code: 'TASK_DEPTH',
          message: `Tasks are limited to ${MAX_TASK_DEPTH} levels`
        });
      }
    }
  }
  return issues;
}

/** Throws the documented hierarchy error instead of accepting an invalid structure. */
export function assertPlanHierarchy(items: readonly PlanItem[]): void {
  const issues = planHierarchyIssues(items);
  if (!issues.length) return;
  const first = issues[0] as PlanIssue;
  const code =
    first.code === 'CYCLE'
      ? 'HIERARCHY_CYCLE'
      : first.code === 'SUBPROJECT_DEPTH' || first.code === 'TASK_DEPTH'
        ? 'HIERARCHY_DEPTH'
        : 'HIERARCHY_INVALID';
  throw new DomainError(code, first.message, { issues });
}

/* ------------------------------- schedule -------------------------------- */

export type PlanScheduleProblem =
  | 'INVALID_START'
  | 'INVALID_FINISH'
  | 'INVALID_RANGE'
  | 'MISSING_FINISH'
  | 'MISSING_DURATION'
  | 'INVALID_DURATION';

export type PlanItemSchedule = {
  start: string | null;
  finish: string | null;
  startDerived: boolean;
  problems: PlanScheduleProblem[];
};

function validOrNull(value: string | null | undefined): { value: string | null; invalid: boolean } {
  if (value === null || value === undefined || value === '') return { value: null, invalid: false };
  return isIsoDate(value) ? { value, invalid: false } : { value: null, invalid: true };
}

/**
 * The one schedule of a plan item.
 *
 * Manual mode keeps the explicit dates. Duration mode derives the start from the finish (the
 * deadline) and the required duration; it never falls back to the explicit start, and it never
 * erases the stored duration.
 */
export function resolvePlanItemSchedule(
  item: Pick<PlanItem, 'startDate' | 'finishDate' | 'durationValue' | 'durationUnit' | 'durationBasis'>,
  mode: PlanScheduleMode,
  calendar: WorkingCalendar = createCalendar()
): PlanItemSchedule {
  const start = validOrNull(item.startDate);
  const finish = validOrNull(item.finishDate);
  const problems: PlanScheduleProblem[] = [];
  if (start.invalid) problems.push('INVALID_START');
  if (finish.invalid) problems.push('INVALID_FINISH');

  if (mode === 'MANUAL') {
    if (start.value && finish.value && start.value > finish.value) problems.push('INVALID_RANGE');
    return { start: start.value, finish: finish.value, startDerived: false, problems };
  }

  if (!finish.value) {
    problems.push('MISSING_FINISH');
    return { start: null, finish: null, startDerived: true, problems };
  }
  const value = item.durationValue;
  const known =
    value !== null && value !== undefined && Number.isFinite(value) && Number.isInteger(value) && value > 0;
  if (!known) {
    problems.push(value === null || value === undefined ? 'MISSING_DURATION' : 'INVALID_DURATION');
    return { start: null, finish: finish.value, startDerived: true, problems };
  }
  const plan = planFromDuration(
    {
      deadline: finish.value,
      value,
      unit: item.durationUnit,
      basis: item.durationBasis
    },
    calendar
  );
  return { start: plan.startDate, finish: finish.value, startDerived: true, problems };
}

/** Whether a bar can be drawn from the resolved schedule. */
export function planItemHasSpan(schedule: PlanItemSchedule): boolean {
  return !!schedule.start && !!schedule.finish && schedule.start <= schedule.finish;
}

/** Inclusive calendar-day length of a resolved schedule. */
export function inclusiveLength(start: string | null, finish: string | null): number | null {
  if (!start || !finish || !isIsoDate(start) || !isIsoDate(finish) || start > finish) return null;
  return diffDays(start, finish) + 1;
}

export function planDateRange(
  items: readonly PlanItem[],
  mode: PlanScheduleMode,
  calendar: WorkingCalendar = createCalendar()
): { from: string; to: string } | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const item of items) {
    const schedule = resolvePlanItemSchedule(item, mode, calendar);
    if (schedule.start && (!from || schedule.start < from)) from = schedule.start;
    if (schedule.finish && (!to || schedule.finish > to)) to = schedule.finish;
  }
  return from && to ? { from, to } : null;
}

export type PlanDatePatch = { startDate: string | null; finishDate: string | null };

/**
 * Moving a bar changes both endpoints together (manual mode) or the deadline (duration mode).
 * A missing endpoint stays missing; nothing is invented.
 */
export function shiftedPlanDates(
  item: Pick<PlanItem, 'startDate' | 'finishDate'>,
  mode: PlanScheduleMode,
  deltaDays: number
): PlanDatePatch {
  if (!Number.isFinite(deltaDays) || deltaDays === 0) {
    return { startDate: item.startDate, finishDate: item.finishDate };
  }
  if (mode === 'DURATION') {
    return {
      startDate: item.startDate,
      finishDate: item.finishDate ? addDays(item.finishDate, deltaDays) : item.finishDate
    };
  }
  return {
    startDate: item.startDate ? addDays(item.startDate, deltaDays) : null,
    finishDate: item.finishDate ? addDays(item.finishDate, deltaDays) : null
  };
}

/** Dragging the left edge changes only the start; it never crosses the finish. */
export function resizedPlanStart(
  item: Pick<PlanItem, 'startDate' | 'finishDate'>,
  mode: PlanScheduleMode,
  deltaDays: number
): PlanDatePatch {
  if (!item.startDate) return { startDate: item.startDate, finishDate: item.finishDate };
  if (mode === 'DURATION') return { startDate: item.startDate, finishDate: item.finishDate };
  const next = addDays(item.startDate, deltaDays);
  const startDate = item.finishDate && next > item.finishDate ? item.finishDate : next;
  return { startDate, finishDate: item.finishDate };
}

/** Dragging the right edge changes only the finish; it never precedes the start. */
export function resizedPlanFinish(
  item: Pick<PlanItem, 'startDate' | 'finishDate'>,
  mode: PlanScheduleMode,
  deltaDays: number
): PlanDatePatch {
  if (!item.finishDate) return { startDate: item.startDate, finishDate: item.finishDate };
  const next = addDays(item.finishDate, deltaDays);
  if (mode === 'DURATION') return { startDate: item.startDate, finishDate: next };
  const finishDate = item.startDate && next < item.startDate ? item.startDate : next;
  return { startDate: item.startDate, finishDate };
}

function workingDaysInclusive(start: string, finish: string, calendar: WorkingCalendar): number {
  if (start > finish) return 0;
  let count = 0;
  let current = start;
  let guard = 0;
  while (current <= finish && guard < 4000) {
    if (calendar.isWorkingDay(current)) count += 1;
    current = addDays(current, 1);
    guard += 1;
  }
  return count;
}

/**
 * The duration a duration-mode plan item needs so its derived start lands on `newStart`.
 *
 * The plan stores whole DAYS with the selected basis, so a later re-edit produces the same
 * schedule instead of a fractional duration.
 */
export function durationForStart(
  newStart: string,
  finish: string | null,
  basis: PlanItem['durationBasis'],
  calendar: WorkingCalendar = createCalendar()
): { durationValue: number; durationUnit: 'DAY'; durationBasis: NonNullable<PlanItem['durationBasis']> } | null {
  if (!finish || !isIsoDate(newStart) || !isIsoDate(finish) || newStart > finish) return null;
  const resolvedBasis = basis ?? 'WORKING_DAYS';
  const value =
    resolvedBasis === 'CALENDAR_DAYS'
      ? diffDays(newStart, finish) + 1
      : workingDaysInclusive(newStart, finish, calendar);
  if (value <= 0) return null;
  return { durationValue: value, durationUnit: 'DAY', durationBasis: resolvedBasis };
}

/* -------------------------------- order ---------------------------------- */

/**
 * Rewrites the manual order of every sibling group to 0..n-1 without touching any other field,
 * so a drag never changes a date, an owner, an identifier or a parent.
 */
export function normalizePlanOrder(items: readonly PlanItem[]): PlanItem[] {
  const index = buildPlanIndex(items);
  const order = new Map<string, number>();
  const groups: PlanItem[][] = [];
  const seen = new Set<string>();
  const collect = (parentItemId: string | null): void => {
    const siblings = planSiblings(index, parentItemId);
    groups.push(siblings);
    for (const sibling of siblings) {
      if (seen.has(sibling.itemId)) continue;
      seen.add(sibling.itemId);
      collect(sibling.itemId);
    }
  };
  collect(null);
  const leftovers = items
    .filter((item) => index.byId.get(item.itemId) === item && !seen.has(item.itemId))
    .sort(compareSiblings);
  if (leftovers.length) groups.push(leftovers);
  for (const group of groups) {
    group.forEach((item, position) => order.set(item.itemId, position));
  }
  return items.map((item) => {
    const next = order.get(item.itemId);
    return next === undefined || next === item.order ? item : { ...item, order: next };
  });
}

/** One position up or down inside the item's own parent. */
export function movePlanItemWithinParent(
  items: readonly PlanItem[],
  itemId: string,
  direction: -1 | 1
): PlanItem[] {
  const index = buildPlanIndex(items);
  const item = index.byId.get(itemId);
  if (!item) return [...items];
  const siblings = planSiblings(index, item.parentItemId);
  const from = siblings.findIndex((entry) => entry.itemId === itemId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= siblings.length) return [...items];
  const reordered = [...siblings];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved as PlanItem);
  const nextOrder = new Map(reordered.map((entry, position) => [entry.itemId, position]));
  return normalizePlanOrder(
    items.map((entry) =>
      nextOrder.has(entry.itemId) ? { ...entry, order: nextOrder.get(entry.itemId) as number } : entry
    )
  );
}

/** Places an item at `targetIndex` inside its current parent. */
export function reorderPlanItem(items: readonly PlanItem[], itemId: string, targetIndex: number): PlanItem[] {
  const index = buildPlanIndex(items);
  const item = index.byId.get(itemId);
  if (!item) return [...items];
  const siblings = planSiblings(index, item.parentItemId);
  const from = siblings.findIndex((entry) => entry.itemId === itemId);
  if (from < 0) return [...items];
  const bounded = Math.max(0, Math.min(siblings.length - 1, Math.trunc(targetIndex)));
  if (bounded === from) return [...items];
  const reordered = [...siblings];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(bounded, 0, moved as PlanItem);
  const nextOrder = new Map(reordered.map((entry, position) => [entry.itemId, position]));
  return normalizePlanOrder(
    items.map((entry) =>
      nextOrder.has(entry.itemId) ? { ...entry, order: nextOrder.get(entry.itemId) as number } : entry
    )
  );
}

/**
 * Moves one item (and so its whole subtree) under a new parent.
 *
 * The complete resulting structure is validated first, so a reparent never flattens a branch,
 * exceeds a depth limit or creates a cycle.
 */
export function reparentPlanItem(
  items: readonly PlanItem[],
  itemId: string,
  newParentItemId: string | null,
  position: 'START' | 'END' = 'END'
): PlanItem[] {
  const index = buildPlanIndex(items);
  const item = index.byId.get(itemId);
  if (!item) return [...items];
  if (newParentItemId === itemId) {
    throw new DomainError('HIERARCHY_INVALID', 'An item cannot be its own parent');
  }
  const candidate = items.map((entry) =>
    entry.itemId === itemId ? { ...entry, parentItemId: newParentItemId } : entry
  );
  const candidateIndex = buildPlanIndex(candidate);
  const targetSiblings = planSiblings(candidateIndex, newParentItemId).filter((entry) => entry.itemId !== itemId);
  const sequence =
    position === 'START'
      ? [itemId, ...targetSiblings.map((entry) => entry.itemId)]
      : [...targetSiblings.map((entry) => entry.itemId), itemId];
  const nextOrder = new Map(sequence.map((id, index2) => [id, index2]));
  const ordered = normalizePlanOrder(
    candidate.map((entry) =>
      nextOrder.has(entry.itemId) ? { ...entry, order: nextOrder.get(entry.itemId) as number } : entry
    )
  );
  assertPlanHierarchy(ordered);
  return ordered;
}

/** Indent under the previous sibling (an explicit, understandable structural move). */
export function indentPlanItem(items: readonly PlanItem[], itemId: string): PlanItem[] {
  const index = buildPlanIndex(items);
  const item = index.byId.get(itemId);
  if (!item) return [...items];
  const siblings = planSiblings(index, item.parentItemId);
  const position = siblings.findIndex((entry) => entry.itemId === itemId);
  if (position <= 0) {
    throw new DomainError('HIERARCHY_INVALID', 'There is no previous sibling to become the new parent');
  }
  const previous = siblings[position - 1] as PlanItem;
  if (item.type === 'SUBPROJECT' && previous.type !== 'SUBPROJECT') {
    throw new DomainError('HIERARCHY_INVALID', 'A subproject can only be nested under another subproject');
  }
  return reparentPlanItem(items, itemId, previous.itemId, 'END');
}

/** Outdent to the parent's parent, placed directly after the former parent. */
export function outdentPlanItem(items: readonly PlanItem[], itemId: string): PlanItem[] {
  const index = buildPlanIndex(items);
  const item = index.byId.get(itemId);
  if (!item) return [...items];
  if (!item.parentItemId) {
    throw new DomainError('HIERARCHY_INVALID', 'This item is already at the top level');
  }
  const parent = index.byId.get(item.parentItemId);
  if (!parent) throw new DomainError('HIERARCHY_INVALID', 'The parent item is missing');
  const grandParentId = parent.parentItemId;
  const grandSiblings = planSiblings(index, grandParentId).filter((entry) => entry.itemId !== itemId);
  const parentIndex = grandSiblings.findIndex((entry) => entry.itemId === parent.itemId);
  const candidate = items.map((entry) =>
    entry.itemId === itemId ? { ...entry, parentItemId: grandParentId } : entry
  );
  const sequence = grandSiblings.map((entry) => entry.itemId);
  sequence.splice(parentIndex + 1, 0, itemId);
  const nextOrder = new Map(sequence.map((id, index2) => [id, index2]));
  const ordered = normalizePlanOrder(
    candidate.map((entry) =>
      nextOrder.has(entry.itemId) ? { ...entry, order: nextOrder.get(entry.itemId) as number } : entry
    )
  );
  assertPlanHierarchy(ordered);
  return ordered;
}

/** Ordered items, parents first, so an export can create parents before children. */
export function planExportOrder(items: readonly PlanItem[]): PlanItem[] {
  return flattenPlan(items).map((row) => row.item);
}

/** The subproject of one item, or null for a direct project task. */
export function planSubprojectOf(itemId: string, index: PlanIndex): string | null {
  return nearestSubprojectId(itemId, index);
}

export function isValidPlanItemType(value: string): value is PlanItemType {
  return value === 'SUBPROJECT' || value === 'TASK';
}

/** The shared working-day check the review uses for a non-working deadline warning. */
export function planFinishIsWorkingDay(finish: string, calendar: WorkingCalendar = createCalendar()): boolean {
  return isIsoDate(finish) && calendar.isWorkingDay(finish) && !isWeekend(finish);
}
