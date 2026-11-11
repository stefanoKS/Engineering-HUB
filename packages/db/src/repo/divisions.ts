/**
 * Divisions (課) and member/division relationships.
 *
 * A division is administrator-managed data, never a source enum: renaming one keeps its stable
 * identifier, and retiring one is a status change that never deletes a row. Relationships are
 * soft: removing a membership stamps `removed_at`/`removed_by` instead of deleting the history,
 * and re-adding a former member reactivates the same row.
 *
 * The reading helpers below deliberately expose display names only to a projection that needs
 * them; a member identifier, an e-mail address and an access kind never travel together with a
 * published or employee-facing payload.
 */
import type { Division, DivisionGrant } from '@eh/contracts';
import type { Queryable } from '../pool';
import { newId } from '../ids';
import { updateWithRevision } from './patch';
type Db = Queryable;

type DivisionRow = {
  division_id: string;
  name: string;
  status: 'Active' | 'Retired';
  sort_order: number;
  retired_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

function toDivision(row: DivisionRow): Division {
  return {
    divisionId: row.division_id,
    name: row.name,
    status: row.status,
    sortOrder: row.sort_order,
    retiredAt: row.retired_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const DIVISION_COLUMNS = `division_id, name, status, sort_order, retired_at, revision, created_at, updated_at`;

/**
 * The one division filter used by every list, tree, search and aggregate query.
 *
 * `ids === undefined` is the administrative unrestricted scope. Any array - including an empty one
 * - restricts the query, and an empty array matches nothing, so an account with no grant can never
 * fall through to "everything".
 */
export function divisionScopeSql(
  column: string,
  ids: readonly string[] | undefined,
  params: unknown[],
  where: string[]
): void {
  if (ids === undefined) return;
  const unique = [...new Set(ids)];
  if (!unique.length) {
    where.push('false');
    return;
  }
  params.push(unique);
  where.push(`${column} = ANY($${params.length}::text[])`);
}

/**
 * The canonical division list.
 *
 * The order is the one `compareDivisions` in `@eh/domain` computes: active before retired, the
 * stored sort order, the display name and finally the stable identifier. Two rows that share a
 * sort order or a name therefore still have exactly one position.
 */
export async function listDivisions(
  db: Db,
  options: { includeRetired?: boolean } = {}
): Promise<Division[]> {
  const rows = await db.many<DivisionRow>(
    `SELECT ${DIVISION_COLUMNS} FROM divisions
      WHERE ($1::boolean OR status = 'Active')
      ORDER BY (status = 'Retired') ASC, sort_order ASC, lower(name) ASC, division_id ASC`,
    [options.includeRetired === true]
  );
  return rows.map(toDivision);
}

export async function getDivision(db: Db, divisionId: string): Promise<Division | null> {
  const row = await db.one<DivisionRow>(`SELECT ${DIVISION_COLUMNS} FROM divisions WHERE division_id = $1`, [
    divisionId
  ]);
  return row ? toDivision(row) : null;
}

export async function insertDivision(
  db: Db,
  input: { name: string; sortOrder?: number },
  divisionId: string = newId('DIV')
): Promise<Division> {
  const row = await db.one<DivisionRow>(
    `INSERT INTO divisions (division_id, name, sort_order) VALUES ($1,$2,$3) RETURNING ${DIVISION_COLUMNS}`,
    [divisionId, input.name, input.sortOrder ?? 0]
  );
  if (!row) throw new Error('Division insert returned no row');
  return toDivision(row);
}

const DIVISION_PATCH: Record<string, string> = {
  name: 'name',
  status: 'status',
  sortOrder: 'sort_order',
  retiredAt: 'retired_at'
};

export async function updateDivision(
  db: Db,
  divisionId: string,
  changes: Record<string, unknown>,
  expectedRevision: number
): Promise<Division | null> {
  const columns: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const column = DIVISION_PATCH[key];
    if (column && value !== undefined) columns[column] = value;
  }
  const row = await updateWithRevision<DivisionRow>(db, {
    table: 'divisions',
    idColumn: 'division_id',
    id: divisionId,
    expectedRevision,
    columns,
    returning: DIVISION_COLUMNS
  });
  return row ? toDivision(row) : null;
}

/** The next free position inside one status group; never rewrites an existing sort order. */
export async function nextDivisionSortOrder(db: Db, status: 'Active' | 'Retired' = 'Active'): Promise<number> {
  const row = await db.one<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM divisions WHERE status = $1`,
    [status]
  );
  return Number(row?.next ?? 1);
}

/* --------------------------- member relationships -------------------------- */

export type MemberDivisionRow = {
  member_id: string;
  division_id: string;
  access_kind: 'WORK' | 'READ';
};

/** One indexed pass: membership rows for the accounts a screen is about to render. */
export async function listMemberDivisionGrants(
  db: Db,
  memberId: string
): Promise<(DivisionGrant & { divisionName: string })[]> {
  const rows = await db.many<{ division_id: string; access_kind: 'WORK' | 'READ'; name: string }>(
    `SELECT md.division_id, md.access_kind, d.name
       FROM member_divisions md JOIN divisions d ON d.division_id = md.division_id
      WHERE md.member_id = $1 AND md.removed_at IS NULL
      ORDER BY d.sort_order, lower(d.name)`,
    [memberId]
  );
  return rows.map((row) => ({
    divisionId: row.division_id,
    accessKind: row.access_kind,
    divisionName: row.name
  }));
}

/** Membership only: the assignment eligibility source. Ordered for a stable display. */
export async function listWorkDivisionIds(db: Db, memberId: string): Promise<string[]> {
  const rows = await db.many<{ division_id: string }>(
    `SELECT division_id FROM member_divisions
      WHERE member_id = $1 AND removed_at IS NULL AND access_kind = 'WORK'
      ORDER BY division_id`,
    [memberId]
  );
  return rows.map((row) => row.division_id);
}

/** Access resolution for one request: the stored oversight flag plus every active relationship. */
export async function loadDivisionAccess(
  db: Db,
  memberId: string
): Promise<{ allDivisionsRead: boolean; grants: { divisionId: string; accessKind: 'WORK' | 'READ' }[] }> {
  const [flag, rows] = await Promise.all([
    db.one<{ all_divisions_read: boolean }>(
      'SELECT all_divisions_read FROM members WHERE member_id = $1',
      [memberId]
    ),
    db.many<{ division_id: string; access_kind: 'WORK' | 'READ' }>(
      `SELECT division_id, access_kind FROM member_divisions
        WHERE member_id = $1 AND removed_at IS NULL ORDER BY division_id`,
      [memberId]
    )
  ]);
  return {
    allDivisionsRead: flag?.all_divisions_read === true,
    grants: rows.map((row) => ({ divisionId: row.division_id, accessKind: row.access_kind }))
  };
}

/**
 * Division display names for a set of members, in one bounded read.
 *
 * Used only to disambiguate two people who share a display name; no identifier, e-mail address or
 * access kind is returned.
 */
export async function memberDivisionNames(
  db: Db,
  memberIds: readonly string[]
): Promise<Map<string, string[]>> {
  if (!memberIds.length) return new Map();
  const rows = await db.many<{ member_id: string; name: string }>(
    `SELECT md.member_id, d.name
       FROM member_divisions md JOIN divisions d ON d.division_id = md.division_id
      WHERE md.member_id = ANY($1::text[]) AND md.removed_at IS NULL
      ORDER BY d.sort_order, lower(d.name)`,
    [[...new Set(memberIds)]]
  );
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const list = result.get(row.member_id) ?? [];
    list.push(row.name);
    result.set(row.member_id, list);
  }
  return result;
}

/**
 * Work-membership division identifiers for a set of members, in one bounded read.
 *
 * Only identifiers the caller may already read are returned; the assignment selector uses them to
 * filter its option list, and the server re-validates every selected identifier.
 */
export async function memberWorkDivisionIds(
  db: Db,
  memberIds: readonly string[]
): Promise<Map<string, string[]>> {
  if (!memberIds.length) return new Map();
  const rows = await db.many<{ member_id: string; division_id: string }>(
    `SELECT member_id, division_id FROM member_divisions
      WHERE member_id = ANY($1::text[]) AND removed_at IS NULL AND access_kind = 'WORK'
      ORDER BY division_id`,
    [[...new Set(memberIds)]]
  );
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const list = result.get(row.member_id) ?? [];
    list.push(row.division_id);
    result.set(row.member_id, list);
  }
  return result;
}

export type GrantChange = {
  /** Memberships and read grants that must exist after the change. */
  grants: readonly DivisionGrant[];
  actor: string;
};

/**
 * Applies the complete desired relationship set in one transaction.
 *
 * A removed relationship is stamped (never deleted) and a re-added one is reactivated on its
 * existing row, so the member/division history cannot grow a duplicate.
 */
export async function setMemberDivisionGrants(db: Db, memberId: string, input: GrantChange): Promise<void> {
  const desired = new Map<string, 'WORK' | 'READ'>();
  for (const grant of input.grants) {
    // WORK wins over READ for the same division: membership implies read access.
    if (!desired.has(grant.divisionId) || grant.accessKind === 'WORK') {
      desired.set(grant.divisionId, grant.accessKind);
    }
  }
  const current = await db.many<{ relationship_id: string; division_id: string; access_kind: 'WORK' | 'READ' }>(
    `SELECT relationship_id, division_id, access_kind FROM member_divisions
      WHERE member_id = $1 AND removed_at IS NULL`,
    [memberId]
  );
  const currentById = new Map(current.map((row) => [row.division_id, row]));
  for (const [divisionId, kind] of desired) {
    const existing = currentById.get(divisionId);
    if (existing && existing.access_kind === kind) continue;
    if (existing) {
      await db.query(
        `UPDATE member_divisions SET access_kind = $2 WHERE relationship_id = $1`,
        [existing.relationship_id, kind]
      );
      continue;
    }
    const removed = await db.one<{ relationship_id: string }>(
      `SELECT relationship_id FROM member_divisions
        WHERE member_id = $1 AND division_id = $2 AND removed_at IS NOT NULL
        ORDER BY assigned_at DESC LIMIT 1`,
      [memberId, divisionId]
    );
    if (removed) {
      await db.query(
        `UPDATE member_divisions
            SET removed_at = NULL, removed_by = '', access_kind = $2, assigned_at = now(), assigned_by = $3
          WHERE relationship_id = $1`,
        [removed.relationship_id, kind, input.actor]
      );
      continue;
    }
    await db.query(
      `INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind, assigned_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [newId('MDR'), memberId, divisionId, kind, input.actor]
    );
  }
  for (const row of current) {
    if (desired.has(row.division_id)) continue;
    await db.query(
      `UPDATE member_divisions SET removed_at = now(), removed_by = $2 WHERE relationship_id = $1`,
      [row.relationship_id, input.actor]
    );
  }
}

