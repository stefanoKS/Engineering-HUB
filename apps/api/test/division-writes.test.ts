/**
 * Division-scoped writes: assignment eligibility, ordering, transfer and transaction-time
 * authorization, against real PostgreSQL.
 *
 * Every race test uses an explicit barrier rather than a sleep: a second connection takes the
 * shared `member-divisions` advisory lock, the request under test is observed queued on it, the
 * conflicting change is committed by the holder, and only then is the lock released. The request
 * therefore passes its request-level reads against the old state and must refuse from the check it
 * makes inside its own transaction.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertProject, insertResponsibility, insertTask } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import type { Identity } from '@eh/domain';
import { freshDatabase } from '../../../packages/db/test/support/db';
import { createTask as createTaskService } from '../src/services/tasks';
import { loadScope } from '../src/services/divisions';

const password = 'Division-writes-password-123';
const LOCK_KEY = 'member-divisions';

const DEV = 'DIV-DEV';
const ENG = 'DIV-ENG';
const OLD = 'DIV-OLD';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

beforeAll(async () => {
  hash = await hashPassword(password);
});

async function replaceGrants(
  memberId: string,
  grants: { divisionId: string; accessKind: 'WORK' | 'READ' }[]
): Promise<void> {
  await db.query('DELETE FROM member_divisions WHERE member_id = $1', [memberId]);
  for (const grant of grants) {
    await db.query(
      `INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind, assigned_by)
       VALUES ($1,$2,$3,$4,'fixture')`,
      [`MD-${memberId}-${grant.divisionId}`, memberId, grant.divisionId, grant.accessKind]
    );
  }
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(
    `INSERT INTO divisions (division_id, name, status, sort_order, retired_at) VALUES
       ('DIV-OLD','旧課','Retired',9, now())`
  );
  await db.query(`
    INSERT INTO members(member_id,name,role,active) VALUES
      ('MEM-ADMIN','Admin','ADMIN',true),
      ('MEM-MGR','Dev manager','MANAGER',true),
      ('MEM-MGR2','Dual manager','MANAGER',true),
      ('MEM-A','Dev member','MEMBER',true),
      ('MEM-B','Engineering member','MEMBER',true),
      ('MEM-READ','Read-only in engineering','MEMBER',true),
      ('MEM-PAST','Former dev member','MEMBER',false),
      ('MEM-OLD','Retained retired-division member','MEMBER',true),
      ('MEM-MGRO','Retained retired-division manager','MANAGER',true),
      ('MEM-GM','Overseer','GENERAL_MANAGER',true)
  `);
  await db.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
       ('MEM-ADMIN','1001',$1,false),('MEM-MGR','1002',$1,false),('MEM-MGR2','1003',$1,false),
       ('MEM-GM','1004',$1,false),('MEM-MGRO','1005',$1,false)`,
    [hash]
  );
  await replaceGrants('MEM-ADMIN', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-MGR', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-MGR2', [
    { divisionId: DEV, accessKind: 'WORK' },
    { divisionId: ENG, accessKind: 'WORK' }
  ]);
  await replaceGrants('MEM-A', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-B', [{ divisionId: ENG, accessKind: 'WORK' }]);
  await replaceGrants('MEM-READ', [
    { divisionId: DEV, accessKind: 'WORK' },
    { divisionId: ENG, accessKind: 'READ' }
  ]);
  // A relationship that survives the member's later deactivation.
  await replaceGrants('MEM-PAST', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await db.query("UPDATE member_divisions SET removed_at = now(), removed_by = 'fixture' WHERE member_id = 'MEM-PAST'");
  await replaceGrants('MEM-OLD', [
    { divisionId: DEV, accessKind: 'WORK' },
    { divisionId: OLD, accessKind: 'WORK' }
  ]);
  await replaceGrants('MEM-MGRO', [
    { divisionId: DEV, accessKind: 'WORK' },
    { divisionId: OLD, accessKind: 'WORK' }
  ]);
  await replaceGrants('MEM-GM', []);
  await db.query("UPDATE members SET all_divisions_read = true WHERE member_id = 'MEM-GM'");

  await insertResponsibility(db, { name: 'Dev area A', divisionId: DEV, ownerMemberId: 'MEM-A', sortOrder: 1 }, 'RSP-A');
  await insertResponsibility(db, { name: 'Dev area B', divisionId: DEV, ownerMemberId: 'MEM-A', sortOrder: 2 }, 'RSP-B');
  await insertResponsibility(db, { name: 'Engineering area', divisionId: ENG, ownerMemberId: 'MEM-B', sortOrder: 2 }, 'RSP-ENG');
  await db.query(
    `INSERT INTO responsibility_members (assignment_id, responsibility_id, member_id, assigned_by)
     VALUES ('RM-A-PAST','RSP-A','MEM-PAST','fixture')`
  );

  await insertProject(
    db,
    { projectName: 'Dev project', divisionId: DEV, responsibilityId: 'RSP-A', status: 'Active', dashboardVisibility: 'INTERNAL' },
    'PRJ-DEV'
  );
  await insertProject(
    db,
    { projectName: 'Free dev project', divisionId: DEV, status: 'Active', dashboardVisibility: 'INTERNAL' },
    'PRJ-FREE'
  );
  await insertTask(db, { projectId: 'PRJ-DEV', taskName: 'Dev task', dueDate: '2026-12-01' }, 'TSK-DEV');
  // History in a retired division: written before retirement, never deleted by it.
  await insertResponsibility(db, { name: 'Old area', divisionId: OLD, ownerMemberId: 'MEM-OLD' }, 'RSP-OLD');
  await insertProject(
    db,
    { projectName: 'Retired-division history', divisionId: OLD, responsibilityId: 'RSP-OLD', status: 'Active', dashboardVisibility: 'INTERNAL' },
    'PRJ-OLD'
  );
  await insertTask(db, { projectId: 'PRJ-OLD', taskName: 'Retired-division task', dueDate: '2026-11-30' }, 'TSK-OLD');

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

async function responsibilityRevision(id: string): Promise<number> {
  const row = await db.one<{ revision: number }>('SELECT revision FROM responsibilities WHERE responsibility_id = $1', [id]);
  return Number(row?.revision ?? 0);
}

async function responsibilityRow(id: string) {
  return db.one<{ division_id: string | null; owner_member_id: string | null; sort_order: number; revision: number; name: string }>(
    'SELECT division_id, owner_member_id, sort_order, revision, name FROM responsibilities WHERE responsibility_id = $1',
    [id]
  );
}

async function activeResponsibilityMembers(id: string): Promise<string[]> {
  const rows = await db.many<{ member_id: string }>(
    'SELECT member_id FROM responsibility_members WHERE responsibility_id = $1 AND removed_at IS NULL ORDER BY member_id',
    [id]
  );
  return rows.map((row) => row.member_id);
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

/** Runs `change` on a connection holding the membership lock while `request` waits for it. */
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

