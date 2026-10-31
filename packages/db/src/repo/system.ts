/** System repositories: settings, outbox, sessions, idempotency, publication and health. */
import type { Queryable } from '../pool';
import { newToken } from '../ids';

type Db = Queryable;

/* ------------------------------- settings -------------------------------- */

export async function getSettingRows(db: Db) {
  return db.many<{
    setting_id: string;
    value: string;
    description: string;
    updated_at: string;
    updated_by: string;
    revision: number;
  }>('SELECT setting_id, value, description, updated_at, updated_by, revision FROM app_settings ORDER BY setting_id');
}

export async function getSettings(db: Db): Promise<Record<string, string>> {
  const rows = await getSettingRows(db);
  const result: Record<string, string> = {};
  for (const row of rows) result[row.setting_id] = row.value;
  return result;
}

export async function saveSettings(
  db: Db,
  changes: Record<string, string>,
  actor: string
): Promise<{ previous: Record<string, string>; next: Record<string, string> }> {
  const previous: Record<string, string> = {};
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(changes)) {
    const row = await db.one<{ value: string }>('SELECT value FROM app_settings WHERE setting_id = $1', [key]);
    if (!row) {
      const known = KNOWN_SETTINGS[key];
      if (!known) throw new Error(`Unknown automation setting: ${key}`);
      await db.query(
        `INSERT INTO app_settings (setting_id, value, description, updated_by) VALUES ($1,$2,$3,$4)`,
        [key, value, known.description, actor]
      );
      previous[key] = known.defaultValue;
      next[key] = value;
      continue;
    }
    await db.query(
      `UPDATE app_settings SET value = $2, updated_by = $3, updated_at = now(), revision = revision + 1
        WHERE setting_id = $1`,
      [key, value, actor]
    );
    previous[key] = row.value;
    next[key] = value;
  }
  return { previous, next };
}

export const KNOWN_SETTINGS: Record<string, { defaultValue: string; description: string; adminOnly: boolean }> = {
  EMAIL_MODE: { defaultValue: 'OFF', description: 'OFF, PREVIEW or LIVE outbound mail mode', adminOnly: true },
  EMERGENCY_STOP: { defaultValue: 'true', description: 'Stops every outbound notification', adminOnly: true },
  ASSIGNMENT_EMAIL_ENABLED: { defaultValue: 'false', description: 'Notify on an approved assignment', adminOnly: false },
  REASSIGNMENT_EMAIL_ENABLED: { defaultValue: 'false', description: 'Notify on a reassignment', adminOnly: false },
  DEADLINE_CHANGE_EMAIL_ENABLED: { defaultValue: 'false', description: 'Notify on an approved deadline change', adminOnly: false },
  DEADLINE_REMINDER_ENABLED: { defaultValue: 'false', description: 'Send deadline reminders', adminOnly: false },
  OVERDUE_REMINDER_ENABLED: { defaultValue: 'false', description: 'Send overdue reminders', adminOnly: false },
  WEEKLY_MANAGER_REPORT_ENABLED: { defaultValue: 'false', description: 'Send the weekly manager report', adminOnly: false },
  REMINDER_OFFSETS: { defaultValue: '7,2', description: 'Days before a deadline to remind', adminOnly: false },
  REMINDER_CATCHUP_DAYS: { defaultValue: '3', description: 'Catch-up window for a missed reminder', adminOnly: false },
  OVERDUE_FREQUENCY_DAYS: { defaultValue: '7', description: 'Minimum days between overdue reminders', adminOnly: false },
  WEEKDAY_ONLY_SENDING: { defaultValue: 'true', description: 'Send only on weekdays', adminOnly: false },
  EXECUTION_WINDOW_START: { defaultValue: '08:00', description: 'Earliest send time (Asia/Tokyo)', adminOnly: false },
  EXECUTION_WINDOW_END: { defaultValue: '20:00', description: 'Latest send time (Asia/Tokyo)', adminOnly: false },
  MANAGEMENT_REPORT_RECIPIENTS: { defaultValue: '', description: 'Report recipients inside the allowed domains', adminOnly: false },
  WEEKLY_REPORT_DAY: { defaultValue: 'MONDAY', description: 'Weekly report day', adminOnly: false },
  WEEKLY_REPORT_TIME: { defaultValue: '08:30', description: 'Weekly report time', adminOnly: false },
  CALENDAR_SYNC_ENABLED: { defaultValue: 'false', description: 'Milestone calendar synchronisation', adminOnly: false },
  DAILY_BACKUP_ENABLED: { defaultValue: 'false', description: 'Scheduled database backup', adminOnly: true },
  AUTO_DASHBOARD_REFRESH_ENABLED: { defaultValue: 'false', description: 'Automatic dashboard refresh', adminOnly: false },
  AUTO_WORKLOAD_REFRESH_ENABLED: { defaultValue: 'false', description: 'Automatic workload refresh', adminOnly: false },
  PROJECT_STALE_ALERT_ENABLED: { defaultValue: 'true', description: 'Alert on a stale project', adminOnly: false },
  PROJECT_STALE_DAYS: { defaultValue: '7', description: 'Days before a project is stale', adminOnly: false },
  HEALTH_MILESTONE_APPROACH_DAYS: { defaultValue: '14', description: 'Milestone approach window', adminOnly: false },
  HEALTH_DELAY_TOLERANCE_DAYS: { defaultValue: '0', description: 'Delay tolerance in days', adminOnly: false },
  SHARED_DASHBOARD_PUBLISH_ENABLED: { defaultValue: 'false', description: 'Publish the shared dashboard snapshot', adminOnly: true },
  SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES: { defaultValue: '30', description: 'Scheduled publication interval', adminOnly: false },
  DEADLINE_REQUEST_EMAIL_ENABLED: { defaultValue: 'false', description: 'Notify on a deadline change request', adminOnly: false },
  COMPLETION_REPORT_EMAIL_ENABLED: { defaultValue: 'false', description: 'Notify on a completion report', adminOnly: false },
  PENDING_REQUEST_REMINDER_ENABLED: { defaultValue: 'false', description: 'Remind about pending requests', adminOnly: false },
  ALLOWED_RECIPIENT_DOMAINS: { defaultValue: '', description: 'Comma-separated recipient domains', adminOnly: true },
  MAX_EMAILS_PER_RUN: { defaultValue: '50', description: 'Hard cap of messages per worker run', adminOnly: true },
  REQUEST_SUBMISSION_ENABLED: { defaultValue: 'false', description: 'Accept employee requests', adminOnly: true }
};

