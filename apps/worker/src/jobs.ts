import { persistentBackup } from './persistent-backup';
import { createHash } from 'node:crypto';
import type { Database } from '@eh/db';
import {
  claimDeliveryAttempt,
  collectPublishedSourceRows,
  commitSnapshot,
  completeJob,
  enqueue,
  finishDeliveryAttempt,
  getProject,
  getSettings,
  getPublicationMeta,
  insertAudit,
  listHolidays,
  recordPublicationFailure,
  reconcileInterruptedDeliveries,
  releaseDeliveryAttempt,
  writeSnapshotSlot,
  type OutboxJob
} from '@eh/db';
import {
  addDays,
  weekday,
  createScope,
  type ScopeTask,
  type SubprojectLike,
  businessDate,
  businessMinutes,
  canonicalJson,
  createCalendar,
  diffDays,
  effectiveEmailMode,
  inactiveSlot,
  maxEmailsPerRun,
  notificationKey,
  overdueFrequencyDays,
  recipientDomainAllowed,
  reminderCatchupDays,
  reminderOffsets,
  setting,
  settingFlag,
  SETTING_KEYS,
  toPublishedRow,
  verifyPublication,
  type NotificationKind
} from '@eh/domain';
import { PUBLISHED_CONTRACT_VERSION } from '@eh/contracts';
import type { WorkerConfig } from './config';

import type { CalendarTransport, DriveTransport, MailTransport } from './transports';

export type JobOutcome = { state: 'DONE' | 'RETRY' | 'FAILED'; error?: string };

export type JobContext = {
  db: Database;
  config: WorkerConfig;
  mail: MailTransport;
  calendar: CalendarTransport;
  drive: DriveTransport;
  sheets: { configured: boolean; append(sheetName: string, values: string[][]): Promise<void> };
  log: (message: string, meta?: Record<string, unknown>) => void;
};

type TaskRow = {
  task_id: string;
  task_name: string;
  project_id: string;
  status: string;
  due_date: string | null;
  planned_start: string | null;
  owner_member_id: string | null;
  assignment_approved_at: string | null;
  assignment_version: number;
  notification_enabled: boolean;
  subproject_id: string | null;
};

async function loadTask(db: Database, taskId: string): Promise<TaskRow | null> {
  return db.one<TaskRow>(
    `SELECT task_id, task_name, project_id, status, due_date, planned_start, owner_member_id,
            assignment_approved_at, assignment_version, notification_enabled, subproject_id
       FROM tasks WHERE task_id = $1 AND deleted_at IS NULL`,
    [taskId]
  );
}

async function recipientsOf(db: Database, task: TaskRow): Promise<{ memberId: string; email: string; name: string }[]> {
  return db.many<{ memberId: string; email: string; name: string }>(
    `SELECT m.member_id AS "memberId", m.email, m.name
       FROM members m
      WHERE m.active AND (
        m.member_id = $1
        OR m.member_id IN (SELECT ta.member_id FROM task_assignees ta WHERE ta.task_id = $2 AND ta.removed_at IS NULL)
      )
      ORDER BY (m.member_id = $1) DESC, m.name`,
    [task.owner_member_id, task.task_id]
  );
}

async function subprojectChainOpen(db: Database, task: TaskRow): Promise<boolean> {
  if (!task.subproject_id) return true;
  const rows = await db.many<{ subproject_id: string; parent_subproject_id: string | null; status: string }>(
    'SELECT subproject_id, parent_subproject_id, status FROM subprojects'
  );
  const byId = new Map(rows.map((row) => [row.subproject_id, row]));
  let node = byId.get(task.subproject_id);
  const seen = new Set<string>();
  while (node) {
    if (seen.has(node.subproject_id)) return false;
    seen.add(node.subproject_id);
    if (node.status === 'Archived' || node.status === 'Cancelled' || node.status === 'Completed') return false;
    node = node.parent_subproject_id ? byId.get(node.parent_subproject_id) : undefined;
  }
  return true;
}

async function ledgerRecord(
  db: Database,
  input: {
    key: string;
    taskId: string | null;
    recipient: string;
    kind: string;
    assignmentVersion: number | null;
  }
): Promise<{ id: string; result: string; attempts: number }> {
  const inserted = await db.one<{ notification_id: string; result: string; attempts: number }>(
    `INSERT INTO notification_ledger
       (notification_id, notification_key, task_id, recipient, notification_type, assignment_version)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (notification_key) DO NOTHING
     RETURNING notification_id, result, attempts`,
    [`NTF-${createHash('sha1').update(input.key).digest('hex').slice(0, 16)}`, input.key, input.taskId, input.recipient, input.kind, input.assignmentVersion]
  );
  if (inserted) return { id: inserted.notification_id, result: inserted.result, attempts: inserted.attempts };
  const existing = await db.one<{ notification_id: string; result: string; attempts: number }>(
    'SELECT notification_id, result, attempts FROM notification_ledger WHERE notification_key = $1',
    [input.key]
  );
  return existing
    ? { id: existing.notification_id, result: existing.result, attempts: existing.attempts }
    : { id: '', result: 'SKIPPED', attempts: 0 };
}