async function createTask(
  headers: Record<string, string>,
  projectId: string,
  name: string,
  assigneeIds?: string[]
) {
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
  const row = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM tasks WHERE task_name = $1', [name]);
  return Number(row?.count ?? 0);
}

describe('responsibility assignment respects the division', () => {
  it('refuses a foreign owner at creation and writes nothing', async () => {
    const manager = await login('1002');
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/responsibilities',
      headers: manager,
      payload: { name: 'Foreign owner area', divisionId: DEV, ownerMemberId: 'MEM-B' }
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    const created = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM responsibilities WHERE name = 'Foreign owner area'"
    );
    expect(created?.count).toBe('0');
  });

  it('refuses an additional member with read-only access and saves no member at all', async () => {
    const manager = await login('1002');
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/responsibilities',
      headers: manager,
      payload: { name: 'Mixed member area', divisionId: DEV, additionalMemberIds: ['MEM-A', 'MEM-READ'] }
    });
    // MEM-READ holds WORK in DEV, so the DEV case is eligible; the same person is only READ in ENG.
    expect(response.statusCode, response.body).toBe(200);
    const manager2 = await login('1003');
    const mixed = await app.inject({
      method: 'POST',
      url: '/api/manager/responsibilities',
      headers: manager2,
      payload: { name: 'Mixed read area', divisionId: ENG, additionalMemberIds: ['MEM-B', 'MEM-READ'] }
    });
    expect(mixed.statusCode, mixed.body).toBe(400);
    expect(mixed.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    const created = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM responsibilities WHERE name = 'Mixed read area'"
    );
    expect(created?.count).toBe('0');
  });

  it('refuses a forged foreign additional member on an edit and keeps the stored set', async () => {
    const manager = await login('1002');
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-A',
      headers: manager,
      payload: { revision: await responsibilityRevision('RSP-A'), additionalMemberIds: ['MEM-B'] }
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    // The retained historical relationship is untouched by the refused operation.
    expect(await activeResponsibilityMembers('RSP-A')).toEqual(['MEM-PAST']);
  });

  it('preserves an inactive retained member and an unchanged owner on an unrelated edit', async () => {
    const manager = await login('1002');
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-A',
      headers: manager,
      payload: { revision: await responsibilityRevision('RSP-A'), description: 'Renamed scope only' }
    });
    expect(response.statusCode, response.body).toBe(200);
    const row = await responsibilityRow('RSP-A');
    expect(row?.owner_member_id).toBe('MEM-A');
    expect(await activeResponsibilityMembers('RSP-A')).toEqual(['MEM-PAST']);
  });

  it('keeps the primary owner change ADMIN-only', async () => {
    const manager = await login('1002');
    const refusal = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-A',
      headers: manager,
      payload: { revision: await responsibilityRevision('RSP-A'), ownerMemberId: 'MEM-B' }
    });
    expect(refusal.statusCode, refusal.body).toBe(403);
    expect(refusal.json().error.code).toBe('AUTHORIZATION_DENIED');
    const admin = await login('1001');
    const accepted = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-A',
      headers: admin,
      payload: { revision: await responsibilityRevision('RSP-A'), ownerMemberId: 'MEM-A' }
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
  });

  it('validates every retained assignment when the division changes', async () => {
    const admin = await login('1001');
    // A DEV area whose only relationships are DEV members: moving it to ENG must refuse the whole
    // change, because the retained owner is not a WORK member of the destination.
    await insertResponsibility(db, { name: 'Dev area C', divisionId: DEV, ownerMemberId: 'MEM-A', sortOrder: 3 }, 'RSP-C');
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-C',
      headers: admin,
      payload: { revision: await responsibilityRevision('RSP-C'), divisionId: ENG }
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    const row = await responsibilityRow('RSP-C');
    expect(row?.division_id).toBe(DEV);
    expect(row?.owner_member_id).toBe('MEM-A');
  });

  it('refuses an unmapped area to a manager and a retired division to everybody', async () => {
    const manager = await login('1002');
    const unmapped = await app.inject({
      method: 'POST',
      url: '/api/manager/responsibilities',
      headers: manager,
      payload: { name: 'Unmapped area', divisionId: null }
    });
    expect(unmapped.statusCode, unmapped.body).toBe(400);
    expect(unmapped.json().error.code).toBe('DIVISION_REQUIRED');

    const admin = await login('1001');
    const retired = await app.inject({
      method: 'POST',
      url: '/api/manager/responsibilities',
      headers: admin,
      payload: { name: 'Retired area', divisionId: OLD }
    });
    expect(retired.statusCode, retired.body).toBe(409);
    expect(retired.json().error.code).toBe('INVALID_TRANSITION');
  });
});

