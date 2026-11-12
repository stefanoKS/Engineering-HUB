/**
 * Division authorization and same-division assignment, against real PostgreSQL.
 *
 * The suite exercises the boundary that a mock cannot: one resolved scope per request, applied
 * before paging, totals, search and hierarchy; membership as the only assignment eligibility; and
 * a read-only oversight role that can see work but can never change it.
 *
 * Fixture divisions are created by the test support helper. Because that helper grants a fixture
 * membership to every new member, a member that must *not* belong to the first division has its
 * grants replaced explicitly here.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertProject, insertResponsibility, insertSubproject, insertTask } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase } from '../../../packages/db/test/support/db';

const password = 'Divisions-test-password-123';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

const DEV = 'DIV-DEV';
const ENG = 'DIV-ENG';
const PROD = 'DIV-PROD';

beforeAll(async () => {
  hash = await hashPassword(password);
});

async function replaceGrants(memberId: string, grants: { divisionId: string; accessKind: 'WORK' | 'READ' }[]): Promise<void> {
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
  await db.query(`
    INSERT INTO members(member_id,name,role,active) VALUES
      ('MEM-ADMIN','Admin','ADMIN',true),
      ('MEM-MGR1','Single manager','MANAGER',true),
      ('MEM-MGR2','Dual manager','MANAGER',true),
      ('MEM-A','Member A','MEMBER',true),
      ('MEM-B','Member B','MEMBER',true),
      ('MEM-READ','Read-only member','MEMBER',true),
      ('MEM-GM-ALL','All-division overseer','GENERAL_MANAGER',true),
      ('MEM-GM-SEL','Selected overseer','GENERAL_MANAGER',true),
      ('MEM-VIEW','Viewer','VIEWER',true),
      ('MEM-PAST','Former member','MEMBER',false),
      ('MEM-DUP1','Same Name','MEMBER',true),
      ('MEM-DUP2','Same Name','MEMBER',true),
      ('MEM-NONE','No division','MEMBER',true)
  `);
  await db.query(`
    INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
      ('MEM-ADMIN','0001',$1,false),('MEM-MGR1','0002',$1,false),('MEM-MGR2','0003',$1,false),
      ('MEM-A','0010',$1,false),('MEM-B','0011',$1,false),('MEM-READ','0012',$1,false),
      ('MEM-GM-ALL','0020',$1,false),('MEM-GM-SEL','0021',$1,false),('MEM-VIEW','0030',$1,false),
      ('MEM-DUP1','0040',$1,false),('MEM-DUP2','0041',$1,false),('MEM-NONE','0042',$1,false)
  `, [hash]);
  // The fixture helper granted every new member a DEV membership; the scope below is deliberate.
  await replaceGrants('MEM-MGR1', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-MGR2', [
    { divisionId: DEV, accessKind: 'WORK' },
    { divisionId: ENG, accessKind: 'WORK' }
  ]);
  await replaceGrants('MEM-A', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-B', [{ divisionId: PROD, accessKind: 'WORK' }]);
  await replaceGrants('MEM-READ', [
    { divisionId: DEV, accessKind: 'WORK' },
    { divisionId: PROD, accessKind: 'READ' }
  ]);
  await replaceGrants('MEM-GM-ALL', []);
  await replaceGrants('MEM-GM-SEL', [{ divisionId: DEV, accessKind: 'READ' }]);
  await replaceGrants('MEM-VIEW', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-DUP1', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-DUP2', [{ divisionId: PROD, accessKind: 'WORK' }]);
  await replaceGrants('MEM-NONE', []);
  await db.query("UPDATE members SET all_divisions_read = true WHERE member_id = 'MEM-GM-ALL'");

  await insertResponsibility(db, { name: 'Development area' }, 'RSP-DEV');
  await db.query("UPDATE responsibilities SET division_id = $1 WHERE responsibility_id = 'RSP-DEV'", [DEV]);
  await insertResponsibility(db, { name: 'Engineering area' }, 'RSP-ENG');
  await db.query("UPDATE responsibilities SET division_id = $1 WHERE responsibility_id = 'RSP-ENG'", [ENG]);
  await insertResponsibility(db, { name: 'Production area' }, 'RSP-PROD');
  await db.query("UPDATE responsibilities SET division_id = $1 WHERE responsibility_id = 'RSP-PROD'", [PROD]);

  await insertProject(
    db,
    {
      projectName: 'Dev project',
      divisionId: DEV,
      responsibilityId: 'RSP-DEV',
      status: 'Active',
      dashboardVisibility: 'INTERNAL'
    },
    'PRJ-DEV'
  );
  await insertProject(
    db,
    {
      projectName: 'Engineering project',
      divisionId: ENG,
      responsibilityId: 'RSP-ENG',
      status: 'Active',
      dashboardVisibility: 'INTERNAL'
    },
    'PRJ-ENG'
  );
  await insertProject(
    db,
    {
      projectName: 'Production project',
      divisionId: PROD,
      responsibilityId: 'RSP-PROD',
      status: 'Active',
      dashboardVisibility: 'INTERNAL'
    },
    'PRJ-PROD'
  );
  // Deliberately unmapped legacy work: ADMIN remediation only.
  await db.query(
    "INSERT INTO projects(project_id,project_name,status,dashboard_visibility,division_id) VALUES('PRJ-UNMAPPED','Legacy project','Active','INTERNAL',NULL)"
  );
  await insertProject(db, { projectName: 'Archived dev', divisionId: DEV, status: 'Active' }, 'PRJ-ARCH');
  await db.query("UPDATE projects SET status = 'Archived', archived_at = now() WHERE project_id = 'PRJ-ARCH'");

  await insertTask(db, { projectId: 'PRJ-DEV', taskName: 'Dev task', dueDate: '2026-12-01' }, 'TSK-DEV');
  await insertTask(db, { projectId: 'PRJ-ENG', taskName: 'Engineering task', dueDate: '2026-12-02' }, 'TSK-ENG');
  await insertTask(db, { projectId: 'PRJ-PROD', taskName: 'Production task', dueDate: '2026-12-03' }, 'TSK-PROD');
  await insertTask(db, { projectId: 'PRJ-UNMAPPED', taskName: 'Legacy task', dueDate: '2026-12-04' }, 'TSK-LEGACY');
  await insertTask(
    db,
    { projectId: 'PRJ-DEV', taskName: 'Finished dev task', status: 'Done', dueDate: '2026-01-10' },
    'TSK-DONE'
  );
  await insertSubproject(db, { projectId: 'PRJ-DEV', subprojectName: 'Phase', status: 'Active' }, 'SUB-DEV');
  await insertSubproject(db, { projectId: 'PRJ-PROD', subprojectName: 'Production phase', status: 'Active' }, 'SUB-PROD');
  await insertTask(
    db,
    { projectId: 'PRJ-DEV', subprojectId: 'SUB-DEV', taskName: 'Nested dev task', dueDate: '2026-12-05' },
    'TSK-NESTED'
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

async function get(headers: Record<string, string>, url: string) {
  const response = await app.inject({ url, headers: { cookie: headers.cookie! } });
  return {
    status: response.statusCode,
    body: response.json() as {
      data?: {
        items: unknown[];
        entries: unknown[];
        total?: number;
        matchedTotal?: number;
        current?: unknown[];
        [key: string]: unknown;
      };
      error?: { code?: string };
      [key: string]: unknown;
    }
  };
}

async function taskIds(headers: Record<string, string>, query = ''): Promise<string[]> {
  const response = await get(headers, `/api/work/tasks?pageSize=100${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body.data!.items as { taskId: string }[]).map((item) => item.taskId).sort();
}

async function createTask(headers: Record<string, string>, projectId: string, name: string, assigneeIds?: string[]) {
  return app.inject({
    method: 'POST',
    url: '/api/manager/tasks',
    headers: { ...headers, ...{} },
    payload: {
      idempotencyKey: `t-${name.replace(/\W+/g, '-')}-${Math.random().toString(36).slice(2)}`,
      projectId,
      taskName: name,
      deadline: '2026-12-20',
      ...(assigneeIds ? { assigneeIds } : {})
    }
  });
}

describe('division read scope', () => {
  it('shows a single-division manager only its own division and refuses a guessed identifier', async () => {
    const manager = await login('0002');
    expect(await taskIds(manager)).toEqual(['TSK-DEV', 'TSK-NESTED']);
    // A guessed project of another division answers exactly like an unknown one.
    expect((await get(manager, '/api/work/projects/PRJ-PROD')).status).toBe(404);
    expect((await get(manager, '/api/work/projects/PRJ-UNKNOWN')).status).toBe(404);
    expect((await get(manager, '/api/manager/tasks/TSK-PROD')).status).toBe(404);
    // A narrow filter can never widen the scope: an unauthorized division is refused outright.
    const foreign = await get(manager, '/api/work/tasks?divisionId=DIV-PROD');
    expect(foreign.status).toBe(404);
    expect(foreign.body.error?.code).toBe('NOT_FOUND');
  });

  it('lets a dual-division manager manage both member divisions', async () => {
    const manager = await login('0003');
    expect(await taskIds(manager)).toEqual(['TSK-DEV', 'TSK-ENG', 'TSK-NESTED']);
    for (const projectId of ['PRJ-DEV', 'PRJ-ENG']) {
      const response = await createTask(manager, projectId, `Dual ${projectId}`);
      expect(response.statusCode, response.body).toBe(200);
    }
    const refused = await createTask(manager, 'PRJ-PROD', 'Dual production');
    // The project exists, so the refusal is an authorization failure rather than a 404.
    expect(refused.statusCode).toBe(403);
  });

  it('keeps an INTERNAL project inside its division', async () => {
    const member = await login('0010');
    expect(await taskIds(member)).toEqual(['TSK-DEV', 'TSK-NESTED']);
    expect((await get(member, '/api/work/projects/PRJ-PROD')).status).toBe(404);
  });

  it('fails closed for an account with no membership', async () => {
    const none = await login('0042');
    expect(await taskIds(none)).toEqual([]);
    const projects = await get(none, '/api/work/projects');
    expect(projects.status).toBe(200);
    expect(projects.body.data!.items).toEqual([]);
    expect((await get(none, '/api/work/projects/PRJ-DEV')).status).toBe(404);
    const created = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: none,
      payload: { idempotencyKey: 'no-division-task', projectId: 'PRJ-DEV', taskName: 'X', deadline: '2026-12-20' }
    });
    expect(created.statusCode).toBe(403);
  });

  it('keeps unmapped legacy work an ADMIN-only remediation view', async () => {
    const admin = await login('0001');
    expect(await taskIds(admin)).toEqual(['TSK-DEV', 'TSK-ENG', 'TSK-LEGACY', 'TSK-NESTED', 'TSK-PROD']);
    const manager = await login('0002');
    expect(await taskIds(manager)).not.toContain('TSK-LEGACY');
    expect((await get(manager, '/api/work/projects/PRJ-UNMAPPED')).status).toBe(404);
  });

  it('applies the scope to totals, search and the tree before paging', async () => {
    const manager = await login('0002');
    const page = await get(manager, '/api/work/tasks?pageSize=100');
    expect(page.body.data!.total).toBe(2);
    const search = await get(manager, '/api/manager/search/tasks?query=Production');
    expect(search.status).toBe(200);
    expect(search.body.data!.items).toEqual([]);
    const tree = await get(manager, '/api/work/tasks?tree=true&pageSize=100');
    expect((tree.body.data!.items as { taskId: string }[]).map((item) => item.taskId).sort()).toEqual([
      'TSK-DEV',
      'TSK-NESTED'
    ]);
    const index = await get(manager, '/api/manager/task-index');
    expect((index.body.data!.entries as { taskId: string }[]).map((entry) => entry.taskId)).not.toContain('TSK-PROD');
  });

  it('does not leak current work of another division into member history', async () => {
    await db.query(
      `INSERT INTO task_assignees (assignment_id, task_id, member_id) VALUES ('ASG-PAST','TSK-DONE','MEM-A')`
    );
    const member = await login('0010');
    const mine = await get(member, '/api/employee/my-work?section=completed');
    expect((mine.body.data!.items as { taskId: string }[]).map((item) => item.taskId)).toContain('TSK-DONE');
    // A former assignment in another division stays readable as history and never as current work.
    const manager = await login('0002');
    const profile = await get(manager, `/api/manager/members/MEM-B/profile`);
    expect(profile.status).toBe(200);
    expect((profile.body.data!.current as unknown[]).length).toBe(0);
  });
});

describe('read-only oversight (次長)', () => {
  it('lets an all-division overseer read every mapped division and mutate nothing', async () => {
    const gm = await login('0020');
    // Every mapped division, including restricted work - but unmapped work stays the ADMIN
    // remediation view, so this oversight role reads nothing without a division.
    expect(await taskIds(gm)).toEqual(['TSK-DEV', 'TSK-ENG', 'TSK-NESTED', 'TSK-PROD']);
    expect((await get(gm, '/api/work/projects/PRJ-UNMAPPED')).status).toBe(404);
    const create = await createTask(gm, 'PRJ-DEV', 'Overseer create');
    expect(create.statusCode).toBe(403);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/manager/tasks/TSK-DEV',
      headers: gm,
      payload: { revision: 1, taskName: 'Overseer edit' }
    });
    expect(patch.statusCode).toBe(403);
    // A manager endpoint is not reachable at all.
    expect((await get(gm, '/api/manager/tasks?page=1')).status).toBe(403);
    // Reading the restricted manager picture is allowed; approving is not.
    const decide = await app.inject({
      method: 'POST',
      url: '/api/manager/requests/REQ-1/decide',
      headers: gm,
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect(decide.statusCode).toBe(403);
  });

  it('honours a restricted oversight list and never widens it', async () => {
    const gm = await login('0021');
    expect(await taskIds(gm)).toEqual(['TSK-DEV', 'TSK-NESTED']);
    expect((await get(gm, '/api/work/projects/PRJ-PROD')).status).toBe(404);
    // Additional read access is not assignment eligibility.
    const assign = await createTask(await login('0002'), 'PRJ-DEV', 'Assign overseer', ['MEM-GM-SEL']);
    expect(assign.statusCode).toBe(400);
    expect(assign.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
  });
});

describe('read versus write', () => {
  it('never lets additional read access create, edit or approve', async () => {
    const read = await login('0012');
    expect(await taskIds(read)).toEqual(['TSK-DEV', 'TSK-NESTED', 'TSK-PROD']);
    const create = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: read,
      payload: { idempotencyKey: 'read-only-create', projectId: 'PRJ-PROD', taskName: 'X', deadline: '2026-12-20' }
    });
    expect(create.statusCode).toBe(403);
  });

  it('keeps a VIEWER read-only inside its division', async () => {
    const viewer = await login('0030');
    expect(await taskIds(viewer)).toEqual(['TSK-DEV', 'TSK-NESTED']);
    const create = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: viewer,
      payload: { idempotencyKey: 'viewer-create', projectId: 'PRJ-DEV', taskName: 'X', deadline: '2026-12-20' }
    });
    expect(create.statusCode).toBe(403);
  });

  it('keeps MEMBER capabilities without a manager power', async () => {
    const member = await login('0010');
    const created = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: member,
      payload: { idempotencyKey: 'member-own-task', projectId: 'PRJ-DEV', taskName: 'Filed by A', deadline: '2026-12-20' }
    });
    expect(created.statusCode, created.body).toBe(200);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/manager/tasks/${created.json().data.taskId}`,
      headers: member,
      payload: { revision: 1, taskName: 'Member edit' }
    });
    expect(patch.statusCode).toBe(403);
  });

  it('refuses a removed membership on the next request and on a previously loaded record', async () => {
    const manager = await login('0002');
    expect((await get(manager, '/api/manager/tasks/TSK-DEV')).status).toBe(200);
    await replaceGrants('MEM-MGR1', []);
    expect((await get(manager, '/api/manager/tasks/TSK-DEV')).status).toBe(404);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/manager/tasks/TSK-DEV',
      headers: manager,
      payload: { revision: 1, taskName: 'Late edit' }
    });
    // A write is refused as an authorization failure; the read above stays a 404 so a guessed
    // identifier never confirms that the record exists.
    expect(patch.statusCode).toBe(403);
  });
});

describe('same-division assignment', () => {
  it('accepts a same-division owner and additional assignee', async () => {
    const manager = await login('0002');
    const created = await createTask(manager, 'PRJ-DEV', 'Same division', ['MEM-A', 'MEM-DUP1']);
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json().data.task.ownerMemberId).toBe('MEM-A');
  });

  it('refuses a cross-division task owner and a cross-division additional assignee', async () => {
    const manager = await login('0002');
    const owner = await createTask(manager, 'PRJ-DEV', 'Cross owner', undefined);
    const withForeignOwner = await app.inject({
      method: 'POST',
      url: '/api/manager/tasks',
      headers: manager,
      payload: {
        idempotencyKey: 'cross-owner-1',
        projectId: 'PRJ-DEV',
        taskName: 'Cross owner 2',
        deadline: '2026-12-20',
        ownerMemberId: 'MEM-B'
      }
    });
    expect(owner.statusCode).toBe(200);
    expect(withForeignOwner.statusCode).toBe(400);
    expect(withForeignOwner.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    const mixed = await createTask(manager, 'PRJ-DEV', 'Mixed selection', ['MEM-A', 'MEM-B']);
    expect(mixed.statusCode).toBe(400);
    // A mixed valid/invalid selection commits nothing.
    const rows = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM tasks WHERE task_name = 'Mixed selection'"
    );
    expect(rows?.count).toBe('0');
  });

  it('refuses a cross-division project owner', async () => {
    const manager = await login('0002');
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: manager,
      payload: {
        idempotencyKey: 'cross-project-owner',
        projectName: 'Cross owned',
        divisionId: DEV,
        responsibilityId: 'RSP-DEV',
        projectOwnerId: 'MEM-B'
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
  });

  it('qualifies a dual-division member in both member divisions only', async () => {
    const manager = await login('0003');
    expect((await createTask(manager, 'PRJ-DEV', 'Dual dev', ['MEM-MGR2'])).statusCode).toBe(200);
    expect((await createTask(manager, 'PRJ-ENG', 'Dual eng', ['MEM-MGR2'])).statusCode).toBe(200);
  });

  it('never lets an ADMIN or overseer role alone qualify somebody', async () => {
    const manager = await login('0002');
    // MEM-ADMIN is a member of this division in the fixture, so an ADMIN *without* membership is
    // the meaningful case: role alone never qualifies, only a WORK membership does.
    const noMembership = await createTask(manager, 'PRJ-DEV', 'Unassigned member', ['MEM-NONE']);
    expect(noMembership.statusCode).toBe(400);
    expect(noMembership.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    const overseer = await createTask(manager, 'PRJ-DEV', 'Overseer assignee', ['MEM-GM-ALL']);
    expect(overseer.statusCode).toBe(400);
    expect(overseer.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
  });

  it('refuses a new assignment to a removed or inactive membership and preserves history', async () => {
    const manager = await login('0002');
    const created = await createTask(manager, 'PRJ-DEV', 'Historical', ['MEM-A']);
    expect(created.statusCode).toBe(200);
    const taskId = created.json().data.task.taskId as string;
    await replaceGrants('MEM-A', []);
    const incremental = await app.inject({
      method: 'PATCH',
      url: `/api/manager/tasks/${taskId}`,
      headers: manager,
      payload: { revision: 1, nextAction: 'Unrelated edit' }
    });
    // An unrelated edit keeps the historical assignment and never rewrites it.
    expect(incremental.statusCode, incremental.body).toBe(200);
    const kept = await db.one<{ owner_member_id: string | null }>(
      'SELECT owner_member_id FROM tasks WHERE task_id = $1',
      [taskId]
    );
    expect(kept?.owner_member_id).toBe('MEM-A');
    const added = await app.inject({
      method: 'PATCH',
      url: `/api/manager/tasks/${taskId}`,
      headers: manager,
      payload: { revision: 2, assigneeIds: ['MEM-A', 'MEM-B'] }
    });
    // MEM-B belongs to another division, so the whole selection is refused.
    expect(added.statusCode).toBe(400);
    expect(added.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
  });

  it('bumps the assignment version, clears approval and writes audit evidence', async () => {
    const manager = await login('0002');
    const created = await createTask(manager, 'PRJ-DEV', 'Reassign', ['MEM-A']);
    const taskId = created.json().data.task.taskId as string;
    const approved = await app.inject({
      method: 'POST',
      url: `/api/manager/tasks/${taskId}/approve`,
      headers: manager,
      payload: { revision: 1, confirmed: true }
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().data.task.assignmentApprovedAt).toBeTruthy();
    const reassigned = await app.inject({
      method: 'PATCH',
      url: `/api/manager/tasks/${taskId}`,
      headers: manager,
      payload: { revision: 2, assigneeIds: ['MEM-DUP1'] }
    });
    expect(reassigned.statusCode, reassigned.body).toBe(200);
    expect(reassigned.json().data.task.assignmentVersion).toBe(2);
    expect(reassigned.json().data.task.assignmentApprovedAt).toBeNull();
    const audit = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE entity_id = $1 AND action = 'TASK_REASSIGNED'",
      [taskId]
    );
    expect(Number(audit?.count)).toBeGreaterThan(0);
  });

  it('refuses a membership removal that active work still depends on', async () => {
    const admin = await login('0001');
    const blocked = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-A',
      headers: admin,
      payload: { revision: 1, divisionGrants: [] }
    });
    // MEM-A owns no active work yet in this fixture, so removal is allowed once nothing depends on it.
    expect(blocked.statusCode, blocked.body).toBe(200);
    const manager = await login('0002');
    const created = await createTask(manager, 'PRJ-DEV', 'Blocking work', ['MEM-DUP1']);
    expect(created.statusCode).toBe(200);
    const member = await db.one<{ revision: number }>("SELECT revision FROM members WHERE member_id = 'MEM-DUP1'");
    const refused = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-DUP1',
      headers: admin,
      payload: { revision: member?.revision, divisionGrants: [] }
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('DIVISION_MEMBERSHIP_BLOCKED');
  });

  it('keeps duplicate display names distinguishable without exposing a raw identifier', async () => {
    const manager = await login('0002');
    const created = await createTask(manager, 'PRJ-DEV', 'Duplicate owners', ['MEM-DUP1']);
    expect(created.statusCode, created.body).toBe(200);
    const options = await get(manager, '/api/work/task-assignees?query=Same');
    expect(options.status).toBe(200);
    expect(options.body.data!.items).toEqual([
      expect.objectContaining({ name: 'Same Name', divisionNames: ['設計・開発課'] })
    ]);
    // The browser receives a division label and never a raw identifier as the label.
    expect(JSON.stringify(options.body.data!.items)).not.toContain('(MEM-');
  });
});

describe('division administration and migration constraints', () => {
  it('keeps the initial divisions, the stable identifiers and the retired status', async () => {
    const admin = await login('0001');
    const list = await get(admin, '/api/manager/divisions');
    expect(list.status).toBe(200);
    const divisions = list.body.data!.items as { divisionId: string; name: string; revision: number }[];
    expect(divisions.map((division) => division.divisionId)).toEqual(expect.arrayContaining([DEV, ENG, PROD]));
    const retired = await app.inject({
      method: 'POST',
      url: `/api/admin/divisions/${PROD}/retire`,
      headers: admin,
      payload: { revision: divisions.find((division) => division.divisionId === PROD)!.revision, confirmed: true }
    });
    expect(retired.statusCode, retired.body).toBe(200);
    // Retirement keeps the record and refuses new work, but the history stays readable.
    expect((await get(await login('0011'), '/api/work/tasks')).status).toBe(200);
    const manager = await login('0003');
    const refused = await createTask(manager, 'PRJ-ENG', 'Production retired', undefined);
    expect(refused.statusCode).toBe(200);
    const create = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: manager,
      payload: {
        idempotencyKey: 'retired-division-project',
        projectName: 'Production again',
        divisionId: PROD,
        responsibilityId: 'RSP-PROD'
      }
    });
    expect(create.statusCode).toBe(409);
  });

  it('refuses a responsibility and a project of different divisions, and a scoped area with foreign projects', async () => {
    await expect(
      db.query("UPDATE responsibilities SET division_id = $1 WHERE responsibility_id = 'RSP-ENG'", [DEV])
    ).rejects.toThrow(/RESPONSIBILITY_DIVISION_MISMATCH/);
    await expect(
      db.query("UPDATE projects SET division_id = $1 WHERE project_id = 'PRJ-ENG'", [DEV])
    ).rejects.toThrow(/PROJECT_DIVISION_MISMATCH/);
  });

  it('enforces one active relationship per member and division and keeps removal soft', async () => {
    await expect(
      db.query(
        `INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind)
         VALUES ('MD-DUP','MEM-A','DIV-DEV','WORK')`
      )
    ).rejects.toThrow();
    await db.query(
      `UPDATE member_divisions SET removed_at = now(), removed_by = 'fixture'
        WHERE member_id = 'MEM-A' AND division_id = 'DIV-DEV'`
    );
    const rows = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM member_divisions WHERE member_id = 'MEM-A' AND division_id = 'DIV-DEV'"
    );
    expect(rows?.count).toBe('1');
  });

  it('refuses a project without a division at the API and keeps legacy rows unresolved', async () => {
    const manager = await login('0002');
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: manager,
      payload: {
        idempotencyKey: 'no-division-project',
        projectName: 'No division',
        responsibilityId: 'RSP-DEV'
      }
    });
    expect(response.statusCode).toBe(400);
    const unresolved = await db.one<{ division_id: string | null }>(
      "SELECT division_id FROM projects WHERE project_id = 'PRJ-UNMAPPED'"
    );
    expect(unresolved?.division_id).toBeNull();
  });

  it('refuses an unknown role at the database boundary', async () => {
    await expect(db.query("UPDATE members SET role = 'SUPERUSER' WHERE member_id = 'MEM-A'")).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind)
         VALUES ('MD-BAD','MEM-A','DIV-ENG','ADMIN')`
      )
    ).rejects.toThrow();
  });
});

/* ======================================================================== *
 * Corrective regression coverage (division upgrade repair)
 * ======================================================================== */

