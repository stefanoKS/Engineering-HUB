/**
 * Role, assignment, completion and account integration tests against real PostgreSQL.
 *
 * These prove the properties that a mock cannot: server-side authorization for every role, the
 * personal work boundary, the unified multi-assignee write, manager direct completion with request
 * reconciliation, the derived overdue state and the create-or-link account command.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertProject, saveSettings } from '@eh/db';
import { businessDate } from '@eh/domain';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

const password = 'Roles-test-password-123';

beforeAll(async () => {
  hash = await hashPassword(password);
});

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(
    "INSERT INTO members(member_id,name,role) VALUES('MEM-ADMIN','Admin','ADMIN'),('MEM-MANAGER','Manager','MANAGER'),('MEM-A','Member A','MEMBER'),('MEM-B','Member B','MEMBER'),('MEM-VIEW','Viewer','VIEWER'),('MEM-STAFF','Existing Staff','MANAGER')"
  );
  await db.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
      ('MEM-ADMIN','0001',$1,false),('MEM-MANAGER','0002',$1,false),('MEM-A','0010',$1,false),
      ('MEM-B','0011',$1,false),('MEM-VIEW','0020',$1,false)`,
    [hash]
  );
  await insertProject(db, { projectName: 'Alpha', status: 'Active', dashboardVisibility: 'INTERNAL' }, 'PRJ-A');
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

async function mine(headers: Record<string, string>): Promise<string[]> {
  const response = await app.inject({ url: '/api/employee/my-work', headers: { cookie: headers.cookie! } });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { data: { items: { taskId: string }[] } }).data.items.map((item) => item.taskId);
}

async function createTaskAsManager(
  headers: Record<string, string>,
  input: { name: string; assigneeIds?: string[]; deadline?: string; ownerMemberId?: string }
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/manager/tasks',
    headers,
    payload: {
      idempotencyKey: `task-${input.name.replace(/[^A-Za-z0-9_-]+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      projectId: 'PRJ-A',
      taskName: input.name,
      deadline: input.deadline ?? '2026-12-31',
      ...(input.assigneeIds ? { assigneeIds: input.assigneeIds } : {}),
      ...(input.ownerMemberId ? { ownerMemberId: input.ownerMemberId } : {})
    }
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { data: { task: { taskId: string } } }).data.task.taskId;
}

describe('personal work isolation', () => {
  it('shows each role only its own assignments under My Work', async () => {
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status,due_date) VALUES('TSK-A','PRJ-A','For A','MEM-A','In Progress','2026-12-01'),('TSK-B','PRJ-A','For B','MEM-B','In Progress','2026-12-01'),('TSK-M','PRJ-A','For manager','MEM-MANAGER','In Progress','2026-12-01')"
    );
    expect(await mine(await login('0010'))).toEqual(['TSK-A']);
    expect(await mine(await login('0011'))).toEqual(['TSK-B']);
    expect(await mine(await login('0002'))).toEqual(['TSK-M']);
    expect(await mine(await login('0020'))).toEqual([]);
    // A manager still sees the departmental list beside the personal one.
    const all = await app.inject({ url: '/api/manager/tasks', headers: { cookie: (await login('0002')).cookie! } });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { data: { items: { taskId: string }[] } }).data.items.map((item) => item.taskId).sort()).toEqual([
      'TSK-A',
      'TSK-B',
      'TSK-M'
    ]);
  });

  it('shows a task in My Work for every active assignee and hides it again after removal', async () => {
    const manager = await login('0002');
    const taskId = await createTaskAsManager(manager, { name: 'Shared', assigneeIds: ['MEM-A', 'MEM-B'] });

    expect(await mine(await login('0010'))).toContain(taskId);
    expect(await mine(await login('0011'))).toContain(taskId);

    const detail = await app.inject({ url: `/api/manager/tasks/${taskId}`, headers: { cookie: manager.cookie! } });
    const record = (detail.json() as { data: { record: { revision: number; ownerMemberId: string } } }).data;
    expect(record.record.ownerMemberId).toBe('MEM-A'); // deterministic: lowest member ID

    const removed = await app.inject({
      method: 'PATCH',
      url: `/api/manager/tasks/${taskId}`,
      headers: manager,
      payload: { revision: record.record.revision, assigneeIds: ['MEM-B'] }
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((removed.json() as { data: { task: { ownerMemberId: string } } }).data.task.ownerMemberId).toBe('MEM-B');
    expect(await mine(await login('0010'))).not.toContain(taskId);
    expect(await mine(await login('0011'))).toContain(taskId);

    // Re-adding a former assignee reactivates the relationship without duplicating it.
    const readded = await app.inject({
      method: 'PATCH',
      url: `/api/manager/tasks/${taskId}`,
      headers: manager,
      payload: { revision: (removed.json() as { data: { task: { revision: number } } }).data.task.revision, assigneeIds: ['MEM-B', 'MEM-A'] }
    });
    expect(readded.statusCode, readded.body).toBe(200);
    expect((readded.json() as { data: { task: { ownerMemberId: string } } }).data.task.ownerMemberId).toBe('MEM-B');
    const rows = await db.many<{ member_id: string; removed_at: string | null }>(
      'SELECT member_id, removed_at FROM task_assignees WHERE task_id = $1 AND removed_at IS NULL ORDER BY member_id',
      [taskId]
    );
    expect(rows.map((row) => row.member_id)).toEqual(['MEM-A']);
    // The demoted former owner keeps its history instead of losing the row.
    const history = await db.many<{ member_id: string }>(
      'SELECT member_id FROM task_assignees WHERE task_id = $1 AND removed_at IS NOT NULL',
      [taskId]
    );
    expect(history.map((row) => row.member_id)).toEqual(['MEM-B']);
    expect(await mine(await login('0010'))).toContain(taskId);
  });
});

describe('role authorization', () => {
  it('lets a MEMBER read all work but never mutate it or forge an assignee', async () => {
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status,due_date) VALUES('TSK-A','PRJ-A','For A','MEM-A','In Progress','2026-12-01')"
    );
    const member = await login('0010');
    const read = await app.inject({ url: '/api/work/tasks', headers: { cookie: member.cookie! } });
    expect(read.statusCode).toBe(200);
    expect(read.body).toContain('For A');

    expect(
      (await app.inject({ method: 'POST', url: '/api/manager/tasks', headers: member, payload: { idempotencyKey: 'member-forged-1', projectId: 'PRJ-A', taskName: 'Forged', deadline: '2026-12-01' } })).statusCode
    ).toBe(403);
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/manager/tasks/TSK-A', headers: member, payload: { revision: 1, taskName: 'Changed' } })).statusCode
    ).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/manager/tasks/TSK-A', headers: member, payload: { revision: 1, confirmed: true, reason: 'x', confirmation: 'DELETE TSK-A' } })).statusCode
    ).toBe(403);
    // A member may not name another assignee; the self-service contract has no such field.
    expect(
      (await app.inject({ method: 'POST', url: '/api/employee/my-work', headers: member, payload: { idempotencyKey: 'member-own-1', projectId: 'PRJ-A', taskName: 'Own', deadline: '2026-12-01', assigneeIds: ['MEM-B'] } })).statusCode
    ).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/api/employee/my-work', headers: member, payload: { idempotencyKey: 'member-own-2', projectId: 'PRJ-A', taskName: 'Own work', deadline: '2026-12-01' } });
    expect(created.statusCode, created.body).toBe(200);
    const stored = await db.one<{ owner_member_id: string; status: string }>(
      'SELECT owner_member_id, status FROM tasks WHERE task_id = $1',
      [(created.json() as { data: { taskId: string } }).data.taskId]
    );
    expect(stored?.owner_member_id).toBe('MEM-A');
    expect(stored?.status).toBe('Not Started');
  });

  it('keeps a VIEWER read-only', async () => {
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status,due_date) VALUES('TSK-V','PRJ-A','Visible','MEM-A','In Progress','2026-12-01')"
    );
    const viewer = await login('0020');
    expect((await app.inject({ url: '/api/work/tasks', headers: { cookie: viewer.cookie! } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/manager/tasks', headers: { cookie: viewer.cookie! } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/employee/requests/mine', headers: { cookie: viewer.cookie! } })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/employee/requests', headers: viewer, payload: { clientRequestId: 'viewer-request-1', taskId: 'TSK-V', requestType: 'COMPLETION_REPORT', completionNote: 'done' } })).statusCode
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/api/manager/tasks/TSK-V/complete', headers: viewer, payload: { revision: 1, confirmed: true } })).statusCode
    ).toBe(403);
  });
});

describe('completion authority', () => {
  it('completes work directly as a manager, withdrawing a pending member request', async () => {
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, 'MEM-ADMIN');
    const member = await login('0010');
    const created = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: member,
      payload: { idempotencyKey: 'completion-direct-1', projectId: 'PRJ-A', taskName: 'Direct work', deadline: '2026-12-01' }
    });
    const taskId = (created.json() as { data: { taskId: string } }).data.taskId;
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/employee/requests',
      headers: member,
      payload: { clientRequestId: 'completion-direct-request-1', taskId, requestType: 'COMPLETION_REPORT', completionNote: 'Finished' }
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const requestId = (submitted.json() as { data: { requestId: string } }).data.requestId;

    const manager = await login('0002');
    const detail = await app.inject({ url: `/api/manager/tasks/${taskId}`, headers: { cookie: manager.cookie! } });
    const revision = (detail.json() as { data: { record: { revision: number } } }).data.record.revision;
    const completed = await app.inject({
      method: 'POST',
      url: `/api/manager/tasks/${taskId}/complete`,
      headers: manager,
      payload: { revision, confirmed: true, note: 'Verified on the floor' }
    });
    expect(completed.statusCode, completed.body).toBe(200);
    const task = await db.one<{ status: string; completed_at: string | null }>(
      'SELECT status, completed_at FROM tasks WHERE task_id = $1',
      [taskId]
    );
    expect(task?.status).toBe('Done');
    expect(task?.completed_at).not.toBeNull();
    const request = await db.one<{ status: string }>('SELECT status FROM task_requests WHERE request_id = $1', [requestId]);
    expect(request?.status).toBe('WITHDRAWN');
    const auditRow = await db.one<{ actor_member_id: string; new_value: { actorRole?: string; completionSource?: string } }>(
      "SELECT actor_member_id, new_value FROM audit_log WHERE entity_type = 'TASKS' AND entity_id = $1 AND action = 'TASK_COMPLETED_DIRECT'",
      [taskId]
    );
    expect(auditRow?.actor_member_id).toBe('MEM-MANAGER');
    expect(auditRow?.new_value.completionSource).toBe('DIRECT');
    expect(auditRow?.new_value.actorRole).toBe('MANAGER');
  });

  it('lets a manager complete their own assigned task and refuses a member', async () => {
    const manager = await login('0002');
    const own = await createTaskAsManager(manager, { name: 'Manager own', ownerMemberId: 'MEM-MANAGER' });
    const first = await app.inject({ method: 'POST', url: `/api/manager/tasks/${own}/complete`, headers: manager, payload: { revision: 1, confirmed: true } });
    expect(first.statusCode, first.body).toBe(200);

    const member = await login('0010');
    await db.query("INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status,due_date) VALUES('TSK-M2','PRJ-A','Member task','MEM-A','In Progress','2026-12-01')");
    expect(
      (await app.inject({ method: 'POST', url: '/api/manager/tasks/TSK-M2/complete', headers: member, payload: { revision: 1, confirmed: true } })).statusCode
    ).toBe(403);
    expect((await db.one<{ status: string }>("SELECT status FROM tasks WHERE task_id='TSK-M2'"))?.status).toBe('In Progress');
  });

  it('refuses a direct completion of a container task', async () => {
    const manager = await login('0002');
    const parent = await createTaskAsManager(manager, { name: 'Parent' });
    await db.query("INSERT INTO tasks(task_id,project_id,task_name,parent_task_id,status,due_date) VALUES('TSK-CHILD','PRJ-A','Child',$1,'In Progress','2026-12-01')", [parent]);
    const response = await app.inject({ method: 'POST', url: `/api/manager/tasks/${parent}/complete`, headers: manager, payload: { revision: 1, confirmed: true } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONTAINER_NOT_COMPLETABLE');
  });
});

describe('derived status', () => {
  it('reports an overdue task without changing the stored status', async () => {
    const yesterday = businessDate(new Date(Date.now() - 86_400_000));
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status,due_date) VALUES('TSK-OD','PRJ-A','Late work','MEM-A','In Progress',$1)",
      [yesterday]
    );
    const member = await login('0010');
    const response = await app.inject({ url: '/api/work/tasks', headers: { cookie: member.cookie! } });
    const item = (response.json() as { data: { items: { taskId: string; displayStatus: string; status: string }[] } }).data.items.find(
      (task) => task.taskId === 'TSK-OD'
    );
    expect(item?.displayStatus).toBe('OVERDUE');
    expect(item?.status).toBe('In Progress');
    const stored = await db.one<{ status: string }>("SELECT status FROM tasks WHERE task_id='TSK-OD'");
    expect(stored?.status).toBe('In Progress');
  });

  it('hides cancelled and archived work from the default list', async () => {
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status,due_date) VALUES('TSK-OPEN','PRJ-A','Open','MEM-A','In Progress','2026-12-01'),('TSK-CAN','PRJ-A','Cancelled','MEM-A','Cancelled','2026-12-01')"
    );
    await db.query("INSERT INTO projects(project_id,project_name,status,archived_at) VALUES('PRJ-OLD','Old','Archived', now())");
    await db.query("INSERT INTO tasks(task_id,project_id,task_name,status) VALUES('TSK-OLD','PRJ-OLD','Archived work','In Progress')");
    const viewer = await login('0020');
    const response = await app.inject({ url: '/api/work/tasks', headers: { cookie: viewer.cookie! } });
    const ids = (response.json() as { data: { items: { taskId: string }[] } }).data.items.map((task) => task.taskId);
    expect(ids).toContain('TSK-OPEN');
    expect(ids).not.toContain('TSK-CAN');
    expect(ids).not.toContain('TSK-OLD');
    const including = await app.inject({ url: '/api/work/tasks?includeInactive=true', headers: { cookie: viewer.cookie! } });
    const allIds = (including.json() as { data: { items: { taskId: string }[] } }).data.items.map((task) => task.taskId);
    expect(allIds).toContain('TSK-CAN');
    expect(allIds).toContain('TSK-OLD');
  });
});

describe('account administration', () => {
  it('creates a new employee with a login and preserves leading zeros', async () => {
    const admin = await login('0001');
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: admin,
      payload: { idempotencyKey: 'account-new-0050', employeeId: '0050', name: 'New Person', role: 'MEMBER', password: 'Temporary-pass-1' }
    });
    expect(created.statusCode, created.body).toBe(200);
    const memberId = (created.json() as { data: { memberId: string } }).data.memberId;
    expect((await db.one<{ role: string }>('SELECT role FROM members WHERE member_id = $1', [memberId]))?.role).toBe('MEMBER');
    const session = await app.inject({ method: 'POST', url: '/api/session', payload: { employeeId: '0050', password: 'Temporary-pass-1' } });
    expect(session.statusCode).toBe(200);
    expect(session.json().data.mustChangePassword).toBe(true);
    // A retried create with the same key replays the stored answer instead of a second member.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: admin,
      payload: { idempotencyKey: 'account-new-0050', employeeId: '0050', name: 'New Person', role: 'MEMBER', password: 'Temporary-pass-1' }
    });
    expect(replay.statusCode).toBe(200);
    expect((await db.one<{ count: string }>("SELECT count(*)::text AS count FROM members WHERE name='New Person'"))?.count).toBe('1');
  });

  it('links a login to an existing member without overwriting the name or the role', async () => {
    const admin = await login('0001');
    const before = await db.one<{ name: string; role: string }>("SELECT name, role FROM members WHERE member_id='MEM-STAFF'");
    const linked = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: admin,
      payload: { idempotencyKey: 'account-link-staff', employeeId: '0060', password: 'Temporary-pass-2', memberId: 'MEM-STAFF', name: 'Ignored name', role: 'VIEWER' }
    });
    expect(linked.statusCode, linked.body).toBe(200);
    const after = await db.one<{ name: string; role: string }>("SELECT name, role FROM members WHERE member_id='MEM-STAFF'");
    expect(after).toEqual(before);
    expect((await db.one<{ count: string }>("SELECT count(*)::text AS count FROM members"))?.count).toBe('6');
    // A second login for the same member is refused.
    const second = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: admin,
      payload: { idempotencyKey: 'account-link-staff-2', employeeId: '0061', password: 'Temporary-pass-3', memberId: 'MEM-STAFF' }
    });
    expect(second.statusCode).toBe(400);
    // A duplicate employee number is refused.
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/admin/accounts',
      headers: admin,
      payload: { idempotencyKey: 'account-new-0001', employeeId: '0001', name: 'Duplicate', role: 'MEMBER', password: 'Temporary-pass-4' }
    });
    expect(duplicate.statusCode).toBe(400);
    // The picker only offers members without a login.
    const linkable = await app.inject({ url: '/api/admin/accounts/linkable?query=Staff', headers: { cookie: admin.cookie! } });
    expect(linkable.statusCode).toBe(200);
    expect((linkable.json() as { data: { items: unknown[] } }).data.items).toHaveLength(0);
  });

  it('restricts account management to an administrator', async () => {
    for (const employeeId of ['0002', '0010', '0020']) {
      const headers = await login(employeeId);
      expect((await app.inject({ url: '/api/admin/accounts', headers: { cookie: headers.cookie! } })).statusCode).toBe(403);
      expect(
        (await app.inject({ method: 'POST', url: '/api/admin/accounts', headers, payload: { idempotencyKey: `denied-${employeeId}`, employeeId: '0099', name: 'Nope', role: 'MEMBER', password: 'Temporary-pass-5' } })).statusCode
      ).toBe(403);
      expect(
        (await app.inject({ method: 'POST', url: '/api/admin/accounts/MEM-A/reset-password', headers, payload: { password: 'Another-pass-1', confirmed: true } })).statusCode
      ).toBe(403);
    }
  });
});

describe('schema readiness', () => {
  it('reports DATABASE_MIGRATION_REQUIRED instead of a false ready status', async () => {
    const ledger = await db.one<{ version: number; name: string; checksum: string; duration_ms: number }>(
      'SELECT version, name, checksum, duration_ms FROM schema_migrations ORDER BY version DESC LIMIT 1'
    );
    expect(ledger?.version).toBe(8);
    await db.query('DELETE FROM schema_migrations WHERE version = $1', [ledger!.version]);
    const response = await app.inject({ url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'migration-required', requiredSchemaVersion: 8 });
    expect(response.json().error.code).toBe('DATABASE_MIGRATION_REQUIRED');
    await db.query(
      'INSERT INTO schema_migrations(version, name, checksum, duration_ms) VALUES($1,$2,$3,$4)',
      [ledger!.version, ledger!.name, ledger!.checksum, ledger!.duration_ms]
    );
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(200);
  });
});
