/**
 * Revision-checked partial update.
 *
 * Only the columns the caller actually addresses are written (one contiguous run per changed
 * column set is still one statement), and the row is only touched when the stored revision
 * matches the one the editor loaded. A stale edit updates nothing and returns null, which the
 * API turns into `EDIT_CONFLICT` with the draft preserved.
 */
import type { QueryResultRow } from 'pg';
import type { Queryable } from '../pool';

export async function updateWithRevision<T extends QueryResultRow = QueryResultRow>(
  db: Queryable,
  input: {
    table: string;
    idColumn: string;
    id: string;
    expectedRevision: number;
    columns: Record<string, unknown>;
    returning: string;
    auditColumn?: string;
  }
): Promise<T | null> {
  const entries = Object.entries(input.columns).filter(([, value]) => value !== undefined);
  if (!entries.length) return null;
  const assignments = entries.map(([column], index) => `${column} = $${index + 3}`);
  const values = entries.map(([, value]) => value);
  const result = await db.query<T>(
    `UPDATE ${input.table}
        SET ${assignments.join(', ')}, ${input.auditColumn ?? 'updated_at'} = now(), revision = revision + 1
      WHERE ${input.idColumn} = $1 AND revision = $2
      RETURNING ${input.returning}`,
    [input.id, input.expectedRevision, ...values]
  );
  return result.rows[0] ?? null;
}
