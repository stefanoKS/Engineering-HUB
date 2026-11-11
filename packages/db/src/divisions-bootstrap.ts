/**
 * Initial division bootstrap.
 *
 * The three operating divisions are configuration, not source constants: a fresh deployment
 * records them once through this explicit step, and renaming one afterwards never changes its
 * identifier. Nothing here runs automatically at application startup, and an existing operational
 * database is never rewritten - a name that already exists is left exactly as it is.
 */
import type { Queryable } from './pool';
import { newId } from './ids';

export type InitialDivision = { divisionId: string; name: string };

/** The approved initial set of divisions for a new deployment. */
export const INITIAL_DIVISIONS: readonly InitialDivision[] = [
  { divisionId: 'DIV-DESIGN-DEV', name: '設計・開発課' },
  { divisionId: 'DIV-DESIGN-ENG', name: '設計・技術課' },
  { divisionId: 'DIV-PRODUCTION-ENG', name: '生産・技術課' }
];

/**
 * Creates the initial divisions when they are absent.
 *
 * Returns the identifiers it created and the ones that already existed, so a caller reports what
 * happened instead of claiming success blindly.
 */
export async function bootstrapDivisions(
  db: Queryable,
  divisions: readonly InitialDivision[] = INITIAL_DIVISIONS
): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];
  for (const [index, division] of divisions.entries()) {
    const present = await db.one<{ division_id: string }>(
      'SELECT division_id FROM divisions WHERE division_id = $1 OR lower(name) = lower($2) LIMIT 1',
      [division.divisionId, division.name]
    );
    if (present) {
      existing.push(present.division_id);
      continue;
    }
    await db.query(
      `INSERT INTO divisions (division_id, name, sort_order) VALUES ($1,$2,$3)`,
      [division.divisionId, division.name, index + 1]
    );
    created.push(division.divisionId);
  }
  return { created, existing };
}

/** Membership rows for a set of members, used by the demo seed and the reviewed mapping step. */
export async function grantDivisionMembership(
  db: Queryable,
  input: { memberId: string; divisionId: string; accessKind?: 'WORK' | 'READ'; actor: string }
): Promise<void> {
  await db.query(
    `INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind, assigned_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING`,
    [newId('MDR'), input.memberId, input.divisionId, input.accessKind ?? 'WORK', input.actor]
  );
}
