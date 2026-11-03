#!/usr/bin/env node
/**
 * Operator CLI.
 *
 *   tsx src/cli.ts backup-now        create and verify one backup (upload when configured)
 *   tsx src/cli.ts backup-status     report the last local backup, the last Drive upload and failures
 *   tsx src/cli.ts verify-restore    prove a logical archive restores into a scratch database
 *   tsx src/cli.ts verify-restore <path/to/downloaded.dump.enc>
 *                                    restore a downloaded encrypted backup into a scratch database
 *   tsx src/cli.ts run-once          drain the outbox once and exit (cron-friendly)
 *   tsx src/cli.ts authorize-delivery-retry <notificationId> <actorEmail>
 *                                    the only way an uncertain delivery becomes sendable again
 *
 * Nothing here activates automation, sends mail or deploys anything.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { persistentBackup } from './persistent-backup';
import pg from 'pg';
import {
  authorizeDeliveryRetry,
  backupStatus,
  claimNext,
  completeJob,
  createPool,
  Database,
  failJob,
  runMigrations,
  toDatabaseConfig
} from '@eh/db';
import { createLogicalBackup, parseEncryptionKey, restoreLogicalBackup, restoreContainer } from './backup';
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
 const drive=new GoogleDriveTransport({credentialsJson:config.GOOGLE_SERVICE_ACCOUNT_JSON,delegatedUser:config.GOOGLE_DRIVE_DELEGATED_USER});
 process.stdout.write(JSON.stringify(await persistentBackup(db,config,drive,'manual:'+randomUUID()))+'\n');
}

/** Local and Drive health are reported separately: a Drive outage keeps the local backup usable. */
async function backupStatusCommand(config: ReturnType<typeof loadWorkerConfig>, db: Database): Promise<void> {
  const status = await backupStatus(db);
  process.stdout.write(
    JSON.stringify({ ...status, driveUploadConfigured: !!config.DRIVE_BACKUP_FOLDER_ID }, null, 2) + '\n'
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
    if(!process.argv[3])await runMigrations(pool);
    const file=process.argv[3];
    if(file){
      await restoreContainer({container:await readFile(file),key:parseEncryptionKey(config.BACKUP_ENCRYPTION_KEY??''),pgRestorePath:config.PG_RESTORE_PATH,targetDatabase:scratch,productionDatabase:base.database,connection:{host:base.host,port:base.port,user:base.user,password:typeof base.password==='string'?base.password:undefined}});
      const counts=await scratchDb.one('SELECT (SELECT count(*) FROM members)::int AS members,(SELECT count(*) FROM tasks)::int AS tasks,(SELECT count(*) FROM local_accounts)::int AS accounts');
      process.stdout.write(JSON.stringify({result:'PASS',source:file,scratchDatabase:scratch,counts})+'\n');return;
    }
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
    drive: new GoogleDriveTransport({ credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON, delegatedUser: config.GOOGLE_DRIVE_DELEGATED_USER }),
    sheets: { configured: sheets.configured, append: sheets.append.bind(sheets) },
    log: (message: string, meta: Record<string, unknown> = {}) =>
      process.stdout.write(`${JSON.stringify({ message, ...meta })}\n`)
  };
  for (;;) {
    const job = await claimNext(db, config.WORKER_ID, config.LEASE_SECONDS);
    if (!job) break;
    const outcome = await handleJob(context, job);
    if (outcome.state === 'DONE') {
      const owned = await completeJob(db, job.job_id, job.lease_token);
      if (!owned) process.stdout.write(`${job.kind} -> LEASE_LOST\n`);
    } else if (outcome.state === 'RETRY')
      await failJob(db, job.job_id, job.lease_token, outcome.error ?? 'RETRY', {
        retryAt: new Date(Date.now() + retryDelaySeconds(job.attempts) * 1000)
      });
    else await failJob(db, job.job_id, job.lease_token, outcome.error ?? 'FAILED', { retryAt: null });
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
    else if (command === 'backup-status') await backupStatusCommand(config, db);
    else if (command === 'verify-restore') await verifyRestore(config, db);
    else if (command === 'run-once') await runOnce(config, db);
    else if (command === 'authorize-delivery-retry') {
      const notificationId = process.argv[3] ?? '';
      const actor = process.argv[4] ?? '';
      if (!notificationId || !actor) {
        throw new Error('Usage: authorize-delivery-retry <notificationId> <actorEmail>');
      }
      const authorized = await authorizeDeliveryRetry(db, notificationId, actor);
      process.stdout.write(`${authorized ? 'AUTHORIZED' : 'NOT_UNCERTAIN'} ${notificationId}\n`);
      if (!authorized) process.exitCode = 1;
    } else throw new Error(`Unknown command: ${command || '(none)'}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
