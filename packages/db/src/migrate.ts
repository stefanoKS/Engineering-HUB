/**
 * SQL migration runner.
 *
 * Chosen approach: plain, inspectable `.sql` files applied in filename order, each inside one
 * transaction, guarded by a session advisory lock and recorded with a checksum. There is no
 * ORM and no generated schema: what runs against PostgreSQL is exactly what a reviewer reads.
 * An already-applied migration whose file changed is a hard failure, never a silent re-run.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const MIGRATIONS_DIR =
  process.env.EH_MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 947_311_002;

export type MigrationRow = {
  version: number;
  name: string;
  checksum: string;
  applied_at: Date;
  duration_ms: number;
};

export type MigrationResult = {
  applied: { version: number; name: string; durationMs: number }[];
  current: number;
};

export function checksum(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function migrationVersion(name: string): number {
  const match = /^(\d+)_/.exec(name);
  if (!match) throw new Error(`Migration file name must start with a numeric version: ${name}`);
  return Number(match[1]);
}

async function ensureTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL DEFAULT 0
    );
  `);
}

export async function runMigrations(
  pool: pg.Pool,
  options: { directory?: string; log?: (message: string) => void } = {}
): Promise<MigrationResult> {
  const directory = options.directory ?? MIGRATIONS_DIR;
  const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied: MigrationResult['applied'] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureTable(client);
    const existing = await client.query<MigrationRow>('SELECT * FROM schema_migrations ORDER BY version');
    const byVersion = new Map(existing.rows.map((row) => [row.version, row]));

    for (const file of files) {
      const version = migrationVersion(file);
      const sql = await readFile(join(directory, file), 'utf8');
      const sum = checksum(sql);
      const prior = byVersion.get(version);
      if (prior) {
        if (prior.checksum !== sum) {
          throw new Error(
            `Migration ${file} changed after it was applied (recorded ${prior.checksum}, now ${sum}). Add a new migration instead.`
          );
        }
        continue;
      }
      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        const duration = Date.now() - started;
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)',
          [version, file, sum, duration]
        );
        await client.query('COMMIT');
        applied.push({ version, name: file, durationMs: duration });
        log(`applied ${file} (${duration} ms)`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    const current = await client.query<{ version: number | null }>(
      'SELECT max(version) AS version FROM schema_migrations'
    );
    return { applied, current: current.rows[0]?.version ?? 0 };
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

export async function schemaVersion(pool: pg.Pool | pg.PoolClient): Promise<number> {
  try {
    const result = await pool.query<{ version: number | null }>(
      'SELECT max(version) AS version FROM schema_migrations'
    );
    return Number(result.rows[0]?.version ?? 0);
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return 0;
    throw error;
  }
}

async function main(): Promise<void> {
  const { createPool, toDatabaseConfig } = await import('./pool');
  const pool = createPool(toDatabaseConfig(process.env));
  try {
    const result = await runMigrations(pool);
    process.stdout.write(
      `schema version ${result.current}; ${result.applied.length} migration(s) applied\n`
    );
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] ? process.argv[1].endsWith('migrate.ts') : false;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
