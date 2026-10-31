#!/usr/bin/env node
/**
 * Operator CLI.
 *
 *   tsx src/cli.ts backup-now        create and verify one backup (upload when configured)
 *   tsx src/cli.ts verify-restore    prove a logical archive restores into a scratch database
 *   tsx src/cli.ts run-once          drain the outbox once and exit (cron-friendly)
 *
 * Nothing here activates automation, sends mail or deploys anything.
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { createPool, Database, claimNext, completeJob, failJob, runMigrations, toDatabaseConfig } from '@eh/db';
import { createBackupArtifact, createLogicalBackup, encrypt, parseEncryptionKey, restoreLogicalBackup } from './backup';
import { loadWorkerConfig } from './config';
import { handleJob } from './jobs';
import {
  GmailApiTransport,
  GoogleCalendarTransport,
  GoogleDriveTransport,
  GoogleSheetsExportTransport
} from './transports';
import { retryDelaySeconds } from '@eh/domain';

function connectionFromUrl(url: string): pg.ClientConfig {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, '')
  };
}

async function backupNow(config: ReturnType<typeof loadWorkerConfig>, db: Database): Promise<void> {
  const { archive, backup } = await createLogicalBackup(db);
  const key = config.BACKUP_ENCRYPTION_KEY ? parseEncryptionKey(config.BACKUP_ENCRYPTION_KEY) : null;
  const payload = key ? encrypt(archive, key) : archive;
  const artifact = key
    ? await createBackupArtifact({
        pgDumpPath: config.PG_DUMP_PATH,
        encryptionKey: key,
        connection: config.database
      }).catch(() => null)
    : null;
  const drive = new GoogleDriveTransport({ credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON });
  const backupId = `BAK-CLI-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let reference = '';
  if (drive.configured && config.DRIVE_BACKUP_FOLDER_ID && key) {
    const uploaded = await drive.upload({
      name: `${backupId}.logical.gz.enc`,
      content: payload,
      mimeType: 'application/octet-stream',
      folderId: config.DRIVE_BACKUP_FOLDER_ID,
      appProperties: { format: 'eh-logical-v1', rows: String(backup.rowCounts.tasks ?? 0) }
    });
    reference = uploaded.fileId;
  }
  await db.query(
    `INSERT INTO backup_log (backup_id, schema_version, backup_reference, result, checksum, size_bytes, manifest)
     VALUES ($1, 1, $2, 'OK', $3, $4, $5)`,
    [
      backupId,
      reference,
      createHash('sha256').update(payload).digest('hex'),
      payload.byteLength,
      JSON.stringify({
        method: artifact ? 'pg_dump+logical' : 'logical',
        uploaded: !!reference,
        encrypted: !!key,
        rowCounts: backup.rowCounts,
        format: backup.format
      })
    ]
  );
  process.stdout.write(
    `backup ${backupId}: ${Object.values(backup.rowCounts).reduce((sum, value) => sum + value, 0)} rows, ` +
      `${payload.byteLength} bytes, uploaded=${!!reference}, encrypted=${!!key}\n`
  );
}

async function verifyRestore(config: ReturnType<typeof loadWorkerConfig>, db: Database): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const base = connectionFromUrl(url);
  const scratch = `eh_verify_${Date.now()}`;
  const admin = new pg.Client({ ...base, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${scratch}`);
  } finally {
    await admin.end();
  }
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratch}`;
  const pool = createPool({ connectionString: scratchUrl.toString(), max: 2 });
  const scratchDb = new Database(pool);
  try {
    await runMigrations(pool);
    const { archive, backup } = await createLogicalBackup(db);
    const restored = await restoreLogicalBackup(scratchDb, archive);
    const mismatched = Object.entries(backup.rowCounts)
      .filter(([table, count]) => (restored.rowCounts[table] ?? 0) !== count)
      .map(([table, count]) => `${table}: source ${count}, restored ${restored.rowCounts[table] ?? 0}`);
    const verification = await scratchDb.one<{ members: string; tasks: string }>(
      `SELECT (SELECT count(*) FROM members)::text AS members, (SELECT count(*) FROM tasks)::text AS tasks`
    );
    process.stdout.write(
      JSON.stringify(
        {
          scratchDatabase: scratch,
          members: verification?.members,
          tasks: verification?.tasks,
          mismatched: mismatched.length ? mismatched : 'none',
          result: mismatched.length ? 'FAIL' : 'PASS'
        },
        null,
        2
      ) + '\n'
    );
    if (mismatched.length) process.exitCode = 1;
  } finally {
    await scratchDb.close();
    const cleanup = new pg.Client({ ...base, database: 'postgres' });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  }
}

async function runOnce(config: ReturnType<typeof loadWorkerConfig>, db: Database): Promise<void> {
  const sheets = new GoogleSheetsExportTransport({
    credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON,
    spreadsheetId: config.EXPORT_SPREADSHEET_ID
  });
  const context = {
    db,
    config,
    mail: new GmailApiTransport({ credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON, sender: config.GMAIL_SENDER }),
    calendar: new GoogleCalendarTransport({
      credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON,
      calendarId: config.CALENDAR_ID
    }),
    drive: new GoogleDriveTransport({ credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON }),
    sheets: { configured: sheets.configured, append: sheets.append.bind(sheets) },
    log: (message: string, meta: Record<string, unknown> = {}) =>
      process.stdout.write(`${JSON.stringify({ message, ...meta })}\n`)
  };
  for (;;) {
    const job = await claimNext(db, config.WORKER_ID, config.LEASE_SECONDS);
    if (!job) break;
    const outcome = await handleJob(context, job);
    if (outcome.state === 'DONE') await completeJob(db, job.job_id);
    else if (outcome.state === 'RETRY')
      await failJob(db, job.job_id, outcome.error ?? 'RETRY', {
        retryAt: new Date(Date.now() + retryDelaySeconds(job.attempts) * 1000)
      });
    else await failJob(db, job.job_id, outcome.error ?? 'FAILED', { retryAt: null });
    process.stdout.write(`${job.kind} -> ${outcome.state}\n`);
  }
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const pool = createPool({ ...toDatabaseConfig(process.env), max: 3 });
  const db = new Database(pool);
  try {
    const command = process.argv[2] ?? '';
    if (command === 'backup-now') await backupNow(config, db);
    else if (command === 'verify-restore') await verifyRestore(config, db);
    else if (command === 'run-once') await runOnce(config, db);
    else throw new Error(`Unknown command: ${command || '(none)'}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
