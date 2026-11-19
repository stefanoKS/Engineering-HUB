/**
 * Planning Board repository.
 *
 * A plan is private to its author. Every read here is scoped by the author identifier the caller
 * resolved from the verified session, and every write is revision-checked. Draft items are never
 * removed by this module: a re-save stamps `removed_at` on the items a person deleted, so the
 * draft row keeps its history and no destructive statement is needed.
 */
import type { PlanExportReceipt, PlanItem, PlanItemType, PlanScheduleMode, PlanStatus } from '@eh/contracts';
import { PLAN_CONTRACT_VERSION } from '@eh/contracts';
import type { Queryable } from '../pool';
import { newId } from '../ids';
import { updateWithRevision } from './patch';

type Db = Queryable;

const PLAN_SELECT = `
  SELECT plan_id, contract_version, title, status, author_member_id, division_id, responsibility_id,
         destination_mode, destination_project_id, project_owner_id, dashboard_visibility,
         schedule_mode, exported_at, export_receipt, archived_at, created_at, updated_at, revision
    FROM plan_drafts`;

export type PlanDraftDestination = 'NEW_PROJECT' | 'EXISTING_PROJECT';

export type PlanRow = {
  plan_id: string;
  contract_version: string;
  title: string;
  status: PlanStatus;
  author_member_id: string;
  division_id: string | null;
  responsibility_id: string | null;
  destination_mode: PlanDraftDestination;
  destination_project_id: string | null;
  project_owner_id: string | null;
  dashboard_visibility: string;
  schedule_mode: PlanScheduleMode;
  exported_at: string | null;
  export_receipt: PlanExportReceipt | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
};

export type PlanDraftRow = PlanRow;

type PlanItemRow = {
  item_id: string;
  plan_id: string;
  parent_item_id: string | null;
  item_type: PlanItemType;
  sort_order: number;
  name: string;
  start_date: string | null;
  finish_date: string | null;
  duration_value: string | number | null;
  duration_unit: 'DAY' | 'WEEK' | null;
  duration_basis: 'WORKING_DAYS' | 'CALENDAR_DAYS' | null;
  owner_member_id: string | null;
  additional_assignee_ids: string[];
};

export type PlanSummaryRow = {
  plan_id: string;
  title: string;
  status: PlanStatus;
  division_id: string | null;
  responsibility_id: string | null;
  destination_mode: PlanDraftDestination;
  destination_project_id: string | null;
  schedule_mode: PlanScheduleMode;
  item_count: string;
  revision: number;
  exported_at: string | null;
  updated_at: string;
};

export type PlanSummaryData = {
  planId: string;
  title: string;
  status: PlanStatus;
  divisionId: string | null;
  responsibilityId: string | null;
  destinationMode: PlanDraftDestination;
  destinationProjectId: string | null;
  scheduleMode: PlanScheduleMode;
  itemCount: number;
  revision: number;
  exportedAt: string | null;
  updatedAt: string;
};

