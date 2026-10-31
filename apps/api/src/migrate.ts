/**
 * Migration entry point for the container image.
 *
 * Lives next to the API so a deployment can apply the reviewed SQL without a source checkout:
 * the Docker image copies `packages/db/src/migrations` and points `EH_MIGRATIONS_DIR` at it.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, runMigrations, schemaVersion, toDatabaseConfig } from '@eh/db';

/**
 * The reviewed SQL is not bundled. A deployment image sets EH_MIGRATIONS_DIR; a source
 * checkout keeps the reviewed files under `packages/db/src/migrations`; a bundle that sits next
 * to a copied `migrations` directory uses that. A missing directory is a clear failure.
 */
function migrationsDirectory(): string {
  const candidates = [
    process.env.EH_MIGRATIONS_DIR,
    join(process.cwd(), 'packages', 'db', 'src', 'migrations'),
    join(dirname(fileURLToPath(import.meta.url)), 'migrations')
  ].filter((value): value is string => !!value);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Migration files were not found. Set EH_MIGRATIONS_DIR. Looked in: ${candidates.join(', ')}`
    );
  }
  return found;
}

async function main(): Promise<void> {
  const pool = createPool({ ...toDatabaseConfig(process.env), applicationName: 'engineering-hub-migrate' });
  try {
    const result = await runMigrations(pool, { directory: migrationsDirectory() });
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
