/**
 * Worker process.
 *
 * One loop claims outbox jobs with a lease, runs the handler and records the outcome. Scheduled
 * work is enqueued as ordinary outbox rows, so a crash cannot lose a reminder or a backup: the
 * lease expires and the job is claimed again.
 */
import { createPool, Database, claimNext, completeJob, enqueue, failJob, getSettings, reapExpiredLeases } from '@eh/db';
import { businessDate, retryDelaySeconds, settingFlag, SETTING_KEYS } from '@eh/domain';
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
    drive: new GoogleDriveTransport({ credentialsJson: config.GOOGLE_SERVICE_ACCOUNT_JSON }),
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
      const outcome = await handleJob(context, job);
      if (outcome.state === 'DONE') {
        await completeJob(db, job.job_id);
        continue;
      }
      if (outcome.state === 'RETRY') {
        const retryAt = new Date(Date.now() + retryDelaySeconds(job.attempts) * 1000);
        const state = await failJob(db, job.job_id, outcome.error ?? 'RETRY', { retryAt });
        log('job scheduled for retry', { jobId: job.job_id, kind: job.kind, state, retryAt });
        continue;
      }
      await failJob(db, job.job_id, outcome.error ?? 'FAILED', { retryAt: null });
      log('job failed permanently', { jobId: job.job_id, kind: job.kind, error: outcome.error });
    } catch (error) {
      log('worker loop error', { error: (error as Error).message });
      await new Promise((resolve) => setTimeout(resolve, config.POLL_INTERVAL_MS));
    }
  }
  await db.close();
}

async function schedule(db: Database, log: (message: string, meta?: Record<string, unknown>) => void): Promise<void> {
  const settings = await getSettings(db);
  const hour = new Date().toISOString().slice(0, 13);
  const day = businessDate();

  if (settingFlag(settings, SETTING_KEYS.DAILY_BACKUP_ENABLED, false)) {
    await enqueue(db, { kind: 'backup.database', dedupeKey: `backup:${day}`, payload: {} });
  }

  await enqueue(db, {
    kind: 'notification.reminder-scan',
    dedupeKey: `reminder-scan:${day}`,
    payload: {}
  });
  await enqueue(db, { kind: 'maintenance.sessions', dedupeKey: `maintenance:${day}`, payload: {} });

  if (settingFlag(settings, SETTING_KEYS.SHARED_DASHBOARD_PUBLISH_ENABLED, false)) {
    await enqueue(db, { kind: 'publication.run', dedupeKey: `publication:${hour}`, payload: {} });
  }
  log('schedule evaluated', { hour, day });
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