describe('responsibility reordering stays inside one division', () => {
  async function setSort(id: string, order: number): Promise<void> {
    await db.query('UPDATE responsibilities SET sort_order = $2 WHERE responsibility_id = $1', [id, order]);
  }

  it('never touches a foreign-division neighbour with the same sort order', async () => {
    await setSort('RSP-A', 1);
    await setSort('RSP-B', 2);
    await setSort('RSP-ENG', 2);
    const before = await responsibilityRow('RSP-ENG');
    const manager = await login('1002');
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-B/order',
      headers: manager,
      payload: { revision: await responsibilityRevision('RSP-B'), direction: 'UP', expectedNeighborId: 'RSP-A' }
    });
    expect(response.statusCode, response.body).toBe(200);
    const after = await responsibilityRow('RSP-ENG');
    expect(after).toEqual(before);
    const a = await responsibilityRow('RSP-A');
    const b = await responsibilityRow('RSP-B');
    expect(b!.sort_order).toBeLessThan(a!.sort_order);
  });

  it('refuses a foreign expected neighbour', async () => {
    const manager = await login('1002');
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-B/order',
      headers: manager,
      payload: { revision: await responsibilityRevision('RSP-B'), direction: 'UP', expectedNeighborId: 'RSP-ENG' }
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('EDIT_CONFLICT');
  });

  it('refuses a move past the boundary of the division group', async () => {
    const manager = await login('1002');
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-A/order',
      headers: manager,
      payload: { revision: await responsibilityRevision('RSP-A'), direction: 'UP', expectedNeighborId: null }
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('separates equal sort orders deterministically and refuses a stale revision', async () => {
    await setSort('RSP-A', 5);
    await setSort('RSP-B', 5);
    const manager = await login('1002');
    const staleA = await responsibilityRevision('RSP-A');
    const moved = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-B/order',
      headers: manager,
      payload: { revision: await responsibilityRevision('RSP-B'), direction: 'UP', expectedNeighborId: 'RSP-A' }
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const a = await responsibilityRow('RSP-A');
    const b = await responsibilityRow('RSP-B');
    expect(b!.sort_order).toBeLessThan(a!.sort_order);
    expect(b!.sort_order).not.toBe(a!.sort_order);

    // The record that was renumbered carries a new revision, so a draft loaded before it is stale.
    expect(a!.revision).toBeGreaterThan(staleA);
    const staleAgain = await app.inject({
      method: 'PATCH',
      url: '/api/manager/responsibilities/RSP-A/order',
      headers: manager,
      payload: { revision: staleA, direction: 'DOWN', expectedNeighborId: 'RSP-B' }
    });
    expect(staleAgain.statusCode, staleAgain.body).toBe(409);
    expect(staleAgain.json().error.code).toBe('EDIT_CONFLICT');
  });
});