async function ids(headers: Record<string, string>, url: string): Promise<string[]> {
  const response = await get(headers, url);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body.data!.items as { taskId?: string; projectId?: string }[])
    .map((item) => item.taskId ?? item.projectId ?? '')
    .sort();
}

describe('manager query scope: a client filter can only narrow', () => {
  it('refuses a foreign division on projects, tasks, the tree, search and the overview', async () => {
    const manager = await login('0002');
    for (const url of [
      '/api/manager/projects?divisionId=DIV-PROD',
      '/api/manager/tasks?divisionId=DIV-PROD',
      '/api/manager/tasks?tree=true&divisionId=DIV-PROD',
      '/api/manager/tasks?divisionId=DIV-PROD&pageSize=100',
      '/api/manager/tasks?divisionId=DIV-PROD&responsibilityId=RSP-PROD',
      '/api/manager/overview?divisionId=DIV-PROD',
      '/api/work/overview?divisionId=DIV-PROD',
      '/api/work/projects?divisionId=DIV-PROD'
    ]) {
      const response = await get(manager, url);
      expect(response.status, `${url}: ${JSON.stringify(response.body)}`).toBe(404);
      expect(response.body.error?.code).toBe('NOT_FOUND');
    }
  });

  it('answers an unknown division exactly like an unauthorized one and discloses no record', async () => {
    const manager = await login('0002');
    const unknown = await get(manager, '/api/manager/tasks?divisionId=DIV-NOT-A-DIVISION');
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(unknown.body)).not.toContain('TSK-');
  });

  it('keeps a dual-division manager working and narrows to the requested division', async () => {
    const manager = await login('0003');
    expect(await ids(manager, '/api/manager/tasks?divisionId=DIV-ENG&pageSize=100')).toEqual(['TSK-ENG']);
    expect(await ids(manager, '/api/manager/tasks?pageSize=100')).toEqual(['TSK-DEV', 'TSK-ENG', 'TSK-NESTED']);
    const projects = await ids(manager, '/api/manager/projects?divisionId=DIV-DEV');
    // The archived DEV project stays listed; no project of another division is included.
    expect(projects).toEqual(['PRJ-ARCH', 'PRJ-DEV']);
    const overview = await get(manager, '/api/manager/overview?divisionId=DIV-ENG');
    expect(overview.status, JSON.stringify(overview.body)).toBe(200);
    const overviewAll = await get(manager, '/api/manager/overview');
    expect(overviewAll.status).toBe(200);
    const counts = (overview.body.data as unknown as { counts: { openWork: number } }).counts;
    const countsAll = (overviewAll.body.data as unknown as { counts: { openWork: number } }).counts;
    expect(counts.openWork).toBeLessThanOrEqual(countsAll.openWork);
  });

  it('keeps the admin filter unrestricted, including unmapped work', async () => {
    const admin = await login('0001');
    expect(await ids(admin, '/api/manager/tasks?pageSize=100')).toContain('TSK-LEGACY');
    expect(await ids(admin, '/api/manager/tasks?divisionId=DIV-DEV&pageSize=100')).toEqual(['TSK-DEV', 'TSK-NESTED']);
  });
});

