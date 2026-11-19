import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@eh/contracts';
import {
  assertPlanHierarchy,
  buildPlanIndex,
  durationForStart,
  flattenPlan,
  indentPlanItem,
  movePlanItemWithinParent,
  normalizePlanOrder,
  outdentPlanItem,
  planDateRange,
  planHierarchyIssues,
  reparentPlanItem,
  reorderPlanItem,
  resolvePlanItemSchedule,
  resizedPlanFinish,
  resizedPlanStart,
  shiftedPlanDates
} from '../src/planning-board';
import { createCalendar } from '../src/time';
import { planFromDuration } from '../src/planning';

let sequence = 0;

function item(overrides: Partial<PlanItem> = {}): PlanItem {
  sequence += 1;
  return {
    itemId: `IT-${sequence}`,
    type: 'TASK',
    parentItemId: null,
    order: 0,
    name: `Item ${sequence}`,
    startDate: null,
    finishDate: null,
    durationValue: null,
    durationUnit: null,
    durationBasis: null,
    ownerMemberId: null,
    assigneeIds: [],
    ...overrides
  };
}

function subproject(overrides: Partial<PlanItem> = {}): PlanItem {
  return item({ type: 'SUBPROJECT', ...overrides });
}

describe('plan hierarchy', () => {
  it('rejects a fifth subproject level and a fourth task level', () => {
    const level1 = subproject();
    const level2 = subproject({ parentItemId: level1.itemId });
    const level3 = subproject({ parentItemId: level2.itemId });
    const level4 = subproject({ parentItemId: level3.itemId });
    const level5 = subproject({ parentItemId: level4.itemId });
    expect(() => assertPlanHierarchy([level1, level2, level3, level4])).not.toThrow();
    expect(() => assertPlanHierarchy([level1, level2, level3, level4, level5])).toThrow();

    const root = subproject();
    const task1 = item({ parentItemId: root.itemId });
    const task2 = item({ parentItemId: task1.itemId });
    const task3 = item({ parentItemId: task2.itemId });
    const task4 = item({ parentItemId: task3.itemId });
    expect(() => assertPlanHierarchy([root, task1, task2, task3])).not.toThrow();
    expect(() => assertPlanHierarchy([root, task1, task2, task3, task4])).toThrow();
  });

  it('refuses a self parent, an unknown parent and a cycle', () => {
    const self = item();
    self.parentItemId = self.itemId;
    expect(planHierarchyIssues([self]).map((issue) => issue.code)).toContain('SELF_PARENT');

    const orphan = item({ parentItemId: 'MISSING' });
    expect(planHierarchyIssues([orphan]).map((issue) => issue.code)).toContain('UNKNOWN_PARENT');

    const first = item();
    const second = item({ parentItemId: first.itemId });
    first.parentItemId = second.itemId;
    expect(planHierarchyIssues([first, second]).map((issue) => issue.code)).toContain('CYCLE');
    expect(() => assertPlanHierarchy([first, second])).toThrow(/cycle/i);
  });

  it('refuses a subproject under a task and a task under nothing but keeps direct project tasks', () => {
    const task = item();
    const nested = subproject({ parentItemId: task.itemId });
    expect(planHierarchyIssues([task, nested]).map((issue) => issue.code)).toContain('INVALID_PARENT_TYPE');

    const direct = item({ parentItemId: null });
    expect(planHierarchyIssues([direct])).toHaveLength(0);
  });

  it('lists parents before children and keeps an orphan visible for repair', () => {
    const root = subproject();
    const child = item({ parentItemId: root.itemId });
    const orphan = item({ parentItemId: 'MISSING' });
    const rows = flattenPlan([child, root, orphan]);
    expect(rows.map((row) => row.item.itemId)).toEqual([root.itemId, child.itemId, orphan.itemId]);
  });
});

