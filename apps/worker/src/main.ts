/**
 * Worker process.
 *
 * One loop claims outbox jobs with a lease token, runs the handler and records the outcome only
 * while it still owns the lease. Long jobs renew the lease. A crashed worker's lease expires and
 * the job is reclaimed; a delivery attempt that was interrupted becomes uncertain instead of being
 * retried blindly. Scheduled work is enqueued as ordinary outbox rows.
 */
import {
  createPool,
  Database,
  claimNext,
  completeJob,
  enqueue,
  failJob,
  getSettings,
  reapExpiredLeases,
  reconcileInterruptedDeliveries,
  renewLease
} from '@eh/db';
import {
  businessDate,
  businessMinutes,
  businessWeekday,
  retryDelaySeconds,
  setting,
  settingFlag,
  SETTING_KEYS
} from '@eh/domain';
import { loadWorkerConfig } from './config';
import { handleJob } from './jobs';
import {
  GmailApiTransport,
  GoogleCalendarTransport,
  GoogleDriveTransport,
  GoogleSheetsExportTransport
} from './transports';

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const pool = createPool({ ...config.database, applicationName: `eh-worker-${config.WORKER_ID}` });
  const db = new Database(pool);
  const log = (message: string, meta: Record<string, unknown> = {}): void => {
    process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), level: 'info', message, ...meta })}\n`);
  };

  const sheets = new GoogleSheetsExportTransport({
    credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON,
    spreadsheetId: config.EXPORT_SPREADSHEET_ID
  });
  const context = {
    db,
    config,
    mail: new GmailApiTransport({
      credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON,
      sender: config.GMAIL_SENDER
    }),
    calendar: new GoogleCalendarTransport({
      credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON,
      calendarId: config.CALENDAR_ID
    }),
    drive: new GoogleDriveTransport({ credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON, delegatedUser: config.GOOGLE_DRIVE_DELEGATED_USER }),
    sheets: { configured: sheets.configured, append: sheets.append.bind(sheets) },
    log
  };

  let running = true;
  const stop = (): void => {
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  let lastScheduleMinute = '';
  while (running) {
    try {
      const reaped = await reapExpiredLeases(db);
      if (reaped) log('reclaimed expired leases', { reaped });
      const interrupted = await reconcileInterruptedDeliveries(db);
      if (interrupted) log('interrupted deliveries marked uncertain', { interrupted });

      if (config.SCHEDULE_ENABLED === 'true') {
        const minute = new Date().toISOString().slice(0, 16);
        if (minute !== lastScheduleMinute) {
          lastScheduleMinute = minute;
          await schedule(db, log);
        }
      }

      const job = await claimNext(db, config.WORKER_ID, config.LEASE_SECONDS);
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, config.POLL_INTERVAL_MS));
        continue;
      }
      const heartbeat = setInterval(
        () => {
          void renewLease(db, job.job_id, job.lease_token, config.LEASE_SECONDS).catch(() => undefined);
        },
        Math.max(5_000, Math.floor((config.LEASE_SECONDS * 1000) / 3))
      );
      let outcome;
      try {
        outcome = await handleJob(context, job);
      } finally {
        clearInterval(heartbeat);
      }
      if (outcome.state === 'DONE') {
        const owned = await completeJob(db, job.job_id, job.lease_token);
        if (!owned) log('lease lost before completion; outcome discarded', { jobId: job.job_id, kind: job.kind });
        continue;
      }
      if (outcome.state === 'RETRY') {
        const retryAt = new Date(Date.now() + retryDelaySeconds(job.attempts) * 1000);
        const state = await failJob(db, job.job_id, job.lease_token, outcome.error ?? 'RETRY', { retryAt });
        log('job scheduled for retry', { jobId: job.job_id, kind: job.kind, state, retryAt });
        continue;
      }
      const state = await failJob(db, job.job_id, job.lease_token, outcome.error ?? 'FAILED', { retryAt: null });
      log('job failed permanently', { jobId: job.job_id, kind: job.kind, state, error: outcome.error });
    } catch (error) {
      log('worker loop error', { error: (error as Error).message });
      await new Promise((resolve) => setTimeout(resolve, config.POLL_INTERVAL_MS));
    }
  }
  await db.close();
}

/** Minutes since the epoch, bucketed by an interval: one scheduled run per interval, never two. */
function intervalBucket(now: Date, minutes: number): number {
  return Math.floor(now.getTime() / (Math.max(1, minutes) * 60_000));
}

function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

async function schedule(db: Database, log: (message: string, meta?: Record<string, unknown>) => void): Promise<void> {
  const settings = await getSettings(db);
  const now = new Date();
  const hour = now.toISOString().slice(0, 13);
  const day = businessDate(now);

  if (settingFlag(settings, SETTING_KEYS.DAILY_BACKUP_ENABLED, false)) {
    const interval = Number(setting(settings, SETTING_KEYS.BACKUP_INTERVAL_MINUTES, '60')) || 60;
    await enqueue(db, {
      kind: 'backup.database',
      dedupeKey: `backup:${intervalBucket(now, interval)}`,
      payload: { intervalMinutes: interval }
    });
  }

  // Reminders are evaluated every hour: the sending window, the catch-up allowance and the
  // overdue interval all need more than one opportunity per day.
  await enqueue(db, { kind: 'notification.reminder-scan', dedupeKey: `reminder-scan:${hour}`, payload: {} });
  if (settingFlag(settings, SETTING_KEYS.CALENDAR_SYNC_ENABLED, false)) {
    await enqueue(db, { kind: 'calendar.scan', dedupeKey: 'calendar-scan:' + hour, payload: {} });
  }
  await enqueue(db, { kind: 'maintenance.sessions', dedupeKey: `maintenance:${day}`, payload: {} });

  if (settingFlag(settings, SETTING_KEYS.SHARED_DASHBOARD_PUBLISH_ENABLED, false)) {
    const interval = Number(setting(settings, SETTING_KEYS.SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES, '60')) || 60;
    await enqueue(db, {
      kind: 'publication.run',
      dedupeKey: `publication:${intervalBucket(now, interval)}`,
      payload: {}
    });
  }

  if (settingFlag(settings, SETTING_KEYS.EXPORT_SHEETS_ENABLED, false)) {
    await enqueue(db, { kind: 'export.sheets', dedupeKey: `export:${day}`, payload: {} });
  }

  if (settingFlag(settings, SETTING_KEYS.WEEKLY_MANAGER_REPORT_ENABLED, false)) {
    const configuredDay = setting(settings, SETTING_KEYS.WEEKLY_REPORT_DAY, 'MONDAY').toUpperCase();
    const names = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const numericDay = Number(configuredDay);
    const targetDay = Number.isFinite(numericDay) && numericDay >= 0 && numericDay <= 6
      ? numericDay
      : names.indexOf(configuredDay);
    const today = businessWeekday(now);
    const reportMinutes = clockMinutes(setting(settings, SETTING_KEYS.WEEKLY_REPORT_TIME, '08:30')) ?? 8 * 60 + 30;
    const nowMinutes = businessMinutes(now);
    // Only the matching hour enqueues; the dedupe key makes an extra evaluation inert.
    if (targetDay >= 0 && today === targetDay && nowMinutes >= reportMinutes && nowMinutes < reportMinutes + 60) {
      await enqueue(db, { kind: 'report.weekly', dedupeKey: `report:${day}`, payload: {} });
    }
  }
  log('schedule evaluated', { hour, day });
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});