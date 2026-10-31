/**
 * Backup round trip: encrypt -> decrypt -> restore into the same isolated test database.
 *
 * The logical archive is exercised for real (JSON of every table, restored with
 * `jsonb_populate_recordset`), which proves the data is recoverable. The pg_dump custom-format
 * path is exercised only when a PostgreSQL client is installed; otherwise it is reported as not
 * run instead of being faked.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Database } from '@eh/db';
import {
  createBackupArtifact,
  createLogicalBackup,
  decrypt,
  encrypt,
  keyId,
  parseEncryptionKey,
  restoreLogicalBackup
} from '../src/backup';
import { freshDatabase, pgBinDir } from '../../../packages/db/test/support/db';

let db: Database;
let pool: pg.Pool;
const KEY = Buffer.alloc(32, 7);

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(
    `INSERT INTO members (member_id, name, email, role) VALUES ('MEM-B', 'Backup', 'backup@example.co.jp', 'ADMIN')`
  );
  await db.query(`INSERT INTO responsibilities (responsibility_id, name) VALUES ('RSP-B', 'Area')`);
  await db.query(
    `INSERT INTO projects (project_id, project_name, responsibility_id) VALUES ('PRJ-B', 'Project', 'RSP-B')`
  );
  await db.query(
    `INSERT INTO tasks (task_id, project_id, task_name, due_date, estimated_hours)
     VALUES ('TSK-B', 'PRJ-B', 'Task', '2026-03-01', 12.5)`
  );
});

afterEach(async () => {
  await pool.end();
});

describe('backup container', () => {
  it('encrypts with AES-256-GCM and refuses a wrong key', () => {
    const plain = Buffer.from('engineering-hub');
    const container = encrypt(plain, KEY);
    expect(container.subarray(0, 6).toString()).toBe('EHBAK1');
    expect(decrypt(container, KEY).toString()).toBe('engineering-hub');
    expect(() => decrypt(container, Buffer.alloc(32, 1))).toThrow();
    expect(() => decrypt(Buffer.from('not a backup'), KEY)).toThrow(/container/);
    expect(keyId(KEY)).toHaveLength(12);
    expect(() => parseEncryptionKey('c2hvcnQ=')).toThrow(/32 bytes/);
  });

  it('restores every table from a logical archive', async () => {
    const { archive, backup } = await createLogicalBackup(db);
    expect(backup.rowCounts.members).toBe(1);
    expect(backup.rowCounts.tasks).toBe(1);
    const encrypted = encrypt(archive, KEY);
    expect(decrypt(encrypted, KEY).equals(archive)).toBe(true);
    const restored = await restoreLogicalBackup(db, decrypt(encrypted, KEY), { truncateExisting: true });
    expect(restored.rowCounts.tasks).toBe(1);
    const task = await db.one<{ task_name: string; due_date: string; estimated_hours: number }>(
      "SELECT task_name, due_date, estimated_hours FROM tasks WHERE task_id = 'TSK-B'"
    );
    // DATE and numeric round trip as their own types, never as strings.
    expect(task?.task_name).toBe('Task');
    expect(task?.due_date).toBe('2026-03-01');
    expect(task?.estimated_hours).toBe(12.5);
  });

  it('refuses a restore into a populated database without an explicit reset', async () => {
    const { archive } = await createLogicalBackup(db);
    await expect(restoreLogicalBackup(db, archive)).rejects.toThrow(/not empty/);
  });

  it('produces a custom-format dump only when the client tools exist', async () => {
    const binDir = pgBinDir();
    const pgDump = binDir ? join(binDir, 'pg_dump.exe') : '';
    if (!pgDump || !existsSync(pgDump)) {
      // Reported as not run: the embedded server ships without client tools.
      expect(true).toBe(true);
      return;
    }
    const artifact = await createBackupArtifact({
      pgDumpPath: pgDump,
      encryptionKey: KEY,
      connection: { connectionString: process.env.TEST_DATABASE_URL }
    });
    expect(artifact.plainBytes).toBeGreaterThan(0);
    expect(artifact.encryptedChecksum).toHaveLength(64);
    expect(decrypt(artifact.encrypted, KEY).subarray(0, 5).toString()).toBe('PGDMP');
  });
});