/** A logical notification is attempted at most this many times before an operator must look. */
const MAX_DELIVERY_ATTEMPTS = 3;

type DeliveryResult = 'SENT' | 'PREVIEW' | 'UNCERTAIN' | 'FAILED' | 'SKIPPED';
function deliveryTerminal(ledger: { result: string; attempts: number }, mode: string): boolean {
  return ['SENT', 'DELIVERY_UNCERTAIN', 'SENDING'].includes(ledger.result) ||
    (mode === 'PREVIEW' && ledger.result === 'PREVIEW') || ledger.attempts >= MAX_DELIVERY_ATTEMPTS;
}

/**
 * Whether the outbox job should be retried. A definite transient failure is retried with bounded
 * backoff; an exhausted, final or uncertain ledger row is not retried again.
 */
function deliveryNeedsRetry(result: DeliveryResult, ledgerResult: string): boolean {
  if (result === 'FAILED') return true;
  if (result === 'SKIPPED') return ledgerResult === 'PENDING' || ledgerResult === 'PREVIEW';
  return false;
}

/**
 * One recipient, one durable attempt.
 *
 * The attempt row is written before the provider is contacted. A transport failure that may have
 * reached Gmail is recorded as uncertain and is never retried automatically; a definitely-not-sent
 * transient failure is released for a bounded retry.
 */
async function deliver(
  ctx: JobContext,
  input: {
    ledgerId: string;
    dedupeKey: string;
    result: string;
    attempts: number;
    to: string;
    subject: string;
    text: string;
    mode: 'OFF' | 'PREVIEW' | 'LIVE';
  }
): Promise<DeliveryResult> {
  if (!input.ledgerId) return 'SKIPPED';
  if (input.result === 'SENT' || input.result === 'DELIVERY_UNCERTAIN' || input.result === 'SENDING') {
    return 'SKIPPED';
  }
  if (input.mode === 'OFF') return 'SKIPPED';
  if (input.mode === 'PREVIEW') {
    await ctx.db.query(
      `UPDATE notification_ledger SET result = 'PREVIEW', error_details = ''
        WHERE notification_id = $1 AND result IN ('PENDING','FAILED','SKIPPED')`,
      [input.ledgerId]
    );
    return 'PREVIEW';
  }
  if (input.attempts >= MAX_DELIVERY_ATTEMPTS) {
    // Permanent from this worker's point of view: visible in the ledger, not retried again.
    ctx.log('delivery attempts exhausted', { notificationId: input.ledgerId });
    return 'SKIPPED';
  }
  const attemptId = await claimDeliveryAttempt(ctx.db, input.ledgerId, ctx.config.WORKER_ID);
  if (!attemptId) return 'SKIPPED';
  let outcome: DeliveryResult = 'FAILED';
  let error = '';
  let retryable = false;
  try {
    const sent = await ctx.mail.send({
      to: input.to,
      subject: input.subject,
      text: input.text,
      dedupeKey: input.dedupeKey
    });
    if (sent.status === 'SENT') outcome = 'SENT';
    else if (sent.status === 'PREVIEW') outcome = 'PREVIEW';
    else if (sent.status === 'UNCERTAIN') {
      outcome = 'UNCERTAIN';
      error = sent.error;
    } else {
      outcome = 'FAILED';
      error = sent.error;
      retryable = sent.retryable;
    }
  } catch (failure) {
    // An exception after the call started is ambiguous, not a definite failure.
    outcome = 'UNCERTAIN';
    error = (failure as Error).message;
  }
  const recorded =
    outcome === 'FAILED' && retryable
      ? await releaseDeliveryAttempt(ctx.db, input.ledgerId, attemptId, error || 'SEND_FAILED')
      : await finishDeliveryAttempt(
          ctx.db,
          input.ledgerId,
          attemptId,
          outcome === 'UNCERTAIN' ? 'DELIVERY_UNCERTAIN' : outcome,
          error
        );
  if (!recorded) {
    // The attempt was superseded (lease lost, reconciliation or another worker). The newer truth
    // wins; never claim success for an outcome this worker could not persist.
    ctx.log('delivery outcome not recorded', { notificationId: input.ledgerId });
    return 'UNCERTAIN';
  }
  return outcome;
}

