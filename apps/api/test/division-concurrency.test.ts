/**
 * Deterministic concurrency coverage for the division boundary, against real PostgreSQL.
 *
 * Every case uses an explicit barrier instead of a sleep. A second connection takes the shared
 * advisory lock that every division-scoped writer acquires first, the request under test is observed
 * queued on that lock, the conflicting change is committed by the holder, and only then is the lock
 * released. The request therefore passes its request-level pre-check against the old state and must
 * refuse the write from the check it makes inside its own transaction.
 *
 * The conflicting change is written directly on the fixture connection on purpose: it represents
 * the state change that must win, not a second copy of the application under test.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase } from '../../../packages/db/test/support/db';

const password = 'Concurrency-test-password-123';
const LOCK_KEY = 'member-divisions';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

beforeAll(async () => {
  hash = await hashPassword(password);
});

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(`
    INSERT INTO members(member_id,name,role,active) VALUES
      ('MEM-ADMIN','Admin','ADMIN',true),
      ('MEM-MGR','Manager','MANAGER',true),
      ('MEM-A','Worker A','MEMBER',true)
  `);
  await db.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
       ('MEM-ADMIN','2001',$1,false),('MEM-MGR','2002',$1,false)`,
    [hash]
  );
  await db.query("DELETE FROM member_divisions WHERE member_id IN ('MEM-MGR','MEM-A')");
  for (const [memberId, divisionId] of [
    ['MEM-MGR', 'DIV-DEV'],
    ['MEM-A', 'DIV-DEV']
  ] as const) {
    await db.query(
      `INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind, assigned_by)
       VALUES ($1,$2,$3,'WORK','fixture')`,
      [`MD-${memberId}`, memberId, divisionId]
    );
  }
  await db.query("INSERT INTO responsibilities(responsibility_id,name,division_id) VALUES ('RSP-DEV','Dev','DIV-DEV')");
  await db.query("INSERT INTO responsibilities(responsibility_id,name,division_id) VALUES ('RSP-PROD','Prod','DIV-PROD')");
  await db.query(
    `INSERT INTO projects(project_id,project_name,division_id,responsibility_id,status,dashboard_visibility)
     VALUES ('PRJ-DEV','Dev project','DIV-DEV','RSP-DEV','Active','INTERNAL')`
  );
  await db.query(
    `INSERT INTO projects(project_id,project_name,division_id,responsibility_id,status,dashboard_visibility)
     VALUES ('PRJ-PROD','Prod project','DIV-PROD','RSP-PROD','Active','INTERNAL')`
  );
  await db.query(
    `INSERT INTO projects(project_id,project_name,division_id,responsibility_id,status,dashboard_visibility)
     VALUES ('PRJ-FREE','Unscoped project','DIV-DEV',NULL,'Active','INTERNAL')`
  );
  app = await buildApp({
    db,
    inbox: new NullInboxSource(),
    logger: false,
    config: loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'local', PUBLIC_ORIGIN: 'http://localhost:8050' })
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

/** Waits until at least one connection is queued on the shared advisory lock. */
async function waitForLockWaiter(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await db.one<{ waiting: string }>(
      "SELECT count(*)::text AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"
    );
    if (Number(row?.waiting ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error('the request never queued on the division membership lock');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Runs `change` on a connection that holds the membership lock while `request` waits for it.
 */
async function raceWithLock<T>(
  request: () => Promise<T>,
  change: (client: pg.PoolClient) => Promise<void>
): Promise<T> {
  const blocker = await pool.connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);
  try {
    const pending = request();
    await waitForLockWaiter();
    await change(blocker);
    await blocker.query('COMMIT');
    return await pending;
  } finally {
    await blocker.query('ROLLBACK').catch(() => undefined);
    blocker.release();
  }
}

async function createTask(headers: Record<string, string>, projectId: string, name: string, assigneeIds?: string[]) {
  return app.inject({
    method: 'POST',
    url: '/api/manager/tasks',
    headers,
    payload: {
      idempotencyKey: `t-${name.replace(/\W+/g, '-')}-${Math.random().toString(36).slice(2)}`,
      projectId,
      taskName: name,
      deadline: '2026-12-20',
      ...(assigneeIds ? { assigneeIds } : {})
    }
  });
}

async function taskCount(name: string): Promise<number> {
  const row = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM tasks WHERE task_name = $1', [
    name
  ]);
  return Number(row?.count ?? 0);
}