describe('project transfer reloads the assignment set inside the transaction', () => {
  it('refuses a transfer when a child assignment is committed while it waits for the lock', async () => {
    const admin = await login('1001');
    const project = await db.one<{ revision: number }>("SELECT revision FROM projects WHERE project_id = 'PRJ-FREE'");
    const response = await raceWithLock(
      () =>
        app.inject({
          method: 'POST',
          url: '/api/admin/projects/PRJ-FREE/transfer-division',
          headers: admin,
          payload: { revision: project?.revision, divisionId: ENG, confirmed: true }
        }),
      async (client) => {
        // A DEV-only worker is assigned while the transfer is queued on the lock.
        await client.query(
          `INSERT INTO tasks (task_id, project_id, task_name, owner_member_id, status, priority)
           VALUES ('TSK-RACE','PRJ-FREE','Racing owner','MEM-A','Not Started','Medium')`
        );
        await client.query(
          `INSERT INTO task_assignees (assignment_id, task_id, member_id, assigned_by)
           VALUES ('TA-RACE','TSK-RACE','MEM-A','fixture')`
        );
      }
    );
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    const row = await db.one<{ division_id: string }>("SELECT division_id FROM projects WHERE project_id = 'PRJ-FREE'");
    expect(row?.division_id).toBe(DEV);
    const kept = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM task_assignees WHERE task_id = 'TSK-RACE' AND removed_at IS NULL"
    );
    expect(kept?.count).toBe('1');
  });

  it('moves a project between two different divisions when every relationship stays eligible', async () => {
    const admin = await login('1001');
    await db.query(
      `INSERT INTO tasks (task_id, project_id, task_name, owner_member_id, status, priority)
       VALUES ('TSK-ENG','PRJ-FREE','Engineering owner','MEM-B','Not Started','Medium')`
    );
    await db.query(
      `INSERT INTO task_assignees (assignment_id, task_id, member_id, assigned_by)
       VALUES ('TA-ENG','TSK-ENG','MEM-B','fixture')`
    );
    const project = await db.one<{ revision: number }>("SELECT revision FROM projects WHERE project_id = 'PRJ-FREE'");
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/projects/PRJ-FREE/transfer-division',
      headers: admin,
      payload: { revision: project?.revision, divisionId: ENG, confirmed: true }
    });
    expect(response.statusCode, response.body).toBe(200);
    const row = await db.one<{ division_id: string }>("SELECT division_id FROM projects WHERE project_id = 'PRJ-FREE'");
    expect(row?.division_id).toBe(ENG);
    const audit = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE entity_id = 'PRJ-FREE' AND action = 'PROJECT_DIVISION_TRANSFERRED'"
    );
    expect(audit?.count).toBe('1');
  });
});

