/** Test-database helpers: a fresh, migrated database per file without re-running initdb. */
import pg from 'pg';
import { expect, inject } from 'vitest';
import { Database, runMigrations } from '../../src/index';

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
    pgBinDir: string;
  }
}

export function databaseUrl(): string {
  const url = inject('dbUrl');
  return url ?? '';
}

export function requireDatabase(): string {
  const url = databaseUrl();
  if (!url) {
    throw new Error('The PostgreSQL test server is unavailable in this environment');
  }
  return url;
}

export function pgBinDir(): string {
  return inject('pgBinDir') ?? '';
}

const TRUNCATE = `
  TRUNCATE TABLE
    calendar_links, notification_ledger, task_deadline_history, task_requests,
    task_assignees, responsibility_members, task_dependencies, tasks, subprojects,
    milestones, issues, project_phases, phase_templates, projects, responsibilities,
    member_skills, skills, members, holidays, app_settings, outbox_jobs,
    idempotency_keys, sessions, published_snapshots, audit_log, record_deletions,
    backup_log, import_runs
  RESTART IDENTITY CASCADE;
`;

export async function freshDatabase(): Promise<{ db: Database; pool: pg.Pool }> {
  const url = requireDatabase();
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  await runMigrations(pool);
  await pool.query(TRUNCATE);
  await pool.query(
    `INSERT INTO published_meta (id, active_slot) VALUES (1, 'NONE')
     ON CONFLICT (id) DO UPDATE SET active_slot = 'NONE', contract_version = '', hash = '', published_at = NULL`
  );
  return { db: new Database(pool), pool };
}

export function expectDatabase(t: { skip: (condition: boolean, reason?: string) => void }): void {
  const available = !!databaseUrl();
  t.skip(!available, 'PostgreSQL test server unavailable');
  expect(available).toBe(true);
}