/* -------------------------------- outbox --------------------------------- */

export type OutboxJob = {
  job_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  correlation_id: string;
};

export async function enqueue(
  db: Db,
  input: {
    kind: string;
    payload: Record<string, unknown>;
    dedupeKey?: string | null;
    correlationId?: string;
    availableAt?: Date;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO outbox_jobs (kind, payload, dedupe_key, correlation_id, available_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      input.kind,
      JSON.stringify(input.payload),
      input.dedupeKey ?? null,
      input.correlationId ?? '',
      input.availableAt ?? new Date()
    ]
  );
}

/**
 * Claims one job with a lease. `FOR UPDATE SKIP LOCKED` lets several workers run without
 * serializing every write behind one lock, and a crashed worker's lease is reclaimed by
 * `reapExpiredLeases`.
 */
export async function claimNext(db: Db, workerId: string, leaseSeconds = 120): Promise<OutboxJob | null> {
  const row = await db.one<{
    job_id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
    correlation_id: string;
  }>(
    `UPDATE outbox_jobs
        SET status = 'LEASED', lease_owner = $1, lease_expires_at = now() + ($2 || ' seconds')::interval,
            attempts = attempts + 1
      WHERE job_id = (
        SELECT job_id FROM outbox_jobs
         WHERE status = 'PENDING' AND available_at <= now()
         ORDER BY available_at, job_id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING job_id::text, kind, payload, attempts, max_attempts, correlation_id`,
    [workerId, String(leaseSeconds)]
  );
  return row ?? null;
}

export async function completeJob(db: Db, jobId: string): Promise<void> {
  await db.query(
    `UPDATE outbox_jobs SET status = 'DONE', completed_at = now(), lease_owner = '', lease_expires_at = NULL
      WHERE job_id = $1`,
    [jobId]
  );
}