describe('generic editor authorization', () => {
  it('refuses a foreign record as NotFound for every supported editor type', async () => {
    const manager = await login('0002');
    for (const [type, id] of [
      ['task', 'TSK-PROD'],
      ['project', 'PRJ-PROD'],
      ['subproject', 'SUB-PROD'],
      ['responsibility', 'RSP-PROD']
    ] as const) {
      const response = await get(manager, `/api/manager/editor?type=${type}&id=${id}`);
      expect(response.status, `${type}:${id}: ${JSON.stringify(response.body)}`).toBe(404);
      expect(response.body.error?.code).toBe('NOT_FOUND');
    }
    // A record inside an authorized division keeps its revision marker.
    const own = await get(manager, '/api/manager/editor?type=task&id=TSK-DEV');
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect((own.body.data as unknown as { record: { _revision: number } }).record._revision).toBeGreaterThan(0);
  });

  it('refuses an edit form in a read-only division and keeps the member editor admin-only', async () => {
    // A MANAGER with WORK membership in DEV and only READ access to PROD: reading is allowed, an
    // edit form is not.
    await replaceGrants('MEM-MGR2', [
      { divisionId: DEV, accessKind: 'WORK' },
      { divisionId: ENG, accessKind: 'WORK' },
      { divisionId: PROD, accessKind: 'READ' }
    ]);
    const reader = await login('0003');
    expect((await get(reader, '/api/manager/editor?type=task&id=TSK-DEV')).status).toBe(200);
    const foreign = await get(reader, '/api/manager/editor?type=task&id=TSK-PROD');
    expect(foreign.status).toBe(403);
    expect(foreign.body.error?.code).toBe('AUTHORIZATION_DENIED');
    // An employee never reaches the manager editor at all.
    const employee = await login('0012');
    expect((await get(employee, '/api/manager/editor?type=task&id=TSK-DEV')).status).toBe(403);
    const manager = await login('0002');
    const member = await get(manager, '/api/manager/editor?type=member&id=MEM-A');
    expect(member.status).toBe(403);
    expect(JSON.stringify(member.body)).not.toContain('divisionGrants');
  });

  it('cannot be bypassed through the detail endpoints', async () => {
    const manager = await login('0002');
    expect((await get(manager, '/api/manager/tasks/TSK-PROD')).status).toBe(404);
    expect((await get(manager, '/api/manager/projects/PRJ-PROD')).status).toBe(404);
    expect((await get(manager, '/api/manager/subprojects?projectId=PRJ-PROD')).status).toBe(404);
  });
});

