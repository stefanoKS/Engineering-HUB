/**
 * Reconciliation report.
 *
 * A migration is accepted only when the report is clean. Every mapped table is compared
 * field-by-field (not just the original four), a blank source cell is compared against the
 * destination column default instead of being silently counted as a match, the relationship tables
 * are compared as sets, the settings carry their documented safe transformations, and the report
 * carries both a source checksum and a deterministic destination checksum.
 */
import { createHash } from 'node:crypto';
import type { Database } from '@eh/db';
import { canonicalJson, normalizeDate } from '@eh/domain';
import { TABLE_SPECS, normalizeBoolean, normalizeNumber, splitIds } from './map';
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

type ColumnMeta = {
  defaultValue: string | null;
  nullable: boolean;
  dataType: string;
};

async function columnDefaults(db: Database): Promise<Map<string, ColumnMeta>> {
  const rows = await db.many<{
    table_name: string;
    column_name: string;
    column_default: string | null;
    is_nullable: string;
    data_type: string;
  }>(
    `SELECT table_name, column_name, column_default, is_nullable, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'`
  );
  const map = new Map<string, ColumnMeta>();
  for (const row of rows) {
    map.set(`${row.table_name}.${row.column_name}`, {
      defaultValue: row.column_default,
      nullable: row.is_nullable === 'YES',
      dataType: row.data_type
    });
  }
  return map;
}

/**
 * The value a blank V1 cell produces in V2. The importer writes only present columns, so a blank
 * cell keeps the destination default; a column without a literal default keeps its implicit empty
 * value. A volatile default (`now()`, a sequence) cannot be predicted and is reported as skipped.
 */