/**
 * Members holding an active WORK membership in a division. Assignment selectors and the server-side
 * eligibility check both read this one source, so a filtered dropdown and a forged identifier are
 * judged by exactly the same rule.
 */
export async function listDivisionWorkMemberIds(db: Db, divisionId: string): Promise<string[]> {
  const rows = await db.many<{ member_id: string }>(
    `SELECT md.member_id FROM member_divisions md JOIN members m ON m.member_id = md.member_id
      WHERE md.division_id = $1 AND md.removed_at IS NULL AND md.access_kind = 'WORK' AND m.active
      ORDER BY md.member_id`,
    [divisionId]
  );
  return rows.map((row) => row.member_id);
}

/** Active work a membership removal would leave without an eligible owner or assignee. */
export async function activeAssignmentBlockers(
  db: Db,
  memberId: string,
  divisionId: string
): Promise<{ taskIds: string[]; projectIds: string[]; subprojectIds: string[]; responsibilityIds: string[] }> {
  const taskRows = await db.many<{ task_id: string }>(
    `SELECT t.task_id FROM tasks t JOIN projects p ON p.project_id = t.project_id
      WHERE p.division_id = $2 AND t.deleted_at IS NULL AND t.status NOT IN ('Done','Cancelled')
        AND p.status NOT IN ('Archived','Completed','Cancelled') AND p.archived_at IS NULL
        AND (t.owner_member_id = $1 OR EXISTS (
              SELECT 1 FROM task_assignees a
               WHERE a.task_id = t.task_id AND a.member_id = $1 AND a.removed_at IS NULL))
      ORDER BY t.task_id`,
    [memberId, divisionId]
  );
  const projectRows = await db.many<{ project_id: string }>(
    `SELECT project_id FROM projects
      WHERE division_id = $2 AND project_owner_id = $1 AND deleted_at IS NULL
        AND status NOT IN ('Archived','Completed','Cancelled') AND archived_at IS NULL
      ORDER BY project_id`,
    [memberId, divisionId]
  );
  const subprojectRows = await db.many<{ subproject_id: string }>(
    `SELECT s.subproject_id FROM subprojects s JOIN projects p ON p.project_id = s.project_id
      WHERE p.division_id = $2 AND s.owner_id = $1 AND s.deleted_at IS NULL
        AND s.status NOT IN ('Archived','Completed','Cancelled')
      ORDER BY s.subproject_id`,
    [memberId, divisionId]
  );
  const responsibilityRows = await db.many<{ responsibility_id: string }>(
    `SELECT r.responsibility_id FROM responsibilities r
      WHERE r.division_id = $2 AND (r.owner_member_id = $1 OR EXISTS (
              SELECT 1 FROM responsibility_members rm
               WHERE rm.responsibility_id = r.responsibility_id AND rm.member_id = $1 AND rm.removed_at IS NULL))
      ORDER BY r.responsibility_id`,
    [memberId, divisionId]
  );
  return {
    taskIds: taskRows.map((row) => row.task_id),
    projectIds: projectRows.map((row) => row.project_id),
    subprojectIds: subprojectRows.map((row) => row.subproject_id),
    responsibilityIds: responsibilityRows.map((row) => row.responsibility_id)
  };
}