export async function failJob(
  db: Db,
  jobId: string,
  error: string,
  options: { retryAt?: Date | null } = {}
): Promise<'PENDING' | 'FAILED'> {
  const row = await db.one<{ attempts: number; max_attempts: number }>(
    'SELECT attempts, max_attempts FROM outbox_jobs WHERE job_id = $1',
    [jobId]
  );
  if (!row) return 'FAILED';
  const exhausted = row.attempts >= row.max_attempts || !options.retryAt;
  await db.query(
    `UPDATE outbox_jobs
        SET status = $2, last_error = $3, lease_owner = '', lease_expires_at = NULL,
            available_at = COALESCE($4, available_at),
            completed_at = CASE WHEN $2 = 'FAILED' THEN now() ELSE NULL END
      WHERE job_id = $1`,
    [jobId, exhausted ? 'FAILED' : 'PENDING', error.slice(0, 2000), options.retryAt ?? null]
  );
  return exhausted ? 'FAILED' : 'PENDING';
}

export async function reapExpiredLeases(db: Db): Promise<number> {
  const result = await db.query(
    `UPDATE outbox_jobs
        SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
            lease_owner = '', lease_expires_at = NULL,
            last_error = CASE WHEN attempts >= max_attempts THEN 'LEASE_EXPIRED' ELSE last_error END
      WHERE status = 'LEASED' AND lease_expires_at < now()`
  );
  return result.rowCount ?? 0;
}

export async function outboxStats(db: Db) {
  const row = await db.one<{ pending: string; leased: string; failed: string; oldest: string | null }>(
    `SELECT
       count(*) FILTER (WHERE status = 'PENDING')::text AS pending,
       count(*) FILTER (WHERE status = 'LEASED')::text AS leased,
       count(*) FILTER (WHERE status = 'FAILED')::text AS failed,
       min(created_at) FILTER (WHERE status = 'PENDING')::text AS oldest
     FROM outbox_jobs`
  );
  return {
    pending: Number(row?.pending ?? 0),
    leased: Number(row?.leased ?? 0),
    failed: Number(row?.failed ?? 0),
    oldestPendingAt: row?.oldest ?? null
  };
}

export async function retryJob(db: Db, jobId: string): Promise<void> {
  await db.query(
    `UPDATE outbox_jobs SET status = 'PENDING', attempts = 0, available_at = now(), lease_owner = '',
            lease_expires_at = NULL, completed_at = NULL
      WHERE job_id = $1 AND status = 'FAILED'`,
    [jobId]
  );
}

/* -------------------------------- sessions ------------------------------- */

export async function createSession(
  db: Db,
  input: { tokenHash: string; memberId: string; csrfToken: string; expiresAt: Date; userAgentHash: string }
): Promise<void> {
  await db.query(
    `INSERT INTO sessions (token_hash, member_id, csrf_token, expires_at, user_agent_hash)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.tokenHash, input.memberId, input.csrfToken, input.expiresAt, input.userAgentHash]
  );
}

export async function findSession(db: Db, tokenHash: string) {
  return db.one<{
    token_hash: string;
    member_id: string;
    csrf_token: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `SELECT token_hash, member_id, csrf_token, expires_at, revoked_at
       FROM sessions WHERE token_hash = $1`,
    [tokenHash]
  );
}

export async function touchSession(db: Db, tokenHash: string): Promise<void> {
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]);
}

export async function revokeSession(db: Db, tokenHash: string): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [tokenHash]);
}

export async function revokeMemberSessions(db: Db, memberId: string): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL', [
    memberId
  ]);
}

export async function purgeExpiredSessions(db: Db): Promise<number> {
  const result = await db.query('DELETE FROM sessions WHERE expires_at < now() - interval \'7 days\'');
  return result.rowCount ?? 0;
}

/* ------------------------------ idempotency ------------------------------ */

export type IdempotencyState =
  | { kind: 'NEW' }
  | { kind: 'REPLAY'; response: unknown }
  | { kind: 'IN_PROGRESS' }
  | { kind: 'MISMATCH' };

export async function beginIdempotency(
  db: Db,
  scope: string,
  key: string,
  requestHash: string
): Promise<IdempotencyState> {
  const inserted = await db.query(
    `INSERT INTO idempotency_keys (scope, key, request_hash)
     VALUES ($1,$2,$3)
     ON CONFLICT (scope, key) DO NOTHING`,
    [scope, key, requestHash]
  );
  if ((inserted.rowCount ?? 0) > 0) return { kind: 'NEW' };
  const row = await db.one<{ request_hash: string; status: string; response: unknown }>(
    'SELECT request_hash, status, response FROM idempotency_keys WHERE scope = $1 AND key = $2',
    [scope, key]
  );
  if (!row) return { kind: 'NEW' };
  if (row.request_hash !== requestHash) return { kind: 'MISMATCH' };
  if (row.status === 'COMPLETED') return { kind: 'REPLAY', response: row.response };
  return { kind: 'IN_PROGRESS' };
}

export async function completeIdempotency(
  db: Db,
  scope: string,
  key: string,
  response: unknown
): Promise<void> {
  await db.query(
    `UPDATE idempotency_keys SET status = 'COMPLETED', response = $3
      WHERE scope = $1 AND key = $2`,
    [scope, key, JSON.stringify(response)]
  );
}

export async function abortIdempotency(db: Db, scope: string, key: string): Promise<void> {
  await db.query('DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND status = \'IN_PROGRESS\'', [
    scope,
    key
  ]);
}

/* ------------------------------ publication ------------------------------ */

export async function getPublicationMeta(db: Db) {
  return db.one<{
    active_slot: 'A' | 'B' | 'NONE';
    contract_version: string;
    publisher_version: string;
    hash: string;
    row_counts: Record<string, number>;
    published_at: string | null;
    last_result: string;
    last_error: string;
  }>(
    'SELECT active_slot, contract_version, publisher_version, hash, row_counts, published_at, last_result, last_error FROM published_meta WHERE id = 1'
  );
}

export async function writeSnapshotSlot(
  db: Db,
  input: {
    slot: 'A' | 'B';
    contractVersion: string;
    publisherVersion: string;
    hash: string;
    rows: unknown[];
    rowCounts: Record<string, number>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO published_snapshots (slot, contract_version, publisher_version, hash, row_counts, rows)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (slot) DO UPDATE SET
       contract_version = EXCLUDED.contract_version,
       publisher_version = EXCLUDED.publisher_version,
       hash = EXCLUDED.hash,
       row_counts = EXCLUDED.row_counts,
       rows = EXCLUDED.rows,
       published_at = now()`,
    [input.slot, input.contractVersion, input.publisherVersion, input.hash, JSON.stringify(input.rowCounts), JSON.stringify(input.rows)]
  );
}

