/**
 * Vitest global setup: one real PostgreSQL instance for the whole run, one migrated database.
 * The URL is exported as TEST_DATABASE_URL; a suite without it skips the database tests.
 */
import type { TestProject } from 'vitest/node';
import { startEmbeddedPostgres, type TestServer } from './packages/db/test/support/server';
import { runMigrations } from './packages/db/src/migrate';

let server: TestServer | null = null;

export async function setup(project: TestProject): Promise<void> {
  if (process.env.TEST_DATABASE_URL) {
    project.provide('dbUrl', process.env.TEST_DATABASE_URL);
    return;
  }
  try {
    server = await startEmbeddedPostgres('eh_test');
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: server.url, max: 2 });
    try {
      await runMigrations(pool);
    } finally {
      await pool.end();
    }
    project.provide('dbUrl', server.url);
    project.provide('pgBinDir', server.binDir);
  } catch (error) {
    process.stderr.write(`PostgreSQL integration tests will be skipped: ${(error as Error).message}\n`);
    project.provide('dbUrl', '');
    project.provide('pgBinDir', '');
  }
}

export async function teardown(): Promise<void> {
  if (server) await server.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
    pgBinDir: string;
  }
}
