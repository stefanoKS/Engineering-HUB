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
    member_skills, skills, members, divisions, member_divisions, holidays, app_settings,
    outbox_jobs, idempotency_keys, sessions, published_snapshots, audit_log, record_deletions,
    backup_log, import_runs
  RESTART IDENTITY CASCADE;
`;

/**
 * Fixture divisions for a test database, part one.
 *
 * The three fixture divisions and the fixture column defaults are created immediately after the
 * truncate, so a row inserted by a test can always reference a division. Nothing here is production
 * behaviour: the shipped migration seeds no division and sets no default.
 */
export async function createFixtureDivisions(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO divisions (division_id, name, sort_order) VALUES
       ('DIV-DEV','設計・開発課',1), ('DIV-ENG','設計・技術課',2), ('DIV-PROD','生産・技術課',3)
     ON CONFLICT (division_id) DO NOTHING`
  );
  await pool.query("ALTER TABLE projects ALTER COLUMN division_id SET DEFAULT 'DIV-DEV'");
  await pool.query("ALTER TABLE responsibilities ALTER COLUMN division_id SET DEFAULT 'DIV-DEV'");
  // Fixture-only convenience: a member created by a test starts with a WORK membership in the
  // first fixture division, so an authorization test is about roles and scope. A test that proves
  // the fail-closed path deletes that relationship explicitly.
  await pool.query(`
    CREATE OR REPLACE FUNCTION eh_fixture_member_division() RETURNS trigger AS $$
    BEGIN
      INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind, assigned_by)
      VALUES ('MD-' || NEW.member_id, NEW.member_id, 'DIV-DEV', 'WORK', 'fixture')
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
  `);
  await pool.query('DROP TRIGGER IF EXISTS members_fixture_division ON members');
  await pool.query(`
    CREATE TRIGGER members_fixture_division AFTER INSERT ON members
      FOR EACH ROW EXECUTE FUNCTION eh_fixture_member_division();
  `);
}

/**
 * Fixture divisions for a test database, part two.
 *
 * The division feature is an organisational boundary, and an authorization suite is about roles
 * and scope, not about the reviewed mapping step. This helper therefore maps every existing row to
 * the first fixture division and gives every existing member a WORK membership there.
 *
 * A test that proves the *unmapped* path writes `division_id = NULL` explicitly, and a test that
 * proves a cross-division refusal uses the other two divisions.
 */
export async function seedTestDivisions(db: Database): Promise<void> {
  // Projects first: the consistency trigger refuses to scope a responsibility whose projects still
  // sit in another (or no) division.
  await db.query(`UPDATE projects SET division_id = 'DIV-DEV' WHERE division_id IS NULL`);
  await db.query(
    `UPDATE responsibilities SET division_id = 'DIV-DEV' WHERE division_id IS NULL AND status <> 'Retired'`
  );
  await db.query(
    `INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind, assigned_by)
     SELECT 'MD-' || m.member_id, m.member_id, 'DIV-DEV', 'WORK', 'fixture'
       FROM members m
      WHERE NOT EXISTS (
        SELECT 1 FROM member_divisions md
         WHERE md.member_id = m.member_id AND md.division_id = 'DIV-DEV' AND md.removed_at IS NULL)`
  );
}

export async function freshDatabase(): Promise<{ db: Database; pool: pg.Pool }> {
  const url = requireDatabase();
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  await runMigrations(pool);
  await pool.query(TRUNCATE);
  await createFixtureDivisions(pool);
  await pool.query(
    `INSERT INTO published_meta (id, active_slot) VALUES (1, 'NONE')
     ON CONFLICT (id) DO UPDATE SET active_slot = 'NONE', contract_version = '', hash = '', published_at = NULL`
  );
  return { db: new Database(pool), pool };
}

export function expectDatabase(t: { skip: (condition: boolean, reason?: string) => void }): void {
  const available = !!databaseUrl();
  if (!available && process.env.REQUIRE_DATABASE === '1') {
    throw new Error(
      'REQUIRE_DATABASE=1 but the PostgreSQL test server is unavailable; a release gate must not pass without it'
    );
  }
  t.skip(!available, 'PostgreSQL test server unavailable');
  expect(available).toBe(true);
}