describe('membership removal versus assignment', () => {
  it('refuses an assignment whose member lost the membership before the write re-checked', async () => {
    const manager = await login('2002');
    const response = await raceWithLock(
      () => createTask(manager, 'PRJ-DEV', 'Racing assignment', ['MEM-A']),
      async (client) => {
        await client.query(
          "UPDATE member_divisions SET removed_at = now(), removed_by = 'test' WHERE member_id = 'MEM-A' AND division_id = 'DIV-DEV'"
        );
      }
    );
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    expect(await taskCount('Racing assignment')).toBe(0);
  });

  it('refuses an assignment whose member was downgraded to read access before the write re-checked', async () => {
    const manager = await login('2002');
    const response = await raceWithLock(
      () => createTask(manager, 'PRJ-DEV', 'Downgraded assignment', ['MEM-A']),
      async (client) => {
        await client.query(
          "UPDATE member_divisions SET access_kind = 'READ' WHERE member_id = 'MEM-A' AND division_id = 'DIV-DEV'"
        );
      }
    );
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    expect(await taskCount('Downgraded assignment')).toBe(0);
  });

  it('removes an ordinary read grant even though active work exists elsewhere', async () => {
    const manager = await login('2002');
    const admin = await login('2001');
    const created = await createTask(manager, 'PRJ-DEV', 'Owned by A', ['MEM-A']);
    expect(created.statusCode, created.body).toBe(200);
    // Start from a real read grant, so this test actually revokes it instead of adding one.
    await db.query(
      "INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind, assigned_by) VALUES ('MD-READ','MEM-A','DIV-PROD','READ','fixture')"
    );
    const member = await db.one<{ revision: number }>("SELECT revision FROM members WHERE member_id = 'MEM-A'");
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-A',
      headers: admin,
      payload: {
        revision: member?.revision,
        divisionGrants: [{ divisionId: 'DIV-DEV', accessKind: 'WORK' }]
      }
    });
    expect(response.statusCode, response.body).toBe(200);
    const active = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM member_divisions WHERE member_id = 'MEM-A' AND division_id = 'DIV-PROD' AND removed_at IS NULL"
    );
    expect(active?.count).toBe('0');
    // Removal is soft: the relationship row is stamped, not deleted.
    const stamped = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM member_divisions WHERE member_id = 'MEM-A' AND division_id = 'DIV-PROD' AND removed_at IS NOT NULL"
    );
    expect(stamped?.count).toBe('1');
    // The WORK membership and the owned work are untouched.
    const membership = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM member_divisions WHERE member_id = 'MEM-A' AND division_id = 'DIV-DEV' AND removed_at IS NULL"
    );
    expect(membership?.count).toBe('1');
  });

  it('treats WORK to READ as a membership removal at the API boundary', async () => {
    const manager = await login('2002');
    const admin = await login('2001');
    const created = await createTask(manager, 'PRJ-DEV', 'Downgrade blocker', ['MEM-A']);
    expect(created.statusCode, created.body).toBe(200);
    const member = await db.one<{ revision: number }>("SELECT revision FROM members WHERE member_id = 'MEM-A'");
    const downgrade = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-A',
      headers: admin,
      payload: { revision: member?.revision, divisionGrants: [{ divisionId: 'DIV-DEV', accessKind: 'READ' }] }
    });
    expect(downgrade.statusCode, downgrade.body).toBe(409);
    expect(downgrade.json().error.code).toBe('DIVISION_MEMBERSHIP_BLOCKED');
    expect(downgrade.json().error.details.blocked[0].reason).toBe('DOWNGRADE');
    const kept = await db.one<{ access_kind: string }>(
      "SELECT access_kind FROM member_divisions WHERE member_id = 'MEM-A' AND division_id = 'DIV-DEV' AND removed_at IS NULL"
    );
    expect(kept?.access_kind).toBe('WORK');
  });
});