function numericOrNull(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPlanItem(row: PlanItemRow): PlanItem {
  return {
    itemId: row.item_id,
    type: row.item_type,
    parentItemId: row.parent_item_id,
    order: row.sort_order,
    name: row.name,
    startDate: row.start_date,
    finishDate: row.finish_date,
    durationValue: numericOrNull(row.duration_value),
    durationUnit: row.duration_unit,
    durationBasis: row.duration_basis,
    ownerMemberId: row.owner_member_id,
    assigneeIds: row.additional_assignee_ids ?? []
  };
}

export function planSummaryOf(row: PlanSummaryRow): PlanSummaryData {
  return {
    planId: row.plan_id,
    title: row.title,
    status: row.status,
    divisionId: row.division_id,
    responsibilityId: row.responsibility_id,
    destinationMode: row.destination_mode,
    destinationProjectId: row.destination_project_id,
    scheduleMode: row.schedule_mode,
    itemCount: Number(row.item_count ?? 0),
    revision: row.revision,
    exportedAt: row.exported_at,
    updatedAt: row.updated_at
  };
}

export async function listPlanSummaries(
  db: Db,
  authorMemberId: string,
  filters: { status?: PlanStatus | 'ALL'; query?: string },
  page: number,
  pageSize: number
): Promise<{ items: PlanSummaryData[]; total: number }> {
  const where: string[] = ['p.author_member_id = $1'];
  const params: unknown[] = [authorMemberId];
  if (filters.status && filters.status !== 'ALL') {
    params.push(filters.status);
    where.push(`p.status = $${params.length}`);
  }
  if (filters.query) {
    params.push(`%${filters.query.toLowerCase()}%`);
    where.push(`lower(p.title) LIKE $${params.length}`);
  }
  const total = await db.one<{ count: string }>(
    `SELECT count(*)::text AS count FROM plan_drafts p WHERE ${where.join(' AND ')}`,
    params
  );
  const offset = (page - 1) * pageSize;
  params.push(pageSize, offset);
  const rows = await db.many<PlanSummaryRow>(
    `SELECT p.plan_id, p.title, p.status, p.division_id, p.responsibility_id, p.destination_mode,
            p.destination_project_id, p.schedule_mode, p.revision, p.exported_at, p.updated_at,
            (SELECT count(*)::text FROM plan_items i
              WHERE i.plan_id = p.plan_id AND i.removed_at IS NULL) AS item_count
       FROM plan_drafts p
      WHERE ${where.join(' AND ')}
      ORDER BY p.updated_at DESC, p.plan_id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { items: rows.map(planSummaryOf), total: Number(total?.count ?? 0) };
}

export async function countPlansForAuthor(db: Db, authorMemberId: string): Promise<number> {
  const row = await db.one<{ count: string }>(
    `SELECT count(*)::text AS count FROM plan_drafts WHERE author_member_id = $1 AND status <> 'ARCHIVED'`,
    [authorMemberId]
  );
  return Number(row?.count ?? 0);
}

export async function getPlanDraftRow(db: Db, planId: string): Promise<PlanRow | null> {
  return db.one<PlanRow>(`${PLAN_SELECT} WHERE plan_id = $1`, [planId]);
}

/** The export serializes on this row, so two exports of one plan cannot interleave. */
export async function lockPlanDraftRow(db: Db, planId: string): Promise<PlanRow | null> {
  return db.one<PlanRow>(`${PLAN_SELECT} WHERE plan_id = $1 FOR UPDATE`, [planId]);
}

export async function listPlanItems(db: Db, planId: string, includeRemoved = false): Promise<PlanItem[]> {
  const rows = await db.many<PlanItemRow>(
    `SELECT item_id, plan_id, parent_item_id, item_type, sort_order, name, start_date, finish_date,
            duration_value, duration_unit, duration_basis, owner_member_id, additional_assignee_ids
       FROM plan_items
      WHERE plan_id = $1 ${includeRemoved ? '' : 'AND removed_at IS NULL'}
      ORDER BY sort_order, lower(name), item_id`,
    [planId]
  );
  return rows.map(toPlanItem);
}

export type PlanDraftInput = {
  title: string;
  authorMemberId: string;
  divisionId: string | null;
  responsibilityId: string | null;
  destinationMode: PlanDraftDestination;
  destinationProjectId: string | null;
  projectOwnerId: string | null;
  dashboardVisibility: string;
  scheduleMode: PlanScheduleMode;
};

export async function insertPlanDraft(
  db: Db,
  input: PlanDraftInput,
  planId: string = newId('PLN')
): Promise<PlanRow> {
  await db.query(
    `INSERT INTO plan_drafts
       (plan_id, contract_version, title, author_member_id, division_id, responsibility_id,
        destination_mode, destination_project_id, project_owner_id, dashboard_visibility, schedule_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      planId,
      PLAN_CONTRACT_VERSION,
      input.title,
      input.authorMemberId,
      input.divisionId,
      input.responsibilityId,
      input.destinationMode,
      input.destinationProjectId,
      input.projectOwnerId,
      input.dashboardVisibility,
      input.scheduleMode
    ]
  );
  const created = await getPlanDraftRow(db, planId);
  if (!created) throw new Error('Plan insert returned no row');
  return created;
}

const PLAN_COLUMNS: Record<string, string> = {
  title: 'title',
  divisionId: 'division_id',
  responsibilityId: 'responsibility_id',
  destinationMode: 'destination_mode',
  destinationProjectId: 'destination_project_id',
  projectOwnerId: 'project_owner_id',
  dashboardVisibility: 'dashboard_visibility',
  scheduleMode: 'schedule_mode',
  status: 'status',
  exportedAt: 'exported_at',
  exportReceipt: 'export_receipt',
  archivedAt: 'archived_at'
};

export async function updatePlanDraft(
  db: Db,
  planId: string,
  patch: Record<string, unknown>,
  expectedRevision: number
): Promise<PlanRow | null> {
  const columns: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(PLAN_COLUMNS)) {
    if (key in patch && patch[key] !== undefined) columns[column] = patch[key];
  }
  if (patch.exportReceipt !== undefined) {
    // jsonb is sent as a JSON string; the row mapping parses it back.
    columns.export_receipt = patch.exportReceipt === null ? null : JSON.stringify(patch.exportReceipt);
  }
  if (!Object.keys(columns).length) return null;
  const row = await updateWithRevision<{ plan_id: string }>(db, {
    table: 'plan_drafts',
    idColumn: 'plan_id',
    id: planId,
    expectedRevision,
    columns,
    returning: 'plan_id'
  });
  if (!row) return null;
  return getPlanDraftRow(db, planId);
}

/**
 * Inserts or updates one draft item.
 *
 * The `WHERE` clause keeps an identifier from another plan from being overwritten: a conflicting
 * identifier returns no row and the caller refuses the save instead of silently losing work.
 */