const MESSAGE: Record<NotificationKind, { subject: (task: TaskRow) => string; body: (task: TaskRow, extra: string) => string }> = {
  ASSIGNMENT: {
    subject: (task) => `【割当承認】${task.task_name}`,
    body: (task) =>
      `タスク「${task.task_name}」の割当が承認されました。\n期限: ${task.due_date ?? '未設定'}\n開始予定: ${task.planned_start ?? '未設定'}`
  },
  DEADLINE_REMINDER: {
    subject: (task) => `【期限間近】${task.task_name}`,
    body: (task) => `タスク「${task.task_name}」の期限が近づいています。\n期限: ${task.due_date ?? '未設定'}`
  },
  DEADLINE_CHANGE: {
    subject: (task) => `【期限変更】${task.task_name}`,
    body: (task, extra) =>
      `タスク「${task.task_name}」の期限が変更されました。\n新しい期限: ${task.due_date ?? '未設定'}${extra ? `\n${extra}` : ''}`
  },
  OVERDUE_REMINDER: {
    subject: (task) => `【期限超過】${task.task_name}`,
    body: (task) => `タスク「${task.task_name}」の期限を過ぎています。\n期限: ${task.due_date ?? '未設定'}`
  },
  COMPLETION: {
    subject: (task) => `【完了】${task.task_name}`,
    body: (task) => `タスク「${task.task_name}」が完了として記録されました。`
  },
  REQUEST_DECISION: {
    subject: (task) => `【申請結果】${task.task_name}`,
    body: (task, extra) => `タスク「${task.task_name}」の申請が処理されました。\n結果: ${extra}`
  },
  REPORT: {
    subject: () => '【レポート】設計・開発課 管理',
    body: (_task, extra) => extra
  }
};

async function sendNotification(
  ctx: JobContext,
  input: {
    kind: NotificationKind;
    taskId: string;
    assignmentVersion?: number | null;
    extra?: string;
    /** The reminder stage (or event identity) that makes this notification distinct. */
    bucket?: string;
  }
): Promise<JobOutcome> {
  const task = await loadTask(ctx.db, input.taskId);
  if (!task) return { state: 'DONE' };
  const project = await getProject(ctx.db, task.project_id);
  if (!project) return { state: 'DONE' };

  const settings = await getSettings(ctx.db);
  const mode = effectiveEmailMode(settings);
  if (mode === 'OFF') return { state: 'DONE' };

  if (input.kind === 'ASSIGNMENT') {
    if (!task.notification_enabled) return { state: 'DONE' };
    if (project.notificationEnabled === false) return { state: 'DONE' };
    // A reassignment is a different decision from the first assignment and has its own switch.
    const gate =
      task.assignment_version > 1
        ? SETTING_KEYS.REASSIGNMENT_EMAIL_ENABLED
        : SETTING_KEYS.ASSIGNMENT_EMAIL_ENABLED;
    if (!settingFlag(settings, gate, false)) return { state: 'DONE' };
    // An assignment notification requires an approval of the current assignment version.
    if (!task.assignment_approved_at) return { state: 'DONE' };
    if (input.assignmentVersion && input.assignmentVersion !== task.assignment_version) return { state: 'DONE' };
  }
  if (input.kind === 'DEADLINE_CHANGE') {
    if (!task.notification_enabled) return { state: 'DONE' };
    if (project.notificationEnabled === false) return { state: 'DONE' };
    if (!settingFlag(settings, SETTING_KEYS.DEADLINE_CHANGE_EMAIL_ENABLED, false)) return { state: 'DONE' };
  }
  if (input.kind === 'DEADLINE_REMINDER' || input.kind === 'OVERDUE_REMINDER') {
    if (!task.notification_enabled) return { state: 'DONE' };
    if (project.status !== 'Active' && project.status !== 'Planned') return { state: 'DONE' };
    const gate =
      input.kind === 'OVERDUE_REMINDER'
        ? SETTING_KEYS.OVERDUE_REMINDER_ENABLED
        : SETTING_KEYS.DEADLINE_REMINDER_ENABLED;
    if (!settingFlag(settings, gate, false)) return { state: 'DONE' };
    if (!(await subprojectChainOpen(ctx.db, task))) return { state: 'DONE' };
  }
  if (project.notificationEnabled === false && input.kind !== 'REQUEST_DECISION') return { state: 'DONE' };

  const recipients = (await recipientsOf(ctx.db, task)).filter((recipient) => {
    if (!recipientDomainAllowed(recipient.email, settings)) {
      ctx.log('recipient domain refused', { taskId: task.task_id });
      return false;
    }
    return true;
  });
  if (!recipients.length) return { state: 'DONE' };

  const cap = maxEmailsPerRun(settings);
  if (cap <= 0) {
    ctx.log('per-run email cap is zero; nothing is sent', { taskId: task.task_id });
    return { state: 'DONE' };
  }
  let attempted = 0;
  let overflow = 0;
  let retry = false;
  for (const recipient of recipients) {
    const key = notificationKey({
      kind: input.kind,
      taskId: task.task_id,
      recipient: recipient.email,
      dueDate: task.due_date,
      bucket: input.bucket ?? null,
      assignmentVersion: input.kind === 'ASSIGNMENT' ? task.assignment_version : null
    });
    const ledger = await ledgerRecord(ctx.db, {
      key,
      taskId: task.task_id,
      recipient: recipient.email,
      kind: input.kind,
      assignmentVersion: input.kind === 'ASSIGNMENT' ? task.assignment_version : null
    });
    if (deliveryTerminal(ledger, mode)) continue;
    if (attempted >= cap) { overflow++; retry = true; continue; }
    attempted++;
    const message = MESSAGE[input.kind];
    const result = await deliver(ctx, {
      ledgerId: ledger.id,
      dedupeKey: key,
      result: ledger.result,
      attempts: ledger.attempts,
      to: recipient.email,
      subject: message.subject(task),
      text: message.body(task, input.extra ?? ''),
      mode
    });
    if (deliveryNeedsRetry(result, ledger.result)) {
      retry = true;
    }
  }
  if (overflow > 0) {
    ctx.log('email cap reached; the remaining recipients are deferred', {
      taskId: task.task_id,
      attempted,
      deferred: overflow
    });
  }
  return retry ? { state: 'RETRY', error: 'DELIVERY_INCOMPLETE' } : { state: 'DONE' };
}

