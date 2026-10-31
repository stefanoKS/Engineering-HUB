/**
 * Reconciliation report: counts plus a field-by-field comparison of every mapped column.
 * A migration is only accepted when the report is clean; the checksum makes two runs comparable.
 */
import { createHash } from 'node:crypto';
import type { Database } from '@eh/db';
import { canonicalJson } from '@eh/domain';
import { TABLE_SPECS, normalizeBoolean, normalizeNumber } from './map';
import { normalizeDate } from '@eh/domain';
import type { ReconcileReport, SourceSnapshot } from './types';

function rowsOf(snapshot: SourceSnapshot, source: string) {
  const table = snapshot.tables[source];
  if (!table) return [];
  return table.rows
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const record: Record<string, string> = {};
      table.headers.forEach((header, index) => {
        if (!header) return;
        record[header] = String(row[index] ?? '');
      });
      return record;
    });
}

function normalizeComparable(value: unknown, type: string): string {
  if (value === null || value === undefined) return '';
  switch (type) {
    case 'date':
      return normalizeDate(String(value)) ?? '';
    case 'timestamp': {
      if (value instanceof Date) return value.toISOString();
      const text = String(value);
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
    }
    case 'number': {
      const number = typeof value === 'number' ? value : normalizeNumber(String(value));
      return number === null ? '' : String(number);
    }
    case 'boolean':
      return typeof value === 'boolean' ? String(value) : String(normalizeBoolean(String(value)));
    default:
      return String(value).trim();
  }
}

export async function reconcileSnapshot(
  db: Database,
  snapshot: SourceSnapshot,
  runId: string
): Promise<ReconcileReport> {
  const report: ReconcileReport = { runId, tables: [], checksum: '', ok: true };
  for (const spec of TABLE_SPECS) {
    const sourceRows = rowsOf(snapshot, spec.source);
    const stored = await db.one<{ count: string }>(`SELECT count(*)::text AS count FROM ${spec.target}`);
    const importedRows = Number(stored?.count ?? 0);
    const entry = {
      table: spec.target,
      sourceRows: sourceRows.length,
      importedRows,
      matchedFields: 0,
      mismatchedFields: [] as ReconcileReport['tables'][number]['mismatchedFields']
    };
    if (spec.compare && sourceRows.length) {
      const selectColumns = [spec.idTarget, ...spec.columns.map((column) => column.target)];
      const storedRows = await db.many<Record<string, unknown>>(
        `SELECT ${selectColumns.join(', ')} FROM ${spec.target}`
      );
      const byId = new Map(storedRows.map((row) => [String(row[spec.idTarget]), row]));
      for (const row of sourceRows) {
        const id = row[spec.idSource]?.trim() ?? '';
        const storedRow = byId.get(id);
        if (!storedRow) {
          entry.mismatchedFields.push({ recordId: id, field: spec.idTarget, source: 'present', stored: 'missing' });
          continue;
        }
        for (const column of spec.columns) {
          const rawSource = String(row[column.source] ?? '').trim();
          // A blank source cell means "not set in V1" and lets the V2 default apply; it is not a
          // data-loss signal and is therefore not compared.
          if (rawSource === '') {
            entry.matchedFields += 1;
            continue;
          }
          const sourceValue = normalizeComparable(rawSource, column.type);
          const storedValue = normalizeComparable(storedRow[column.target], column.type);
          if (sourceValue === '') {
            entry.matchedFields += 1;
            continue;
          }
          if (sourceValue === storedValue) entry.matchedFields += 1;
          else
            entry.mismatchedFields.push({
              recordId: id,
              field: column.target,
              source: sourceValue,
              stored: storedValue
            });
        }
      }
    }
    if (entry.sourceRows !== entry.importedRows || entry.mismatchedFields.length) report.ok = false;
    report.tables.push(entry);
  }
  report.checksum = createHash('sha256')
    .update(canonicalJson({ label: snapshot.label, exportedAt: snapshot.exportedAt, tables: snapshot.tables }), 'utf8')
    .digest('hex');
  return report;
}
