import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  Database,
  countPlansForAuthor,
  findPlanExportByKey,
  getPlanDraftRow,
  insertMember,
  insertPlanDraft,
  insertPlanExport,
  insertProject,
  insertResponsibility,
  insertSubproject,
  insertTask,
  listPlanItems,
  listPlanSummaries,
  markRemovedPlanItems,
  setSubprojectSortOrder,
  setTaskSortOrder,
  updatePlanDraft,
  upsertPlanItem
} from '../src/index';
import type { PlanItem } from '@eh/contracts';
import { freshDatabase, expectDatabase, seedTestDivisions } from './support/db';

let db: Database;
let pool: pg.Pool;

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
});

afterEach(async () => {
  await pool.end();
});

function planItem(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    itemId: 'PI-1',
    type: 'TASK',
    parentItemId: null,
    order: 0,
    name: 'Task',
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

async function seedAuthor(): Promise<void> {
  await insertMember(db, { name: 'Manager', email: 'manager@example.co.jp', role: 'MANAGER' }, 'MEM-MANAGER');
  await seedTestDivisions(db);
}

describe('plan draft repository', () => {
  it('stores a private draft, soft-removes deleted items and refuses a stale revision', async () => {
    expectDatabase({ skip: () => undefined });
    await seedAuthor();
    await insertResponsibility(db, { name: 'Area', divisionId: 'DIV-DEV' }, 'RSP-1');
    const draft = await insertPlanDraft(db, {
      title: 'Lunch release',
      authorMemberId: 'MEM-MANAGER',
      divisionId: 'DIV-DEV',
      responsibilityId: 'RSP-1',
      destinationMode: 'NEW_PROJECT',
      destinationProjectId: null,
      projectOwnerId: 'MEM-MANAGER',
      dashboardVisibility: 'RESTRICTED',
      scheduleMode: 'MANUAL'
    });
    expect(draft.revision).toBe(1);

    await upsertPlanItem(db, draft.plan_id, planItem({ itemId: 'PI-A', name: 'Alpha' }));
    await upsertPlanItem(
      db,
      draft.plan_id,
      planItem({ itemId: 'PI-B', name: 'Beta', parentItemId: 'PI-A', type: 'TASK', order: 0 })
    );
    expect((await listPlanItems(db, draft.plan_id)).map((item) => item.name)).toEqual(['Alpha', 'Beta']);

    const saved = await updatePlanDraft(db, draft.plan_id, { title: 'Renamed plan' }, 1);
    expect(saved?.title).toBe('Renamed plan');
    expect(saved?.revision).toBe(2);
    expect(await updatePlanDraft(db, draft.plan_id, { title: 'Stale' }, 1)).toBeNull();

    const removed = await markRemovedPlanItems(db, draft.plan_id, ['PI-A']);
    expect(removed).toBe(1);
    expect((await listPlanItems(db, draft.plan_id)).map((item) => item.itemId)).toEqual(['PI-A']);
    expect((await listPlanItems(db, draft.plan_id, true)).map((item) => item.itemId).sort()).toEqual([
      'PI-A',
      'PI-B'
    ]);

    // Re-adding a removed item reactivates the same row instead of duplicating it.
    await upsertPlanItem(db, draft.plan_id, planItem({ itemId: 'PI-B', name: 'Beta again' }));
    const items = await listPlanItems(db, draft.plan_id, true);
    expect(items.filter((item) => item.itemId === 'PI-B')).toHaveLength(1);
  });

  it('never lets an item identifier cross into another plan', async () => {
    expectDatabase({ skip: () => undefined });
    await seedAuthor();
    const first = await insertPlanDraft(db, {
      title: 'First',
      authorMemberId: 'MEM-MANAGER',
      divisionId: 'DIV-DEV',
      responsibilityId: null,
      destinationMode: 'NEW_PROJECT',
      destinationProjectId: null,
      projectOwnerId: null,
      dashboardVisibility: 'RESTRICTED',
      scheduleMode: 'MANUAL'
    });
    const second = await insertPlanDraft(db, {
      title: 'Second',
      authorMemberId: 'MEM-MANAGER',
      divisionId: 'DIV-DEV',
      responsibilityId: null,
      destinationMode: 'NEW_PROJECT',
      destinationProjectId: null,
      projectOwnerId: null,
      dashboardVisibility: 'RESTRICTED',
      scheduleMode: 'MANUAL'
    });
    await upsertPlanItem(db, first.plan_id, planItem({ itemId: 'PI-SHARED' }));
    await expect(upsertPlanItem(db, second.plan_id, planItem({ itemId: 'PI-SHARED' }))).rejects.toThrow();
  });

  it('scopes summaries to their author and reports the item count', async () => {
    expectDatabase({ skip: () => undefined });
    await seedAuthor();
    await insertMember(db, { name: 'Other', email: 'other@example.co.jp', role: 'MANAGER' }, 'MEM-OTHER');
    const mine = await insertPlanDraft(db, {
      title: 'Mine',
      authorMemberId: 'MEM-MANAGER',
      divisionId: 'DIV-DEV',
      responsibilityId: null,
      destinationMode: 'NEW_PROJECT',
      destinationProjectId: null,
      projectOwnerId: null,
      dashboardVisibility: 'RESTRICTED',
      scheduleMode: 'MANUAL'
    });
    await upsertPlanItem(db, mine.plan_id, planItem({ itemId: 'PI-1' }));
    await upsertPlanItem(db, mine.plan_id, planItem({ itemId: 'PI-2', order: 1 }));
    await insertPlanDraft(db, {
      title: 'Theirs',
      authorMemberId: 'MEM-OTHER',
      divisionId: 'DIV-DEV',
      responsibilityId: null,
      destinationMode: 'NEW_PROJECT',
      destinationProjectId: null,
      projectOwnerId: null,
      dashboardVisibility: 'RESTRICTED',
      scheduleMode: 'MANUAL'
    });

    const page = await listPlanSummaries(db, 'MEM-MANAGER', { status: 'ALL' }, 1, 20);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ title: 'Mine', itemCount: 2 });
    expect(await countPlansForAuthor(db, 'MEM-OTHER')).toBe(1);
    expect(await countPlansForAuthor(db, 'MEM-MANAGER')).toBe(1);
    expect(await getPlanDraftRow(db, mine.plan_id)).not.toBeNull();
  });

  it('stores an export receipt keyed to the attempt and refuses a duplicate key', async () => {
    expectDatabase({ skip: () => undefined });
    await seedAuthor();
    const draft = await insertPlanDraft(db, {
      title: 'Exportable',
      authorMemberId: 'MEM-MANAGER',
      divisionId: 'DIV-DEV',
      responsibilityId: null,
      destinationMode: 'NEW_PROJECT',
      destinationProjectId: null,
      projectOwnerId: null,
      dashboardVisibility: 'RESTRICTED',
      scheduleMode: 'MANUAL'
    });
    const receipt = {
      exportId: 'PEX-1',
      planId: draft.plan_id,
      planRevision: 1,
      exportedAt: new Date().toISOString(),
      contractVersion: '1.0',
      destination: {
        mode: 'NEW_PROJECT' as const,
        projectId: 'PRJ-NEW',
        projectName: 'Exportable',
        divisionId: 'DIV-DEV',
        responsibilityId: null
      },
      counts: { subprojects: 0, tasks: 0 },
      created: { projectId: 'PRJ-NEW', subprojectIds: [], taskIds: [] },
      mapping: []
    };
    await insertPlanExport(
      db,
      { planId: draft.plan_id, planRevision: 1, idempotencyKey: 'export-key-0001', requestHash: 'hash', receipt },
      'PEX-1'
    );
    const found = await findPlanExportByKey(db, draft.plan_id, 'export-key-0001');
    expect(found?.receipt.exportId).toBe('PEX-1');
    await expect(
      insertPlanExport(
        db,
        { planId: draft.plan_id, planRevision: 1, idempotencyKey: 'export-key-0001', requestHash: 'other', receipt },
        'PEX-2'
      )
    ).rejects.toThrow();
  });
});