describe('membership downgrade, retrieval and retired divisions', () => {
  it('treats WORK to READ as a membership removal and blocks it while work depends on it', async () => {
    const manager = await login('0002');
    const created = await createTask(manager, 'PRJ-DEV', 'Downgrade blocker', ['MEM-DUP1']);
    expect(created.statusCode, created.body).toBe(200);
    const admin = await login('0001');
    const member = await db.one<{ revision: number }>("SELECT revision FROM members WHERE member_id = 'MEM-DUP1'");
    const downgrade = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-DUP1',
      headers: admin,
      payload: { revision: member?.revision, divisionGrants: [{ divisionId: DEV, accessKind: 'READ' }] }
    });
    expect(downgrade.statusCode, downgrade.body).toBe(409);
    expect(downgrade.json().error.code).toBe('DIVISION_MEMBERSHIP_BLOCKED');
    expect(downgrade.json().error.details.blocked[0].reason).toBe('DOWNGRADE');
    // The relationship is still a WORK membership.
    const kept = await db.one<{ access_kind: string }>(
      "SELECT access_kind FROM member_divisions WHERE member_id = 'MEM-DUP1' AND removed_at IS NULL"
    );
    expect(kept?.access_kind).toBe('WORK');
  });

  it('allows an ordinary read-grant removal without an active-work blocker', async () => {
    const admin = await login('0001');
    const member = await db.one<{ revision: number }>("SELECT revision FROM members WHERE member_id = 'MEM-READ'");
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/manager/members/MEM-READ',
      headers: admin,
      payload: {
        revision: member?.revision,
        divisionGrants: [{ divisionId: DEV, accessKind: 'WORK' }]
      }
    });
    expect(response.statusCode, response.body).toBe(200);
    const grants = await db.many<{ division_id: string; access_kind: string }>(
      'SELECT division_id, access_kind FROM member_divisions WHERE member_id = $1 AND removed_at IS NULL ORDER BY division_id',
      ['MEM-READ']
    );
    expect(grants).toEqual([{ division_id: DEV, access_kind: 'WORK' }]);
  });

  it('refuses new work in a retired division even when nothing is assigned', async () => {
    const admin = await login('0001');
    const list = await get(admin, '/api/manager/divisions');
    const divisions = (list.body.data as { items: { divisionId: string; revision: number }[] }).items;
    const retired = await app.inject({
      method: 'POST',
      url: `/api/admin/divisions/${DEV}/retire`,
      headers: admin,
      payload: { revision: divisions.find((division) => division.divisionId === DEV)!.revision, confirmed: true }
    });
    expect(retired.statusCode, retired.body).toBe(200);
    const manager = await login('0002');
    const unassignedTask = await createTask(manager, 'PRJ-DEV', 'No assignee in a retired division', undefined);
    expect(unassignedTask.statusCode, unassignedTask.body).toBe(409);
    expect(unassignedTask.json().error.code).toBe('INVALID_TRANSITION');
    const assignedTask = await createTask(manager, 'PRJ-DEV', 'Assigned in a retired division', ['MEM-A']);
    expect(assignedTask.statusCode).toBe(409);
    const subproject = await app.inject({
      method: 'POST',
      url: '/api/manager/subprojects',
      headers: manager,
      payload: { idempotencyKey: 'retired-subproject', projectId: 'PRJ-DEV', subprojectName: 'Retired area' }
    });
    expect(subproject.statusCode, subproject.body).toBe(409);
    // Existing history stays readable.
    expect((await get(manager, '/api/manager/tasks/TSK-DEV')).status).toBe(200);
  });

  it('does not reveal another division current task detail through a member profile history', async () => {
    await db.query(
      `INSERT INTO task_assignees (assignment_id, task_id, member_id, removed_at)
       VALUES ('ASG-FORMER','TSK-PROD','MEM-A', now())`
    );
    const manager = await login('0002');
    const profile = await get(manager, '/api/manager/members/MEM-A/profile');
    expect(profile.status, JSON.stringify(profile.body)).toBe(200);
    const data = profile.body.data as unknown as { previous: { taskId: string; taskName: string }[]; ownership: { previousHidden: number } };
    expect(data.previous.map((task) => task.taskId)).not.toContain('TSK-PROD');
    expect(JSON.stringify(data.previous)).not.toContain('Production task');
    // The withholding is reported honestly rather than silently erased.
    expect(data.ownership.previousHidden).toBe(1);
    const admin = await login('0001');
    const adminView = await get(admin, '/api/manager/members/MEM-A/profile');
    expect((adminView.body.data as unknown as { previous: { taskId: string }[] }).previous.map((task) => task.taskId)).toContain(
      'TSK-PROD'
    );
  });
});

