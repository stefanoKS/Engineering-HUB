/**
 * ADMIN corrective reopening of an accidentally completed task.
 *
 * The operation is deliberately narrow: ADMIN only, leaf work only, a stored `Done` only, a typed
 * `REOPEN <id>` confirmation and a required reason. It reverses the current completion as a new
 * corrective event - the original request, approval and audit rows stay untouched - and it never
 * invents a historical progress value. A `Completed` parent project is reopened in the same
 * operation only when the caller explicitly acknowledged it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertProject, insertResponsibility, insertTask, saveSettings } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

const password = 'Reopen-password-123';

beforeEach(async () => {
  hash = await hashPassword(password);
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(
    "INSERT INTO members(member_id,name,role) VALUES('MEM-ADMIN','Admin','ADMIN'),('MEM-MANAGER','Manager','MANAGER'),('MEM-A','Member A','MEMBER'),('MEM-VIEW','Viewer','VIEWER')"
  );
  await db.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
      ('MEM-ADMIN','0001',$1,false),('MEM-MANAGER','0002',$1,false),('MEM-A','0010',$1,false),('MEM-VIEW','0020',$1,false)`,
    [hash]
  );
  await insertResponsibility(db, { name: '設計' }, 'RSP-A');
  await insertProject(
    db,
    {
      projectName: 'Alpha',
      responsibilityId: 'RSP-A',
      status: 'Active',
      dashboardVisibility: 'INTERNAL'
    },
    'PRJ-A'
  );
  app = await buildApp({
    db,
    inbox: new NullInboxSource(),
    logger: false,
    config: loadConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'local',
      PUBLIC_ORIGIN: 'http://localhost:8050'
    })
  });
  await app.ready();
  await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, 'MEM-ADMIN');
});

afterEach(async () => {
  await app.close();
  await pool.end();
});

async function login(employeeId: string): Promise<Record<string, string>> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { employeeId, password } });
  expect(response.statusCode, response.body).toBe(200);
  return {
    cookie: String(response.headers['set-cookie']).split(';')[0]!,
    'x-csrf-token': response.json().data.csrfToken,
    origin: 'http://localhost:8050'
  };
}

async function seedDone(
  taskId: string,
  overrides: { completedAt?: string | null; progressPercent?: number } = {}
): Promise<void> {
  await insertTask(
    db,
    {
      projectId: 'PRJ-A',
      taskName: `Task ${taskId}`,
      ownerMemberId: 'MEM-A',
      status: 'Done',
      progressPercent: overrides.progressPercent ?? 100,
      dueDate: '2026-12-01'
    },
    taskId
  );
  const completedAt = overrides.completedAt === undefined ? '2026-10-01T03:00:00.000Z' : overrides.completedAt;
  await db.query('UPDATE tasks SET completed_at = $2 WHERE task_id = $1', [taskId, completedAt]);
}

function reopen(headers: Record<string, string>, taskId: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/manager/tasks/${taskId}/reopen`, headers, payload });
}

async function taskRow(taskId: string) {
  return db.one<{ status: string; progress_percent: number | null; completed_at: string | null; revision: number }>(
    'SELECT status, progress_percent, completed_at, revision FROM tasks WHERE task_id = $1',
    [taskId]
  );
}

describe('reopening a completed task', () => {
  it('lets an ADMIN reopen a completed leaf task with a reason and a typed confirmation', async () => {
    await seedDone('TSK-1');
    const admin = await login('0001');
    const response = await reopen(admin, 'TSK-1', {
      idempotencyKey: 'reopen-1',
      revision: 1,
      reason: '完了操作が誤りでした',
      confirmation: 'REOPEN TSK-1'
    });
    expect(response.statusCode, response.body).toBe(200);
    const stored = await taskRow('TSK-1');
    expect(stored?.status).toBe('In Progress');
    expect(stored?.progress_percent).toBe(0);
    expect(stored?.completed_at).toBeNull();

    const audited = await db.one<{ actor_member_id: string; new_value: { reason: string } }>(
      "SELECT actor_member_id, new_value FROM audit_log WHERE action = 'TASK_REOPENED' AND entity_id = $1",
      ['TSK-1']
    );
    expect(audited?.actor_member_id).toBe('MEM-ADMIN');
    expect(audited?.new_value.reason).toBe('完了操作が誤りでした');
  });

  it('refuses a MANAGER, a MEMBER and a VIEWER', async () => {
    await seedDone('TSK-1');
    for (const [employeeId, role] of [
      ['0002', 'MANAGER'],
      ['0010', 'MEMBER'],
      ['0020', 'VIEWER']
    ] as const) {
      const headers = await login(employeeId);
      const response = await reopen(headers, 'TSK-1', {
        idempotencyKey: `reopen-${role}`,
        revision: 1,
        reason: 'Attempt',
        confirmation: 'REOPEN TSK-1'
      });
      expect(response.statusCode, `${role}: ${response.body}`).toBe(403);
      expect(response.json().error.code).toBe('AUTHORIZATION_DENIED');
    }
    expect((await taskRow('TSK-1'))?.status).toBe('Done');
  });

  it('refuses a stale revision and an open task', async () => {
    await seedDone('TSK-1');
    const admin = await login('0001');
    const stale = await reopen(admin, 'TSK-1', {
      idempotencyKey: 'reopen-stale',
      revision: 99,
      reason: 'Correction',
      confirmation: 'REOPEN TSK-1'
    });
    expect(stale.json().error.code).toBe('EDIT_CONFLICT');

    await insertTask(
      db,
      { projectId: 'PRJ-A', taskName: 'Open task', ownerMemberId: 'MEM-A', status: 'In Progress', dueDate: '2026-12-01' },
      'TSK-OPEN'
    );
    const open = await reopen(admin, 'TSK-OPEN', {
      idempotencyKey: 'reopen-open',
      revision: 1,
      reason: 'Correction',
      confirmation: 'REOPEN TSK-OPEN'
    });
    expect(open.statusCode, open.body).toBe(409);
    expect(open.json().error.code).toBe('INVALID_TRANSITION');
  });

  it('refuses a container task and a missing confirmation phrase', async () => {
    await seedDone('TSK-PARENT');
    await insertTask(
      db,
      {
        projectId: 'PRJ-A',
        parentTaskId: 'TSK-PARENT',
        taskName: 'Child',
        ownerMemberId: 'MEM-A',
        status: 'In Progress',
        dueDate: '2026-12-01'
      },
      'TSK-CHILD'
    );
    const admin = await login('0001');
    const container = await reopen(admin, 'TSK-PARENT', {
      idempotencyKey: 'reopen-container',
      revision: 1,
      reason: 'Correction',
      confirmation: 'REOPEN TSK-PARENT'
    });
    expect(container.statusCode, container.body).toBe(409);
    expect(container.json().error.code).toBe('CONTAINER_NOT_COMPLETABLE');

    await seedDone('TSK-2');
    const wrongPhrase = await reopen(admin, 'TSK-2', {
      idempotencyKey: 'reopen-phrase',
      revision: 1,
      reason: 'Correction',
      confirmation: 'REOPEN'
    });
    expect(wrongPhrase.json().error.code).toBe('CONFIRMATION_REQUIRED');
    expect((await taskRow('TSK-2'))?.status).toBe('Done');
    expect((await taskRow('TSK-PARENT'))?.status).toBe('Done');
  });

  it('replays the same idempotency key without a second audit row', async () => {
    await seedDone('TSK-1');
    const admin = await login('0001');
    const payload = {
      idempotencyKey: 'reopen-replay',
      revision: 1,
      reason: 'Correction',
      confirmation: 'REOPEN TSK-1'
    };
    expect((await reopen(admin, 'TSK-1', payload)).statusCode).toBe(200);
    const replay = await reopen(admin, 'TSK-1', payload);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().data.replayed).toBe(true);
    const audit = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE action = 'TASK_REOPENED' AND entity_id = $1",
      ['TSK-1']
    );
    expect(Number(audit?.count ?? 0)).toBe(1);
  });

  it('reopens a Completed parent project only with the explicit acknowledgement', async () => {
    await seedDone('TSK-1');
    await db.query("UPDATE projects SET status = 'Completed' WHERE project_id = 'PRJ-A'");
    const admin = await login('0001');
    const withoutAcknowledgement = await reopen(admin, 'TSK-1', {
      idempotencyKey: 'reopen-project-1',
      revision: 1,
      reason: 'Completion correction',
      confirmation: 'REOPEN TSK-1'
    });
    expect(withoutAcknowledgement.json().error.code).toBe('CONFIRMATION_REQUIRED');
    expect((await taskRow('TSK-1'))?.status).toBe('Done');

    const eligibility = await app.inject({
      method: 'GET',
      url: '/api/manager/tasks/TSK-1/reopen-eligibility',
      headers: admin
    });
    expect(eligibility.statusCode, eligibility.body).toBe(200);
    expect(eligibility.json().data.projectReopenRequired).toBe(true);

    const acknowledged = await reopen(admin, 'TSK-1', {
      idempotencyKey: 'reopen-project-2',
      revision: 1,
      reason: 'Completion correction',
      confirmation: 'REOPEN TSK-1',
      reopenProject: true
    });
    expect(acknowledged.statusCode, acknowledged.body).toBe(200);
    const project = await db.one<{ status: string }>("SELECT status FROM projects WHERE project_id = 'PRJ-A'");
    expect(project?.status).toBe('Active');
    const projectAudit = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE action = 'PROJECT_REOPENED' AND entity_id = 'PRJ-A'"
    );
    expect(Number(projectAudit?.count ?? 0)).toBe(1);
  });

  it('refuses to reactivate an archived project and keeps a Completed project untouched', async () => {
    await seedDone('TSK-1');
    await db.query("UPDATE projects SET status = 'Archived', archived_at = now() WHERE project_id = 'PRJ-A'");
    const admin = await login('0001');
    const response = await reopen(admin, 'TSK-1', {
      idempotencyKey: 'reopen-archived',
      revision: 1,
      reason: 'Correction',
      confirmation: 'REOPEN TSK-1',
      reopenProject: true
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('INVALID_TRANSITION');
    const project = await db.one<{ status: string }>("SELECT status FROM projects WHERE project_id = 'PRJ-A'");
    expect(project?.status).toBe('Archived');
    expect((await taskRow('TSK-1'))?.status).toBe('Done');
  });

  it('preserves the original approval and accepts a genuinely new completion report', async () => {
    await seedDone('TSK-1');
    await db.query(
      `INSERT INTO task_requests(request_id, request_type, task_id, project_id, requester_name, status,
                                 task_revision_at_submission, due_date_at_submission, snapshot_version,
                                 requester_member_id, decided_at, accepted_completion_at)
       VALUES('REQ-OLD','COMPLETION_REPORT','TSK-1','PRJ-A','Member A','APPROVED','1','2026-12-01','1','MEM-A', now(), now())`
    );
    const admin = await login('0001');
    const reopened = await reopen(admin, 'TSK-1', {
      idempotencyKey: 'reopen-history',
      revision: 1,
      reason: 'Correction',
      confirmation: 'REOPEN TSK-1'
    });
    expect(reopened.statusCode, reopened.body).toBe(200);
    const audited = await db.one<{ new_value: { reversedCompletionRequestId: string | null } }>(
      "SELECT new_value FROM audit_log WHERE action = 'TASK_REOPENED' AND entity_id = 'TSK-1'"
    );
    expect(audited?.new_value.reversedCompletionRequestId).toBe('REQ-OLD');
    const original = await db.one<{ status: string }>("SELECT status FROM task_requests WHERE request_id = 'REQ-OLD'");
    expect(original?.status).toBe('APPROVED');

    // The historical approval can never be applied again: it is already decided.
    const reapplied = await app.inject({
      method: 'POST',
      url: '/api/manager/requests/REQ-OLD/decide',
      headers: admin,
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect(reapplied.statusCode, reapplied.body).toBe(409);
    expect(reapplied.json().error.code).toBe('DUPLICATE_DECISION');
    expect((await taskRow('TSK-1'))?.status).toBe('In Progress');

    // A new report is a new request, and its approval completes the task again.
    const member = await login('0010');
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/employee/requests',
      headers: member,
      payload: {
        clientRequestId: 'req-new-after-reopen',
        taskId: 'TSK-1',
        requestType: 'COMPLETION_REPORT',
        completionNote: 'Finished again after reopening'
      }
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const requestId = submitted.json().data.requestId as string;
    const approved = await app.inject({
      method: 'POST',
      url: `/api/manager/requests/${requestId}/decide`,
      headers: admin,
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const stored = await taskRow('TSK-1');
    expect(stored?.status).toBe('Done');
    expect(stored?.completed_at).not.toBeNull();
  });

  it('reopens a legacy Done task that has no completion timestamp', async () => {
    await seedDone('TSK-LEGACY', { completedAt: null, progressPercent: 0 });
    const admin = await login('0001');
    const eligibility = await app.inject({
      method: 'GET',
      url: '/api/manager/tasks/TSK-LEGACY/reopen-eligibility',
      headers: admin
    });
    expect(eligibility.statusCode, eligibility.body).toBe(200);
    expect(eligibility.json().data.eligible).toBe(true);
    expect(eligibility.json().data.completedAt).toBeNull();

    const response = await reopen(admin, 'TSK-LEGACY', {
      idempotencyKey: 'reopen-legacy',
      revision: 1,
      reason: 'Legacy completion was wrong',
      confirmation: 'REOPEN TSK-LEGACY'
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((await taskRow('TSK-LEGACY'))?.status).toBe('In Progress');
  });

  it('updates the authorized open and completed figures after the correction', async () => {
    await seedDone('TSK-1');
    const admin = await login('0001');
    const before = await app.inject({ method: 'GET', url: '/api/manager/overview', headers: admin });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json().data.counts.completedWork).toBe(1);
    expect(before.json().data.counts.openWork).toBe(0);

    await reopen(admin, 'TSK-1', {
      idempotencyKey: 'reopen-counts',
      revision: 1,
      reason: 'Correction',
      confirmation: 'REOPEN TSK-1'
    });

    const after = await app.inject({ method: 'GET', url: '/api/manager/overview', headers: admin });
    expect(after.json().data.counts.completedWork).toBe(0);
    expect(after.json().data.counts.openWork).toBe(1);
  });
});