/** The single commit write. Until it succeeds the previous slot stays active. */
export async function commitSnapshot(
  db: Db,
  input: { slot: 'A' | 'B'; contractVersion: string; publisherVersion: string; hash: string; rowCounts: Record<string, number> }
): Promise<void> {
  await db.query(
    `UPDATE published_meta
        SET active_slot = $1, contract_version = $2, publisher_version = $3, hash = $4,
            row_counts = $5, published_at = now(), last_result = 'PUBLISHED', last_error = ''
      WHERE id = 1`,
    [input.slot, input.contractVersion, input.publisherVersion, input.hash, JSON.stringify(input.rowCounts)]
  );
}

export async function recordPublicationFailure(db: Db, error: string): Promise<void> {
  await db.query(
    `UPDATE published_meta SET last_result = 'FAILED', last_error = $1 WHERE id = 1`,
    [error.slice(0, 2000)]
  );
}

export async function readActiveSnapshot(db: Db) {
  const meta = await getPublicationMeta(db);
  if (!meta || meta.active_slot === 'NONE') return { meta, rows: [] as unknown[] };
  const slot = await db.one<{ rows: unknown[]; hash: string; row_counts: Record<string, number> }>(
    'SELECT rows, hash, row_counts FROM published_snapshots WHERE slot = $1',
    [meta.active_slot]
  );
  return { meta, rows: slot?.rows ?? [] };
}

/* -------------------------------- health --------------------------------- */

export async function tableCounts(db: Db): Promise<Record<string, number>> {
  const row = await db.one<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM projects WHERE deleted_at IS NULL)::text AS projects,
       (SELECT count(*) FROM subprojects WHERE deleted_at IS NULL)::text AS subprojects,
       (SELECT count(*) FROM tasks WHERE deleted_at IS NULL)::text AS tasks,
       (SELECT count(*) FROM members)::text AS members,
       (SELECT count(*) FROM responsibilities)::text AS responsibilities,
       (SELECT count(*) FROM task_requests)::text AS requests,
       (SELECT count(*) FROM notification_ledger)::text AS notifications,
       (SELECT count(*) FROM audit_log)::text AS audit`
  );
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(row ?? {})) result[key] = Number(value);
  return result;
}

export async function lastBackup(db: Db) {
  return db.one<{ created_at: string; result: string }>(
    'SELECT created_at, result FROM backup_log ORDER BY created_at DESC LIMIT 1'
  );
}

export async function newCsrfToken(): Promise<string> {
  return newToken();
}