describe('transaction-time authorization of manager writes', () => {
  it('refuses a prepared write whose actor was demoted to MEMBER while the membership stayed', async () => {
    const manager = await login('1002');
    const response = await raceWithLock(
      () => createTask(manager, 'PRJ-DEV', 'Demoted writer'),
      async (client) => {
        await client.query("UPDATE members SET role = 'MEMBER' WHERE member_id = 'MEM-MGR'");
      }
    );
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json().error.code).toBe('AUTHORIZATION_DENIED');
    expect(await taskCount('Demoted writer')).toBe(0);
    const grants = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM member_divisions WHERE member_id = 'MEM-MGR' AND removed_at IS NULL"
    );
    expect(grants?.count).toBe('1');
  });

  it('refuses a prepared write whose actor was demoted to VIEWER while the membership stayed', async () => {
    const manager = await login('1002');
    const response = await raceWithLock(
      () => createTask(manager, 'PRJ-DEV', 'Viewer writer'),
      async (client) => {
        await client.query("UPDATE members SET role = 'VIEWER' WHERE member_id = 'MEM-MGR'");
      }
    );
    expect(response.statusCode, response.body).toBe(403);
    expect(await taskCount('Viewer writer')).toBe(0);
  });

  it('refuses an assignment approval after the actor lost the division', async () => {
    const manager = await login('1002');
    const created = await createTask(manager, 'PRJ-DEV', 'Approval target', ['MEM-A']);
    expect(created.statusCode, created.body).toBe(200);
    const task = await db.one<{ task_id: string; revision: number }>(
      "SELECT task_id, revision FROM tasks WHERE task_name = 'Approval target'"
    );
    const response = await raceWithLock(
      () =>
        app.inject({
          method: 'POST',
          url: `/api/manager/tasks/${task!.task_id}/approve`,
          headers: manager,
          payload: { revision: task?.revision, confirmed: true }
        }),
      async (client) => {
        await client.query(
          "UPDATE member_divisions SET removed_at = now(), removed_by = 'test' WHERE member_id = 'MEM-MGR'"
        );
      }
    );
    expect(response.statusCode, response.body).toBe(403);
    const approved = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE entity_id = $1 AND action = 'ASSIGNMENT_APPROVED'",
      [task!.task_id]
    );
    expect(approved?.count).toBe('0');
  });

  it('refuses a project archive after the actor was demoted', async () => {
    const manager = await login('1002');
    const project = await db.one<{ revision: number }>("SELECT revision FROM projects WHERE project_id = 'PRJ-FREE'");
    const response = await raceWithLock(
      () =>
        app.inject({
          method: 'POST',
          url: '/api/manager/projects/PRJ-FREE/archive',
          headers: manager,
          payload: { revision: project?.revision, confirmed: true }
        }),
      async (client) => {
        await client.query("UPDATE members SET role = 'MEMBER' WHERE member_id = 'MEM-MGR'");
      }
    );
    expect(response.statusCode, response.body).toBe(403);
    const row = await db.one<{ status: string }>("SELECT status FROM projects WHERE project_id = 'PRJ-FREE'");
    expect(row?.status).toBe('Active');
    const audit = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE entity_id = 'PRJ-FREE' AND action = 'PROJECT_ARCHIVED'"
    );
    expect(audit?.count).toBe('0');
  });

  it('refuses a manager write after the demotion was made through the member service path', async () => {
    const manager = await login('1002');
    const admin = await login('1001');
    const member = await db.one<{ revision: number }>("SELECT revision FROM members WHERE member_id = 'MEM-MGR'");
    const demoted = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-MGR',
      headers: admin,
      payload: { revision: member?.revision, role: 'MEMBER' }
    });
    expect(demoted.statusCode, demoted.body).toBe(200);
    // The old session must not carry the previous role into a write.
    const response = await createTask(manager, 'PRJ-DEV', 'After demotion');
    expect(response.statusCode, response.body).toBe(403);
    expect(await taskCount('After demotion')).toBe(0);
  });

  it('refuses a manager write after the membership was removed through the member service path', async () => {
    const manager = await login('1002');
    const admin = await login('1001');
    const member = await db.one<{ revision: number }>("SELECT revision FROM members WHERE member_id = 'MEM-MGR'");
    const removed = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-MGR',
      headers: admin,
      payload: { revision: member?.revision, divisionGrants: [] }
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const response = await createTask(manager, 'PRJ-DEV', 'After removal');
    expect(response.statusCode, response.body).toBe(403);
    expect(await taskCount('After removal')).toBe(0);
  });
});

