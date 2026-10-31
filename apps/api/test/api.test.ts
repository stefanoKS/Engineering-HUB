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
    DEV_AUTH_EMAILS: [ADMIN, MANAGER, MEMBER].join(','),
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
    const task = await insertTask(db, { projectId: project.projectId, taskName: 'Task', dueDate: '2026-02-01' }, 'T1');
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
