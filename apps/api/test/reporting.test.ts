/**
 * Completion-report authorization and attribution.
 *
 * Approved policy: an authenticated MEMBER, MANAGER or ADMIN may report completion for work they
 * can already reach, whether or not they are assigned to it. The reporter is the verified session,
 * the task is never completed or reassigned by a report, and a VIEWER stays read-only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  Database,
  insertMember,
  insertProject,
  insertResponsibility,
  insertTask,
  saveSettings
} from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { freshDatabase, requireDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let config: ReturnType<typeof loadConfig>;

const ADMIN = 'admin@example.co.jp';
const MANAGER = 'manager@example.co.jp';
const MEMBER = 'member@example.co.jp';
const OTHER = 'other@example.co.jp';
const VIEWER = 'viewer@example.co.jp';
const EMAILS = [ADMIN, MANAGER, MEMBER, OTHER, VIEWER];

type Auth = { cookie: string; csrf: string };

async function signIn(email: string): Promise<Auth> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: email } });
  expect(response.statusCode, response.body).toBe(200);
  const cookie = String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const body = response.json() as { data: { csrfToken: string } };
  return { cookie, csrf: body.data.csrfToken };
}

function headers(auth: Auth, mutate = false): Record<string, string> {
  const result: Record<string, string> = { cookie: auth.cookie };
  if (mutate) {
    result['x-csrf-token'] = auth.csrf;
    result.origin = 'http://localhost:5173';
  }
  return result;
}

async function submit(auth: Auth, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/employee/requests',
    headers: headers(auth, true),
    payload
  });
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await insertMember(db, { name: 'Admin', email: ADMIN, role: 'ADMIN' }, 'MEM-ADMIN');
  await insertMember(db, { name: 'Manager', email: MANAGER, role: 'MANAGER' }, 'MEM-MANAGER');
  await insertMember(db, { name: 'Member', email: MEMBER, role: 'MEMBER' }, 'MEM-MEMBER');
  await insertMember(db, { name: 'Other member', email: OTHER, role: 'MEMBER' }, 'MEM-OTHER');
  await insertMember(db, { name: 'Viewer', email: VIEWER, role: 'VIEWER' }, 'MEM-VIEWER');
  config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'DEVELOPMENT',
    DATABASE_URL: requireDatabase(),
    MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAILS: EMAILS.join(','),
    PUBLIC_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    MAIL_FROM_ADDRESS: 'noreply@example.co.jp',
    SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: 'sheet-id'
  });
  app = await buildApp({ config, db, inbox: new NullInboxSource(), logger: false });
  await app.ready();
  await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, 'MEM-ADMIN');
});

afterEach(async () => {
  await app.close();
  await pool.end();
});

async function seedTask(
  taskId: string,
  overrides: { status?: string; ownerMemberId?: string | null; projectId?: string } = {}
): Promise<void> {
  await insertTask(
    db,
    {
      projectId: overrides.projectId ?? 'PRJ-R',
      taskName: `Task ${taskId}`,
      dueDate: '2026-12-01',
      ownerMemberId: overrides.ownerMemberId ?? 'MEM-MEMBER',
      status: overrides.status ?? 'In Progress'
    },
    taskId
  );
}

async function seedProject(projectId = 'PRJ-R', visibility = 'INTERNAL'): Promise<void> {
  await insertResponsibility(db, { name: 'Area' }, 'RSP-R');
  await insertProject(
    db,
    { projectName: `Project ${projectId}`, status: 'Active', dashboardVisibility: visibility },
    projectId
  );
}

async function eligibility(auth: Auth, taskId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/employee/tasks/${taskId}/report-eligibility`,
    headers: headers(auth)
  });
}

describe('who may file a completion report', () => {
  it('accepts a report from an assigned MEMBER and leaves the task unfinished', async () => {
    await seedProject();
    await seedTask('TSK-1');
    const member = await signIn(MEMBER);
    const response = await submit(member, {
      clientRequestId: 'report-assigned-1',
      taskId: 'TSK-1',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Checked and finished'
    });
    expect(response.statusCode, response.body).toBe(200);
    const stored = await db.one<{ requester_member_id: string; requester_name: string; status: string; request_type: string }>(
      'SELECT requester_member_id, requester_name, status, request_type FROM task_requests WHERE task_id = $1',
      ['TSK-1']
    );
    expect(stored).toMatchObject({
      requester_member_id: 'MEM-MEMBER',
      requester_name: 'Member',
      status: 'PENDING',
      request_type: 'COMPLETION_REPORT'
    });
    // A report is not a completion.
    const task = await db.one<{ status: string; revision: number; owner_member_id: string }>(
      'SELECT status, revision, owner_member_id FROM tasks WHERE task_id = $1',
      ['TSK-1']
    );
    expect(task?.status).toBe('In Progress');
    expect(task?.revision).toBe(1);
    expect(task?.owner_member_id).toBe('MEM-MEMBER');
  });

  it('accepts a report from a MEMBER who is not an assignee, without changing the owner', async () => {
    await seedProject();
    await seedTask('TSK-2');
    const other = await signIn(OTHER);
    const response = await submit(other, {
      clientRequestId: 'report-other-member-1',
      taskId: 'TSK-2',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Observed the final check'
    });
    expect(response.statusCode, response.body).toBe(200);
    const request = await db.one<{ requester_member_id: string; requester_name: string }>(
      'SELECT requester_member_id, requester_name FROM task_requests WHERE task_id = $1',
      ['TSK-2']
    );
    // The reporter and the assignee remain two distinct facts.
    expect(request?.requester_member_id).toBe('MEM-OTHER');
    expect(request?.requester_name).toBe('Other member');
    const task = await db.one<{ owner_member_id: string; status: string }>(
      'SELECT owner_member_id, status FROM tasks WHERE task_id = $1',
      ['TSK-2']
    );
    expect(task?.owner_member_id).toBe('MEM-MEMBER');
    expect(task?.status).toBe('In Progress');
  });

  it('accepts a report from a MANAGER and from an ADMIN', async () => {
    await seedProject();
    await seedTask('TSK-3');
    await seedTask('TSK-4');
    const manager = await signIn(MANAGER);
    const admin = await signIn(ADMIN);
    expect(
      (await submit(manager, {
        clientRequestId: 'report-manager-1',
        taskId: 'TSK-3',
        requestType: 'COMPLETION_REPORT',
        completionNote: 'Manager verified'
      })).statusCode
    ).toBe(200);
    expect(
      (await submit(admin, {
        clientRequestId: 'report-admin-1',
        taskId: 'TSK-4',
        requestType: 'COMPLETION_REPORT',
        completionNote: 'Admin verified'
      })).statusCode
    ).toBe(200);
    const reporters = await db.many<{ requester_member_id: string }>(
      "SELECT requester_member_id FROM task_requests WHERE request_type = 'COMPLETION_REPORT' ORDER BY task_id"
    );
    expect(reporters.map((row) => row.requester_member_id)).toEqual(['MEM-MANAGER', 'MEM-ADMIN']);
  });

  it('refuses a VIEWER', async () => {
    await seedProject();
    await seedTask('TSK-5');
    const viewer = await signIn(VIEWER);
    const response = await submit(viewer, {
      clientRequestId: 'report-viewer-1',
      taskId: 'TSK-5',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Read only'
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('AUTHORIZATION_DENIED');
    const count = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM task_requests');
    expect(count?.count).toBe('0');
  });

  it('refuses work in a restricted project the reporter cannot reach', async () => {
    await seedProject('PRJ-PRIVATE', 'RESTRICTED');
    await seedTask('TSK-6', { projectId: 'PRJ-PRIVATE', ownerMemberId: 'MEM-MANAGER' });
    const other = await signIn(OTHER);
    const response = await submit(other, {
      clientRequestId: 'report-restricted-1',
      taskId: 'TSK-6',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Should not be possible'
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
    // The eligibility read refuses the same way, so nothing confirms the record exists.
    expect((await eligibility(other, 'TSK-6')).statusCode).toBe(404);
    // The assignee still reports their own restricted work.
    await db.query("UPDATE tasks SET owner_member_id = 'MEM-OTHER' WHERE task_id = 'TSK-6'");
    expect(
      (await submit(other, {
        clientRequestId: 'report-restricted-2',
        taskId: 'TSK-6',
        requestType: 'COMPLETION_REPORT',
        completionNote: 'My own restricted work'
      })).statusCode
    ).toBe(200);
  });

  it('ignores a browser-supplied reporter name and rejects a supplied identity at the boundary', async () => {
    await seedProject();
    await seedTask('TSK-7');
    const other = await signIn(OTHER);
    const response = await submit(other, {
      clientRequestId: 'report-spoof-1',
      taskId: 'TSK-7',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Verified reporter only',
      requesterName: 'Pretend Manager'
    });
    expect(response.statusCode, response.body).toBe(200);
    const request = await db.one<{ requester_member_id: string; requester_name: string }>(
      'SELECT requester_member_id, requester_name FROM task_requests WHERE task_id = $1',
      ['TSK-7']
    );
    expect(request).toEqual({ requester_member_id: 'MEM-OTHER', requester_name: 'Other member' });
    const task = await db.one<{ owner_member_id: string }>('SELECT owner_member_id FROM tasks WHERE task_id = $1', ['TSK-7']);
    expect(task?.owner_member_id).toBe('MEM-MEMBER');

    // A member, role or owner in the payload is not data the endpoint accepts at all.
    const rejected = await submit(other, {
      clientRequestId: 'report-spoof-2',
      taskId: 'TSK-7',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Identity fields',
      requesterMemberId: 'MEM-MANAGER',
      reporterRole: 'ADMIN',
      ownerMemberId: 'MEM-OTHER'
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('records the actual reporter and the assignment in the audit trail', async () => {
    await seedProject();
    await seedTask('TSK-8');
    const other = await signIn(OTHER);
    await submit(other, {
      clientRequestId: 'report-audit-1',
      taskId: 'TSK-8',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Audited'
    });
    const entry = await db.one<{ actor_member_id: string; new_value: Record<string, unknown> }>(
      "SELECT actor_member_id, new_value FROM audit_log WHERE action = 'REQUEST_SUBMITTED' ORDER BY occurred_at DESC LIMIT 1"
    );
    expect(entry?.actor_member_id).toBe('MEM-OTHER');
    expect(entry?.new_value).toMatchObject({
      taskId: 'TSK-8',
      requesterMemberId: 'MEM-OTHER',
      reporterRole: 'MEMBER',
      reporterIsAssignee: false,
      taskOwnerMemberId: 'MEM-MEMBER'
    });
  });
});

describe('deadline-change authority is unchanged', () => {
  it('still requires the assigned MEMBER and refuses a manager', async () => {
    await seedProject();
    await seedTask('TSK-D1');
    const other = await signIn(OTHER);
    const notAssigned = await submit(other, {
      clientRequestId: 'deadline-other-1',
      taskId: 'TSK-D1',
      requestType: 'DEADLINE_CHANGE',
      requestedDueDate: '2026-12-20',
      reason: 'Please move'
    });
    expect(notAssigned.statusCode).toBe(403);
    expect(notAssigned.json().error.code).toBe('AUTHORIZATION_DENIED');

    const manager = await signIn(MANAGER);
    const byManager = await submit(manager, {
      clientRequestId: 'deadline-manager-1',
      taskId: 'TSK-D1',
      requestType: 'DEADLINE_CHANGE',
      requestedDueDate: '2026-12-21',
      reason: 'Manager cannot request'
    });
    expect(byManager.statusCode).toBe(403);

    const member = await signIn(MEMBER);
    const assigned = await submit(member, {
      clientRequestId: 'deadline-member-1',
      taskId: 'TSK-D1',
      requestType: 'DEADLINE_CHANGE',
      requestedDueDate: '2026-12-22',
      reason: 'Real constraint'
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
  });
});

describe('existing reportability rules survive the exception', () => {
  it('refuses a container, a completed and a cancelled task', async () => {
    await seedProject();
    await seedTask('TSK-C1');
    await insertTask(db, { projectId: 'PRJ-R', parentTaskId: 'TSK-C1', taskName: 'Child', dueDate: '2026-12-01' }, 'TSK-C1-CHILD');
    await seedTask('TSK-C2', { status: 'Done' });
    await seedTask('TSK-C3', { status: 'Cancelled' });
    const other = await signIn(OTHER);
    const container = await submit(other, {
      clientRequestId: 'container-report-1',
      taskId: 'TSK-C1',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Container'
    });
    expect(container.statusCode).toBe(409);
    expect(container.json().error.code).toBe('CONTAINER_NOT_COMPLETABLE');
    const done = await submit(other, {
      clientRequestId: 'done-report-1',
      taskId: 'TSK-C2',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Already done'
    });
    expect(done.statusCode).toBe(409);
    const cancelled = await submit(other, {
      clientRequestId: 'cancelled-report-1',
      taskId: 'TSK-C3',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Cancelled'
    });
    expect(cancelled.statusCode).toBe(409);
    expect((await db.one<{ count: string }>('SELECT count(*)::text AS count FROM task_requests'))?.count).toBe('0');
  });

  it('refuses while the submission switch is off, and says so in the capability read', async () => {
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'false' }, 'MEM-ADMIN');
    await seedProject();
    await seedTask('TSK-S1');
    const other = await signIn(OTHER);
    const response = await submit(other, {
      clientRequestId: 'closed-report-1',
      taskId: 'TSK-S1',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Closed'
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('REQUEST_SUBMISSION_CLOSED');
    const capability = await eligibility(other, 'TSK-S1');
    expect(capability.statusCode).toBe(200);
    expect(capability.json().data).toMatchObject({
      eligible: false,
      submissionEnabled: false,
      reporterName: 'Other member'
    });
    expect(capability.json().data.reasons).toContain('SUBMISSION_DISABLED');
  });
});

describe('the reported capability', () => {
  it('lists every refusal and keeps a pending report visible regardless of history paging', async () => {
    await seedProject();
    await seedTask('TSK-E1');
    await seedTask('TSK-E2', { status: 'Done' });
    const other = await signIn(OTHER);
    expect((await eligibility(other, 'TSK-E1')).json().data).toMatchObject({ eligible: true, reasons: [] });
    expect((await eligibility(other, 'TSK-E2')).json().data.reasons).toContain('COMPLETED');

    // A different task keeps a long history; the pending state of TSK-E1 is not derived from it.
    await db.query(`INSERT INTO task_requests (request_id, request_type, task_id, status)
      SELECT 'REQ-HIST-' || lpad(n::text, 4, '0'), 'COMPLETION_REPORT', 'TSK-E2', 'APPROVED' FROM generate_series(1, 120) n`);
    expect(
      (await submit(other, {
        clientRequestId: 'pending-visible-1',
        taskId: 'TSK-E1',
        requestType: 'COMPLETION_REPORT',
        completionNote: 'First report'
      })).statusCode
    ).toBe(200);
    const capability = await eligibility(other, 'TSK-E1');
    expect(capability.json().data).toMatchObject({ eligible: false });
    expect(capability.json().data.reasons).toContain('PENDING');
    // A second report while one is open is refused instead of creating a duplicate.
    const duplicate = await submit(other, {
      clientRequestId: 'pending-visible-2',
      taskId: 'TSK-E1',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Second report'
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('INVALID_TRANSITION');
  });

  it('refuses a VIEWER capability and an unknown or foreign task', async () => {
    await seedProject();
    await seedTask('TSK-E3');
    const viewer = await signIn(VIEWER);
    const capability = await eligibility(viewer, 'TSK-E3');
    expect(capability.statusCode).toBe(200);
    expect(capability.json().data).toMatchObject({ eligible: false });
    expect(capability.json().data.reasons).toEqual(['ROLE']);
    expect((await eligibility(viewer, 'TSK-UNKNOWN')).statusCode).toBe(404);
  });
});

describe('idempotency and approval separation', () => {
  it('replays one receipt for one key and refuses a foreign replay', async () => {
    await seedProject();
    await seedTask('TSK-I1');
    const other = await signIn(OTHER);
    const payload = {
      clientRequestId: 'idempotent-report-1',
      taskId: 'TSK-I1',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Once only'
    };
    const first = await submit(other, payload);
    const second = await submit(other, payload);
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().data.requestId).toBe(first.json().data.requestId);
    expect((await db.one<{ count: string }>('SELECT count(*)::text AS count FROM task_requests'))?.count).toBe('1');

    const member = await signIn(MEMBER);
    const foreign = await submit(member, payload);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain(first.json().data.requestId);
  });

  it('keeps approval a separate authorization decision', async () => {
    await seedProject();
    await seedTask('TSK-A1');
    const other = await signIn(OTHER);
    const submitted = await submit(other, {
      clientRequestId: 'approval-report-1',
      taskId: 'TSK-A1',
      requestType: 'COMPLETION_REPORT',
      completionNote: 'Ready for review'
    });
    const requestId = (submitted.json() as { data: { requestId: string } }).data.requestId;

    // The reporter cannot approve their own report.
    const selfApproval = await app.inject({
      method: 'POST',
      url: `/api/manager/requests/${requestId}/decide`,
      headers: headers(other, true),
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect(selfApproval.statusCode).toBe(403);

    const manager = await signIn(MANAGER);
    const approved = await app.inject({
      method: 'POST',
      url: `/api/manager/requests/${requestId}/decide`,
      headers: headers(manager, true),
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const task = await db.one<{ status: string; owner_member_id: string }>(
      'SELECT status, owner_member_id FROM tasks WHERE task_id = $1',
      ['TSK-A1']
    );
    expect(task?.status).toBe('Done');
    // Approval completes the task; it never transfers ownership to the reporter.
    expect(task?.owner_member_id).toBe('MEM-MEMBER');
    const decided = await db.one<{ reviewer: string; status: string }>(
      'SELECT reviewer, status FROM task_requests WHERE request_id = $1',
      [requestId]
    );
    expect(decided?.status).toBe('APPROVED');
    expect(decided?.reviewer).toBe(MANAGER);
  });
});
