/**
 * Migration entry point for the container image.
 *
 * Lives next to the API so a deployment can apply the reviewed SQL without a source checkout:
 * the Docker image copies `packages/db/src/migrations` and points `EH_MIGRATIONS_DIR` at it.
 */
import { createPool, runMigrations, schemaVersion, toDatabaseConfig } from '@eh/db';

async function main(): Promise<void> {
  const pool = createPool({ ...toDatabaseConfig(process.env), applicationName: 'engineering-hub-migrate' });
  try {
    const result = await runMigrations(pool);
    process.stdout.write(
      `schema version ${result.current}; ${result.applied.length} migration(s) applied\n`
    );
    const verified = await schemaVersion(pool);
    if (verified !== result.current) {
      throw new Error(`Schema version ${verified} does not match the applied version ${result.current}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