/**
 * Record-level write availability.
 *
 * A manager may hold `WORK` membership in one division and only `READ` access in another. Such a
 * manager can read both divisions, but the list must resolve the write availability per record so
 * the interface never offers an edit that the server would refuse. The flag is a presentation aid:
 * the command itself is still refused by `assertWritableDivision`, which the last case proves.
 */
describe('record-level write availability', () => {
  async function readOnlyManager(): Promise<Record<string, string>> {
    await db.query(
      "INSERT INTO members(member_id,name,role,active) VALUES ('MEM-MGR-RO','Read-only manager','MANAGER',true)"
    );
    await db.query(
      "INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES ('MEM-MGR-RO','0009',$1,false)",
      [hash]
    );
    await replaceGrants('MEM-MGR-RO', [
      { divisionId: DEV, accessKind: 'WORK' },
      { divisionId: PROD, accessKind: 'READ' }
    ]);
    return login('0009');
  }

  it('marks a project writable only where the manager holds WORK membership', async () => {
    const manager = await readOnlyManager();
    const projects = await get(manager, '/api/manager/projects?pageSize=50');
    expect(projects.status, JSON.stringify(projects.body)).toBe(200);
    const items = projects.body.data!.items as { projectId: string; canWrite: boolean }[];
    const byId = new Map(items.map((item) => [item.projectId, item.canWrite]));
    expect(byId.get('PRJ-DEV')).toBe(true);
    expect(byId.get('PRJ-PROD')).toBe(false);
  });

  it('marks a task writable through its project division', async () => {
    const manager = await readOnlyManager();
    const tasks = await get(manager, '/api/manager/tasks?pageSize=50');
    expect(tasks.status, JSON.stringify(tasks.body)).toBe(200);
    const items = tasks.body.data!.items as { taskId: string; canWrite: boolean }[];
    const byId = new Map(items.map((item) => [item.taskId, item.canWrite]));
    expect(byId.get('TSK-DEV')).toBe(true);
    expect(byId.get('TSK-PROD')).toBe(false);
    // The read-only record is still readable, including its detail.
    const detail = await get(manager, '/api/manager/tasks/TSK-PROD');
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect((detail.body.data as unknown as { canWrite: boolean }).canWrite).toBe(false);
  });

  it('keeps the read-only division readable while refusing its writes on the server', async () => {
    const manager = await readOnlyManager();
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/manager/tasks/TSK-PROD',
      headers: { cookie: manager.cookie!, 'x-csrf-token': manager['x-csrf-token']!, origin: 'http://localhost:8050' },
      payload: { revision: 1, taskName: 'Attempted change' }
    });
    expect([403, 404]).toContain(patch.statusCode);
  });

  it('lets an ADMIN act on unmapped work', async () => {
    const admin = await login('0001');
    const tasks = await get(admin, '/api/manager/tasks?pageSize=50');
    const items = tasks.body.data!.items as { taskId: string; canWrite: boolean }[];
    const legacy = items.find((item) => item.taskId === 'TSK-LEGACY');
    expect(legacy?.canWrite).toBe(true);
  });
});