describe('idempotent replay is authorized again', () => {
  it('answers a replayed create only while the actor still holds the capability, and never re-executes it', async () => {
    // A request-level identity snapshot is what a real request carries: it was verified when the
    // request started, so the replay path has to re-read the stored role itself.
    const identity: Identity = {
      memberId: 'MEM-MGR',
      name: 'Dev manager',
      email: 'manager@example.invalid',
      role: 'MANAGER',
      active: true,
      verified: true
    };
    const divisions = await loadScope(db, identity);
    const ctx = { db, identity, correlationId: 'replay-guard', divisions };
    const body: Parameters<typeof createTaskService>[1] = {
      idempotencyKey: 'replay-guard-key',
      projectId: 'PRJ-DEV',
      taskName: 'Replay guard task',
      deadline: '2026-12-20'
    };
    const first = await createTaskService(ctx, body);
    expect(first.replayed).toBe(false);

    // The exact same replay still succeeds while the manager is a manager.
    const replay = await createTaskService(ctx, body);
    expect(replay.replayed).toBe(true);
    expect(replay.task.taskId).toBe(first.task.taskId);

    await db.query("UPDATE members SET role = 'MEMBER' WHERE member_id = 'MEM-MGR'");
    await expect(createTaskService(ctx, body)).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    // The refused replay created nothing a second time.
    expect(await taskCount('Replay guard task')).toBe(1);
  });
});

