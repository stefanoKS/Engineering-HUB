/**
 * Delivery semantics with a recording transport.
 *
 * These cover the policy the worker must keep: a preview never blocks a later live send, an
 * uncertain delivery is never retried automatically, and a capped run reports the deferred work
 * instead of silently dropping it.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  Database,
  approveAssignment,
  insertMember,
  insertProject,
  insertResponsibility,
  insertTask,
  saveSettings
} from '@eh/db';
import { handleJob, type JobContext } from '../src/jobs';
import { loadWorkerConfig } from '../src/config';
import { RecordingMailTransport, type SendOutcome } from '../src/transports';
import { freshDatabase, requireDatabase } from '../../../packages/db/test/support/db';

let db: Database;
let pool: pg.Pool;

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
});

afterEach(async () => {
  await pool.end();
});

async function seedTask(): Promise<void> {
  const owner = await insertMember(
    db,
    { name: 'Owner', email: 'owner@example.co.jp', role: 'MEMBER' },
    'MEM-OWNER'
  );
  const second = await insertMember(
    db,
    { name: 'Second', email: 'second@example.co.jp', role: 'MEMBER' },
    'MEM-SECOND'
  );
  await insertMember(db, { name: 'Manager', email: 'manager@example.co.jp', role: 'MANAGER' }, 'MEM-MGR');
  const area = await insertResponsibility(db, { name: 'Area', ownerMemberId: owner.memberId }, 'RSP-1');
  const project = await insertProject(
    db,
    { projectName: 'Project', responsibilityId: area.responsibilityId, projectOwnerId: owner.memberId },
    'PRJ-1'
  );
  const task = await insertTask(
    db,
    {
      projectId: project.projectId,
      taskName: 'Notify me',
      ownerMemberId: owner.memberId,
      dueDate: '2026-03-01',
      notificationEnabled: true
    },
    'TSK-1'
  );
  await db.query(
    "INSERT INTO task_assignees (assignment_id, task_id, member_id) VALUES ('ASG-1', 'TSK-1', $1)",
    [second.memberId]
  );
  await approveAssignment(db, task.taskId, task.revision);
  await saveSettings(
    db,
    {
      EMAIL_MODE: 'PREVIEW',
      EMERGENCY_STOP: 'false',
      ASSIGNMENT_EMAIL_ENABLED: 'true',
      ALLOWED_RECIPIENT_DOMAINS: 'example.co.jp',
      MAX_EMAILS_PER_RUN: '50'
    },
    'test'
  );
}

function context(outcome?: SendOutcome): JobContext & { mail: RecordingMailTransport } {
  const config = loadWorkerConfig({
    ...process.env,
    DATABASE_URL: requireDatabase(),
    WORKER_ID: 'worker-test',
    SCHEDULE_ENABLED: 'false'
  });
  const mail = new RecordingMailTransport(outcome);
  return {
    db,
    config,
    mail,
    calendar: { configured: false, upsertEvent: async () => ({ eventId: 'none' }) },
    drive: {
      configured: false,
      upload: async () => ({ fileId: 'none', webViewLink: '' }),
      listOld: async () => [],
      remove: async () => undefined
    },
    sheets: { configured: false, append: async () => undefined },
    log: () => undefined
  };
}

async function ledger(): Promise<{ result: string; attempts: number } | null> {
  return db.one<{ result: string; attempts: number }>(
    'SELECT result, attempts FROM notification_ledger ORDER BY created_at DESC LIMIT 1'
  );
}

function assignmentJob() {
  return {
    job_id: '1',
    kind: 'notification.assignment',
    payload: { taskId: 'TSK-1', assignmentVersion: 1 },
    attempts: 1,
    max_attempts: 6,
    correlation_id: '',
    lease_token: 'token'
  };
}

describe('notification delivery', () => {
  it('weekly report counts exclude archived work and respect recipient caps across retries', async () => {
    await seedTask();
    await db.query("UPDATE projects SET status = 'Archived', archived_at = now() WHERE project_id = 'PRJ-1'");
    await saveSettings(db, { EMAIL_MODE: 'LIVE', WEEKLY_MANAGER_REPORT_ENABLED: 'true', MAX_EMAILS_PER_RUN: '1', MANAGEMENT_REPORT_RECIPIENTS: 'manager@example.co.jp,other@example.co.jp' }, 'test');
    const job = { ...assignmentJob(), kind: 'report.weekly', payload: {} };
    const ctx = context();
    expect((await handleJob(ctx, job)).state).toBe('RETRY');
    expect(ctx.mail.sent[0]?.text).toContain('未完了の作業: 0');
    expect((await handleJob(ctx, job)).state).toBe('DONE');
    expect(ctx.mail.sent).toHaveLength(2);
    expect(new Set(ctx.mail.sent.map(message => message.to)).size).toBe(2);
  });

  it('projects milestones into Calendar once and respects the default-off switch', async () => {
    await seedTask();
    await db.query("INSERT INTO milestones (milestone_id, project_id, milestone_name, target_date) VALUES ('MIL-1', 'PRJ-1', 'Review', '2026-11-05')");
    const ctx = context();
    const calls: string[] = [];
    ctx.calendar = { configured: true, upsertEvent: async input => { calls.push(input.identityKey); return { eventId: 'owned-event' }; } };
    const job = { ...assignmentJob(), kind: 'calendar.milestone', payload: { entityId: 'MIL-1' } };
    await handleJob(ctx, job);
    expect(calls).toHaveLength(0);
    await saveSettings(db, { CALENDAR_SYNC_ENABLED: 'true' }, 'test');
    await handleJob(ctx, job); await handleJob(ctx, job);
    expect(calls).toEqual(['DEVELOPMENT:MILESTONE:MIL-1']);
  });

  it('pending reminders have their own switch and stop after a request is decided', async () => {
    await seedTask();
    await db.query("INSERT INTO task_requests (request_id, task_id, request_type) VALUES ('REQ-P', 'TSK-1', 'COMPLETION_REPORT')");
    await saveSettings(db, { EMAIL_MODE: 'LIVE', PENDING_REQUEST_REMINDER_ENABLED: 'true', COMPLETION_REPORT_EMAIL_ENABLED: 'false' }, 'test');
    const job = { ...assignmentJob(), kind: 'notification.request', payload: { taskId: 'TSK-1', requestId: 'REQ-P', requestType: 'COMPLETION_REPORT', pendingReminder: true, bucket: '2026-11-01' } };
    const ctx = context();
    await handleJob(ctx, job);
    expect(ctx.mail.sent).toHaveLength(1);
    await handleJob(ctx, job);
    expect(ctx.mail.sent).toHaveLength(1);
    await db.query("UPDATE task_requests SET status = 'REJECTED' WHERE request_id = 'REQ-P'");
    await handleJob(ctx, { ...job, payload: { ...job.payload, bucket: '2026-11-02' } });
    expect(ctx.mail.sent).toHaveLength(1);
  });

  it('lets a later live send proceed after a preview', async () => {
    await seedTask();
    const preview = context();
    const first = await handleJob(preview, assignmentJob());
    expect(first.state).toBe('DONE');
    expect(preview.mail.sent).toHaveLength(0);
    expect((await ledger())?.result).toBe('PREVIEW');

    await saveSettings(db, { EMAIL_MODE: 'LIVE' }, 'test');
    const live = context();
    const second = await handleJob(live, assignmentJob());
    expect(second.state).toBe('DONE');
    // owner + additional assignee, one message each
    expect(live.mail.sent).toHaveLength(2);
    expect((await ledger())?.result).toBe('SENT');
  });

  it('never retries an uncertain delivery automatically', async () => {
    await seedTask();
    await saveSettings(db, { EMAIL_MODE: 'LIVE' }, 'test');
    const ctx = context({ status: 'UNCERTAIN', error: 'socket hang up' });
    await handleJob(ctx, assignmentJob());
    expect((await ledger())?.result).toBe('DELIVERY_UNCERTAIN');

    const retry = context();
    const outcome = await handleJob(retry, assignmentJob());
    expect(outcome.state).toBe('DONE');
    expect(retry.mail.sent).toHaveLength(0);
  });

  it('reports deferred recipients when the per-run cap is reached', async () => {
    await seedTask();
    await saveSettings(db, { EMAIL_MODE: 'LIVE', MAX_EMAILS_PER_RUN: '1' }, 'test');
    const ctx = context();
    const outcome = await handleJob(ctx, assignmentJob());
    expect(ctx.mail.sent).toHaveLength(1);
    expect(outcome.state).toBe('RETRY');
    expect(outcome.error).toBe('DELIVERY_INCOMPLETE');
    const resumed = context();
    expect((await handleJob(resumed, assignmentJob())).state).toBe('DONE');
    expect(resumed.mail.sent).toHaveLength(1);
    expect(resumed.mail.sent[0]?.to).not.toBe(ctx.mail.sent[0]?.to);
  });

  it('records a definite transient failure for a bounded retry', async () => {
    await seedTask();
    await saveSettings(db, { EMAIL_MODE: 'LIVE' }, 'test');
    const ctx = context({ status: 'FAILED', error: 'TRANSIENT', retryable: true });
    const outcome = await handleJob(ctx, assignmentJob());
    expect(outcome.state).toBe('RETRY');
    expect((await ledger())?.result).toBe('PENDING');
  });

  it('waits for the exact assignment version it announces', async () => {
    await seedTask();
    await saveSettings(db, { EMAIL_MODE: 'LIVE' }, 'test');
    const ctx = context();
    const stale = { ...assignmentJob(), payload: { taskId: 'TSK-1', assignmentVersion: 99 } };
    await handleJob(ctx, stale);
    expect(ctx.mail.sent).toHaveLength(0);
  });

  it('honours the deadline-change switch for an approved deadline change', async () => {
    await seedTask();
    await saveSettings(db, { EMAIL_MODE: 'LIVE', DEADLINE_CHANGE_EMAIL_ENABLED: 'false' }, 'test');
    const disabled = context();
    await handleJob(disabled, {
      ...assignmentJob(),
      kind: 'notification.task',
      payload: { taskId: 'TSK-1', notificationKind: 'DEADLINE_CHANGE', bucket: 'request:REQ-1' },
      dedupeKey: 'deadline-change:REQ-1',
      job_id: '2'
    } as never);
    expect(disabled.mail.sent).toHaveLength(0);

    await saveSettings(db, { DEADLINE_CHANGE_EMAIL_ENABLED: 'true' }, 'test');
    const enabled = context();
    // A different request id keeps the ledger key distinct.
    await handleJob(enabled, {
      ...assignmentJob(),
      kind: 'notification.task',
      payload: { taskId: 'TSK-1', notificationKind: 'DEADLINE_CHANGE', bucket: 'request:REQ-2' },
      job_id: '3'
    } as never);
    expect(enabled.mail.sent).toHaveLength(2);
  });
});