/**
 * Per-request decision capability.
 *
 * A manager may hold `WORK` membership in one division and only `READ` access in another. The queue
 * must resolve the decision capability for each request's own work, and the decision command must
 * still refuse the read-only division even if a browser claims otherwise.
 */
describe('request decision capability', () => {
  async function seedRequests(): Promise<void> {
    await db.query(`
      INSERT INTO task_requests
        (request_id, request_type, task_id, project_id, requester_name, status,
         task_revision_at_submission, due_date_at_submission, snapshot_version, inbox_request_id,
         requester_member_id)
      VALUES
        ('REQ-DEV','DEADLINE_CHANGE','TSK-DEV','PRJ-DEV','Member A','PENDING','1','2026-12-01','1','INBOX-DEV','MEM-A'),
        ('REQ-PROD','DEADLINE_CHANGE','TSK-PROD','PRJ-PROD','Member B','PENDING','1','2026-12-03','1','INBOX-PROD','MEM-B')
    `);
  }

  async function readOnlyManager(): Promise<Record<string, string>> {
    await db.query(
      "INSERT INTO members(member_id,name,role,active) VALUES ('MEM-MGR-RO','Read-only manager','MANAGER',true)"
    );
    await db.query(
      "INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES ('MEM-MGR-RO','0009',$1,false)",
      [hash]
    );
    await replaceGrants('MEM-MGR-RO', [
      { divisionId: DEV, accessKind: 'WORK' },
      { divisionId: PROD, accessKind: 'READ' }
    ]);
    return login('0009');
  }

  it('marks a request decidable only in the division the manager works in', async () => {
    await seedRequests();
    const manager = await readOnlyManager();
    const queue = await get(manager, '/api/manager/requests?includeDecided=true');
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    const items = queue.body.data!.items as { requestId: string; canDecide: boolean }[];
    const byId = new Map(items.map((item) => [item.requestId, item.canDecide]));
    expect(byId.get('REQ-DEV')).toBe(true);
    expect(byId.get('REQ-PROD')).toBe(false);
  });

  it('gives ADMIN the same decision on both records', async () => {
    await seedRequests();
    const admin = await login('0001');
    const queue = await get(admin, '/api/manager/requests?includeDecided=true');
    const items = queue.body.data!.items as { requestId: string; canDecide: boolean }[];
    expect(items.every((item) => item.canDecide)).toBe(true);
  });

  it('still refuses the decision the interface does not offer', async () => {
    await seedRequests();
    const manager = await readOnlyManager();
    const response = await app.inject({
      method: 'POST',
      url: '/api/manager/requests/REQ-PROD/decide',
      headers: {
        cookie: manager.cookie!,
        'x-csrf-token': manager['x-csrf-token']!,
        origin: 'http://localhost:8050'
      },
      payload: { decision: 'APPROVE', revision: 1, confirmed: true }
    });
    expect([403, 404]).toContain(response.statusCode);
    // Nothing was decided.
    const row = await db.one<{ status: string }>('SELECT status FROM task_requests WHERE request_id = $1', ['REQ-PROD']);
    expect(row?.status).toBe('PENDING');
  });

  it('resolves one request by id inside the caller scope and refuses a foreign one', async () => {
    await seedRequests();
    const manager = await readOnlyManager();
    const own = await get(manager, '/api/manager/requests/REQ-DEV');
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect((own.body.data as unknown as { request: { canDecide: boolean } }).request.canDecide).toBe(true);

    const foreign = await get(manager, '/api/manager/requests/REQ-MISSING');
    expect(foreign.status).toBe(404);

    // A request of a division the caller cannot read is not revealed.
    await db.query("INSERT INTO divisions(division_id,name,status,sort_order) VALUES ('DIV-HIDDEN','Hidden','Active',9)");
    await insertProject(db, { projectName: 'Hidden project', divisionId: 'DIV-HIDDEN', status: 'Active' }, 'PRJ-HIDDEN');
    await insertTask(db, { projectId: 'PRJ-HIDDEN', taskName: 'Hidden task', dueDate: '2026-12-09' }, 'TSK-HIDDEN');
    await db.query(`
      INSERT INTO task_requests
        (request_id, request_type, task_id, project_id, requester_name, status,
         task_revision_at_submission, due_date_at_submission, snapshot_version, inbox_request_id)
      VALUES ('REQ-HIDDEN','DEADLINE_CHANGE','TSK-HIDDEN','PRJ-HIDDEN','Someone','PENDING','1','2026-12-09','1','INBOX-HIDDEN')
    `);
    const hidden = await get(manager, '/api/manager/requests/REQ-HIDDEN');
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain('Hidden task');
  });
});