/** Asia/Tokyo minutes since midnight, used for the configured sending window. */

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** A configured sending window is honoured; an unset window means "any time". */
function withinExecutionWindow(settings: Record<string, string | undefined>): boolean {
  const start = parseClock(setting(settings, SETTING_KEYS.EXECUTION_WINDOW_START, ''));
  const end = parseClock(setting(settings, SETTING_KEYS.EXECUTION_WINDOW_END, ''));
  if (start === null || end === null) return true;
  const now = businessMinutes();
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

async function reminderScan(ctx: JobContext): Promise<JobOutcome> {
  const settings = await getSettings(ctx.db);
  if (effectiveEmailMode(settings) === 'OFF') return { state: 'DONE' };
  const today = businessDate();
  const offsets = reminderOffsets(settings);
  const catchup = reminderCatchupDays(settings);
  const overdueEvery = overdueFrequencyDays(settings);
  const overdueEnabled = settingFlag(settings, SETTING_KEYS.OVERDUE_REMINDER_ENABLED, false);
  const holidays = await listHolidays(ctx.db);
  const calendar = createCalendar(holidays);
  if (settingFlag(settings, SETTING_KEYS.WEEKDAY_ONLY_SENDING, true) && !calendar.isWorkingDay(today)) {
    return { state: 'DONE' };
  }
  if (!withinExecutionWindow(settings)) {
    ctx.log('outside the configured sending window');
    return { state: 'DONE' };
  }
  if (settingFlag(settings, SETTING_KEYS.PENDING_REQUEST_REMINDER_ENABLED, false)) {
    const pending = await ctx.db.many<{ request_id: string; task_id: string; request_type: string }>(
      "SELECT request_id, task_id, request_type FROM task_requests WHERE status IN ('PENDING','PROCESSING') AND submitted_at < $1::date ORDER BY request_id", [today]);
    for (const request of pending) await enqueue(ctx.db, {
      kind: 'notification.request', dedupeKey: 'pending-request:' + request.request_id + ':' + today,
      payload: { requestId: request.request_id, taskId: request.task_id, requestType: request.request_type, pendingReminder: true, bucket: today }
    });
  }
  const horizon = offsets[0] ?? 0;
  const candidates = await ctx.db.many<{ task_id: string; due_date: string | null }>(
    `SELECT task_id, due_date FROM tasks
      WHERE deleted_at IS NULL AND notification_enabled
        AND status IN ('Not Started','Assigned','In Progress','Blocked')
        AND due_date IS NOT NULL
        AND due_date <= $1::date + $2::int
      ORDER BY due_date LIMIT 1000`,
    [today, horizon]
  );
  let enqueued = 0;
  for (const candidate of candidates) {
    const due = candidate.due_date ?? '';
    if (!due) continue;
    const daysUntil = diffDays(today, due);
    if (daysUntil >= 0) {
      // Every configured stage is eligible; a stage whose exact day was missed by up to
      // REMINDER_CATCHUP_DAYS is sent once, after which its dedupe key keeps it single.
      for (const offset of offsets) {
        const missedBy = offset - daysUntil;
        if (missedBy < 0 || missedBy > catchup) continue;
        await enqueue(ctx.db, {
          kind: 'notification.task',
          dedupeKey: `reminder:${candidate.task_id}:${due}:${offset}`,
          payload: {
            taskId: candidate.task_id,
            notificationKind: 'DEADLINE_REMINDER',
            bucket: `offset:${offset}`,
            dueDate: due
          }
        });
        enqueued += 1;
        break;
      }
      continue;
    }
    if (!overdueEnabled) continue;
    const daysOverdue = -daysUntil;
    // An overdue reminder repeats at the configured interval, and a missed interval day is
    // caught up within the same bounded allowance.
    if (daysOverdue % overdueEvery > catchup) continue;
    await enqueue(ctx.db, {
      kind: 'notification.task',
      dedupeKey: `overdue:${candidate.task_id}:${due}:${daysOverdue}`,
      payload: {
        taskId: candidate.task_id,
        notificationKind: 'OVERDUE_REMINDER',
        bucket: `overdue:${daysOverdue}`,
        dueDate: due
      }
    });
    enqueued += 1;
  }
  ctx.log('reminder scan complete', { enqueued, stages: offsets.length, candidates: candidates.length });
  return { state: 'DONE' };
}

async function syncCalendar(ctx: JobContext, entityId: string, type: 'TASK' | 'MILESTONE' = 'TASK'): Promise<JobOutcome> {
  const settings = await getSettings(ctx.db);
  if (!settingFlag(settings, SETTING_KEYS.CALENDAR_SYNC_ENABLED, false)) return { state: 'DONE' };
  if (!ctx.calendar.configured) return { state: 'FAILED', error: 'CALENDAR_NOT_CONFIGURED' };
  return ctx.db.transaction(async tx => {
    await tx.query("SET LOCAL idle_in_transaction_session_timeout = '90s'");
    await tx.advisoryLock('calendar:' + type + ':' + entityId);
    const row = type === 'TASK'
      ? await tx.one<{ name: string; start: string | null; due: string | null; status: string; project_status: string }>(
          'SELECT t.task_name AS name, t.planned_start AS start, t.due_date AS due, t.status, p.status AS project_status FROM tasks t JOIN projects p USING (project_id) WHERE t.task_id = $1 AND t.deleted_at IS NULL', [entityId])
      : await tx.one<{ name: string; start: string | null; due: string | null; status: string; project_status: string }>(
          'SELECT m.milestone_name AS name, m.target_date AS start, m.target_date AS due, m.status, p.status AS project_status FROM milestones m JOIN projects p USING (project_id) WHERE m.milestone_id = $1', [entityId]);
    if (!row || !row.due) return { state: 'DONE' };
    const existing = await tx.one<{ event_id: string; sync_hash: string }>('SELECT event_id, sync_hash FROM calendar_links WHERE entity_type = $1 AND entity_id = $2', [type, entityId]);
    const inactive = ['Cancelled', 'Archived', 'Completed'].includes(row.project_status) || ['Cancelled', 'Archived', 'Done', 'Completed'].includes(row.status);
    if (inactive && !existing) return { state: 'DONE' };
    const summary = (inactive ? '[' + (row.status || row.project_status) + '] ' : '') + row.name;
    const start = row.start && row.start <= row.due ? row.start : row.due;
    const hash = createHash('sha256').update(JSON.stringify([summary, start, row.due])).digest('hex');
    if (existing?.sync_hash === hash) return { state: 'DONE' };
    const event = await ctx.calendar.upsertEvent({ eventId: existing?.event_id ?? null,
      identityKey: ctx.config.APP_ENV + ':' + type + ':' + entityId, summary,
      description: '設計・開発課 管理: ' + (type === 'TASK' ? 'タスク期限' : 'マイルストーン'), startDate: start, endDate: row.due });
    await tx.query(`INSERT INTO calendar_links (entity_type, entity_id, event_id, sync_hash) VALUES ($1,$2,$3,$4)
      ON CONFLICT (entity_type, entity_id) DO UPDATE SET event_id = EXCLUDED.event_id, sync_hash = EXCLUDED.sync_hash, synced_at = now()`, [type, entityId, event.eventId, hash]);
    return { state: 'DONE' };
  });
}

async function calendarScan(ctx: JobContext): Promise<JobOutcome> {
  if (!settingFlag(await getSettings(ctx.db), SETTING_KEYS.CALENDAR_SYNC_ENABLED, false)) return { state: 'DONE' };
  const rows = await ctx.db.many<{ kind: string; id: string }>(`SELECT 'TASK' AS kind, task_id AS id FROM tasks WHERE due_date IS NOT NULL AND deleted_at IS NULL
    UNION ALL SELECT 'MILESTONE', milestone_id FROM milestones WHERE target_date IS NOT NULL`);
  const hour = new Date().toISOString().slice(0, 13);
  for (const row of rows) await enqueue(ctx.db, { kind: row.kind === 'TASK' ? 'calendar.task' : 'calendar.milestone',
    dedupeKey: 'calendar-scan:' + row.kind + ':' + row.id + ':' + hour, payload: { entityId: row.id, taskId: row.id } });
  return { state: 'DONE' };
}

async function backup(ctx: JobContext, jobId: string): Promise<JobOutcome> {
 try { await persistentBackup(ctx.db,ctx.config,ctx.drive,jobId); return {state:'DONE'}; }
 catch(error){
  const id='BAK-'+createHash('sha256').update(ctx.config.BACKUP_INSTANCE_ID+':'+jobId).digest('hex').slice(0,32);
  await ctx.db.query("INSERT INTO backup_log(backup_id,schema_version,result,error_details) VALUES($1,0,'FAILED',$2) ON CONFLICT(backup_id) DO UPDATE SET result='FAILED',error_details=EXCLUDED.error_details",[id,(error as Error).message.slice(0,500)]);
  return {state:'RETRY',error:(error as Error).message};
 }
}

async function publish(ctx: JobContext): Promise<JobOutcome> {
  const settings = await getSettings(ctx.db);
  if (!settingFlag(settings, SETTING_KEYS.SHARED_DASHBOARD_PUBLISH_ENABLED, false)) {
    return { state: 'DONE' };
  }
  try {
    const rows = (await collectPublishedSourceRows(ctx.db))
      .map((row) =>
        toPublishedRow({
          taskId: row.task_id,
          taskName: row.task_name,
          projectId: row.project_id,
          projectName: row.project_name,
          responsibilityId: row.responsibility_id,
          responsibilityName: row.responsibility_name ?? '',
          responsibilityColor: row.responsibility_color ?? '',
          status: row.status,
          dueDate: row.due_date,
          plannedStart: row.planned_start,
          ownerName: row.owner_name ?? '',
          assigneeNames: row.assignee_names ?? [],
          container: row.container,
          parentTaskId: row.parent_task_id,
          reviewState: row.review_state,
          completedAt: row.completed_at,
          progressPercent: row.progress_percent,
          pendingRequest: row.pending_request,
          projectVisibility: row.dashboard_visibility
        })
      )
      .filter((row): row is NonNullable<typeof row> => row !== null);
    const hash = createHash('sha256').update(canonicalJson(rows), 'utf8').digest('hex');
    const meta = await getPublicationMeta(ctx.db);
    const slot = inactiveSlot(meta?.active_slot ?? 'NONE');
    await ctx.db.transaction(async (tx) => {
      await writeSnapshotSlot(tx, {
        slot,
        contractVersion: PUBLISHED_CONTRACT_VERSION,
        publisherVersion: ctx.config.APP_VERSION,
        hash,
        rows,
        rowCounts: { tasks: rows.length }
      });
      const written = await tx.one<{ count: string; hash: string }>(
        'SELECT jsonb_array_length(rows)::text AS count, hash FROM published_snapshots WHERE slot = $1',
        [slot]
      );
      verifyPublication({
        headersMatch: true,
        rowCount: Number(written?.count ?? -1),
        expectedRows: rows.length,
        hash: written?.hash ?? '',
        expectedHash: hash
      });
      await commitSnapshot(tx, {
        slot,
        contractVersion: PUBLISHED_CONTRACT_VERSION,
        publisherVersion: ctx.config.APP_VERSION,
        hash,
        rowCounts: { tasks: rows.length }
      });
      await insertAudit(tx, {
        entityType: 'PUBLISHED_SNAPSHOT',
        entityId: slot,
        action: 'PUBLICATION_COMPLETED',
        actorEmail: 'worker',
        actorMemberId: '',
        newValue: { slot, hash, rows: rows.length }
      });
    });
    return { state: 'DONE' };
  } catch (error) {
    await recordPublicationFailure(ctx.db, (error as Error).message).catch(() => undefined);
    return { state: 'RETRY', error: (error as Error).message };
  }
}

async function exportSheets(ctx: JobContext): Promise<JobOutcome> {
  if (!ctx.sheets.configured) return { state: 'DONE' };
  const rows = (await collectPublishedSourceRows(ctx.db))
    .map((row) =>
      toPublishedRow({
        taskId: row.task_id,
        taskName: row.task_name,
        projectId: row.project_id,
        projectName: row.project_name,
        responsibilityId: row.responsibility_id,
        responsibilityName: row.responsibility_name ?? '',
        responsibilityColor: row.responsibility_color ?? '',
        status: row.status,
        dueDate: row.due_date,
        plannedStart: row.planned_start,
        ownerName: row.owner_name ?? '',
        assigneeNames: row.assignee_names ?? [],
        container: row.container,
        parentTaskId: row.parent_task_id,
        reviewState: row.review_state,
        completedAt: row.completed_at,
        progressPercent: row.progress_percent,
        pendingRequest: row.pending_request,
        projectVisibility: row.dashboard_visibility
      })
    )
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const stamp = new Date().toISOString();
  const values: string[][] = [
    [`Exported at ${stamp}`, `Contract ${PUBLISHED_CONTRACT_VERSION}`, `Rows ${rows.length}`],
    ['Task_ID', 'Task', 'Project', 'Responsibility', 'Status', 'Due', 'Owner', 'Assignees', 'Container', 'Review'],
    ...rows.map((row) => [
      row.taskId,
      row.taskName,
      row.projectName,
      row.responsibilityName,
      row.status,
      row.dueDate,
      row.ownerName,
      row.assigneeNames.join(', '),
      row.container ? 'YES' : 'NO',
      row.reviewState
    ])
  ];
  try {
    await ctx.sheets.append(ctx.config.EXPORT_SHEET_NAME, values);
    return { state: 'DONE' };
  } catch (error) {
    return { state: 'RETRY', error: (error as Error).message };
  }
}

async function maintenance(ctx: JobContext): Promise<JobOutcome> {
  const purged = await ctx.db.query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days'");
  const reconciled = await reconcileInterruptedDeliveries(ctx.db);
  ctx.log('session purge', { purged: purged.rowCount, reconciledDeliveries: reconciled });
  return { state: 'DONE' };
}

/** The weekly manager report: one message per recipient per business week. */
async function weeklyReport(ctx: JobContext): Promise<JobOutcome> {
  const settings = await getSettings(ctx.db);
  const mode = effectiveEmailMode(settings);
  if (mode === 'OFF') return { state: 'DONE' };
  if (!settingFlag(settings, SETTING_KEYS.WEEKLY_MANAGER_REPORT_ENABLED, false)) {
    return { state: 'DONE' };
  }
  const today = businessDate();
  const counts = await ctx.db.transaction(async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const tasks = await tx.many<ScopeTask & { completedAt: string | null }>(`SELECT task_id AS "taskId", project_id AS "projectId", subproject_id AS "subprojectId",
      parent_task_id AS "parentTaskId", status, due_date AS "dueDate", completed_at AS "completedAt" FROM tasks WHERE deleted_at IS NULL`);
    const projects = await tx.many<{ projectId: string; status: string }>('SELECT project_id AS "projectId", status FROM projects WHERE deleted_at IS NULL');
    const subprojects = await tx.many<SubprojectLike>('SELECT subproject_id AS "subprojectId", project_id AS "projectId", parent_subproject_id AS "parentSubprojectId", status FROM subprojects WHERE deleted_at IS NULL');
    const scope = createScope(tasks, new Map(projects.map(p => [p.projectId, p])), new Map(subprojects.map(p => [p.subprojectId, p])), today);
    const totals = scope.counts();
    const weekStart = addDays(today, -((weekday(today) + 6) % 7));
    const completed = tasks.filter(task => !scope.isContainer(task.taskId) && task.status === 'Done' && task.completedAt && businessDate(new Date(task.completedAt)) >= weekStart).length;
    const pending = await tx.one<{ count: string }>("SELECT count(*)::text AS count FROM task_requests WHERE status IN ('PENDING','PROCESSING')");
    return { open: totals.openWork, overdue: totals.overdueWork, upcoming: scope.upcoming(today, addDays(today, 7)).length, completed_week: completed, pending_requests: Number(pending?.count ?? 0) };
  });
  const text = [
    `週次レポート (${today})`,
    `未完了の作業: ${counts?.open ?? '0'}`,
    `期限超過: ${counts?.overdue ?? '0'}`,
    `今後7日の期限: ${counts?.upcoming ?? '0'}`,
    `今週の完了: ${counts?.completed_week ?? '0'}`,
    `未処理の申請: ${counts?.pending_requests ?? '0'}`
  ].join('\n');
  const configured = setting(settings, SETTING_KEYS.MANAGEMENT_REPORT_RECIPIENTS)
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const managers = configured.length
    ? configured
    : (await ctx.db.many<{ email: string }>(
        "SELECT email FROM members WHERE active AND role IN ('ADMIN','MANAGER') ORDER BY email"
      )).map((row) => row.email);
  const cap = maxEmailsPerRun(settings);
  const recipients = managers.filter((email) => recipientDomainAllowed(email, settings));
  let attempted = 0;
  let retry = false;
  for (const email of recipients) {
    const key = notificationKey({ kind: 'REPORT', taskId: '', recipient: email, bucket: `week:${addDays(today, -((weekday(today) + 6) % 7))}` });
    const ledger = await ledgerRecord(ctx.db, {
      key,
      taskId: null,
      recipient: email,
      kind: 'REPORT',
      assignmentVersion: null
    });
    if (deliveryTerminal(ledger, mode)) continue;
    if (attempted >= cap) { retry = true; continue; }
    attempted++;
    const result = await deliver(ctx, {
      ledgerId: ledger.id,
      dedupeKey: key,
      result: ledger.result,
      attempts: ledger.attempts,
      to: email,
      subject: `【週次レポート】設計・開発課 管理 (${today})`,
      text,
      mode
    });
    if (deliveryNeedsRetry(result, ledger.result)) retry = true;
  }
  return retry ? { state: 'RETRY', error: 'REPORT_INCOMPLETE' } : { state: 'DONE' };
}

