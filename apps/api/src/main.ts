/** API process entry point. */
import { join } from 'node:path';
import { createPool, Database } from '@eh/db';
import { loadConfig } from './config';
import { buildApp } from './app';
import { createInboxSource } from './inbox';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool({
    ...config.database,
    applicationName: 'engineering-hub-api'
  });
  const db = new Database(pool);
  const app = await buildApp({
    config,
    db,
    inbox: createInboxSource(process.env),
    webRoot: process.env.WEB_ROOT ?? join(process.cwd(), 'apps', 'web', 'dist')
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.close();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { environment: config.appEnv, database: config.database.host ?? 'DATABASE_URL' },
    'engineering-hub api ready'
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
