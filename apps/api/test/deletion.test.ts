/**
 * Permanent-deletion integration tests against real PostgreSQL.
 *
 * These prove the properties a mock cannot: only ADMIN reaches the preflight and the removal,
 * every blocker refuses the operation with a readable code, the revision and typed confirmation
 * are re-checked inside the deleting transaction, and the tombstone plus both audit records exist
 * after a successful removal while unrelated work and assignments survive untouched.
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

const password = 'Deletion-test-password-123';

type Headers = Record<string, string>;

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
  // A RESTRICTED project is not published, so publication is not what refuses these removals.
  await db.query(
    `INSERT INTO projects(project_id,project_name,status,dashboard_visibility) VALUES
      ('PRJ-PRIV','Private project','Active','RESTRICTED'),
      ('PRJ-INT','Published project','Active','INTERNAL')`
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

async function preflight(headers: Headers, entityType: string, entityId: string) {
  return app.inject({
    url: `/api/manager/deletion/preflight?entityType=${entityType}&entityId=${entityId}`,
    headers: { cookie: headers.cookie! }
  });
}

function remove(headers: Headers, path: string, body: Record<string, unknown>) {
  return app.inject({ method: 'DELETE', url: path, headers, payload: body });
}

function administrativeRemove(headers: Headers, path: string, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: path, headers, payload: body });
}

function patchSubproject(headers: Headers, entityId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/manager/subprojects/${entityId}`,
    headers,
    payload: body
  });
}

async function revisionOf(table: 'tasks' | 'subprojects', id: string): Promise<number> {
  const column = table === 'tasks' ? 'task_id' : 'subproject_id';
  const row = await db.one<{ revision: number }>(`SELECT revision FROM ${table} WHERE ${column} = $1`, [id]);
  return row!.revision;
}

describe('deletion authorization', () => {
  it('refuses every non-admin role on the preflight and on the removal', async () => {
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES('T-SOLO','PRJ-PRIV','Lonely work','In Progress','2026-12-01')"
    );
    const admin = await login('0001');
    const allowed = await preflight(admin, 'TASKS', 'T-SOLO');
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect((allowed.json() as { data: { deletable: boolean } }).data.deletable).toBe(true);

    for (const employeeId of ['0002', '0010', '0020']) {
      const headers = await login(employeeId);
      const blocked = await preflight(headers, 'TASKS', 'T-SOLO');
      expect(blocked.statusCode, `${employeeId}: ${blocked.body}`).toBe(403);
      expect((blocked.json() as { error: { code: string } }).error.code).toBe('AUTHORIZATION_DENIED');
      const refused = await remove(headers, '/api/manager/tasks/T-SOLO', {
        revision: await revisionOf('tasks', 'T-SOLO'),
        confirmed: true,
        reason: 'Mistake',
        confirmation: 'DELETE T-SOLO'
      });
      expect(refused.statusCode, `${employeeId}: ${refused.body}`).toBe(403);
      const still = await db.one('SELECT 1 FROM tasks WHERE task_id = $1 AND deleted_at IS NULL', ['T-SOLO']);
      expect(still, `task survived a ${employeeId} attempt`).toBeTruthy();
    }
  });
});

describe('administrative logical removal', () => {
        it('removes a completed task with approval, schedule, effort and audit history while preserving every record', async () => {
          await db.query(
            `INSERT INTO tasks(task_id,project_id,task_name,status,due_date,actual_hours,assignment_approved_at,revision)
             VALUES('T-LOGICAL','PRJ-INT','Mistaken published task','Done','2026-12-10',4,now(),4)`
          );
          await db.query(
            `INSERT INTO schedule_confirmations(schedule_confirmation_id,task_id,confirmed_by)
             VALUES('SC-LOGICAL','T-LOGICAL','MEM-ADMIN')`
          );
          await db.query(
            `INSERT INTO audit_log(entity_type,entity_id,action,actor_member_id)
             VALUES
               ('TASKS','T-LOGICAL','ASSIGNMENT_APPROVED','MEM-ADMIN'),
               ('TASKS','T-LOGICAL','SCHEDULE_CONFIRMED','MEM-ADMIN'),
               ('TASKS','T-LOGICAL','TASK_COMPLETED_DIRECT','MEM-ADMIN'),
               ('TASKS','T-LOGICAL','COMPLETION_OVERRIDDEN','MEM-ADMIN')`
          );
          await db.query(
            `INSERT INTO task_requests(request_id,request_type,task_id,project_id,requester_name,status)
             VALUES('REQ-HIST','DEADLINE_CHANGE','T-LOGICAL','PRJ-INT','Former requester','APPROVED')`
          );
          await db.query(
            `INSERT INTO task_deadline_history(history_id,task_id,request_id,previous_due_date,new_due_date,reason)
             VALUES('HIST-1','T-LOGICAL','REQ-HIST','2026-12-01','2026-12-10','Approved historical change')`
          );
          await db.query(
            `INSERT INTO task_assignees(assignment_id,task_id,member_id,assigned_by,removed_at,removed_by)
             VALUES('ASG-HIST','T-LOGICAL','MEM-A','MEM-ADMIN',now(),'MEM-ADMIN')`
          );
          const admin = await login('0001');
          const checked = await app.inject({
            url: '/api/manager/removal/preflight?entityType=TASKS&entityId=T-LOGICAL',
            headers: { cookie: admin.cookie! }
          });
          expect(checked.statusCode, checked.body).toBe(200);
          expect(checked.json().data).toMatchObject({ deletable: true, blockers: [], requiresReason: true, revision: 4 });

          const missingReason = await administrativeRemove(admin, '/api/admin/tasks/T-LOGICAL/remove', {
            revision: 4,
            confirmed: true
          });
          expect(missingReason.statusCode, missingReason.body).toBe(400);
          expect(missingReason.json().error.code).toBe('VALIDATION_FAILED');

          const removed = await administrativeRemove(admin, '/api/admin/tasks/T-LOGICAL/remove', {
            revision: 4,
            confirmed: true,
            reason: 'Created by mistake'
          });
          expect(removed.statusCode, removed.body).toBe(200);
          expect(removed.json().data).toMatchObject({ alreadyRemoved: false, revision: 5 });
          expect(await db.one("SELECT 1 FROM tasks WHERE task_id = 'T-LOGICAL' AND deleted_at IS NOT NULL AND revision = 5")).toBeTruthy();
          expect(await db.one("SELECT 1 FROM task_deadline_history WHERE history_id = 'HIST-1'")).toBeTruthy();
          expect(await db.one("SELECT 1 FROM audit_log WHERE entity_id = 'T-LOGICAL' AND action = 'TASK_COMPLETED_DIRECT'")).toBeTruthy();
          expect(await db.one("SELECT 1 FROM task_assignees WHERE assignment_id = 'ASG-HIST'")).toBeTruthy();
          expect(await db.one("SELECT 1 FROM task_requests WHERE request_id = 'REQ-HIST'")).toBeTruthy();
          expect(await db.one("SELECT 1 FROM audit_log WHERE entity_id = 'T-LOGICAL' AND action = 'RECORD_REMOVED'")).toBeTruthy();
          expect(await db.one("SELECT 1 FROM outbox_jobs WHERE kind = 'publication.run' AND payload->>'taskId' = 'T-LOGICAL'")).toBeTruthy();

          const active = await app.inject({
            url: '/api/manager/tasks?query=Mistaken%20published&page=1&pageSize=25',
            headers: { cookie: admin.cookie! }
          });
          expect(active.statusCode, active.body).toBe(200);
          expect(active.json().data.items).toEqual([]);
        });

        it('is ADMIN-only and treats a repeated successful removal as idempotent', async () => {
          await db.query(
            "INSERT INTO tasks(task_id,project_id,task_name,status) VALUES('T-IDEMPOTENT','PRJ-PRIV','Duplicate','Not Started')"
          );
          for (const employeeId of ['0002', '0010', '0020']) {
            const headers = await login(employeeId);
            const refused = await administrativeRemove(headers, '/api/admin/tasks/T-IDEMPOTENT/remove', {
              revision: 1,
              confirmed: true
            });
            expect(refused.statusCode, `${employeeId}: ${refused.body}`).toBe(403);
          }
          const anonymous = await administrativeRemove({}, '/api/admin/tasks/T-IDEMPOTENT/remove', {
            revision: 1,
            confirmed: true
          });
          expect(anonymous.statusCode).toBe(401);

          const admin = await login('0001');
          const first = await administrativeRemove(admin, '/api/admin/tasks/T-IDEMPOTENT/remove', {
            revision: 1,
            confirmed: true
          });
          expect(first.statusCode, first.body).toBe(200);
          const second = await administrativeRemove(admin, '/api/admin/tasks/T-IDEMPOTENT/remove', {
            revision: 1,
            confirmed: true
          });
          expect(second.statusCode, second.body).toBe(200);
          expect(second.json().data).toMatchObject({ alreadyRemoved: true, revision: 2 });
          const evidence = await db.one<{ count: string }>(
            "SELECT count(*)::text AS count FROM audit_log WHERE entity_id = 'T-IDEMPOTENT' AND action = 'RECORD_REMOVED'"
          );
          expect(Number(evidence!.count)).toBe(1);
        });

        it('blocks child work, active dependencies, pending requests/jobs and stale revisions', async () => {
          await db.query(
            `INSERT INTO tasks(task_id,project_id,task_name,status,actual_hours) VALUES
             ('T-BLOCKED','PRJ-PRIV','Blocked target','In Progress',NULL),
             ('T-CHILD','PRJ-PRIV','Child task','Not Started',NULL),
             ('T-DEPENDANT','PRJ-PRIV','Dependant task','Not Started',NULL),
             ('T-DONE','PRJ-PRIV','Completed task','Done',2)`
          );
          await db.query("UPDATE tasks SET parent_task_id = 'T-BLOCKED' WHERE task_id = 'T-CHILD'");
          await db.query("INSERT INTO task_dependencies(task_id,depends_on_task_id) VALUES('T-DEPENDANT','T-BLOCKED')");
          await db.query(
            `INSERT INTO task_requests(request_id,request_type,task_id,project_id,requester_name,status)
             VALUES('REQ-PENDING','COMPLETION_REPORT','T-BLOCKED','PRJ-PRIV','Worker','PENDING')`
          );
          await db.query(
            `INSERT INTO outbox_jobs(kind,payload,dedupe_key)
             VALUES('notification.task','{"taskId":"T-BLOCKED"}','pending-blocker')`
          );
          const admin = await login('0001');
          const checked = await app.inject({
            url: '/api/manager/removal/preflight?entityType=TASKS&entityId=T-BLOCKED',
            headers: { cookie: admin.cookie! }
          });
          const blockers = checked.json().data.blockers as { code: string; detail: string }[];
          expect(blockers.map((entry) => entry.code)).toEqual(
            expect.arrayContaining(['HAS_DESCENDANTS', 'DEPENDENCY_REFERENCED', 'REQUESTS', 'NOTIFICATIONS'])
          );
          expect(blockers.find((entry) => entry.code === 'HAS_DESCENDANTS')?.detail).toContain('Child task');
          expect(blockers.find((entry) => entry.code === 'DEPENDENCY_REFERENCED')?.detail).toContain('Dependant task');

          const done = await app.inject({
            url: '/api/manager/removal/preflight?entityType=TASKS&entityId=T-DONE',
            headers: { cookie: admin.cookie! }
          });
          expect(done.json().data).toMatchObject({ deletable: true, blockers: [], requiresReason: true });

          await db.query(
            "INSERT INTO tasks(task_id,project_id,task_name,status,revision) VALUES('T-STALE-REMOVE','PRJ-PRIV','Stale task','Not Started',3)"
          );
          const stale = await administrativeRemove(admin, '/api/admin/tasks/T-STALE-REMOVE/remove', {
            revision: 2,
            confirmed: true
          });
          expect(stale.statusCode, stale.body).toBe(409);
          expect(stale.json().error.code).toBe('EDIT_CONFLICT');
          expect(await db.one("SELECT 1 FROM tasks WHERE task_id = 'T-STALE-REMOVE' AND deleted_at IS NULL")).toBeTruthy();
        });

        it('removes an edited empty subproject but protects active children', async () => {
          await db.query(
            `INSERT INTO subprojects(subproject_id,project_id,subproject_name,status,revision) VALUES
             ('SUB-SOFT','PRJ-PRIV','Edited empty area','Planned',5),
             ('SUB-PARENT','PRJ-PRIV','Parent area','Planned',1),
             ('SUB-CHILD','PRJ-PRIV','Child area','Planned',1)`
          );
          await db.query("UPDATE subprojects SET parent_subproject_id = 'SUB-PARENT' WHERE subproject_id = 'SUB-CHILD'");
          await db.query(
            "INSERT INTO audit_log(entity_type,entity_id,action,actor_member_id) VALUES('SUBPROJECTS','SUB-SOFT','SUBPROJECT_UPDATED','MEM-ADMIN')"
          );
          const admin = await login('0001');
          const removed = await administrativeRemove(admin, '/api/admin/subprojects/SUB-SOFT/remove', {
            revision: 5,
            confirmed: true
          });
          expect(removed.statusCode, removed.body).toBe(200);
          expect(await db.one("SELECT 1 FROM subprojects WHERE subproject_id = 'SUB-SOFT' AND deleted_at IS NOT NULL")).toBeTruthy();
          expect(await db.one("SELECT 1 FROM audit_log WHERE entity_id = 'SUB-SOFT' AND action = 'SUBPROJECT_UPDATED'")).toBeTruthy();

          const blocked = await app.inject({
            url: '/api/manager/removal/preflight?entityType=SUBPROJECTS&entityId=SUB-PARENT',
            headers: { cookie: admin.cookie! }
          });
          expect(blocked.json().data.blockers[0].code).toBe('HAS_DESCENDANTS');
          expect(blocked.json().data.blockers[0].detail).toContain('Child area');
        });
      });

describe('eligible removals', () => {
  it('physically purges an edited INTERNAL mistaken task and its administrative relationships', async () => {
    await db.query(
      `INSERT INTO tasks(task_id,project_id,task_name,status) VALUES
        ('T-BASE','PRJ-PRIV','Existing work','Not Started'),
        ('T-PURGE','PRJ-INT','Mistaken internal task','Not Started')`
    );
    await db.query(
      `INSERT INTO task_assignees(assignment_id,task_id,member_id,assigned_by)
       VALUES('ASG-PURGE','T-PURGE','MEM-A','MEM-ADMIN')`
    );
    await db.query(
      "INSERT INTO task_dependencies(task_id,depends_on_task_id) VALUES('T-PURGE','T-BASE')"
    );
    await db.query(
      `INSERT INTO audit_log(entity_type,entity_id,action,actor_member_id)
       VALUES('TASKS','T-PURGE','TASK_UPDATED','MEM-ADMIN')`
    );
    const admin = await login('0001');
    const checked = await preflight(admin, 'TASKS', 'T-PURGE');
    expect(checked.statusCode, checked.body).toBe(200);
    const body = checked.json().data as {
      deletable: boolean;
      blockers: unknown[];
      revision: number;
      confirmationText: string;
      erasePlan: { code: string; count: number; detail: string }[];
    };
    expect(body.deletable).toBe(true);
    expect(body.blockers).toEqual([]);
    expect(body.erasePlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TASK_ROW', count: 1 }),
        expect.objectContaining({ code: 'TASK_ASSIGNEES', count: 1 }),
        expect.objectContaining({ code: 'TASK_DEPENDENCIES', count: 1 })
      ])
    );

    const purged = await administrativeRemove(admin, '/api/admin/tasks/T-PURGE/purge', {
      revision: body.revision,
      confirmed: true,
      reason: 'Mistaken duplicate',
      confirmation: body.confirmationText
    });
    expect(purged.statusCode, purged.body).toBe(200);
    expect(await db.one("SELECT 1 FROM tasks WHERE task_id = 'T-PURGE'")).toBeFalsy();
    expect(await db.one("SELECT 1 FROM task_assignees WHERE task_id = 'T-PURGE'")).toBeFalsy();
    expect(await db.one("SELECT 1 FROM task_dependencies WHERE task_id = 'T-PURGE'")).toBeFalsy();
    expect(await db.one("SELECT 1 FROM tasks WHERE task_id = 'T-BASE'")).toBeTruthy();
    expect(await db.one("SELECT 1 FROM record_deletions WHERE entity_type = 'TASKS' AND entity_id = 'T-PURGE'")).toBeTruthy();
    expect(await db.one("SELECT 1 FROM audit_log WHERE entity_id = 'T-PURGE' AND action = 'TASK_UPDATED'")).toBeTruthy();
    expect(await db.one("SELECT 1 FROM audit_log WHERE entity_id = 'T-PURGE' AND action = 'RECORD_DELETED'")).toBeTruthy();
  });

  it('removes an empty subproject and records the intent, tombstone and completion', async () => {
    await db.query(
      "INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES('SUB-EMPTY','PRJ-PRIV','Empty area','Planned')"
    );
    await db.query(
      "INSERT INTO audit_log(entity_type,entity_id,action,actor_member_id) VALUES('SUBPROJECTS','SUB-EMPTY','SUBPROJECT_CREATED','MEM-ADMIN')"
    );
    const admin = await login('0001');
    const checked = await preflight(admin, 'SUBPROJECTS', 'SUB-EMPTY');
    expect(checked.statusCode, checked.body).toBe(200);
    const preflightBody = (checked.json() as {
      data: { deletable: boolean; confirmationText: string; revision: number; blockers: unknown[] };
    }).data;
    expect(preflightBody.blockers).toEqual([]);
    expect(preflightBody.deletable).toBe(true);

    const deleted = await remove(admin, '/api/manager/subprojects/SUB-EMPTY', {
      revision: preflightBody.revision,
      confirmed: true,
      reason: 'Created by mistake',
      confirmation: preflightBody.confirmationText
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const tombstoneId = (deleted.json() as { data: { tombstoneId: string } }).data.tombstoneId;

    expect(await db.one('SELECT 1 FROM subprojects WHERE subproject_id = $1', ['SUB-EMPTY'])).toBeFalsy();
    const tombstone = await db.one<{
      tombstone_id: string;
      reason: string;
      deleted_by: string;
      last_revision: number;
      snapshot: { subprojectId: string; subprojectName: string; projectId: string };
    }>(
      'SELECT tombstone_id, reason, deleted_by, last_revision, snapshot FROM record_deletions WHERE entity_type = $1 AND entity_id = $2',
      ['SUBPROJECTS', 'SUB-EMPTY']
    );
    expect(tombstone).toBeTruthy();
    expect(tombstone!.tombstone_id).toBe(tombstoneId);
    expect(tombstone!.reason).toBe('Created by mistake');
    expect(tombstone!.last_revision).toBe(preflightBody.revision);
    expect(tombstone!.snapshot).toMatchObject({
      subprojectId: 'SUB-EMPTY',
      subprojectName: 'Empty area',
      projectId: 'PRJ-PRIV'
    });
    const actions = await db.many<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_type = 'SUBPROJECTS' AND entity_id = 'SUB-EMPTY' ORDER BY occurred_at, audit_id"
    );
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(['SUBPROJECT_CREATED', 'RECORD_DELETE_PREPARED', 'RECORD_DELETED'])
    );
  });

  it.each([
    { edits: 1, id: 'SUB-EDITED-ONCE' },
    { edits: 3, id: 'SUB-EDITED-MULTIPLE' }
  ])('removes an empty subproject after $edits normal edit(s)', async ({ edits, id }) => {
    await db.query(
      'INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES($1,$2,$3,$4)',
      [id, 'PRJ-PRIV', 'Mistaken area', 'Planned']
    );
    await db.query(
      "INSERT INTO audit_log(entity_type,entity_id,action,actor_member_id) VALUES('SUBPROJECTS',$1,'SUBPROJECT_CREATED','MEM-ADMIN')",
      [id]
    );
    const admin = await login('0001');
    for (let edit = 1; edit <= edits; edit += 1) {
      const changed = await patchSubproject(admin, id, {
        revision: await revisionOf('subprojects', id),
        subprojectName: `Mistaken area ${edit}`
      });
      expect(changed.statusCode, changed.body).toBe(200);
    }

    const checked = await preflight(admin, 'SUBPROJECTS', id);
    const body = (checked.json() as {
      data: { deletable: boolean; blockers: unknown[]; revision: number; confirmationText: string };
    }).data;
    expect(body.deletable).toBe(true);
    expect(body.blockers).toEqual([]);
    const deleted = await remove(admin, `/api/manager/subprojects/${id}`, {
      revision: body.revision,
      confirmed: true,
      reason: 'Mistaken empty structure',
      confirmation: body.confirmationText
    });
    expect(deleted.statusCode, deleted.body).toBe(200);

    const history = await db.many<{ action: string }>(
      'SELECT action FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY audit_id',
      ['SUBPROJECTS', id]
    );
    expect(history.filter((entry) => entry.action === 'SUBPROJECT_UPDATED')).toHaveLength(edits);
    expect(history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['SUBPROJECT_CREATED', 'RECORD_DELETE_PREPARED', 'RECORD_DELETED'])
    );
  });

  it('removes an eligible leaf task and preserves every unrelated task and assignment', async () => {
    await db.query(
      `INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES
        ('T-MISTAKE','PRJ-PRIV','Typo entry','In Progress','2026-12-01'),
        ('T-KEEP','PRJ-PRIV','Real work','In Progress','2026-12-02')`
    );
    await db.query(
      "INSERT INTO task_assignees(assignment_id,task_id,member_id,assigned_by) VALUES('ASG-KEEP','T-KEEP','MEM-A','MEM-ADMIN')"
    );
    const admin = await login('0001');
    const checked = await preflight(admin, 'TASKS', 'T-MISTAKE');
    const body = (checked.json() as { data: { deletable: boolean; revision: number; confirmationText: string } }).data;
    expect(body.deletable).toBe(true);

    const deleted = await remove(admin, '/api/manager/tasks/T-MISTAKE', {
      revision: body.revision,
      confirmed: true,
      reason: 'Duplicate of T-KEEP',
      confirmation: body.confirmationText
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(await db.one('SELECT 1 FROM tasks WHERE task_id = $1', ['T-MISTAKE'])).toBeFalsy();
    expect(await db.one('SELECT 1 FROM tasks WHERE task_id = $1 AND deleted_at IS NULL', ['T-KEEP'])).toBeTruthy();
    const assignment = await db.one("SELECT 1 FROM task_assignees WHERE task_id = 'T-KEEP' AND member_id = 'MEM-A' AND removed_at IS NULL");
    expect(assignment).toBeTruthy();
    // A removed identifier is never reused and stays traceable.
    const reused = await remove(admin, '/api/manager/tasks/T-MISTAKE', {
      revision: body.revision,
      confirmed: true,
      reason: 'Again',
      confirmation: body.confirmationText
    });
    expect(reused.statusCode).toBe(409);
    expect((reused.json() as { error: { details: { blockers: { code: string }[] } } }).error.details.blockers.map((entry) => entry.code)).toContain(
      'NOT_FOUND_OR_DELETED'
    );
  });
});

describe('deletion blockers', () => {
  it('refuses a subproject that still owns tasks', async () => {
    await db.query(
      "INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES('SUB-WORK','PRJ-PRIV','Area with work','Planned')"
    );
    await db.query(
      "INSERT INTO tasks(task_id,project_id,subproject_id,task_name,status,due_date) VALUES('T-IN','PRJ-PRIV','SUB-WORK','Attached work','In Progress','2026-12-01')"
    );
    const admin = await login('0001');
    const checked = await preflight(admin, 'SUBPROJECTS', 'SUB-WORK');
    const body = (checked.json() as { data: { deletable: boolean; blockers: { code: string }[] } }).data;
    expect(body.deletable).toBe(false);
    expect(body.blockers.map((entry) => entry.code)).toContain('HAS_TASKS');

    const refused = await remove(admin, '/api/manager/subprojects/SUB-WORK', {
      revision: await revisionOf('subprojects', 'SUB-WORK'),
      confirmed: true,
      reason: 'Try anyway',
      confirmation: 'DELETE SUB-WORK'
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect((refused.json() as { error: { details: { blockers: { code: string }[] } } }).error.details.blockers.map((entry) => entry.code)).toContain('HAS_TASKS');
    expect(await db.one("SELECT 1 FROM subprojects WHERE subproject_id = 'SUB-WORK'")).toBeTruthy();
    expect(await db.one("SELECT 1 FROM tasks WHERE task_id = 'T-IN' AND deleted_at IS NULL")).toBeTruthy();
  });

  it('refuses a subproject that still owns nested subprojects', async () => {
    await db.query(
      `INSERT INTO subprojects(subproject_id,project_id,parent_subproject_id,subproject_name,status) VALUES
        ('SUB-PARENT','PRJ-PRIV',NULL,'Parent area','Planned'),
        ('SUB-CHILD','PRJ-PRIV','SUB-PARENT','Child area','Planned')`
    );
    const admin = await login('0001');
    const checked = await preflight(admin, 'SUBPROJECTS', 'SUB-PARENT');
    const body = (checked.json() as { data: { deletable: boolean; blockers: { code: string }[]; descendantCount: number } }).data;
    expect(body.deletable).toBe(false);
    expect(body.blockers.map((entry) => entry.code)).toContain('HAS_DESCENDANTS');
    expect(body.descendantCount).toBe(1);
    expect(await db.one("SELECT 1 FROM subprojects WHERE subproject_id = 'SUB-CHILD'")).toBeTruthy();
  });

  it('refuses a subproject linked to a milestone', async () => {
    await db.query(
      "INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES('SUB-MILESTONE','PRJ-PRIV','Milestone area','Planned')"
    );
    await db.query(
      "INSERT INTO milestones(milestone_id,project_id,subproject_id,milestone_name) VALUES('MS-SUB','PRJ-PRIV','SUB-MILESTONE','Protected gate')"
    );
    const admin = await login('0001');
    const checked = await preflight(admin, 'SUBPROJECTS', 'SUB-MILESTONE');
    const body = (checked.json() as { data: { deletable: boolean; blockers: { code: string }[] } }).data;
    expect(body.deletable).toBe(false);
    expect(body.blockers.map((entry) => entry.code)).toContain('HAS_TASKS');
    expect(await db.one("SELECT 1 FROM subprojects WHERE subproject_id = 'SUB-MILESTONE'")).toBeTruthy();
    expect(await db.one("SELECT 1 FROM milestones WHERE milestone_id = 'MS-SUB'")).toBeTruthy();
  });

  it('treats unknown and old disallowed audit activity as protected history', async () => {
    await db.query(
      "INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES('SUB-HISTORY','PRJ-PRIV','History area','Planned')"
    );
    await db.query(
      "INSERT INTO audit_log(entity_type,entity_id,action) VALUES('SUBPROJECTS','SUB-HISTORY','UNRECOGNIZED_OPERATION')"
    );
    for (let entry = 0; entry < 101; entry += 1) {
      await db.query(
        "INSERT INTO audit_log(entity_type,entity_id,action) VALUES('SUBPROJECTS','SUB-HISTORY','SUBPROJECT_UPDATED')"
      );
    }
    const admin = await login('0001');
    const checked = await preflight(admin, 'SUBPROJECTS', 'SUB-HISTORY');
    const body = (checked.json() as { data: { deletable: boolean; blockers: { code: string }[] } }).data;
    expect(body.deletable).toBe(false);
    expect(body.blockers.map((entry) => entry.code)).toContain('AUDIT_HISTORY');
    expect(await db.one("SELECT 1 FROM subprojects WHERE subproject_id = 'SUB-HISTORY'")).toBeTruthy();
  });

  it('refuses a task that has children, recorded effort, requests or protected history', async () => {
    await db.query(
      `INSERT INTO tasks(task_id,project_id,task_name,status,due_date,parent_task_id) VALUES
        ('T-PARENT','PRJ-PRIV','Container','In Progress','2026-12-01',NULL),
        ('T-KID','PRJ-PRIV','Child work','In Progress','2026-12-01','T-PARENT'),
        ('T-DONE','PRJ-PRIV','Finished work','Done','2026-12-01',NULL)`
    );
    await db.query("UPDATE tasks SET actual_hours = 3 WHERE task_id = 'T-DONE'");
    const admin = await login('0001');

    const parent = (await preflight(admin, 'TASKS', 'T-PARENT')).json() as { data: { deletable: boolean; blockers: { code: string }[] } };
    expect(parent.data.deletable).toBe(false);
    expect(parent.data.blockers.map((entry) => entry.code)).toContain('HAS_DESCENDANTS');

    const done = (await preflight(admin, 'TASKS', 'T-DONE')).json() as { data: { deletable: boolean; blockers: { code: string }[] } };
    expect(done.data.deletable).toBe(false);
    expect(done.data.blockers.map((entry) => entry.code)).toContain('RECORDED_EFFORT');

    // The child itself is still a legal, empty leaf: the blocker belongs to the parent only.
    const kid = (await preflight(admin, 'TASKS', 'T-KID')).json() as { data: { deletable: boolean } };
    expect(kid.data.deletable).toBe(true);
  });

  it('classifies uncorroborated legacy hours separately from genuine completed work', async () => {
    await db.query(
      `INSERT INTO tasks(task_id,project_id,task_name,status,actual_hours) VALUES
        ('T-LEGACY-HOURS','PRJ-PRIV','Imported default','Not Started',2),
        ('T-AUDITED-HOURS','PRJ-PRIV','Recorded work','In Progress',3)`
    );
    await db.query(
      `INSERT INTO audit_log(entity_type,entity_id,action,previous_value,new_value,actor_member_id)
       VALUES('TASKS','T-AUDITED-HOURS','TASK_UPDATED','{"actualHours":0}','{"actualHours":3}','MEM-ADMIN')`
    );
    const admin = await login('0001');
    const legacy = (await preflight(admin, 'TASKS', 'T-LEGACY-HOURS')).json().data as {
      blockers: { code: string; detail: string }[];
    };
    expect(legacy.blockers).toEqual([
      expect.objectContaining({
        code: 'UNVERIFIED_LEGACY_EFFORT',
        detail: expect.stringContaining('not assumed to be genuine')
      })
    ]);
    const audited = (await preflight(admin, 'TASKS', 'T-AUDITED-HOURS')).json().data as {
      blockers: { code: string; detail: string }[];
    };
    expect(audited.blockers).toEqual([
      expect.objectContaining({
        code: 'RECORDED_EFFORT',
        detail: expect.stringContaining('audited task update')
      })
    ]);
  });

  it('blocks actual publication references but not an INTERNAL setting alone', async () => {
    await db.query(
      `INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES
        ('T-PUB','PRJ-INT','Published work','In Progress','2026-12-01'),
        ('T-INTERNAL-ONLY','PRJ-INT','Never published','Not Started',NULL)`
    );
    await db.query(
      `INSERT INTO published_snapshots(slot,contract_version,publisher_version,hash,row_counts,rows)
       VALUES('A','1.6','test','hash','{"tasks":1}','[{"taskId":"T-PUB"}]')`
    );
    await db.query(
      `INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES('SUB-ARCH','PRJ-PRIV','Retired area','Archived')`
    );
    const admin = await login('0001');
    const published = (await preflight(admin, 'TASKS', 'T-PUB')).json() as { data: { deletable: boolean; blockers: { code: string }[] } };
    expect(published.data.deletable).toBe(false);
    expect(published.data.blockers.map((entry) => entry.code)).toContain('PUBLISHED');
    const internalOnly = (await preflight(admin, 'TASKS', 'T-INTERNAL-ONLY')).json() as {
      data: { deletable: boolean; blockers: { code: string }[] };
    };
    expect(internalOnly.data).toMatchObject({ deletable: true, blockers: [] });
    const archived = (await preflight(admin, 'SUBPROJECTS', 'SUB-ARCH')).json() as { data: { deletable: boolean; blockers: { code: string }[] } };
    expect(archived.data.deletable).toBe(false);
    expect(archived.data.blockers.map((entry) => entry.code)).toContain('ARCHIVED_RECORD');
  });
});

describe('deletion confirmation and revision', () => {
  it('refuses a stale revision without removing anything', async () => {
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES('T-STALE','PRJ-PRIV','Racy work','In Progress','2026-12-01')"
    );
    const admin = await login('0001');
    const stale = (await revisionOf('tasks', 'T-STALE')) + 5;
    const refused = await remove(admin, '/api/manager/tasks/T-STALE', {
      revision: stale,
      confirmed: true,
      reason: 'Stale',
      confirmation: 'DELETE T-STALE'
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('EDIT_CONFLICT');
    expect(await db.one("SELECT 1 FROM tasks WHERE task_id = 'T-STALE' AND deleted_at IS NULL")).toBeTruthy();
    expect(await db.one("SELECT 1 FROM record_deletions WHERE entity_id = 'T-STALE'")).toBeFalsy();
  });

  it('refuses a wrong confirmation phrase or a missing reason', async () => {
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES('T-CONF','PRJ-PRIV','Confirmation work','In Progress','2026-12-01')"
    );
    const admin = await login('0001');
    const revision = await revisionOf('tasks', 'T-CONF');
    const wrongPhrase = await remove(admin, '/api/manager/tasks/T-CONF', {
      revision,
      confirmed: true,
      reason: 'Mistake',
      confirmation: 'delete t-conf'
    });
    expect(wrongPhrase.statusCode, wrongPhrase.body).toBe(400);
    expect((wrongPhrase.json() as { error: { code: string } }).error.code).toBe('CONFIRMATION_REQUIRED');

    const noReason = await remove(admin, '/api/manager/tasks/T-CONF', {
      revision,
      confirmed: true,
      reason: '   ',
      confirmation: 'DELETE T-CONF'
    });
    expect(noReason.statusCode, noReason.body).toBe(400);
    expect(await db.one("SELECT 1 FROM tasks WHERE task_id = 'T-CONF' AND deleted_at IS NULL")).toBeTruthy();
  });

  it('refuses a subproject changed after preflight and preserves the new revision', async () => {
    await db.query(
      "INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES('SUB-RACE','PRJ-PRIV','Original name','Planned')"
    );
    const admin = await login('0001');
    const checked = await preflight(admin, 'SUBPROJECTS', 'SUB-RACE');
    const before = (checked.json() as {
      data: { revision: number; confirmationText: string };
    }).data;
    const changed = await patchSubproject(admin, 'SUB-RACE', {
      revision: before.revision,
      subprojectName: 'Concurrent name'
    });
    expect(changed.statusCode, changed.body).toBe(200);

    const refused = await remove(admin, '/api/manager/subprojects/SUB-RACE', {
      revision: before.revision,
      confirmed: true,
      reason: 'Stale delete attempt',
      confirmation: before.confirmationText
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('EDIT_CONFLICT');
    const surviving = await db.one<{ subproject_name: string; revision: number }>(
      "SELECT subproject_name, revision FROM subprojects WHERE subproject_id = 'SUB-RACE'"
    );
    expect(surviving).toMatchObject({ subproject_name: 'Concurrent name', revision: before.revision + 1 });
    expect(await db.one("SELECT 1 FROM record_deletions WHERE entity_id = 'SUB-RACE'")).toBeFalsy();
  });
});

describe('project detail hierarchy payload', () => {
  it('returns the stored parent links so the client never groups by name or order', async () => {
    await db.query(
      `INSERT INTO subprojects(subproject_id,project_id,parent_subproject_id,subproject_name,status) VALUES
        ('SUB-TOP','PRJ-PRIV',NULL,'Top area','Planned'),
        ('SUB-NESTED','PRJ-PRIV','SUB-TOP','Nested area','Planned')`
    );
    await db.query(
      `INSERT INTO tasks(task_id,project_id,subproject_id,task_name,status,due_date) VALUES
        ('T-NESTED','PRJ-PRIV','SUB-NESTED','Nested work','In Progress','2026-12-01'),
        ('T-DIRECT','PRJ-PRIV',NULL,'Direct work','In Progress','2026-12-01')`
    );
    const admin = await login('0001');
    const response = await app.inject({ url: '/api/manager/projects/PRJ-PRIV', headers: { cookie: admin.cookie! } });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as {
      data: { subprojects: { subprojectId: string; parentSubprojectId: string | null }[]; tasks: { taskId: string; subprojectId: string | null }[] };
    };
    const nested = body.data.subprojects.find((entry) => entry.subprojectId === 'SUB-NESTED')!;
    expect(nested.parentSubprojectId).toBe('SUB-TOP');
    expect(body.data.tasks.find((entry) => entry.taskId === 'T-NESTED')!.subprojectId).toBe('SUB-NESTED');
    expect(body.data.tasks.find((entry) => entry.taskId === 'T-DIRECT')!.subprojectId).toBeNull();
  });

  it('gives a MEMBER reader the ancestor links without any restricted field', async () => {
    await db.query(
      `INSERT INTO subprojects(subproject_id,project_id,parent_subproject_id,subproject_name,status) VALUES
        ('SUB-TOP','PRJ-INT',NULL,'Top area','Planned'),
        ('SUB-NESTED','PRJ-INT','SUB-TOP','Nested area','Planned')`
    );
    await db.query(
      "INSERT INTO tasks(task_id,project_id,subproject_id,task_name,status,due_date) VALUES('T-NESTED','PRJ-INT','SUB-NESTED','Nested work','In Progress','2026-12-01')"
    );
    const member = await login('0010');
    const response = await app.inject({ url: '/api/work/projects/PRJ-INT', headers: { cookie: member.cookie! } });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as {
      data: {
        subprojects: { subprojectId: string; parentSubprojectId: string | null }[];
        tasks: { taskId: string; subprojectId: string | null }[];
      };
    };
    expect(body.data.subprojects.map((entry) => [entry.subprojectId, entry.parentSubprojectId])).toEqual([
      ['SUB-TOP', null],
      ['SUB-NESTED', 'SUB-TOP']
    ]);
    expect(body.data.tasks.map((entry) => entry.taskId)).toEqual(['T-NESTED']);
    expect(response.body).not.toContain('ownerId');
    expect(response.body).not.toContain('notificationEnabled');
  });

  it('withholds the tasks of an archived branch from a non-manager reader', async () => {
    await db.query(
      `INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES('SUB-ARCH','PRJ-INT','Retired area','Archived')`
    );
    await db.query(
      `INSERT INTO tasks(task_id,project_id,subproject_id,task_name,status,due_date) VALUES
        ('T-ARCH','PRJ-INT','SUB-ARCH','Retired work','In Progress','2026-12-01'),
        ('T-LIVE','PRJ-INT',NULL,'Live work','Done','2026-12-01')`
    );
    const member = await login('0010');
    const response = await app.inject({ url: '/api/work/projects/PRJ-INT', headers: { cookie: member.cookie! } });
    const body = response.json() as { data: { subprojects: { subprojectId: string }[]; tasks: { taskId: string }[] } };
    expect(body.data.subprojects.map((entry) => entry.subprojectId)).not.toContain('SUB-ARCH');
    expect(body.data.tasks.map((entry) => entry.taskId)).toEqual(['T-LIVE']);
  });
});