describe('division creation and ordering', () => {
  async function divisionList(headers: Record<string, string>) {
    const response = await app.inject({ method: 'GET', url: '/api/manager/divisions', headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.items as { divisionId: string; name: string; status: string; sortOrder: number; _revision: number }[];
  }

  it('allocates distinct sort orders for new divisions and reorders them', async () => {
    const admin = await login('1001');
    for (const name of ['新課A', '新課B', '新課C']) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/admin/divisions',
        headers: admin,
        payload: { name }
      });
      expect(created.statusCode, created.body).toBe(200);
    }
    const items = await divisionList(admin);
    const orders = items.filter((item) => item.status === 'Active').map((item) => item.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
    const activeList = items.filter((item) => item.status === 'Active');
    const last = activeList[activeList.length - 1]!;
    expect(last.name).toBe('新課C');
    const previous = items.filter((item) => item.name === '新課B')[0]!;
    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/admin/divisions/${last.divisionId}/order`,
      headers: admin,
      payload: { revision: last._revision, direction: 'UP', expectedNeighborId: previous.divisionId }
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const after = await divisionList(admin);
    const names = after.filter((item) => item.status === 'Active').map((item) => item.name);
    expect(names.indexOf('新課C')).toBeLessThan(names.indexOf('新課B'));
  });

  it('replays a repeated creation instead of inserting a duplicate', async () => {
    const admin = await login('1001');
    const first = await app.inject({ method: 'POST', url: '/api/admin/divisions', headers: admin, payload: { name: '再送課' } });
    expect(first.statusCode, first.body).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/api/admin/divisions', headers: admin, payload: { name: '再送課' } });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().data.division.divisionId).toBe(first.json().data.division.divisionId);
    const count = await db.one<{ count: string }>("SELECT count(*)::text AS count FROM divisions WHERE name = '再送課'");
    expect(count?.count).toBe('1');
  });

  it('reorders records that share a sort order', async () => {
    const admin = await login('1001');
    await db.query("UPDATE divisions SET sort_order = 7 WHERE division_id IN ('DIV-ENG','DIV-PROD')");
    const items = await divisionList(admin);
    const tied = items.filter((item) => item.status === 'Active' && item.sortOrder === 7);
    expect(tied).toHaveLength(2);
    const first = tied[0]!;
    const second = tied[1]!;
    expect(second.sortOrder).toBe(first.sortOrder);
    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/admin/divisions/${second.divisionId}/order`,
      headers: admin,
      payload: { revision: second._revision, direction: 'UP', expectedNeighborId: first.divisionId }
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const after = await divisionList(admin);
    const afterTied = after.filter((item) => item.status === 'Active' && item.sortOrder !== 1);
    expect(afterTied[0]!.divisionId).toBe(second.divisionId);
  });

  it('refuses a stale reorder and never crosses the active/retired boundary', async () => {
    const admin = await login('1001');
    const items = await divisionList(admin);
    const active = items.filter((item) => item.status === 'Active');
    const lastActive = active[active.length - 1]!;
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/admin/divisions/${lastActive.divisionId}/order`,
      headers: admin,
      payload: { revision: lastActive._revision + 5, direction: 'UP', expectedNeighborId: active[0]!.divisionId }
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe('EDIT_CONFLICT');

    const boundary = await app.inject({
      method: 'PATCH',
      url: `/api/admin/divisions/${lastActive.divisionId}/order`,
      headers: admin,
      payload: { revision: lastActive._revision, direction: 'DOWN', expectedNeighborId: OLD }
    });
    expect(boundary.statusCode, boundary.body).toBe(409);
    expect(boundary.json().error.code).toBe('INVALID_TRANSITION');
    const retired = await db.one<{ sort_order: number; revision: number }>(
      "SELECT sort_order, revision FROM divisions WHERE division_id = 'DIV-OLD'"
    );
    expect(retired?.sort_order).toBe(9);
    expect(retired?.revision).toBe(1);
  });
});

describe('workload report and request queue follow the division switch', () => {
  // A wide custom period, so the two fixture tasks are inside it whatever "today" is.
  const period = 'mode=CUSTOM&start=2026-01-01&end=2026-12-31';

  it('refuses a foreign division and counts only the selected one', async () => {
    const single = await login('1002');
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/manager/reports/workload?${period}&divisionId=${ENG}`,
      headers: single
    });
    expect(foreign.statusCode, foreign.body).toBe(404);

    const aggregate = await app.inject({
      method: 'GET',
      url: `/api/manager/reports/workload?${period}`,
      headers: single
    });
    expect(aggregate.statusCode, aggregate.body).toBe(200);
    expect(aggregate.json().data.summary.dueTasks).toBe(1);

    // A dual-division manager narrows to the division that owns the other task.
    const dual = await login('1003');
    await insertProject(
      db,
      { projectName: 'Engineering project', divisionId: ENG, status: 'Active', dashboardVisibility: 'INTERNAL' },
      'PRJ-ENG'
    );
    await insertTask(db, { projectId: 'PRJ-ENG', taskName: 'Engineering due task', dueDate: '2026-11-20' }, 'TSK-ENG-DUE');
    const narrowed = await app.inject({
      method: 'GET',
      url: `/api/manager/reports/workload?${period}&divisionId=${ENG}`,
      headers: dual
    });
    expect(narrowed.statusCode, narrowed.body).toBe(200);
    expect(narrowed.json().data.summary.dueTasks).toBe(1);

    const foreignDrilldown = await app.inject({
      method: 'GET',
      url: `/api/manager/reports/workload/tasks?${period}&kind=DUE&divisionId=${ENG}`,
      headers: single
    });
    expect(foreignDrilldown.statusCode, foreignDrilldown.body).toBe(404);
  });

  it('refuses a foreign division on the request queue and keeps the readable scope', async () => {
    const single = await login('1002');
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/manager/requests?divisionId=${ENG}`,
      headers: single
    });
    expect(foreign.statusCode, foreign.body).toBe(404);

    const own = await app.inject({
      method: 'GET',
      url: `/api/manager/requests?divisionId=${DEV}`,
      headers: single
    });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json().data.total).toBe(0);
  });
});

describe('retired divisions: history readable, new access refused', () => {
  it('keeps a retained grant to a retired division on an unrelated member edit', async () => {
    const admin = await login('1001');
    const member = await db.one<{ revision: number }>("SELECT revision FROM members WHERE member_id = 'MEM-OLD'");
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-OLD',
      headers: admin,
      payload: {
        revision: member?.revision,
        position: 'Senior',
        divisionGrants: [
          { divisionId: DEV, accessKind: 'WORK' },
          { divisionId: OLD, accessKind: 'WORK' }
        ]
      }
    });
    expect(response.statusCode, response.body).toBe(200);
    const rows = await db.many<{ division_id: string }>(
      "SELECT division_id FROM member_divisions WHERE member_id = 'MEM-OLD' AND removed_at IS NULL ORDER BY division_id"
    );
    expect(rows.map((row) => row.division_id)).toEqual([DEV, OLD].sort());
  });

  it('refuses a new grant in a retired division', async () => {
    const admin = await login('1001');
    const member = await db.one<{ revision: number }>("SELECT revision FROM members WHERE member_id = 'MEM-B'");
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-B',
      headers: admin,
      payload: {
        revision: member?.revision,
        divisionGrants: [
          { divisionId: ENG, accessKind: 'WORK' },
          { divisionId: OLD, accessKind: 'READ' }
        ]
      }
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('INVALID_TRANSITION');
  });

  it('shows a retired division to a reader who may read it, and to oversight, but not to a stranger', async () => {
    const admin = await login('1001');
    const adminSession = await app.inject({ method: 'GET', url: '/api/session', headers: admin });
    const adminDivisions = adminSession.json().data.divisions as { readable: { divisionId: string }[]; writable: { divisionId: string }[] };
    expect(adminDivisions.readable.map((entry) => entry.divisionId)).toContain(OLD);
    expect(adminDivisions.writable.map((entry) => entry.divisionId)).not.toContain(OLD);

    await db.query(
      `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password)
       VALUES ('MEM-OLD','1009',$1,false)`,
      [hash]
    );
    const retained = await login('1009');
    const retainedSession = await app.inject({ method: 'GET', url: '/api/session', headers: retained });
    const retainedDivisions = retainedSession.json().data.divisions as { readable: { divisionId: string }[] };
    expect(retainedDivisions.readable.map((entry) => entry.divisionId)).toContain(OLD);

    const overseer = await login('1004');
    const overseerSession = await app.inject({ method: 'GET', url: '/api/session', headers: overseer });
    const overseerDivisions = overseerSession.json().data.divisions as { readable: { divisionId: string }[] };
    expect(overseerDivisions.readable.map((entry) => entry.divisionId)).toContain(OLD);
  });

  it('keeps retired-division history readable in lists, detail and totals for a retained manager', async () => {
    const retained = await login('1005');
    const list = await app.inject({ method: 'GET', url: '/api/manager/projects?pageSize=100', headers: retained });
    expect(list.statusCode, list.body).toBe(200);
    const items = list.json().data.items as { projectId: string }[];
    expect(items.map((item) => item.projectId)).toContain('PRJ-OLD');

    const detail = await app.inject({ method: 'GET', url: '/api/manager/projects/PRJ-OLD', headers: retained });
    expect(detail.statusCode, detail.body).toBe(200);

    const overview = await app.inject({ method: 'GET', url: '/api/manager/overview', headers: retained });
    expect(overview.statusCode, overview.body).toBe(200);
    expect(overview.json().data.counts.openWork).toBeGreaterThan(0);
  });

  it('withholds retired-division history from a manager without that grant', async () => {
    const stranger = await login('1002');
    const list = await app.inject({ method: 'GET', url: '/api/manager/projects?pageSize=100', headers: stranger });
    expect(list.statusCode, list.body).toBe(200);
    const items = list.json().data.items as { projectId: string }[];
    expect(items.map((item) => item.projectId)).not.toContain('PRJ-OLD');
    const detail = await app.inject({ method: 'GET', url: '/api/manager/projects/PRJ-OLD', headers: stranger });
    expect(detail.statusCode, detail.body).toBe(404);
  });

  it('still refuses new work in the retired division', async () => {
    const retained = await login('1005');
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/tasks',
      headers: retained,
      payload: {
        idempotencyKey: `retired-${Math.random().toString(36).slice(2)}`,
        projectId: 'PRJ-OLD',
        taskName: 'New work in a retired division',
        deadline: '2026-12-20'
      }
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('INVALID_TRANSITION');
    expect(await taskCount('New work in a retired division')).toBe(0);
  });
});
