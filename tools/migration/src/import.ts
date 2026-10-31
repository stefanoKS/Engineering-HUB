/**
 * Import into a fresh V2 database.
 *
 * The import refuses a populated target, preserves every stable identifier, keeps historical
 * timestamps and state, and never activates automation: outbound mail, Calendar, scheduled
 * backups and shared-dashboard publication are forced OFF regardless of the source values.
 * `--dry-run` runs the identical statements inside one transaction and rolls back.
 */
import type { Database, Transaction } from '@eh/db';
import { newId } from '@eh/db';
import { normalizeDate } from '@eh/domain';
import { TABLE_SPECS, normalizeBoolean, normalizeNumber, splitIds } from './map';
import type { SourceSnapshot, ValidationIssue } from './types';
import { validateSnapshot } from './validate';

export type ImportOptions = {
  runId?: string;
  dryRun?: boolean;
  allowPopulated?: boolean;
  log?: (message: string) => void;
};

export type ImportResult = {
  runId: string;
  dryRun: boolean;
  counts: Record<string, number>;
  issues: ValidationIssue[];
};

class DryRunRollback extends Error {}



function convert(raw: string, type: string): unknown {
  switch (type) {
    case 'date':
      return normalizeDate(raw);
    case 'timestamp': {
      if (!raw) return null;
      const value = new Date(raw);
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    case 'number':
      return normalizeNumber(raw);
    case 'boolean':
      return normalizeBoolean(raw);
    default:
      return raw;
  }
}

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

async function insertRows(
  tx: Transaction,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
): Promise<number> {
  let inserted = 0;
  for (const row of rows) {
    // Only the columns this row actually carries are written, so a database default
    // (for example a project notification switch or a status) is never overwritten with null.
    const present = columns.filter((column) => row[column] !== undefined);
    const values = present.map((column) => row[column] ?? null);
    const placeholders = present.map((_, index) => `$${index + 1}`);
    await tx.query(`INSERT INTO ${table} (${present.join(', ')}) VALUES (${placeholders.join(', ')})`, values);
    inserted += 1;
  }
  return inserted;
}

export async function importSnapshot(
  db: Database,
  snapshot: SourceSnapshot,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const log = options.log ?? (() => undefined);
  const runId = options.runId ?? newId('IMPORT');
  const issues = validateSnapshot(snapshot);
  const errors = issues.filter((issue) => issue.severity === 'ERROR');
  if (errors.length) {
    throw new Error(
      `Import refused: ${errors.length} validation error(s). Run the dry-run report first.\n` +
        errors
          .slice(0, 10)
          .map((issue) => `- ${issue.table}/${issue.recordId}/${issue.field}: ${issue.message}`)
          .join('\n')
    );
  }

  const existing = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM members');
  if (Number(existing?.count ?? 0) > 0 && !options.allowPopulated) {
    throw new Error('Import refused: the target database already contains records');
  }

  const counts: Record<string, number> = {};
  const apply = async (tx: Transaction): Promise<void> => {
    // Historical timestamps are preserved exactly; the touch trigger is suppressed for this run.
    await tx.query("SELECT set_config('eh.preserve_timestamps', 'on', true)");
    await tx.query(
      `INSERT INTO import_runs (run_id, source_label, source_checksum, status) VALUES ($1,$2,$3,'RUNNING')`,
      [runId, snapshot.label, snapshot.exportedAt]
    );

    for (const spec of TABLE_SPECS) {
      if (spec.source === 'PROJECT_PHASES') continue;
      const sourceRows = rowsOf(snapshot, spec.source);
      if (!sourceRows.length) {
        counts[spec.target] = 0;
        continue;
      }
      const insertColumns = [spec.idTarget];
      for (const column of spec.columns) {
        if (column.deferred) continue;
        insertColumns.push(column.target);
      }
      const prepared = sourceRows.map((row) => {
        const record: Record<string, unknown> = { [spec.idTarget]: row[spec.idSource]?.trim() };
        for (const column of spec.columns) {
          if (column.deferred) continue;
          const raw = row[column.source] ?? '';
          if (raw === '') continue;
          if (column.type === 'enum' && column.values && !column.values.includes(raw.trim())) {
            throw new Error(`${spec.source}/${row[spec.idSource]}: unsupported ${column.source}=${raw}`);
          }
          record[column.target] = convert(raw, column.type);
        }
        return record;
      });
      counts[spec.target] = await insertRows(tx, spec.target, insertColumns, prepared);

      // Deferred self-referencing foreign keys are applied after every row exists.
      const deferredColumns = spec.columns.filter((column) => column.deferred);
      for (const column of deferredColumns) {
        const pairs = sourceRows
          .map((row) => ({ id: row[spec.idSource]?.trim(), value: row[column.source]?.trim() }))
          .filter((pair) => !!pair.id && !!pair.value);
        for (const pair of pairs) {
          await tx.query(`UPDATE ${spec.target} SET ${column.target} = $2 WHERE ${spec.idTarget} = $1`, [
            pair.id,
            pair.value
          ]);
        }
      }
    }

    // Sequencing lives in a relation table in V2.
    let dependencyCount = 0;
    for (const row of rowsOf(snapshot, 'TASKS')) {
      for (const dependencyId of splitIds(row.Dependency_IDs ?? '')) {
        await tx.query(
          'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [row.Task_ID, dependencyId]
        );
        dependencyCount += 1;
      }
    }
    counts.task_dependencies = dependencyCount;

    for (const row of rowsOf(snapshot, 'TASK_ASSIGNEES')) {
      const taskId = row.Task_ID ?? '';
      const memberId = row.Member_ID ?? '';
      if (!taskId || !memberId) continue;
      await tx.query(
        `INSERT INTO task_assignees (assignment_id, task_id, member_id, assigned_at, assigned_by, removed_at, removed_by)
         VALUES ($1,$2,$3,COALESCE($4, now()),$5,$6,$7)`,
        [
          row.Assignment_ID || newId('TAS'),
          taskId,
          memberId,
          row.Assigned_At ? convert(row.Assigned_At, 'timestamp') : null,
          row.Assigned_By ?? '',
          row.Removed_At ? convert(row.Removed_At, 'timestamp') : null,
          row.Removed_By ?? ''
        ]
      );
    }
    counts.task_assignees = rowsOf(snapshot, 'TASK_ASSIGNEES').length;

    for (const row of rowsOf(snapshot, 'RESPONSIBILITY_MEMBERS')) {
      const responsibilityId = row.Responsibility_ID ?? '';
      const memberId = row.Member_ID ?? '';
      if (!responsibilityId || !memberId) continue;
      await tx.query(
        `INSERT INTO responsibility_members
           (assignment_id, responsibility_id, member_id, assigned_at, assigned_by, removed_at, removed_by)
         VALUES ($1,$2,$3,COALESCE($4, now()),$5,$6,$7)`,
        [
          row.Assignment_ID || newId('RMA'),
          responsibilityId,
          memberId,
          row.Assigned_At ? convert(row.Assigned_At, 'timestamp') : null,
          row.Assigned_By ?? '',
          row.Removed_At ? convert(row.Removed_At, 'timestamp') : null,
          row.Removed_By ?? ''
        ]
      );
    }
    counts.responsibility_members = rowsOf(snapshot, 'RESPONSIBILITY_MEMBERS').length;

    // Project phases depend on the project and are imported after tasks exist.
    const phaseSpec = TABLE_SPECS.find((spec) => spec.source === 'PROJECT_PHASES');
    if (phaseSpec) {
      const phaseRows = rowsOf(snapshot, 'PROJECT_PHASES');
      const columns = [phaseSpec.idTarget, ...phaseSpec.columns.map((column) => column.target)];
      const prepared = phaseRows.map((row) => {
        const record: Record<string, unknown> = { [phaseSpec.idTarget]: row.Project_Phase_ID };
        for (const column of phaseSpec.columns) {
          const raw = row[column.source] ?? '';
          if (raw === '') continue;
          record[column.target] =
            column.target === 'dependency_ids' ? splitIds(raw) : convert(raw, column.type);
        }
        return record;
      });
      counts.project_phases = await insertRows(tx, phaseSpec.target, columns, prepared);
    }

    // Settings are imported but every outbound automation stays OFF.
    const safeSettings = new Map<string, string>([
      ['EMAIL_MODE', 'OFF'],
      ['EMERGENCY_STOP', 'true'],
      ['SHARED_DASHBOARD_PUBLISH_ENABLED', 'false'],
      ['CALENDAR_SYNC_ENABLED', 'false'],
      ['DAILY_BACKUP_ENABLED', 'false']
    ]);
    let settingCount = 0;
    for (const row of rowsOf(snapshot, 'AUTOMATION_SETTINGS')) {
      const key = row.Setting_ID ?? '';
      if (!key) continue;
      const value = safeSettings.get(key) ?? row.Value ?? '';
      await tx.query(
        `INSERT INTO app_settings (setting_id, value, description, updated_at, updated_by)
         VALUES ($1,$2,$3,COALESCE($4, now()),$5)
         ON CONFLICT (setting_id) DO UPDATE SET value = EXCLUDED.value`,
        [key, value, row.Description ?? '', row.Updated_At ? convert(row.Updated_At, 'timestamp') : null, row.Updated_By ?? 'migration']
      );
      settingCount += 1;
    }
    for (const [key, value] of safeSettings) {
      if (!settingCount || !rowsOf(snapshot, 'AUTOMATION_SETTINGS').some((row) => row.Setting_ID === key)) {
        await tx.query(
          `INSERT INTO app_settings (setting_id, value, description, updated_by)
           VALUES ($1,$2,'Activated by migration safety rule',$3) ON CONFLICT (setting_id) DO NOTHING`,
          [key, value, 'migration']
        );
      }
    }
    counts.app_settings = Math.max(settingCount, safeSettings.size);

    // Audit evidence keeps its original timestamps and values.
    let auditCount = 0;
    for (const row of rowsOf(snapshot, 'AUDIT_LOG')) {
      const action = row.Action ?? '';
      const entityType = row.Entity_Type ?? '';
      const entityId = row.Entity_ID ?? '';
      if (!action && !entityType) continue;
      await tx.query(
        `INSERT INTO audit_log
           (occurred_at, entity_type, entity_id, action, previous_value, new_value, actor_email, result)
         VALUES (COALESCE($1, now()), $2, $3, $4, $5, $6, $7, $8)`,
        [
          row.Timestamp ? convert(row.Timestamp, 'timestamp') : null,
          entityType || 'UNKNOWN',
          entityId || '-',
          action || 'MIGRATED_ROW',
          row.Previous_Value ? JSON.stringify(row.Previous_Value) : null,
          row.New_Value ? JSON.stringify(row.New_Value) : null,
          row.Actor ?? '',
          row.Result === 'REFUSED' || row.Result === 'FAILED' ? row.Result : 'OK'
        ]
      );
      auditCount += 1;
    }
    counts.audit_log = auditCount;

    await tx.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, new_value, actor_email)
       VALUES ('MIGRATION', $1, 'MIGRATION_IMPORTED', $2, 'migration')`,
      [runId, JSON.stringify({ counts, source: snapshot.label, dryRun: options.dryRun === true })]
    );
    await tx.query(
      `UPDATE import_runs SET status = $2, finished_at = now(), row_counts = $3 WHERE run_id = $1`,
      [runId, options.dryRun ? 'DRY_RUN' : 'COMPLETED', JSON.stringify(counts)]
    );
    log(`imported ${Object.values(counts).reduce((sum, value) => sum + value, 0)} rows`);
    if (options.dryRun) throw new DryRunRollback('dry run complete');
  };

  try {
    await db.transaction(apply);
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return { runId, dryRun: options.dryRun === true, counts, issues };
}