describe('operational order', () => {
  it('writes the manual order of an exported branch without touching other columns', async () => {
    expectDatabase({ skip: () => undefined });
    await seedAuthor();
    await insertResponsibility(db, { name: 'Area', divisionId: 'DIV-DEV' }, 'RSP-1');
    await insertProject(
      db,
      { projectName: 'Project', divisionId: 'DIV-DEV', responsibilityId: 'RSP-1' },
      'PRJ-1'
    );
    await insertSubproject(db, { projectId: 'PRJ-1', subprojectName: 'Folder' }, 'SUB-1');
    await insertTask(db, { projectId: 'PRJ-1', subprojectId: 'SUB-1', taskName: 'Task', dueDate: '2026-11-20' }, 'TSK-1');

    await setSubprojectSortOrder(db, 'SUB-1', 7);
    await setTaskSortOrder(db, 'TSK-1', 3);
    const subproject = await db.one<{ sort_order: number; subproject_name: string }>(
      'SELECT sort_order, subproject_name FROM subprojects WHERE subproject_id = $1',
      ['SUB-1']
    );
    const task = await db.one<{ sort_order: number; due_date: string; status: string }>(
      'SELECT sort_order, due_date, status FROM tasks WHERE task_id = $1',
      ['TSK-1']
    );
    expect(subproject).toEqual({ sort_order: 7, subproject_name: 'Folder' });
    expect(task?.sort_order).toBe(3);
    expect(task?.due_date).toBe('2026-11-20');
    expect(task?.status).toBe('Not Started');
  });
});