function expectedForBlank(meta: ColumnMeta | undefined): { value: unknown; verifiable: boolean } {
  if (!meta) return { value: '', verifiable: false };
  if (meta.defaultValue === null) {
    if (meta.nullable) return { value: null, verifiable: true };
    if (meta.dataType === 'boolean') return { value: false, verifiable: true };
    if (['text', 'character varying', 'citext'].includes(meta.dataType)) return { value: '', verifiable: true };
    return { value: null, verifiable: false };
  }
  let text = meta.defaultValue.trim().replace(/::[a-zA-Z_ ]+(\[\])?$/, '').trim();
  if (text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1).replace(/''/g, "'");
  if (text === 'true') return { value: true, verifiable: true };
  if (text === 'false') return { value: false, verifiable: true };
  if (/^-?\d+(\.\d+)?$/.test(text)) return { value: Number(text), verifiable: true };
  if (/^(now\(\)|CURRENT_TIMESTAMP|nextval\()/i.test(text)) return { value: null, verifiable: false };
  return { value: text, verifiable: true };
}

function checksumOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export async function reconcileSnapshot(
  db: Database,
  snapshot: SourceSnapshot,
  runId: string
): Promise<ReconcileReport> {
  const defaults = await columnDefaults(db);
  const report: ReconcileReport = {
    runId,
    tables: [],
    relations: [],
    settings: { table: 'app_settings', expected: 0, imported: 0, mismatched: [] },
    checksum: '',
    destinationChecksum: '',
    ok: true
  };

  for (const spec of TABLE_SPECS) {
    const sourceRows = rowsOf(snapshot, spec.source);
    const stored = await db.one<{ count: string }>(`SELECT count(*)::text AS count FROM ${spec.target}`);
    const importedRows = Number(stored?.count ?? 0);
    const entry: ReconcileReport['tables'][number] = {
      table: spec.target,
      sourceRows: sourceRows.length,
      importedRows,
      matchedFields: 0,
      skippedFields: 0,
      mismatchedFields: [],
      destinationChecksum: ''
    };
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
        const storedValue = normalizeComparable(storedRow[column.target], column.type);
        if (rawSource === '') {
          const expected = expectedForBlank(defaults.get(`${spec.target}.${column.target}`));
          if (!expected.verifiable) {
            entry.skippedFields += 1;
            continue;
          }
          const expectedValue = normalizeComparable(expected.value, column.type);
          if (expectedValue === storedValue) entry.matchedFields += 1;
          else
            entry.mismatchedFields.push({
              recordId: id,
              field: column.target,
              source: '(blank)',
              stored: storedValue
            });
          continue;
        }
        const sourceValue = normalizeComparable(rawSource, column.type);
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

    // Deterministic destination evidence: the stored rows, normalized and independent of order.
    const normalizedDestination = storedRows
      .map((row) => Object.fromEntries(selectColumns.map((column) => [column, normalizeComparable(row[column], 'text')])))
      .sort((left, right) => String(left[spec.idTarget]).localeCompare(String(right[spec.idTarget])));
    entry.destinationChecksum = checksumOf(normalizedDestination);

    if (entry.sourceRows !== entry.importedRows || entry.mismatchedFields.length) report.ok = false;
    report.tables.push(entry);
  }

  await reconcileRelations(db, snapshot, report);
  await reconcileSettings(db, snapshot, report);

  report.checksum = checksumOf({
    label: snapshot.label,
    exportedAt: snapshot.exportedAt,
    tables: snapshot.tables
  });
  report.destinationChecksum = checksumOf(
    report.tables.map((entry) => ({
      table: entry.table,
      rows: entry.importedRows,
      checksum: entry.destinationChecksum
    }))
  );
  if (report.relations.some((relation) => relation.missing.length || relation.unexpected.length)) {
    report.ok = false;
  }
  if (report.settings.mismatched.length) report.ok = false;
  return report;
}

async function compareSet(
  report: ReconcileReport,
  table: string,
  expected: Set<string>,
  actual: Set<string>
): Promise<void> {
  const missing = [...expected].filter((key) => !actual.has(key)).sort();
  const unexpected = [...actual].filter((key) => !expected.has(key)).sort();
  report.relations.push({ table, expectedRows: expected.size, importedRows: actual.size, missing, unexpected });
}

async function reconcileRelations(
  db: Database,
  snapshot: SourceSnapshot,
  report: ReconcileReport
): Promise<void> {
  const expectedAssignees = new Set(
    rowsOf(snapshot, 'TASK_ASSIGNEES')
      .map((row) => `${row.Task_ID ?? ''}|${row.Member_ID ?? ''}`)
      .filter((key) => !key.startsWith('|') && !key.endsWith('|'))
  );
  const storedAssignees = await db.many<{ task_id: string; member_id: string }>(
    'SELECT task_id, member_id FROM task_assignees'
  );
  await compareSet(
    report,
    'task_assignees',
    expectedAssignees,
    new Set(storedAssignees.map((row) => `${row.task_id}|${row.member_id}`))
  );

  const expectedMembers = new Set(
    rowsOf(snapshot, 'RESPONSIBILITY_MEMBERS')
      .map((row) => `${row.Responsibility_ID ?? ''}|${row.Member_ID ?? ''}`)
      .filter((key) => !key.startsWith('|') && !key.endsWith('|'))
  );
  const storedMembers = await db.many<{ responsibility_id: string; member_id: string }>(
    'SELECT responsibility_id, member_id FROM responsibility_members'
  );
  await compareSet(
    report,
    'responsibility_members',
    expectedMembers,
    new Set(storedMembers.map((row) => `${row.responsibility_id}|${row.member_id}`))
  );

  const expectedDependencies = new Set<string>();
  for (const row of rowsOf(snapshot, 'TASKS')) {
    const taskId = row.Task_ID ?? '';
    for (const dependencyId of splitIds(row.Dependency_IDs ?? '')) {
      if (taskId && dependencyId) expectedDependencies.add(`${taskId}|${dependencyId}`);
    }
  }
  const storedDependencies = await db.many<{ task_id: string; depends_on_task_id: string }>(
    'SELECT task_id, depends_on_task_id FROM task_dependencies'
  );
  await compareSet(
    report,
    'task_dependencies',
    expectedDependencies,
    new Set(storedDependencies.map((row) => `${row.task_id}|${row.depends_on_task_id}`))
  );
}

/** Documented safe transformations: outbound automation is always OFF after a migration. */
const SAFE_SETTING_OVERRIDES = new Map<string, string>([
  ['EMAIL_MODE', 'OFF'],
  ['EMERGENCY_STOP', 'true'],
  ['SHARED_DASHBOARD_PUBLISH_ENABLED', 'false'],
  ['CALENDAR_SYNC_ENABLED', 'false'],
  ['DAILY_BACKUP_ENABLED', 'false']
]);

async function reconcileSettings(
  db: Database,
  snapshot: SourceSnapshot,
  report: ReconcileReport
): Promise<void> {
  const sourceRows = rowsOf(snapshot, 'AUTOMATION_SETTINGS').filter((row) => (row.Setting_ID ?? '').trim() !== '');
  const stored = await db.many<{ setting_id: string; value: string }>('SELECT setting_id, value FROM app_settings');
  const byId = new Map(stored.map((row) => [row.setting_id, row.value]));
  report.settings.expected = sourceRows.length;
  report.settings.imported = stored.length;
  const compare = (key: string, expected: string): void => {
    const actual = byId.get(key);
    if (actual === undefined) {
      report.settings.mismatched.push({ recordId: key, field: 'value', source: expected, stored: 'missing' });
      return;
    }
    if (String(actual) !== String(expected)) {
      report.settings.mismatched.push({ recordId: key, field: 'value', source: expected, stored: String(actual) });
    }
  };
  for (const row of sourceRows) {
    const key = (row.Setting_ID ?? '').trim();
    if (!key) continue;
    compare(key, SAFE_SETTING_OVERRIDES.get(key) ?? (row.Value ?? ''));
  }
  // The five safety keys must exist even when the source workbook never defined them.
  for (const [key, value] of SAFE_SETTING_OVERRIDES) compare(key, value);
}