export async function handleJob(ctx: JobContext, job: OutboxJob): Promise<JobOutcome> {
  if (ctx.config.BACKUP_ONLY === 'true' && !['backup.database','maintenance.sessions'].includes(job.kind)) return {state:'DONE'};
  const payload = job.payload as Record<string, unknown>;
  switch (job.kind) {
    case 'notification.assignment':
      return sendNotification(ctx, { kind: 'ASSIGNMENT', taskId: String(payload.taskId), assignmentVersion: Number(payload.assignmentVersion) });
    case 'notification.task':
      return sendNotification(ctx, {
        kind: (payload.notificationKind as NotificationKind) ?? 'DEADLINE_REMINDER',
        taskId: String(payload.taskId),
        bucket: payload.bucket === undefined ? undefined : String(payload.bucket)
      });
    case 'notification.request': {
      const taskId = String(payload.taskId);
      const requestId = String(payload.requestId ?? '');
      const managers = await ctx.db.many<{ email: string }>(
        "SELECT email FROM members WHERE active AND role IN ('ADMIN','MANAGER') ORDER BY email"
      );
      const task = await loadTask(ctx.db, taskId);
      if (!task || !managers.length) return { state: 'DONE' };
      const settings = await getSettings(ctx.db);
      const mode = effectiveEmailMode(settings);
      // The switch matches the request type: a completion report and a deadline request are
      // different notifications that a manager enables independently.
      const requestType = String(payload.requestType ?? '');
      const gate =
        requestType === 'COMPLETION_REPORT'
          ? SETTING_KEYS.COMPLETION_REPORT_EMAIL_ENABLED
          : SETTING_KEYS.DEADLINE_REQUEST_EMAIL_ENABLED;
      if (!payload.pendingReminder && !settingFlag(settings, gate, false)) {
        return { state: 'DONE' };
      }
      if (mode === 'OFF') return { state: 'DONE' };
      if (payload.pendingReminder) {
        if (!settingFlag(settings, SETTING_KEYS.PENDING_REQUEST_REMINDER_ENABLED, false)) return { state: 'DONE' };
        const current = await ctx.db.one<{ status: string }>('SELECT status FROM task_requests WHERE request_id = $1', [requestId]);
        if (!current || !['PENDING', 'PROCESSING'].includes(current.status)) return { state: 'DONE' };
      }
      let attempted = 0;
      let retry = false;
      for (const manager of managers) {
        if (!recipientDomainAllowed(manager.email, settings)) continue;
        // One request is one notification: two requests on the same task never share an identity.
        const key = notificationKey({
          kind: 'REQUEST_DECISION',
          taskId,
          recipient: manager.email,
          bucket: payload.pendingReminder ? `pending:${requestId}:${String(payload.bucket)}` : `request:${requestId || 'unknown'}`
        });
        const ledger = await ledgerRecord(ctx.db, {
          key,
          taskId,
          recipient: manager.email,
          kind: 'REQUEST_DECISION',
          assignmentVersion: null
        });
        if (deliveryTerminal(ledger, mode)) continue;
        if (attempted >= maxEmailsPerRun(settings)) { retry = true; continue; }
        attempted++;
        const result = await deliver(ctx, {
          ledgerId: ledger.id,
          dedupeKey: key,
          result: ledger.result,
          attempts: ledger.attempts,
          to: manager.email,
          subject: `${payload.pendingReminder ? '【未処理の申請】' : '【申請】'}${task.task_name}`,
          text: `タスク「${task.task_name}」の申請一覧を確認してください。`,
          mode
        });
        if (deliveryNeedsRetry(result, ledger.result)) retry = true;
      }
      return retry ? { state: 'RETRY', error: 'REQUEST_NOTIFICATION_INCOMPLETE' } : { state: 'DONE' };
    }
    case 'notification.request-decision':
      return sendNotification(ctx, {
        kind: 'REQUEST_DECISION',
        taskId: String(payload.taskId),
        extra: String(payload.decision ?? ''),
        bucket: `decision:${String(payload.requestId ?? '')}`
      });
    case 'notification.reminder-scan':
      return reminderScan(ctx);
    case 'calendar.scan':
      return calendarScan(ctx);
    case 'calendar.milestone':
      return syncCalendar(ctx, String(payload.entityId), 'MILESTONE');
    case 'calendar.task':
      return syncCalendar(ctx, String(payload.taskId));
    case 'backup.database':
      return backup(ctx, job.job_id+':'+(job.created_at??'legacy'));
    case 'publication.run':
      return publish(ctx);
    case 'export.sheets':
      return exportSheets(ctx);
    case 'report.weekly':
      return weeklyReport(ctx);
    case 'maintenance.sessions':
      return maintenance(ctx);
    default:
      return { state: 'FAILED', error: `Unknown job kind: ${job.kind}` };
  }
}

export { completeJob };