describe('plan schedule', () => {
  it('keeps manual dates and reports an inverted range without repairing it', () => {
    const schedule = resolvePlanItemSchedule(
      { startDate: '2026-11-20', finishDate: '2026-11-10', durationValue: null, durationUnit: null, durationBasis: null },
      'MANUAL'
    );
    expect(schedule.start).toBe('2026-11-20');
    expect(schedule.finish).toBe('2026-11-10');
    expect(schedule.problems).toContain('INVALID_RANGE');
  });

  it('derives the start from the deadline and the required duration', () => {
    const calendar = createCalendar();
    const expected = planFromDuration(
      { deadline: '2026-11-20', value: 5, unit: 'DAY', basis: 'WORKING_DAYS' },
      calendar
    );
    const schedule = resolvePlanItemSchedule(
      {
        startDate: '2026-01-01',
        finishDate: '2026-11-20',
        durationValue: 5,
        durationUnit: 'DAY',
        durationBasis: 'WORKING_DAYS'
      },
      'DURATION',
      calendar
    );
    expect(schedule.start).toBe(expected.startDate);
    expect(schedule.finish).toBe('2026-11-20');
    expect(schedule.startDerived).toBe(true);
  });

  it('never falls back to an explicit start when the duration is missing', () => {
    const schedule = resolvePlanItemSchedule(
      { startDate: '2026-11-01', finishDate: '2026-11-20', durationValue: null, durationUnit: null, durationBasis: null },
      'DURATION'
    );
    expect(schedule.start).toBeNull();
    expect(schedule.problems).toContain('MISSING_DURATION');
  });

  it('moves both manual endpoints together and only the deadline in duration mode', () => {
    expect(shiftedPlanDates({ startDate: '2026-11-02', finishDate: '2026-11-06' }, 'MANUAL', 3)).toEqual({
      startDate: '2026-11-05',
      finishDate: '2026-11-09'
    });
    expect(shiftedPlanDates({ startDate: null, finishDate: '2026-11-06' }, 'MANUAL', 3)).toEqual({
      startDate: null,
      finishDate: '2026-11-09'
    });
    expect(shiftedPlanDates({ startDate: '2026-11-02', finishDate: '2026-11-06' }, 'DURATION', 2)).toEqual({
      startDate: '2026-11-02',
      finishDate: '2026-11-08'
    });
  });

  it('clamps a resize so the start never crosses the finish', () => {
    expect(resizedPlanStart({ startDate: '2026-11-02', finishDate: '2026-11-06' }, 'MANUAL', 30)).toEqual({
      startDate: '2026-11-06',
      finishDate: '2026-11-06'
    });
    expect(resizedPlanFinish({ startDate: '2026-11-02', finishDate: '2026-11-06' }, 'MANUAL', -30)).toEqual({
      startDate: '2026-11-02',
      finishDate: '2026-11-02'
    });
    expect(resizedPlanStart({ startDate: '2026-11-02', finishDate: '2026-11-06' }, 'DURATION', 5)).toEqual({
      startDate: '2026-11-02',
      finishDate: '2026-11-06'
    });
  });

  it('computes a whole-day duration for a derived start', () => {
    expect(durationForStart('2026-11-02', '2026-11-06', 'CALENDAR_DAYS')).toEqual({
      durationValue: 5,
      durationUnit: 'DAY',
      durationBasis: 'CALENDAR_DAYS'
    });
    expect(durationForStart('2026-11-06', '2026-11-02', 'CALENDAR_DAYS')).toBeNull();
  });

  it('reports the plan range from resolved schedules', () => {
    const first = item({ startDate: '2026-11-10', finishDate: '2026-11-12' });
    const second = subproject({ startDate: '2026-11-01', finishDate: '2026-11-20' });
    expect(planDateRange([first, second], 'MANUAL')).toEqual({ from: '2026-11-01', to: '2026-11-20' });
  });
});

describe('plan manual order', () => {
  it('reorders without changing any other field', () => {
    const first = item({ order: 0, name: 'First', startDate: '2026-11-02', ownerMemberId: 'MEM-1' });
    const second = item({ order: 1, name: 'Second', finishDate: '2026-11-10' });
    const moved = movePlanItemWithinParent([first, second], second.itemId, -1);
    const reordered = moved.find((entry) => entry.itemId === second.itemId) as PlanItem;
    expect(reordered.order).toBe(0);
    expect(reordered.name).toBe('Second');
    expect(reordered.finishDate).toBe('2026-11-10');
    const untouched = moved.find((entry) => entry.itemId === first.itemId) as PlanItem;
    expect(untouched.startDate).toBe('2026-11-02');
    expect(untouched.ownerMemberId).toBe('MEM-1');
    expect(untouched.itemId).toBe(first.itemId);
  });

  it('places an item at a target position inside its own parent', () => {
    const items = [item({ order: 0, name: 'A' }), item({ order: 1, name: 'B' }), item({ order: 2, name: 'C' })];
    const moved = reorderPlanItem(items, items[0]!.itemId, 2);
    const order = moved
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.name);
    expect(order).toEqual(['B', 'C', 'A']);
  });

  it('normalizes duplicate orders deterministically', () => {
    const items = [item({ order: 5, name: 'B' }), item({ order: 5, name: 'A' })];
    const normalized = normalizePlanOrder(items);
    const orders = normalized.map((entry) => entry.order).sort((left, right) => left - right);
    expect(orders).toEqual([0, 1]);
  });

  it('moves a whole branch on reparent and validates the result', () => {
    const root = subproject({ name: 'Root' });
    const branch = subproject({ parentItemId: root.itemId, name: 'Branch' });
    const leaf = item({ parentItemId: branch.itemId, name: 'Leaf' });
    const target = subproject({ name: 'Target' });
    const moved = reparentPlanItem([root, branch, leaf, target], branch.itemId, target.itemId);
    const index = buildPlanIndex(moved);
    expect(index.byId.get(branch.itemId)?.parentItemId).toBe(target.itemId);
    expect(index.byId.get(leaf.itemId)?.parentItemId).toBe(branch.itemId);
    expect(() => reparentPlanItem([root, branch, leaf], root.itemId, leaf.itemId)).toThrow();
  });

  it('indents under the previous sibling and outdents after the parent', () => {
    const first = subproject({ order: 0, name: 'First' });
    const second = item({ order: 1, name: 'Second' });
    const indented = indentPlanItem([first, second], second.itemId);
    expect(indented.find((entry) => entry.itemId === second.itemId)?.parentItemId).toBe(first.itemId);

    const outdented = outdentPlanItem(indented, second.itemId);
    expect(outdented.find((entry) => entry.itemId === second.itemId)?.parentItemId).toBeNull();
    expect(() => indentPlanItem([first, second], first.itemId)).toThrow();
  });
});