describe('access revocation versus write', () => {
  it('refuses a prepared write whose actor lost the division before the write re-checked', async () => {
    const manager = await login('2002');
    const response = await raceWithLock(
      () => createTask(manager, 'PRJ-DEV', 'Revoked writer'),
      async (client) => {
        await client.query(
          "UPDATE member_divisions SET removed_at = now(), removed_by = 'test' WHERE member_id = 'MEM-MGR' AND division_id = 'DIV-DEV'"
        );
      }
    );
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json().error.code).toBe('AUTHORIZATION_DENIED');
    expect(await taskCount('Revoked writer')).toBe(0);
  });

  it('refuses a prepared write whose actor was deactivated before the write re-checked', async () => {
    const manager = await login('2002');
    const response = await raceWithLock(
      () => createTask(manager, 'PRJ-DEV', 'Deactivated writer'),
      async (client) => {
        await client.query("UPDATE members SET active = false WHERE member_id = 'MEM-MGR'");
      }
    );
    expect(response.statusCode, response.body).toBe(403);
    expect(await taskCount('Deactivated writer')).toBe(0);
  });
});

describe('division retirement versus assignment', () => {
  it('refuses a prepared assignment once the division is retired', async () => {
    const manager = await login('2002');
    const response = await raceWithLock(
      () => createTask(manager, 'PRJ-DEV', 'Retired race', ['MEM-A']),
      async (client) => {
        await client.query(
          "UPDATE divisions SET status = 'Retired', retired_at = now() WHERE division_id = 'DIV-DEV'"
        );
      }
    );
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('INVALID_TRANSITION');
    expect(await taskCount('Retired race')).toBe(0);
  });

  it('refuses a prepared unassigned creation once the division is retired', async () => {
    const manager = await login('2002');
    const response = await raceWithLock(
      () => createTask(manager, 'PRJ-DEV', 'Retired unassigned'),
      async (client) => {
        await client.query(
          "UPDATE divisions SET status = 'Retired', retired_at = now() WHERE division_id = 'DIV-DEV'"
        );
      }
    );
    expect(response.statusCode, response.body).toBe(409);
    expect(await taskCount('Retired unassigned')).toBe(0);
  });
});

describe('division transfer versus child assignment', () => {
  it('refuses a transfer that would make an existing owner ineligible', async () => {
    const admin = await login('2001');
    const manager = await login('2002');
    // PRJ-FREE carries no responsibility, so the only reason to refuse the move is the assignment.
    const created = await createTask(manager, 'PRJ-FREE', 'Owned by A', ['MEM-A']);
    expect(created.statusCode, created.body).toBe(200);
    const project = await db.one<{ revision: number }>(
      "SELECT revision FROM projects WHERE project_id = 'PRJ-FREE'"
    );
    const transfer = await app.inject({
      method: 'POST',
      url: '/api/admin/projects/PRJ-FREE/transfer-division',
      headers: admin,
      payload: { revision: project?.revision, divisionId: 'DIV-PROD', confirmed: true }
    });
    expect(transfer.statusCode, transfer.body).toBe(400);
    expect(transfer.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    const row = await db.one<{ division_id: string }>(
      "SELECT division_id FROM projects WHERE project_id = 'PRJ-FREE'"
    );
    expect(row?.division_id).toBe('DIV-DEV');
  });

  it('refuses a transfer whose responsibility belongs to another division', async () => {
    const admin = await login('2001');
    const project = await db.one<{ revision: number }>(
      "SELECT revision FROM projects WHERE project_id = 'PRJ-DEV'"
    );
    const transfer = await app.inject({
      method: 'POST',
      url: '/api/admin/projects/PRJ-DEV/transfer-division',
      headers: admin,
      payload: { revision: project?.revision, divisionId: 'DIV-PROD', confirmed: true }
    });
    expect(transfer.statusCode, transfer.body).toBe(400);
    expect(transfer.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('moves a project between two different divisions when nothing becomes ineligible', async () => {
    const admin = await login('2001');
    // PRJ-FREE carries no responsibility and no assignment, so the only fact under test is the
    // division change itself - and the destination is a different division.
    const project = await db.one<{ revision: number }>(
      "SELECT revision FROM projects WHERE project_id = 'PRJ-FREE'"
    );
    const clean = await app.inject({
      method: 'POST',
      url: '/api/admin/projects/PRJ-FREE/transfer-division',
      headers: admin,
      payload: { revision: project?.revision, divisionId: 'DIV-PROD', confirmed: true }
    });
    expect(clean.statusCode, clean.body).toBe(200);
    const moved = await db.one<{ division_id: string }>(
      "SELECT division_id FROM projects WHERE project_id = 'PRJ-FREE'"
    );
    expect(moved?.division_id).toBe('DIV-PROD');
  });
});