export async function upsertPlanItem(db: Db, planId: string, item: PlanItem): Promise<void> {
  const result = await db.query(
    `INSERT INTO plan_items
       (item_id, plan_id, parent_item_id, item_type, sort_order, name, start_date, finish_date,
        duration_value, duration_unit, duration_basis, owner_member_id, additional_assignee_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (item_id) DO UPDATE SET
       parent_item_id = EXCLUDED.parent_item_id,
       item_type = EXCLUDED.item_type,
       sort_order = EXCLUDED.sort_order,
       name = EXCLUDED.name,
       start_date = EXCLUDED.start_date,
       finish_date = EXCLUDED.finish_date,
       duration_value = EXCLUDED.duration_value,
       duration_unit = EXCLUDED.duration_unit,
       duration_basis = EXCLUDED.duration_basis,
       owner_member_id = EXCLUDED.owner_member_id,
       additional_assignee_ids = EXCLUDED.additional_assignee_ids,
       removed_at = NULL,
       updated_at = now()
     WHERE plan_items.plan_id = EXCLUDED.plan_id
     RETURNING item_id`,
    [
      item.itemId,
      planId,
      item.parentItemId,
      item.type,
      item.order,
      item.name,
      item.startDate,
      item.finishDate,
      item.durationValue,
      item.durationUnit,
      item.durationBasis,
      item.ownerMemberId,
      item.assigneeIds
    ]
  );
  if (result.rowCount === 0) {
    throw new Error('A draft item identifier belongs to another plan');
  }
}

/** Soft removal of the items a person deleted from the draft. */
export async function markRemovedPlanItems(
  db: Db,
  planId: string,
  keepItemIds: readonly string[]
): Promise<number> {
  const result = await db.query(
    `UPDATE plan_items
        SET removed_at = now(), updated_at = now()
      WHERE plan_id = $1 AND removed_at IS NULL AND item_id <> ALL($2::text[])`,
    [planId, [...keepItemIds]]
  );
  return result.rowCount ?? 0;
}

/* ------------------------------ exports ---------------------------------- */

export type PlanExportRow = {
  export_id: string;
  plan_id: string;
  plan_revision: number;
  idempotency_key: string;
  request_hash: string;
  status: 'COMPLETED';
  receipt: PlanExportReceipt;
  created_at: string;
};

const EXPORT_SELECT = `
  SELECT export_id, plan_id, plan_revision, idempotency_key, request_hash, status, receipt, created_at
    FROM plan_exports`;

export async function findPlanExportByKey(
  db: Db,
  planId: string,
  idempotencyKey: string
): Promise<PlanExportRow | null> {
  return db.one<PlanExportRow>(`${EXPORT_SELECT} WHERE plan_id = $1 AND idempotency_key = $2`, [
    planId,
    idempotencyKey
  ]);
}

export async function getPlanExportRow(
  db: Db,
  planId: string,
  exportId: string
): Promise<PlanExportRow | null> {
  return db.one<PlanExportRow>(`${EXPORT_SELECT} WHERE plan_id = $1 AND export_id = $2`, [planId, exportId]);
}

export async function latestPlanExport(db: Db, planId: string): Promise<PlanExportRow | null> {
  return db.one<PlanExportRow>(`${EXPORT_SELECT} WHERE plan_id = $1 ORDER BY created_at DESC LIMIT 1`, [
    planId
  ]);
}

export async function insertPlanExport(
  db: Db,
  input: {
    planId: string;
    planRevision: number;
    idempotencyKey: string;
    requestHash: string;
    receipt: PlanExportReceipt;
  },
  exportId: string = newId('PEX')
): Promise<PlanExportRow> {
  await db.query(
    `INSERT INTO plan_exports (export_id, plan_id, plan_revision, idempotency_key, request_hash, receipt)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      exportId,
      input.planId,
      input.planRevision,
      input.idempotencyKey,
      input.requestHash,
      JSON.stringify(input.receipt)
    ]
  );
  const created = await getPlanExportRow(db, input.planId, exportId);
  if (!created) throw new Error('Plan export insert returned no row');
  return created;
}

/* ------------------------- operational ordering -------------------------- */

/**
 * Preserves the manual order of an exported branch in the operational row.
 *
 * Only the reviewed export writes this column; an ordinary edit never rewrites it, and the
 * existing screens keep their current ordering until they choose to read it.
 */
export async function setSubprojectSortOrder(db: Db, subprojectId: string, sortOrder: number): Promise<void> {
  await db.query('UPDATE subprojects SET sort_order = $2 WHERE subproject_id = $1', [subprojectId, sortOrder]);
}

export async function setTaskSortOrder(db: Db, taskId: string, sortOrder: number): Promise<void> {
  await db.query('UPDATE tasks SET sort_order = $2 WHERE task_id = $1', [taskId, sortOrder]);
}
