/**
 * Permanent deletion of an unused responsibility area, against real PostgreSQL.
 *
 * These prove the properties a mock cannot: only ADMIN reaches the preflight and the deletion,
 * every project reference (active, archived or logically deleted) refuses the operation, member
 * links alone do not block it, the revision and the typed phrase are re-checked inside the
 * deleting transaction, and the tombstone plus both audit records survive while no project, task
 * or other responsibility is touched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

const password = 'Responsibility-deletion-password-123';

type Headers = Record<string, string>;

type Preflight = {
  entityType: string;
  entityId: string;
  name: string;
  status: 'Active' | 'Retired' | null;
  deletable: boolean;
  blockers: { code: string; detail: string }[];
  projectCount: number;
  archivedProjectCount: number;
  deletedProjectCount: number;
  activeMemberCount: number;
  historicalMemberCount: number;
  auditReferenceCount: number;
  publishedReferenceCount: number;
  activeJobCount: number;
  confirmationText: string;
  revision: number | null;
};

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

async function login(employeeId: string): Promise<Headers> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { employeeId, password } });
  expect(response.statusCode, response.body).toBe(200);
  return {
    cookie: String(response.headers['set-cookie']).split(';')[0]!,
    'x-csrf-token': response.json().data.csrfToken,
    origin: 'http://localhost:8050'
  };
}

function preflight(headers: Headers, id: string) {
  return app.inject({
    url: `/api/admin/responsibilities/${id}/delete-preflight`,
    headers: { cookie: headers.cookie! }
  });
}

function remove(headers: Headers, id: string, body: Record<string, unknown>) {
  return app.inject({ method: 'DELETE', url: `/api/admin/responsibilities/${id}`, headers, payload: body });
}

async function revisionOf(id: string): Promise<number> {
  const row = await db.one<{ revision: number }>(
    'SELECT revision FROM responsibilities WHERE responsibility_id = $1',
    [id]
  );
  return row!.revision;
}

async function responsibilityExists(id: string): Promise<boolean> {
  return !!(await db.one('SELECT 1 FROM responsibilities WHERE responsibility_id = $1', [id]));
}

async function addResponsibility(id: string, status: 'Active' | 'Retired' = 'Active'): Promise<void> {
  await db.query('INSERT INTO responsibilities(responsibility_id,name,status) VALUES($1,$2,$3)', [
    id,
    `Area ${id}`,
    status
  ]);
}

describe('responsibility deletion authorization', () => {
  it('refuses every non-admin role on the preflight and on the deletion', async () => {
    await addResponsibility('RSP-EMPTY');
    const admin = await login('0001');
    const allowed = await preflight(admin, 'RSP-EMPTY');
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect((allowed.json() as { data: Preflight }).data.deletable).toBe(true);

    for (const employeeId of ['0002', '0010', '0020']) {
      const headers = await login(employeeId);
      const blocked = await preflight(headers, 'RSP-EMPTY');
      expect(blocked.statusCode, `${employeeId}: ${blocked.body}`).toBe(403);
      expect((blocked.json() as { error: { code: string } }).error.code).toBe('AUTHORIZATION_DENIED');
      const refused = await remove(headers, 'RSP-EMPTY', {
        revision: await revisionOf('RSP-EMPTY'),
        confirmed: true,
        confirmation: 'DELETE RSP-EMPTY'
      });
      expect(refused.statusCode, `${employeeId}: ${refused.body}`).toBe(403);
      expect((refused.json() as { error: { code: string } }).error.code).toBe('AUTHORIZATION_DENIED');
    }
    expect(await responsibilityExists('RSP-EMPTY')).toBe(true);
  });
});

describe('responsibility deletion eligibility', () => {
  it('allows an unused responsibility and reports it as deletable', async () => {
    await addResponsibility('RSP-EMPTY');
    const admin = await login('0001');
    const checked = (await preflight(admin, 'RSP-EMPTY')).json() as { data: Preflight };
    expect(checked.data).toMatchObject({
      entityType: 'RESPONSIBILITIES',
      entityId: 'RSP-EMPTY',
      name: 'Area RSP-EMPTY',
      status: 'Active',
      deletable: true,
      blockers: [],
      projectCount: 0,
      archivedProjectCount: 0,
      deletedProjectCount: 0,
      confirmationText: 'DELETE RSP-EMPTY'
    });
  });

  it('blocks a responsibility that an active, archived or logically deleted project still names', async () => {
    await addResponsibility('RSP-USED');
    await db.query(
      `INSERT INTO projects(project_id,project_name,responsibility_id,status) VALUES
        ('PRJ-ACTIVE','Active project','RSP-USED','Active')`
    );
    const admin = await login('0001');
    const active = (await preflight(admin, 'RSP-USED')).json() as { data: Preflight };
    expect(active.data.deletable).toBe(false);
    expect(active.data.projectCount).toBe(1);
    expect(active.data.blockers.map((entry) => entry.code)).toContain('PROJECTS_REFERENCED');

    await db.query(
      `INSERT INTO projects(project_id,project_name,responsibility_id,status,archived_at) VALUES
        ('PRJ-ARCHIVED','Archived project','RSP-USED','Archived',now())`
    );
    const archived = (await preflight(admin, 'RSP-USED')).json() as { data: Preflight };
    expect(archived.data.projectCount).toBe(2);
    expect(archived.data.archivedProjectCount).toBe(1);
    expect(archived.data.deletable).toBe(false);

    await db.query(
      `INSERT INTO projects(project_id,project_name,responsibility_id,status,deleted_at) VALUES
        ('PRJ-DELETED','Mistaken project','RSP-USED','Active',now())`
    );
    const deleted = (await preflight(admin, 'RSP-USED')).json() as { data: Preflight };
    expect(deleted.data.projectCount).toBe(3);
    expect(deleted.data.deletedProjectCount).toBe(1);
    expect(deleted.data.deletable).toBe(false);
    expect(deleted.data.blockers.find((entry) => entry.code === 'PROJECTS_REFERENCED')?.detail).toContain(
      '1 archived'
    );
  });

  it('never lets member links alone block a mistaken area, and reports them for the tombstone', async () => {
    await addResponsibility('RSP-LINKS');
    await db.query(
      `INSERT INTO responsibility_members(assignment_id,responsibility_id,member_id,assigned_by,removed_at,removed_by)
       VALUES ('RMA-1','RSP-LINKS','MEM-A','admin@example.invalid',NULL,''),
              ('RMA-2','RSP-LINKS','MEM-MANAGER','admin@example.invalid',now(),'admin@example.invalid')`
    );
    const admin = await login('0001');
    const checked = (await preflight(admin, 'RSP-LINKS')).json() as { data: Preflight };
    expect(checked.data).toMatchObject({
      deletable: true,
      blockers: [],
      activeMemberCount: 1,
      historicalMemberCount: 1
    });
  });

  it('reports an unknown or already deleted identifier instead of pretending it is deletable', async () => {
    const admin = await login('0001');
    const missing = (await preflight(admin, 'RSP-NONE')).json() as { data: Preflight };
    expect(missing.data.deletable).toBe(false);
    expect(missing.data.blockers.map((entry) => entry.code)).toEqual(['NOT_FOUND_OR_DELETED']);
    expect(missing.data.revision).toBeNull();
  });
});

describe('responsibility deletion execution', () => {
  it('removes the unused row with a tombstone and retained audit evidence, touching nothing else', async () => {
    await addResponsibility('RSP-EMPTY');
    await addResponsibility('RSP-KEEP');
    await db.query(
      "INSERT INTO projects(project_id,project_name,responsibility_id,status) VALUES('PRJ-KEEP','Keep me','RSP-KEEP','Active')"
    );
    await db.query(
      `INSERT INTO responsibility_members(assignment_id,responsibility_id,member_id,assigned_by,removed_at,removed_by)
       VALUES ('RMA-A','RSP-EMPTY','MEM-A','admin@example.invalid',NULL,''),
              ('RMA-B','RSP-EMPTY','MEM-MANAGER','admin@example.invalid',now(),'admin@example.invalid')`
    );
    const admin = await login('0001');
    const revision = await revisionOf('RSP-EMPTY');
    const deleted = await remove(admin, 'RSP-EMPTY', {
      revision,
      confirmed: true,
      confirmation: 'DELETE RSP-EMPTY'
    });
    expect(deleted.statusCode, deleted.body).toBe(200);

    expect(await responsibilityExists('RSP-EMPTY')).toBe(false);
    expect(await db.one("SELECT 1 FROM responsibility_members WHERE responsibility_id = 'RSP-EMPTY'")).toBeFalsy();

    const tombstone = await db.one<{ entity_type: string; reason: string; last_revision: number; snapshot: unknown }>(
      "SELECT entity_type, reason, last_revision, snapshot FROM record_deletions WHERE entity_id = 'RSP-EMPTY'"
    );
    expect(tombstone).toMatchObject({
      entity_type: 'RESPONSIBILITIES',
      reason: 'Created by mistake',
      last_revision: revision
    });
    const snapshot = tombstone!.snapshot as { name: string; memberLinks: { memberId: string; removedAt: string | null }[] };
    expect(snapshot.name).toBe('Area RSP-EMPTY');
    expect(snapshot.memberLinks.map((link) => link.memberId).sort()).toEqual(['MEM-A', 'MEM-MANAGER']);
    expect(snapshot.memberLinks.filter((link) => link.removedAt !== null)).toHaveLength(1);

    const actions = await db.many<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_type = 'RESPONSIBILITIES' AND entity_id = 'RSP-EMPTY' ORDER BY audit_id"
    );
    expect(actions.map((row) => row.action)).toEqual(['RECORD_DELETE_PREPARED', 'RECORD_DELETED']);

    // Nothing else moved: the other area and its project are untouched.
    expect(await responsibilityExists('RSP-KEEP')).toBe(true);
    const project = await db.one<{ responsibility_id: string | null }>(
      "SELECT responsibility_id FROM projects WHERE project_id = 'PRJ-KEEP'"
    );
    expect(project?.responsibility_id).toBe('RSP-KEEP');
  });

  it('refuses a stale revision, a wrong phrase and a project added after the preflight', async () => {
    await addResponsibility('RSP-RACE');
    const admin = await login('0001');
    const revision = await revisionOf('RSP-RACE');

    const stale = await remove(admin, 'RSP-RACE', {
      revision: revision + 5,
      confirmed: true,
      confirmation: 'DELETE RSP-RACE'
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect((stale.json() as { error: { code: string } }).error.code).toBe('EDIT_CONFLICT');

    const wrongPhrase = await remove(admin, 'RSP-RACE', {
      revision,
      confirmed: true,
      confirmation: 'delete rsp-race'
    });
    expect(wrongPhrase.statusCode, wrongPhrase.body).toBe(400);
    expect((wrongPhrase.json() as { error: { code: string } }).error.code).toBe('CONFIRMATION_REQUIRED');
    expect(await responsibilityExists('RSP-RACE')).toBe(true);

    // A project appears between the preflight and the deletion: the transaction re-checks and refuses.
    await db.query(
      "INSERT INTO projects(project_id,project_name,responsibility_id,status) VALUES('PRJ-LATE','Late project','RSP-RACE','Planned')"
    );
    const blocked = await remove(admin, 'RSP-RACE', {
      revision,
      confirmed: true,
      confirmation: 'DELETE RSP-RACE'
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    const failure = blocked.json() as { error: { code: string; details: { projectCount: number } } };
    expect(failure.error.code).toBe('INVALID_TRANSITION');
    expect(failure.error.details.projectCount).toBe(1);
    expect(await responsibilityExists('RSP-RACE')).toBe(true);
    expect(await db.one("SELECT 1 FROM record_deletions WHERE entity_id = 'RSP-RACE'")).toBeFalsy();
  });

  it('reports a repeated deletion instead of double-deleting', async () => {
    await addResponsibility('RSP-ONCE');
    const admin = await login('0001');
    const revision = await revisionOf('RSP-ONCE');
    const first = await remove(admin, 'RSP-ONCE', {
      revision,
      confirmed: true,
      confirmation: 'DELETE RSP-ONCE'
    });
    expect(first.statusCode, first.body).toBe(200);

    const repeated = await remove(admin, 'RSP-ONCE', {
      revision,
      confirmed: true,
      confirmation: 'DELETE RSP-ONCE'
    });
    expect(repeated.statusCode, repeated.body).toBe(409);
    expect((repeated.json() as { error: { code: string } }).error.code).toBe('INVALID_TRANSITION');
    const tombstones = await db.many("SELECT tombstone_id FROM record_deletions WHERE entity_id = 'RSP-ONCE'");
    expect(tombstones).toHaveLength(1);
    const deletes = await db.many(
      "SELECT audit_id FROM audit_log WHERE entity_type = 'RESPONSIBILITIES' AND entity_id = 'RSP-ONCE' AND action = 'RECORD_DELETED'"
    );
    expect(deletes).toHaveLength(1);
  });

  it('retires a referenced area instead of deleting it', async () => {
    await addResponsibility('RSP-RETIRE');
    await db.query(
      "INSERT INTO projects(project_id,project_name,responsibility_id,status) VALUES('PRJ-R','Referenced','RSP-RETIRE','Active')"
    );
    const admin = await login('0001');
    const retired = await app.inject({
      method: 'POST',
      url: '/api/manager/responsibilities/RSP-RETIRE/retire',
      headers: admin,
      payload: { revision: await revisionOf('RSP-RETIRE'), confirmed: true }
    });
    expect(retired.statusCode, retired.body).toBe(200);
    const row = await db.one<{ status: string }>(
      "SELECT status FROM responsibilities WHERE responsibility_id = 'RSP-RETIRE'"
    );
    expect(row?.status).toBe('Retired');
    expect(await db.one("SELECT 1 FROM record_deletions WHERE entity_id = 'RSP-RETIRE'")).toBeFalsy();

    // Reactivation returns the area to the default active list without touching the project.
    const reactivated = await app.inject({
      method: 'POST',
      url: '/api/manager/responsibilities/RSP-RETIRE/reactivate',
      headers: admin,
      payload: { revision: await revisionOf('RSP-RETIRE'), confirmed: true }
    });
    expect(reactivated.statusCode, reactivated.body).toBe(200);
    expect(
      (await db.one<{ status: string }>("SELECT status FROM responsibilities WHERE responsibility_id = 'RSP-RETIRE'"))
        ?.status
    ).toBe('Active');
    expect(
      (await db.one<{ responsibility_id: string }>("SELECT responsibility_id FROM projects WHERE project_id = 'PRJ-R'"))
        ?.responsibility_id
    ).toBe('RSP-RETIRE');
  });
});
