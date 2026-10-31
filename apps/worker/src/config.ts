/** Worker configuration. External integrations stay disabled unless explicitly configured. */
import { z } from 'zod';
import { APP_VERSION } from '@eh/contracts';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['DEVELOPMENT', 'STAGING', 'PRODUCTION']).default('DEVELOPMENT'),
  APP_VERSION: z.string().default(APP_VERSION),
  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().optional(),
  PGPORT: z.coerce.number().int().optional(),
  PGUSER: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().optional(),
  PGSSL: z.enum(['true', 'false']).default('false'),
  WORKER_ID: z.string().default('worker-1'),
  POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(180),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GMAIL_SENDER: z.string().optional(),
  CALENDAR_ID: z.string().optional(),
  DRIVE_BACKUP_FOLDER_ID: z.string().optional(),
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  PG_DUMP_PATH: z.string().default('pg_dump'),
  PG_RESTORE_PATH: z.string().default('pg_restore'),
  EXPORT_SPREADSHEET_ID: z.string().optional(),
  EXPORT_SHEET_NAME: z.string().default('SNAPSHOT'),
  SCHEDULE_ENABLED: z.enum(['true', 'false']).default('true')
});

export type WorkerConfig = z.infer<typeof Schema> & {
  database: {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl: boolean;
  };
};

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid worker configuration: ${detail}`);
  }
  const value = parsed.data;
  return {
    ...value,
    database: {
      connectionString: value.DATABASE_URL,
      host: value.PGHOST,
      port: value.PGPORT,
      user: value.PGUSER,
      password: value.PGPASSWORD,
      database: value.PGDATABASE,
      ssl: value.PGSSL === 'true'
    }
  };
}
