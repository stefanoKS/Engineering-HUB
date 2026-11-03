/**
 * API integration tests against a real PostgreSQL instance.
 *
 * These cover the properties that cannot be proven by a mock: server-side authorization, CSRF,
 * revision conflicts, idempotent creation, the request decision transaction and the closed
 * submission gate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertMember, insertProject, insertResponsibility, insertSubproject, insertTask, saveSettings } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { businessDate } from '@eh/domain';
import { freshDatabase, requireDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let config: ReturnType<typeof loadConfig>;

const ADMIN = 'admin@example.co.jp';
const MANAGER = 'manager@example.co.jp';
const MEMBER = 'member@example.co.jp';

async function signIn(email: string): Promise<{ cookie: string; csrf: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { devEmail: email }
  });
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const body = response.json() as { data: { csrfToken: string } };
  return { cookie, csrf: body.data.csrfToken };
}

function headers(auth: { cookie: string; csrf: string }, mutate = false): Record<string, string> {
  const result: Record<string, string> = { cookie: auth.cookie };
  if (mutate) {
    result['x-csrf-token'] = auth.csrf;
    result.origin = 'http://localhost:5173';
  }
  return result;
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await insertMember(db, { name: 'Admin', email: ADMIN, role: 'ADMIN' }, 'MEM-ADMIN');
  await insertMember(db, { name: 'Manager', email: MANAGER, role: 'MANAGER' }, 'MEM-MANAGER');
  await insertMember(db, { name: 'Member', email: MEMBER, role: 'MEMBER' }, 'MEM-MEMBER');
  config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'DEVELOPMENT',
    DATABASE_URL: requireDatabase(),
    MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAILS: [ADMIN, MANAGER, MEMBER, 'other@example.co.jp', 'viewer@example.co.jp'].join(','),
    PUBLIC_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    MAIL_FROM_ADDRESS: 'noreply@example.co.jp',
    SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: 'sheet-id'
  });
  app = await buildApp({ config, db, inbox: new NullInboxSource(), logger: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await pool.end();
});

describe('concurrent administrator changes', () => {
  it('keeps an administrator when two authenticated administrators demote each other', async () => {
    await insertMember(db, { name: 'Second admin', email: 'second-admin@example.co.jp', role: 'ADMIN' }, 'MEM-ADMIN2');
    const { saveMember } = await import('../src/services/directory');
    const identity = (id: string) => ({ memberId: id, name: 'Admin', email: ADMIN, role: 'ADMIN' as const, active: true, verified: true });
    const ctx = (id: string) => ({ db, identity: identity(id), correlationId: 'race' });
    const results = await Promise.allSettled([
      saveMember(ctx('MEM-ADMIN'), { memberId: 'MEM-ADMIN2', revision: 1, role: 'MEMBER' }),
      saveMember(ctx('MEM-ADMIN2'), { memberId: 'MEM-ADMIN', revision: 1, role: 'MEMBER' })
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const remaining = await db.one<{ count: string }>("SELECT count(*)::text AS count FROM members WHERE role = 'ADMIN' AND active");
    expect(remaining?.count).toBe('1');
  });
});

describe('request queue pagination', () => {
  it('reaches requests past the old 500-row cutoff and validates paging inputs', async () => {
    await insertProject(db, { projectName: 'Queue' }, 'PRJ-QUEUE');
    await insertTask(db, { projectId: 'PRJ-QUEUE', taskName: 'Queue task', dueDate: '2026-11-05' }, 'TSK-QUEUE');
    await db.query(`INSERT INTO task_requests (request_id, request_type, task_id, status)
      SELECT 'REQ-' || lpad(n::text, 4, '0'), 'COMPLETION_REPORT', 'TSK-QUEUE', 'PENDING' FROM generate_series(1, 501) n`);
    const auth = await signIn(MANAGER);
    const response = await app.inject({ method: 'GET', url: '/api/manager/requests?page=6&pageSize=100&includeDecided=false', headers: headers(auth) });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ total: 501, page: 6, totalPages: 6 });
    expect(response.json().data.items).toHaveLength(1);
    const invalid = await app.inject({ method: 'GET', url: '/api/manager/requests?page=-1', headers: headers(auth) });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('session and CSRF', () => {
  it('refuses an unauthenticated read', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/manager/bootstrap' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a mutation without the CSRF header and a foreign origin', async () => {
    const auth = await signIn(MANAGER);
    const withoutCsrf = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: { cookie: auth.cookie },
      payload: { idempotencyKey: 'key-00000001', projectName: 'X', responsibilityId: 'R1' }
    });
    expect(withoutCsrf.statusCode).toBe(403);

    const foreignOrigin = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf, origin: 'https://evil.example' },
      payload: { idempotencyKey: 'key-00000002', projectName: 'X', responsibilityId: 'R1' }
    });
    expect(foreignOrigin.statusCode).toBe(403);
    expect(foreignOrigin.json().error.code).toBe('AUTHORIZATION_DENIED');
  });

  it('refuses the development fixture for an address outside the allowlist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { devEmail: 'outsider@example.co.jp' }
    });
    expect(response.statusCode).toBe(401);
  });

  it('reports the session without exposing the cookie', async () => {
    const auth = await signIn(MANAGER);
    const response = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: auth.cookie } });
    const body = response.json() as { data: { actor: { role: string } } };
    expect(body.data.actor.role).toBe('MANAGER');
    expect(JSON.stringify(body)).not.toContain(auth.cookie);
  });

  it('serves only public runtime configuration before sign-in', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/public-config' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json() as {
      data: { appVersion: string; devSignInEnabled: boolean; googleClientId: string; authConfigured: boolean };
    };
    expect(body.data.appVersion).toBeTruthy();
    // The development fixture is available in this deployment, and no secret is exposed.
    expect(body.data.devSignInEnabled).toBe(true);
    expect(body.data.authConfigured).toBe(false);
    const text = response.body;
    expect(text).not.toMatch(/database|password|serviceAccount|private_key/i);
  });

  it('binds a member to the verified subject and refuses a different one', async () => {
    await signIn(ADMIN);
    const bound = await db.one<{ google_subject: string }>(
      'SELECT google_subject FROM members WHERE email = $1',
      [ADMIN]
    );
    expect(bound?.google_subject).toBe(`dev:${ADMIN}`);
    const audit = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE action = 'IDENTITY_LINKED' AND entity_id = 'MEM-ADMIN'"
    );
    expect(Number(audit?.count)).toBe(1);

    await db.query("UPDATE members SET google_subject = 'different-google-subject' WHERE email = $1", [ADMIN]);
    const refused = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: ADMIN } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('AUTHORIZATION_DENIED');
  });
});

describe('authorization and privacy boundaries', () => {
  it('refuses a manager endpoint for a MEMBER', async () => {
    const auth = await signIn(MEMBER);
    const response = await app.inject({
      method: 'GET',
      url: '/api/manager/projects',
      headers: headers(auth)
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('AUTHORIZATION_DENIED');
  });

  it('rejects a browser-supplied role or actor field', async () => {
    const auth = await signIn(MANAGER);
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: headers(auth, true),
      payload: {
        idempotencyKey: 'key-spoof-0001',
        projectName: 'Spoof',
        responsibilityId: 'R1',
        role: 'ADMIN'
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('allows a VIEWER to read the published employee snapshot only', async () => {
    await insertMember(db, { name: 'Viewer', email: 'viewer@example.co.jp', role: 'VIEWER' }, 'MEM-VIEWER');
    config = loadConfig({ ...configToEnv(config), DEV_AUTH_EMAILS: [ADMIN, MANAGER, MEMBER, 'viewer@example.co.jp'].join(',') });
    await app.close();
    app = await buildApp({ config, db, inbox: new NullInboxSource(), logger: false });
    await app.ready();
    const auth = await signIn('viewer@example.co.jp');
    const employee = await app.inject({ method: 'GET', url: '/api/employee/snapshot', headers: headers(auth) });
    expect(employee.statusCode).toBe(200);
    const manager = await app.inject({ method: 'GET', url: '/api/manager/bootstrap', headers: headers(auth) });
    expect(manager.statusCode).toBe(403);
  });
});

describe('project commands', () => {
  it('creates a project once per idempotency key and refuses a stale edit', async () => {
    const auth = await signIn(MANAGER);
    await insertResponsibility(db, { name: 'Area' }, 'RSP-1');
    const payload = {
      idempotencyKey: 'project-create-1',
      projectName: 'Pump',
      responsibilityId: 'RSP-1'
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: headers(auth, true),
      payload
    });
    expect(first.statusCode).toBe(200);
    const created = (first.json() as { data: { project: { projectId: string; revision: number; dashboardVisibility: string } } }).data.project;
    expect(created.dashboardVisibility).toBe('RESTRICTED');

    const replay = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: headers(auth, true),
      payload
    });
    expect((replay.json() as { data: { project: { projectId: string } } }).data.project.projectId).toBe(created.projectId);
    const rows = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM projects');
    expect(Number(rows?.count)).toBe(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/manager/projects/${created.projectId}`,
      headers: headers(auth, true),
      payload: { revision: created.revision, nextAction: 'Next' }
    });
    expect(patch.statusCode).toBe(200);

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/manager/projects/${created.projectId}`,
      headers: headers(auth, true),
      payload: { revision: created.revision, nextAction: 'Stale' }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('EDIT_CONFLICT');
  });

  it('refuses a project without an active responsibility', async () => {
    const auth = await signIn(MANAGER);
    await insertResponsibility(db, { name: 'Old', status: 'Retired' }, 'RSP-OLD');
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: headers(auth, true),
      payload: { idempotencyKey: 'project-create-2', projectName: 'Pump', responsibilityId: 'RSP-OLD' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('RESPONSIBILITY_REQUIRED');
  });

  it('refuses a deadline change without explicit confirmation', async () => {
    const auth = await signIn(MANAGER);
    const project = await insertProject(db, { projectName: 'P', committedDeadline: '2026-03-01' }, 'PRJ-1');
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/manager/projects/${project.projectId}`,
      headers: headers(auth, true),
      payload: { revision: project.revision, committedDeadline: '2026-04-01' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('CONFIRMATION_REQUIRED');
  });
});

describe('employee request flow', () => {
  async function publishedTask() {
    const responsibility = await insertResponsibility(db, { name: 'Area' }, 'RSP-1');
    const project = await insertProject(
      db,
      { projectName: 'P', responsibilityId: responsibility.responsibilityId, dashboardVisibility: 'INTERNAL' },
      'PRJ-1'
    );
    const task = await insertTask(
      db,
      { projectId: project.projectId, taskName: 'Task', dueDate: '2026-02-01', ownerMemberId: 'MEM-MEMBER' },
      'T1'
    );
    return { project, task };
  }

  it('fails closed while submission is disabled', async () => {
    const { task } = await publishedTask();
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'false' }, ADMIN);
    const auth = await signIn(MEMBER);
    const response = await app.inject({
      method: 'POST',
      url: '/api/employee/requests',
      headers: headers(auth, true),
      payload: {
        clientRequestId: 'client-request-1',
        taskId: task.taskId,
        requestType: 'DEADLINE_CHANGE',
        requestedDueDate: '2026-02-10'
      }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('REQUEST_SUBMISSION_CLOSED');
  });

  it('accepts a request once and reports a duplicate idempotently', async () => {
    const { task } = await publishedTask();
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, ADMIN);
    const auth = await signIn(MEMBER);
    const payload = {
      clientRequestId: 'client-request-2',
      taskId: task.taskId,
      requestType: 'DEADLINE_CHANGE',
      requestedDueDate: '2026-02-10',
      reason: 'Delay'
    };
    const first = await app.inject({ method: 'POST', url: '/api/employee/requests', headers: headers(auth, true), payload });
    expect(first.statusCode, first.body).toBe(200);
    const firstBody = first.json() as { data: { state: string; requestId: string } };
    expect(firstBody.data.state).toBe('RECEIVED');
    const second = await app.inject({ method: 'POST', url: '/api/employee/requests', headers: headers(auth, true), payload });
    const secondBody = second.json() as { data: { state: string; requestId: string } };
    // A retry with the same client request ID replays the durable receipt, never a new request.
    expect(secondBody.data.state).toBe('RECEIVED');
    expect(secondBody.data.requestId).toBe(firstBody.data.requestId);
    const rows = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM task_requests');
    expect(Number(rows?.count)).toBe(1);
  });

  it('refuses a completion report for a container task', async () => {
    const { project, task } = await publishedTask();
    await insertTask(db, { projectId: project.projectId, parentTaskId: task.taskId, taskName: 'Child', dueDate: '2026-02-01' }, 'T2');
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, ADMIN);
    const auth = await signIn(MEMBER);
    const response = await app.inject({
      method: 'POST',
      url: '/api/employee/requests',
      headers: headers(auth, true),
      payload: {
        clientRequestId: 'client-request-3',
        taskId: task.taskId,
        requestType: 'COMPLETION_REPORT',
        completionNote: 'done'
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONTAINER_NOT_COMPLETABLE');
  });

  it('applies an approved deadline change once with history and audit', async () => {
    const { task } = await publishedTask();
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, ADMIN);
    const memberAuth = await signIn(MEMBER);
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/employee/requests',
      headers: headers(memberAuth, true),
      payload: {
        clientRequestId: 'client-request-4',
        taskId: task.taskId,
        requestType: 'DEADLINE_CHANGE',
        requestedDueDate: '2026-02-10',
        reason: 'Delay'
      }
    });
    const requestId = (submitted.json() as { data: { requestId: string } }).data.requestId;

    const managerAuth = await signIn(MANAGER);
    const queue = await app.inject({
      method: 'GET',
      url: '/api/manager/requests',
      headers: headers(managerAuth)
    });
    const queued = (queue.json() as { data: { items: { requestId: string; revision: number }[] } }).data.items.find(
      (item) => item.requestId === requestId
    );
    expect(queued?.revision).toBe(1);

    const decision = await app.inject({
      method: 'POST',
      url: `/api/manager/requests/${requestId}/decide`,
      headers: headers(managerAuth, true),
      payload: { decision: 'APPROVE', revision: 1, confirmed: true, note: 'ok' }
    });
    expect(decision.statusCode).toBe(200);
    const result = decision.json() as { data: { applied: boolean; dueDate: string } };
    expect(result.data.applied).toBe(true);
    expect(result.data.dueDate).toBe('2026-02-10');

    const stored = await db.one<{ status: string; reviewer: string }>(
      'SELECT status, reviewer FROM task_requests WHERE request_id = $1',
      [requestId]
    );
    expect(stored?.status).toBe('APPROVED');
    expect(stored?.reviewer).toBe(MANAGER);
    const history = await db.one<{ count: string }>(
      'SELECT count(*)::text AS count FROM task_deadline_history WHERE task_id = $1',
      [task.taskId]
    );
    expect(Number(history?.count)).toBe(1);
    const audit = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE action = 'TASK_DEADLINE_CHANGED'"
    );
    expect(Number(audit?.count)).toBe(1);

    const repeat = await app.inject({
      method: 'POST',
      url: `/api/manager/requests/${requestId}/decide`,
      headers: headers(managerAuth, true),
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect(repeat.statusCode).toBe(409);
    const due = await db.one<{ due_date: string }>('SELECT due_date FROM tasks WHERE task_id = $1', [task.taskId]);
    expect(due?.due_date).toBe('2026-02-10');
  });

  it('marks a request STALE instead of overwriting a newer deadline', async () => {
    const { task } = await publishedTask();
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, ADMIN);
    const memberAuth = await signIn(MEMBER);
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/employee/requests',
      headers: headers(memberAuth, true),
      payload: {
        clientRequestId: 'client-request-5',
        taskId: task.taskId,
        requestType: 'DEADLINE_CHANGE',
        requestedDueDate: '2026-02-10'
      }
    });
    const requestId = (submitted.json() as { data: { requestId: string } }).data.requestId;
    // A manager edit changes the deadline after submission.
    await db.query("UPDATE tasks SET due_date = '2026-02-20', revision = revision + 1 WHERE task_id = $1", [task.taskId]);
    const managerAuth = await signIn(MANAGER);
    const decision = await app.inject({
      method: 'POST',
      url: `/api/manager/requests/${requestId}/decide`,
      headers: headers(managerAuth, true),
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect(decision.statusCode).toBe(200);
    const result = decision.json() as { data: { stale: boolean; applied: boolean } };
    expect(result.data.stale).toBe(true);
    expect(result.data.applied).toBe(false);
    const due = await db.one<{ due_date: string }>('SELECT due_date FROM tasks WHERE task_id = $1', [task.taskId]);
    expect(due?.due_date).toBe('2026-02-20');
  });
});

describe('publication gate', () => {
  it('refuses publication while it is disabled', async () => {
    const auth = await signIn(ADMIN);
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/publication/publish',
      headers: headers(auth, true),
      payload: { confirmed: true }
    });
    expect(response.statusCode).not.toBe(200);
  });

  it('publishes only INTERNAL projects and keeps the previous slot on refusal', async () => {
    const responsibility = await insertResponsibility(db, { name: 'Area' }, 'RSP-1');
    const internal = await insertProject(
      db,
      { projectName: 'Internal', responsibilityId: responsibility.responsibilityId, dashboardVisibility: 'INTERNAL' },
      'PRJ-I'
    );
    await insertProject(
      db,
      { projectName: 'Restricted', responsibilityId: responsibility.responsibilityId, dashboardVisibility: 'RESTRICTED' },
      'PRJ-R'
    );
    await insertTask(db, { projectId: internal.projectId, taskName: 'Published', dueDate: '2026-03-01' }, 'T1');
    await saveSettings(db, { SHARED_DASHBOARD_PUBLISH_ENABLED: 'true' }, ADMIN);
    const auth = await signIn(ADMIN);
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/publication/publish',
      headers: headers(auth, true),
      payload: { confirmed: true }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { rows: number; slot: string } };
    expect(body.data.rows).toBe(1);
    const slot = await db.one<{ rows: unknown[] }>('SELECT rows FROM published_snapshots WHERE slot = $1', [
      body.data.slot
    ]);
    expect(slot?.rows.length).toBe(1);
    const employee = await app.inject({
      method: 'GET',
      url: '/api/employee/snapshot',
      headers: headers(await signIn(MEMBER))
    });
    expect((employee.json() as { data: { tasks: unknown[] } }).data.tasks.length).toBe(1);
  });

  it('requires the typed confirmation to enable publication', async () => {
    const auth = await signIn(ADMIN);
    const automation = await app.inject({ method: 'GET', url: '/api/manager/automation', headers: headers(auth) });
    const revision = (automation.json() as { data: { revision: string } }).data.revision;
    const response = await app.inject({
      method: 'PUT',
      url: '/api/manager/automation',
      headers: headers(auth, true),
      payload: { revision, changes: { SHARED_DASHBOARD_PUBLISH_ENABLED: 'true' }, confirmed: true }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('CONFIRMATION_REQUIRED');
  });
});

describe('subproject hierarchy over HTTP', () => {
  it('refuses a cross-project parent', async () => {
    const auth = await signIn(MANAGER);
    const one = await insertProject(db, { projectName: 'One' }, 'PRJ-1');
    const two = await insertProject(db, { projectName: 'Two' }, 'PRJ-2');
    await insertSubproject(db, { projectId: one.projectId, subprojectName: 'S1' }, 'SUB-1');
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/subprojects',
      headers: headers(auth, true),
      payload: {
        idempotencyKey: 'sub-create-1',
        projectId: two.projectId,
        parentSubprojectId: 'SUB-1',
        subprojectName: 'S2'
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('HIERARCHY_INVALID');
  });
});

function configToEnv(value: ReturnType<typeof loadConfig>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: value.nodeEnv,
    APP_ENV: value.appEnv,
    DATABASE_URL: requireDatabase(),
    MANAGER_WEB_ALLOWED_DOMAINS: value.allowedDomains.join(','),
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAILS: value.devAuthEmails.join(','),
    PUBLIC_ORIGIN: value.publicOrigin,
    LOG_LEVEL: 'silent',
    MAIL_FROM_ADDRESS: 'noreply@example.co.jp',
    SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: 'sheet-id'
  };
}


describe('workload effort', () => {
  it('subtracts actual effort and counts an owner also listed as assignee only once', async () => {
    await db.query("INSERT INTO projects (project_id, project_name) VALUES ('PRJ-W', 'Workload')");
    await db.query(
      "INSERT INTO tasks (task_id, project_id, task_name, owner_member_id, due_date, estimated_hours, actual_hours) VALUES ('TSK-W', 'PRJ-W', 'Work', 'MEM-MEMBER', $1, 10, 3)",
      [businessDate()]
    );
    await db.query("INSERT INTO task_assignees (assignment_id, task_id, member_id) VALUES ('ASG-W', 'TSK-W', 'MEM-MEMBER')");
    const auth = await signIn(MANAGER);
    const result = await app.inject({ method: 'GET', url: '/api/manager/reports/workload', headers: headers(auth) });
    expect(result.statusCode).toBe(200);
    const data = result.json().data;
    const row = data.rows.find((entry: { memberId: string; weekStart: string }) => entry.memberId === 'MEM-MEMBER' && entry.weekStart === data.weeks[0]);
    expect(row.remainingHours).toBe(7);
    expect(row.actualHours).toBe(3);
  });
});

describe('member self-service task creation', () => {
  async function activeProject() {
    const responsibility = await insertResponsibility(db, { name: 'Area' }, 'RSP-M');
    const project = await insertProject(
      db,
      { projectName: 'Member project', responsibilityId: responsibility.responsibilityId, status: 'Active' },
      'PRJ-M'
    );
    await insertSubproject(db, { projectId: project.projectId, subprojectName: 'Phase 1' }, 'SUB-M');
    return project;
  }

  const body = (overrides: Record<string, unknown> = {}) => ({
    idempotencyKey: 'member-create-0001',
    projectId: 'PRJ-M',
    taskName: '�����̍��',
    deadline: '2026-05-01',
    priority: 'High',
    ...overrides
  });

  it('lists only active projects and their non-archived subprojects', async () => {
    const project = await activeProject();
    await insertProject(db, { projectName: 'Planned only', status: 'Planned' }, 'PRJ-PLANNED');
    await insertSubproject(db, { projectId: project.projectId, subprojectName: 'Closed phase', status: 'Archived' }, 'SUB-ARCHIVED');
    const member = await signIn(MEMBER);
    const response = await app.inject({ method: 'GET', url: '/api/employee/my-work/projects', headers: headers(member) });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as {
      data: { items: { projectId: string; subprojects: { subprojectId: string }[] }[] };
    };
    expect(body.data.items.map((entry) => entry.projectId)).toEqual(['PRJ-M']);
    expect(body.data.items[0]!.subprojects.map((entry) => entry.subprojectId)).toEqual(['SUB-M']);
  });

  it('creates a task owned by the verified member, visible immediately', async () => {
    await activeProject();
    const auth = await signIn(MEMBER);
    const response = await app.inject({ method: 'POST', url: '/api/employee/my-work', headers: headers(auth, true), payload: body() });
    expect(response.statusCode, response.body).toBe(200);
    const taskId = (response.json() as { data: { taskId: string } }).data.taskId;

    const stored = await db.one<{ owner_member_id: string; status: string; progress_percent: number; creation_channel: string }>(
      'SELECT owner_member_id, status, progress_percent, creation_channel FROM tasks WHERE task_id = $1',
      [taskId]
    );
    expect(stored).toMatchObject({ owner_member_id: 'MEM-MEMBER', status: 'Not Started', creation_channel: 'MEMBER' });
    expect(Number(stored?.progress_percent)).toBe(0);

    const mine = await app.inject({ method: 'GET', url: '/api/employee/my-work', headers: headers(auth) });
    expect((mine.json() as { data: { items: { taskId: string }[] } }).data.items.map((item) => item.taskId)).toContain(taskId);

    const manager = await signIn(MANAGER);
    const list = await app.inject({ method: 'GET', url: '/api/manager/tasks?page=1&pageSize=50', headers: headers(manager) });
    expect((list.json() as { data: { items: { taskId: string }[] } }).data.items.map((item) => item.taskId)).toContain(taskId);

    const audit = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE action = 'TASK_CREATED' AND entity_id = $1",
      [taskId]
    );
    expect(Number(audit?.count)).toBe(1);
  });

  it('replays one creation for one idempotency key', async () => {
    await activeProject();
    const auth = await signIn(MEMBER);
    const first = await app.inject({ method: 'POST', url: '/api/employee/my-work', headers: headers(auth, true), payload: body() });
    const second = await app.inject({ method: 'POST', url: '/api/employee/my-work', headers: headers(auth, true), payload: body() });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const ids = new Set([
      (first.json() as { data: { taskId: string } }).data.taskId,
      (second.json() as { data: { taskId: string } }).data.taskId
    ]);
    expect(ids.size).toBe(1);
    await db.query("UPDATE idempotency_keys SET scope='employee.task.create' WHERE scope='employee.task.create:MEM-MEMBER'");
    const legacyReplay=await app.inject({method:'POST',url:'/api/employee/my-work',headers:headers(auth,true),payload:body()});
    expect(legacyReplay.statusCode,legacyReplay.body).toBe(200);
    expect(legacyReplay.json().data.taskId).toBe(first.json().data.taskId);
    const count = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM tasks');
    expect(Number(count?.count)).toBe(1);
  });

  it('isolates creation idempotency by authenticated member', async () => {
    await activeProject();
    await insertMember(db, { name: 'Other', email: 'other@example.co.jp', role: 'MEMBER' }, 'MEM-OTHER');
    const first = await app.inject({ method: 'POST', url: '/api/employee/my-work', headers: headers(await signIn(MEMBER), true), payload: body() });
    const second = await app.inject({ method: 'POST', url: '/api/employee/my-work', headers: headers(await signIn('other@example.co.jp'), true), payload: body() });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.taskId).not.toBe(first.json().data.taskId);
    expect((await db.one<{owner_member_id:string}>('SELECT owner_member_id FROM tasks WHERE task_id=$1',[second.json().data.taskId]))?.owner_member_id).toBe('MEM-OTHER');
  });

  it('refuses an owner, an assignee, a status or a project in the payload', async () => {
    await activeProject();
    const auth = await signIn(MEMBER);
    for (const extra of [
      { ownerMemberId: 'MEM-ADMIN' },
      { assigneeIds: ['MEM-MANAGER'] },
      { status: 'Done' },
      { parentTaskId: null }
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/employee/my-work',
        headers: headers(auth, true),
        payload: { ...body(), ...extra }
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(400);
    }
  });

  it('refuses VIEWER, MANAGER, an inactive project and another project hierarchy', async () => {
    const project = await activeProject();
    await insertMember(db, { name: 'Viewer', email: 'viewer@example.co.jp', role: 'VIEWER' }, 'MEM-VIEWER');
    const viewer = await signIn('viewer@example.co.jp');
    const denied = await app.inject({ method: 'POST', url: '/api/employee/my-work', headers: headers(viewer, true), payload: body() });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('AUTHORIZATION_DENIED');

    // A manager files work through the manager task form, not the member self-service path.
    const manager = await signIn(MANAGER);
    const managerAttempt = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: headers(manager, true),
      payload: body({ idempotencyKey: 'member-create-manager' })
    });
    expect(managerAttempt.statusCode).toBe(403);
    expect(managerAttempt.json().error.code).toBe('AUTHORIZATION_DENIED');
    const adminAttempt = await app.inject({method:'POST',url:'/api/employee/my-work',headers:headers(await signIn(ADMIN),true),payload:body({idempotencyKey:'admin-create-refused'})});
    expect(adminAttempt.statusCode).toBe(403);

    const other = await insertProject(db, { projectName: 'Other', status: 'Active' }, 'PRJ-O');
    await insertSubproject(db, { projectId: other.projectId, subprojectName: 'Elsewhere' }, 'SUB-O');
    const member = await signIn(MEMBER);
    const crossSubproject = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: headers(member, true),
      payload: body({ subprojectId: 'SUB-O' })
    });
    expect(crossSubproject.statusCode).toBeGreaterThanOrEqual(400);
    expect(crossSubproject.json().error.code).toBe('HIERARCHY_INVALID');

    await db.query("UPDATE projects SET status = 'Archived', archived_at = now() WHERE project_id = $1", [project.projectId]);
    const archived = await app.inject({ method: 'POST', url: '/api/employee/my-work', headers: headers(member, true), payload: body() });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe('INVALID_TRANSITION');
  });
});

describe('member completion requests', () => {
  async function memberTask() {
    await insertResponsibility(db, { name: 'Area' }, 'RSP-C');
    await insertProject(db, { projectName: 'Member project', status: 'Active', dashboardVisibility: 'INTERNAL' }, 'PRJ-C');
    const member = await signIn(MEMBER);
    const created = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: headers(member, true),
      payload: { idempotencyKey: 'member-completion-1', projectId: 'PRJ-C', taskName: 'Report me', deadline: '2026-06-01' }
    });
    const taskId = (created.json() as { data: { taskId: string } }).data.taskId;
    await db.query("UPDATE projects SET dashboard_visibility = 'RESTRICTED' WHERE project_id = 'PRJ-C'");
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, ADMIN);
    return { taskId, member };
  }

  async function submitCompletion(member: { cookie: string; csrf: string }, taskId: string, key = 'completion-request-1') {
    return app.inject({
      method: 'POST',
      url: '/api/employee/requests',
      headers: headers(member, true),
      payload: { clientRequestId: key, taskId, requestType: 'COMPLETION_REPORT', completionNote: 'Finished and checked' }
    });
  }

  it('keeps the task unfinished while the request is pending', async () => {
    const { taskId, member } = await memberTask();
    const response = await submitCompletion(member, taskId);
    expect(response.statusCode, response.body).toBe(200);
    const stored = await db.one<{ status: string; requester_member_id: string }>(
      'SELECT status, requester_member_id FROM task_requests WHERE task_id = $1',
      [taskId]
    );
    expect(stored?.status).toBe('PENDING');
    expect(stored?.requester_member_id).toBe('MEM-MEMBER');
    const task = await db.one<{ status: string }>('SELECT status FROM tasks WHERE task_id = $1', [taskId]);
    expect(task?.status).toBe('Not Started');
  });

  it('refuses a request for work the member is not assigned to', async () => {
    await insertResponsibility(db, { name: 'Area' }, 'RSP-X');
    await insertProject(db, { projectName: 'Foreign', dashboardVisibility: 'INTERNAL' }, 'PRJ-X');
    await insertTask(db, { projectId: 'PRJ-X', taskName: 'Not mine', dueDate: '2026-06-01' }, 'TSK-X');
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, ADMIN);
    const member = await signIn(MEMBER);
    const response = await submitCompletion(member, 'TSK-X');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('AUTHORIZATION_DENIED');
  });

  it('requires an ADMIN decision to complete a member-created task', async () => {
    const { taskId, member } = await memberTask();
    const submitted = await submitCompletion(member, taskId);
    const requestId = (submitted.json() as { data: { requestId: string } }).data.requestId;

    const manager = await signIn(MANAGER);
    const refused = await app.inject({
      method: 'POST',
      url: `/api/manager/requests/${requestId}/decide`,
      headers: headers(manager, true),
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('AUTHORIZATION_DENIED');
    // A refused decision never claims the request or touches the task.
    const afterRefusal = await db.one<{ status: string }>('SELECT status FROM task_requests WHERE request_id = $1', [requestId]);
    expect(afterRefusal?.status).toBe('PENDING');
    const untouched = await db.one<{ status: string }>('SELECT status FROM tasks WHERE task_id = $1', [taskId]);
    expect(untouched?.status).toBe('Not Started');

    const admin = await signIn(ADMIN);
    const approved = await app.inject({
      method: 'POST',
      url: `/api/manager/requests/${requestId}/decide`,
      headers: headers(admin, true),
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const done = await db.one<{ status: string; progress_percent: number }>(
      'SELECT status, progress_percent FROM tasks WHERE task_id = $1',
      [taskId]
    );
    expect(done?.status).toBe('Done');
    expect(Number(done?.progress_percent)).toBe(100);
  });

  it('leaves the task unfinished after a rejection or a return', async () => {
    const { taskId, member } = await memberTask();
    const first = await submitCompletion(member, taskId, 'completion-request-reject');
    const firstId = (first.json() as { data: { requestId: string } }).data.requestId;
    const manager = await signIn(MANAGER);
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/manager/requests/${firstId}/decide`,
      headers: headers(manager, true),
      payload: { decision: 'REJECT', revision: 1, confirmed: true, note: 'Not finished' }
    });
    expect(rejected.statusCode).toBe(200);
    const afterReject = await db.one<{ status: string }>('SELECT status FROM tasks WHERE task_id = $1', [taskId]);
    expect(afterReject?.status).toBe('Not Started');
    const stored = await db.one<{ status: string }>('SELECT status FROM task_requests WHERE request_id = $1', [firstId]);
    expect(stored?.status).toBe('REJECTED');
  });

  it('uses the verified requester name and refuses another member replaying the receipt key', async () => {
    const { taskId, member } = await memberTask();
    const payload = {clientRequestId:'shared-receipt-key',taskId,requestType:'COMPLETION_REPORT',completionNote:'Checked',requesterName:'Pretend administrator'};
    const first = await app.inject({method:'POST',url:'/api/employee/requests',headers:headers(member,true),payload});
    expect(first.statusCode,first.body).toBe(200);
    const row=await db.one<{requester_name:string}>('SELECT requester_name FROM task_requests WHERE request_id=$1',[first.json().data.requestId]);
    expect(row?.requester_name).not.toBe(payload.requesterName);
    await insertMember(db,{name:'Other',email:'other@example.co.jp',role:'MEMBER'},'MEM-OTHER');
    await db.query("UPDATE tasks SET owner_member_id='MEM-OTHER' WHERE task_id=$1",[taskId]);
    const other=await app.inject({method:'POST',url:'/api/employee/requests',headers:headers(await signInOther(),true),payload});
    expect(other.statusCode).toBe(404);
    expect(other.body).not.toContain(first.json().data.requestId);
  });

  it('shows the member only their own receipts', async () => {
    const { taskId, member } = await memberTask();
    const submitted = await submitCompletion(member, taskId);
    const requestId = (submitted.json() as { data: { requestId: string } }).data.requestId;

    const mine = await app.inject({ method: 'GET', url: '/api/employee/requests/mine', headers: headers(member) });
    expect((mine.json() as { data: { items: { requestId: string }[] } }).data.items.map((item) => item.requestId)).toContain(requestId);

    await insertMember(db, { name: 'Other', email: 'other@example.co.jp', role: 'MEMBER' }, 'MEM-OTHER');
    const other = await app.inject({ method: 'GET', url: '/api/employee/requests/mine', headers: headers(await signInOther()) });
    expect((other.json() as { data: { items: unknown[] } }).data.items).toHaveLength(0);

    const receipt = await app.inject({ method: 'GET', url: `/api/employee/requests/${requestId}`, headers: headers(await signInOther()) });
    expect(receipt.statusCode).toBe(404);
    const ownReceipt = await app.inject({ method: 'GET', url: `/api/employee/requests/${requestId}`, headers: headers(member) });
    expect(ownReceipt.statusCode).toBe(200);
  });

  async function signInOther() {
    const response = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: 'other@example.co.jp' } });
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const body = response.json() as { data: { csrfToken: string } };
    return { cookie, csrf: body.data.csrfToken };
  }
});


describe('task tree paging', () => {
  it('keeps matching descendants reachable beneath ancestors before paging', async () => {
    await insertProject(db,{projectName:'Tree',status:'Active'},'PRJ-TREE');
    await insertTask(db,{projectId:'PRJ-TREE',taskName:'Root later',dueDate:'2027-12-01'},'TSK-ROOT');
    await insertTask(db,{projectId:'PRJ-TREE',taskName:'Branch',parentTaskId:'TSK-ROOT',dueDate:'2027-01-01'},'TSK-BRANCH');
    await insertTask(db,{projectId:'PRJ-TREE',taskName:'Needle',parentTaskId:'TSK-BRANCH',dueDate:'2026-12-01'},'TSK-LEAF');
    await insertTask(db,{projectId:'PRJ-TREE',taskName:'Other root',dueDate:'2028-01-01'},'TSK-OTHER');
    const auth=await signIn(MANAGER);
    const get=async(extra:string)=>app.inject({method:'GET',url:'/api/manager/tasks?tree=true&pageSize=1'+extra,headers:headers(auth)});
    const root=await get('&query=Needle');
    expect(root.statusCode,root.body).toBe(200);
    expect(root.json().data).toMatchObject({total:1,matchedTotal:1,totalPages:1});
    expect(root.json().data.items.map((t:{taskId:string})=>t.taskId)).toEqual(['TSK-ROOT']);
    const branch=await get('&query=Needle&treeParentId=TSK-ROOT');
    expect(branch.json().data.items.map((t:{taskId:string})=>t.taskId)).toEqual(['TSK-BRANCH']);
    const leaf=await get('&query=Needle&treeParentId=TSK-BRANCH');
    expect(leaf.json().data.items.map((t:{taskId:string})=>t.taskId)).toEqual(['TSK-LEAF']);
    const all=await get('');
    expect(all.json().data).toMatchObject({total:2,matchedTotal:4,totalPages:2});
    expect((await get('&page=2')).json().data.items[0].taskId).toBe('TSK-OTHER');
    const refused=await app.inject({method:'GET',url:'/api/manager/tasks?tree=true&treeParentId=TSK-ROOT',headers:headers(await signIn(MEMBER))});
    expect(refused.statusCode).toBe(403);
    for (let i=0;i<26;i++) await insertTask(db,{projectId:'PRJ-TREE',taskName:'Sibling '+i,parentTaskId:'TSK-ROOT',dueDate:'2028-01-01'},'TSK-SIB-'+String(i).padStart(2,'0'));
    const siblings=await app.inject({method:'GET',url:'/api/manager/tasks?tree=true&treeParentId=TSK-ROOT&page=2&pageSize=25',headers:headers(auth)});
    expect(siblings.statusCode,siblings.body).toBe(200);
    expect(siblings.json().data).toMatchObject({total:27,page:2,totalPages:2});
    expect(siblings.json().data.items).toHaveLength(2);
  });
});
