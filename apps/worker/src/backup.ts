/**
 * Backup and restore helpers.
 *
 * `pg_dump` streams a custom-format archive, which is hashed and encrypted with AES-256-GCM
 * before it leaves the server. The encryption key is supplied by the operator; a backup without
 * a recoverable key is not a backup, so the manifest records the key identifier, never the key.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Database } from '@eh/db';

const MAGIC = Buffer.from('EHBAK1');

export type BackupArtifact = {
  fileName: string;
  plainBytes: number;
  encrypted: Buffer;
  plainChecksum: string;
  encryptedChecksum: string;
  keyId: string;
  createdAt: string;
};

export function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export function parseEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  }
  return key;
}

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(container: Buffer, key: Buffer): Buffer {
  if (!container.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not an Engineering-HUB backup container');
  }
  const iv = container.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = container.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ciphertext = container.subarray(MAGIC.length + 28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr.slice(0, 800)}`));
    });
  });
}

export type DumpOptions = {
  pgDumpPath: string;
  connection: {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };
};

/**
 * Creates one custom-format dump in a private temporary directory and returns its bytes.
 * The directory is removed in every path, including failure.
 */
export async function createDump(options: DumpOptions): Promise<{ content: Buffer; bytes: number }> {
  const directory = await mkdtemp(join(tmpdir(), 'eh-backup-'));
  const file = join(directory, 'engineering_hub.dump');
  try {
    const args = ['--format=custom', '--no-owner', '--no-privileges', '--file', file];
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options.connection.connectionString) {
      args.push('--dbname', options.connection.connectionString);
    } else {
      if (options.connection.host) args.push('--host', options.connection.host);
      if (options.connection.port) args.push('--port', String(options.connection.port));
      if (options.connection.user) args.push('--username', options.connection.user);
      if (options.connection.database) args.push('--dbname', options.connection.database);
      if (options.connection.password) env.PGPASSWORD = options.connection.password;
    }
    await run(options.pgDumpPath, args, env);
    const content = await readFile(file);
    return { content, bytes: content.byteLength };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function createBackupArtifact(options: DumpOptions & { encryptionKey: Buffer }): Promise<BackupArtifact> {
  const dump = await createDump(options);
  const encrypted = encrypt(dump.content, options.encryptionKey);
  const createdAt = new Date();
  const stamp = createdAt.toISOString().replace(/[:.]/g, '-');
  return {
    fileName: `engineering-hub-${stamp}.dump.enc`,
    plainBytes: dump.bytes,
    encrypted,
    plainChecksum: createHash('sha256').update(dump.content).digest('hex'),
    encryptedChecksum: createHash('sha256').update(encrypted).digest('hex'),
    keyId: keyId(options.encryptionKey),
    createdAt: createdAt.toISOString()
  };
}

/**
 * Restores a container into a separate database. Used by the scheduled restore verification and
 * by the operator runbook; it refuses to write into the configured production database name.
 */
export async function restoreContainer(input: {
  container: Buffer;
  key: Buffer;
  pgRestorePath: string;
  targetDatabase: string;
  connection: { host?: string; port?: number; user?: string; password?: string };
  productionDatabase?: string;
}): Promise<void> {
  if (input.productionDatabase && input.targetDatabase === input.productionDatabase) {
    throw new Error('Restore refused: the target is the production database');
  }
  const plain = decrypt(input.container, input.key);
  const directory = await mkdtemp(join(tmpdir(), 'eh-restore-'));
  const file = join(directory, 'restore.dump');
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(file);
      stream.on('error', reject);
      stream.on('finish', () => resolve());
      stream.end(plain);
    });
    await stat(file);
    const args = ['--no-owner', '--no-privileges', '--dbname', input.targetDatabase, file];
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (input.connection.password) env.PGPASSWORD = input.connection.password;
    if (input.connection.host) args.push('--host', input.connection.host);
    if (input.connection.port) args.push('--port', String(input.connection.port));
    if (input.connection.user) args.push('--username', input.connection.user);
    await run(input.pgRestorePath, args, env);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Tables in dependency order. The logical backup is a portable, client-tool-free archive:
 * `jsonb_agg(to_jsonb(t))` preserves PostgreSQL types (DATE stays DATE, numeric stays numeric)
 * and `jsonb_populate_recordset` restores them without any column mapping in JavaScript.
 */
export const BACKUP_TABLES = [
  'members',
  'responsibilities',
  'skills',
  'holidays',
  'projects',
  'subprojects',
  'tasks',
  'task_dependencies',
  'task_assignees',
  'responsibility_members',
  'milestones',
  'member_skills',
  'issues',
  'phase_templates',
  'project_phases',
  'schedule_confirmations',
  'task_requests',
  'task_deadline_history',
  'notification_ledger',
  'audit_log',
  'app_settings',
  'backup_log',
  'record_deletions',
  'outbox_jobs',
  'idempotency_keys',
  'published_snapshots',
  'published_meta',
  'import_runs',
  'calendar_links'
] as const;

export type LogicalBackup = {
  format: 'eh-logical-v1';
  createdAt: string;
  tables: Record<string, unknown[]>;
  rowCounts: Record<string, number>;
};

export async function createLogicalBackup(db: Database): Promise<{ archive: Buffer; backup: LogicalBackup }> {
  const tables: Record<string, unknown[]> = {};
  const rowCounts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const row = await db.one<{ rows: unknown[] }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM ${table} t`
    );
    const rows = row?.rows ?? [];
    tables[table] = rows;
    rowCounts[table] = rows.length;
  }
  const backup: LogicalBackup = {
    format: 'eh-logical-v1',
    createdAt: new Date().toISOString(),
    tables,
    rowCounts
  };
  return { archive: gzipSync(Buffer.from(JSON.stringify(backup), 'utf8')), backup };
}

/**
 * Verification helper. It refuses a populated target unless the caller explicitly asks for a
 * destructive verification reset, so it can never be pointed at production by accident.
 */
export async function restoreLogicalBackup(
  db: Database,
  archive: Buffer,
  options: { truncateExisting?: boolean } = {}
): Promise<{ rowCounts: Record<string, number> }> {
  const parsed = JSON.parse(gunzipSync(archive).toString('utf8')) as LogicalBackup;
  if (parsed.format !== 'eh-logical-v1') throw new Error('Unsupported logical backup format');
  const existing = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM members');
  if (Number(existing?.count ?? 0) > 0 && options.truncateExisting !== true) {
    throw new Error('Restore refused: the target database is not empty');
  }
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    if (options.truncateExisting === true) {
      await tx.query(
        `TRUNCATE TABLE ${[...BACKUP_TABLES].reverse().join(', ')} RESTART IDENTITY CASCADE`
      );
    }
    for (const table of BACKUP_TABLES) {
      const rows = parsed.tables[table] ?? [];
      if (!rows.length) {
        counts[table] = 0;
        continue;
      }
      await tx.query(
        `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb)`,
        [JSON.stringify(rows)]
      );
      counts[table] = rows.length;
    }
  });
  return { rowCounts: counts };
}
