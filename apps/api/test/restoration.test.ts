/**
 * Restoration of recoverably removed tasks and subprojects, plus the ADMIN Deleted Items view.
 *
 * These prove the properties a mock cannot: only an ADMIN restores, the *same* row and identifier
 * come back, a completed task stays completed, a removed parent or an inactive project blocks the
 * restoration with an explanation instead of being repaired silently, a repeated or stale request
 * is safe, and a permanently erased record is never a restore candidate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertProject, insertResponsibility, insertTask, saveSettings } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase, seedTestDivisions } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

const password = 'Restoration-password-123';

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
  await insertResponsibility(db, { name: '設計' }, 'RSP-A');
  await insertProject(
    db,
    { projectName: 'Alpha', responsibilityId: 'RSP-A', status: 'Active', dashboardVisibility: 'RESTRICTED' },
    'PRJ-A'
  );
  await seedTestDivisions(db);
  app = await buildApp({
    db,
    inbox: new NullInboxSource(),
    logger: false,
    config: loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'local', PUBLIC_ORIGIN: 'http://localhost:8050' })
  });
  await app.ready();
  await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, 'MEM-ADMIN');
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

async function removeTask(headers: Headers, taskId: string): Promise<void> {
  const row = await db.one<{ revision: number }>('SELECT revision FROM tasks WHERE task_id = $1', [taskId]);
  const response = await app.inject({
    method: 'POST',
    url: `/api/manager/tasks/${taskId}/remove`,
    headers,
    payload: { revision: row!.revision, confirmed: true }
  });
  expect(response.statusCode, response.body).toBe(200);
}

function restore(headers: Headers, entityType: 'tasks' | 'subprojects', entityId: string, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/admin/${entityType}/${entityId}/restore`, headers, payload: body });
}

function restorePreflight(headers: Headers, entityType: string, entityId: string) {
  return app.inject({
    url: `/api/admin/${entityType}/${entityId}/restore-preflight`,
    headers: { cookie: headers.cookie! }
  });
}

async function taskRow(taskId: string) {
  return db.one<{
    task_name: string;
    status: string;
    progress_percent: number | null;
    due_date: string | null;
    owner_member_id: string | null;
    completed_at: string | null;
    deleted_at: string | null;
    revision: number;
  }>(
    `SELECT task_name, status, progress_percent, due_date, owner_member_id, completed_at, deleted_at, revision
       FROM tasks WHERE task_id = $1`,
    [taskId]
  );
}

describe('restoring a recoverably removed record', () => {
  it('restores the same row and identifier with its status, dates and assignments', async () => {
    await insertTask(
      db,
      {
        projectId: 'PRJ-A',
        taskName: 'Removed but real',
        ownerMemberId: 'MEM-A',
        status: 'In Progress',
        progressPercent: 40,
        dueDate: '2026-12-15'
      },
      'T-RESTORE'
    );
    await db.query(
      "INSERT INTO task_assignees(assignment_id,task_id,member_id,assigned_by) VALUES('ASG-RESTORE','T-RESTORE','MEM-MANAGER','MEM-ADMIN')"
    );
    const admin = await login('0001');
    await removeTask(admin, 'T-RESTORE');
    const removed = await taskRow('T-RESTORE');
    expect(removed?.deleted_at).not.toBeNull();

    const checked = await restorePreflight(admin, 'tasks', 'T-RESTORE');
    expect(checked.statusCode, checked.body).toBe(200);
    const preflight = checked.json().data as { restorable: boolean; blockers: unknown[]; revision: number };
    expect(preflight.restorable).toBe(true);
    expect(preflight.blockers).toEqual([]);

    const restored = await restore(admin, 'tasks', 'T-RESTORE', {
      revision: preflight.revision,
      confirmed: true
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().data).toMatchObject({ alreadyRestored: false });

    const row = await taskRow('T-RESTORE');
    expect(row).toMatchObject({
      task_name: 'Removed but real',
      status: 'In Progress',
      progress_percent: 40,
      due_date: '2026-12-15',
      owner_member_id: 'MEM-A',
      deleted_at: null
    });
    // Restoring a historical assignment never grants or removes membership.
    expect(
      await db.one("SELECT 1 FROM task_assignees WHERE assignment_id = 'ASG-RESTORE' AND removed_at IS NULL")
    ).toBeTruthy();
    const audit = await db.one<{ new_value: { confirmationSource: string; restoredBy: string } }>(
      "SELECT new_value FROM audit_log WHERE entity_id = 'T-RESTORE' AND action = 'RECORD_RESTORED'"
    );
    expect(audit?.new_value).toMatchObject({ confirmationSource: 'BUTTON', restoredBy: 'MEM-ADMIN' });
  });

  it('restores a completed task as completed and leaves reopening a separate ADMIN act', async () => {
    await insertTask(
      db,
      { projectId: 'PRJ-A', taskName: 'Finished work', ownerMemberId: 'MEM-A', status: 'Done', dueDate: '2026-11-01' },
      'T-DONE'
    );
    await db.query("UPDATE tasks SET completed_at = now(), progress_percent = 100 WHERE task_id = 'T-DONE'");
    const admin = await login('0001');
    await removeTask(admin, 'T-DONE');

    const checked = await restorePreflight(admin, 'tasks', 'T-DONE');
    const restored = await restore(admin, 'tasks', 'T-DONE', {
      revision: checked.json().data.revision,
      confirmed: true
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const row = await taskRow('T-DONE');
    expect(row?.status).toBe('Done');
    expect(row?.progress_percent).toBe(100);
    expect(row?.completed_at).not.toBeNull();
  });

  it('restores a removed subproject without touching its siblings', async () => {
    await db.query(
      `INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES
        ('SUB-RESTORE','PRJ-A','Removed area','Planned'),
        ('SUB-KEEP','PRJ-A','Kept area','Planned')`
    );
    const admin = await login('0001');
    const revision = (await db.one<{ revision: number }>(
      "SELECT revision FROM subprojects WHERE subproject_id = 'SUB-RESTORE'"
    ))!.revision;
    const removed = await app.inject({
      method: 'POST',
      url: '/api/manager/subprojects/SUB-RESTORE/remove',
      headers: admin,
      payload: { revision, confirmed: true }
    });
    expect(removed.statusCode, removed.body).toBe(200);

    const checked = await restorePreflight(admin, 'subprojects', 'SUB-RESTORE');
    expect(checked.json().data.restorable).toBe(true);
    const restored = await restore(admin, 'subprojects', 'SUB-RESTORE', {
      revision: checked.json().data.revision,
      confirmed: true
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const row = await db.one<{ subproject_name: string; deleted_at: string | null }>(
      "SELECT subproject_name, deleted_at FROM subprojects WHERE subproject_id = 'SUB-RESTORE'"
    );
    expect(row).toMatchObject({ subproject_name: 'Removed area', deleted_at: null });
    expect(await db.one("SELECT 1 FROM subprojects WHERE subproject_id = 'SUB-KEEP' AND deleted_at IS NULL")).toBeTruthy();
  });

  it('requires MANAGER or ADMIN and refuses a repeated or stale restoration safely', async () => {
    await insertTask(db, { projectId: 'PRJ-A', taskName: 'Probe', ownerMemberId: 'MEM-A', status: 'In Progress', dueDate: '2026-12-01' }, 'T-PROBE');
    const admin = await login('0001');
    await removeTask(admin, 'T-PROBE');

    for (const employeeId of ['0010', '0020']) {
      const headers = await login(employeeId);
      const row = await taskRow('T-PROBE');
      const refused = await restore(headers, 'tasks', 'T-PROBE', { revision: row!.revision, confirmed: true });
      expect(refused.statusCode, `${employeeId}: ${refused.body}`).toBe(403);
      const preflight = await restorePreflight(headers, 'tasks', 'T-PROBE');
      expect(preflight.statusCode, `${employeeId}: ${preflight.body}`).toBe(403);
    }
    expect((await taskRow('T-PROBE'))?.deleted_at).not.toBeNull();

    const stale = await restore(admin, 'tasks', 'T-PROBE', { revision: 1, confirmed: true });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe('EDIT_CONFLICT');
    expect((await taskRow('T-PROBE'))?.deleted_at).not.toBeNull();

    const revision = (await taskRow('T-PROBE'))!.revision;
    const first = await restore(admin, 'tasks', 'T-PROBE', { revision, confirmed: true });
    expect(first.statusCode, first.body).toBe(200);
    const second = await restore(admin, 'tasks', 'T-PROBE', { revision, confirmed: true });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().data).toMatchObject({ alreadyRestored: true });
    const evidence = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE entity_id = 'T-PROBE' AND action = 'RECORD_RESTORED'"
    );
    expect(Number(evidence!.count)).toBe(1);
  });
});

describe('restoration blockers', () => {
  it('refuses to restore a task whose subproject is still removed', async () => {
    await db.query(
      "INSERT INTO subprojects(subproject_id,project_id,subproject_name,status,deleted_at) VALUES('SUB-GONE','PRJ-A','Removed area','Planned',now())"
    );
    await insertTask(
      db,
      { projectId: 'PRJ-A', subprojectId: 'SUB-GONE', taskName: 'Orphaned work', ownerMemberId: 'MEM-A', status: 'In Progress', dueDate: '2026-12-01' },
      'T-ORPHAN'
    );
    await db.query("UPDATE tasks SET deleted_at = now() WHERE task_id = 'T-ORPHAN'");
    const admin = await login('0001');
    const checked = await restorePreflight(admin, 'tasks', 'T-ORPHAN');
    expect(checked.statusCode, checked.body).toBe(200);
    expect(checked.json().data.restorable).toBe(false);
    expect(checked.json().data.blockers.map((entry: { code: string }) => entry.code)).toContain('PARENT_DELETED');

    const refused = await restore(admin, 'tasks', 'T-ORPHAN', {
      revision: checked.json().data.revision,
      confirmed: true
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe('INVALID_TRANSITION');
    expect((await taskRow('T-ORPHAN'))?.deleted_at).not.toBeNull();
    // Nothing was repaired silently: the parent stays removed.
    expect(await db.one("SELECT 1 FROM subprojects WHERE subproject_id = 'SUB-GONE' AND deleted_at IS NOT NULL")).toBeTruthy();
  });

  it('refuses to restore a subproject whose parent subproject is removed', async () => {
    await db.query(
      `INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES
        ('SUB-PARENT','PRJ-A','Parent area','Planned'),
        ('SUB-CHILD','PRJ-A','Child area','Planned')`
    );
    await db.query("UPDATE subprojects SET parent_subproject_id = 'SUB-PARENT' WHERE subproject_id = 'SUB-CHILD'");
    await db.query("UPDATE subprojects SET deleted_at = now() WHERE subproject_id IN ('SUB-PARENT','SUB-CHILD')");
    const admin = await login('0001');
    const checked = await restorePreflight(admin, 'subprojects', 'SUB-CHILD');
    expect(checked.json().data.restorable).toBe(false);
    expect(checked.json().data.blockers.map((entry: { code: string }) => entry.code)).toContain('PARENT_DELETED');
    const parent = await restorePreflight(admin, 'subprojects', 'SUB-PARENT');
    expect(parent.json().data.restorable).toBe(true);
  });

  it('refuses to restore work into an archived or cancelled project', async () => {
    await insertTask(db, { projectId: 'PRJ-A', taskName: 'Archived project work', ownerMemberId: 'MEM-A', dueDate: '2026-12-01' }, 'T-ARCH');
    await db.query("UPDATE tasks SET deleted_at = now() WHERE task_id = 'T-ARCH'");
    await db.query("UPDATE projects SET status = 'Archived', archived_at = now() WHERE project_id = 'PRJ-A'");
    const admin = await login('0001');
    const checked = await restorePreflight(admin, 'tasks', 'T-ARCH');
    expect(checked.json().data.restorable).toBe(false);
    expect(checked.json().data.blockers.map((entry: { code: string }) => entry.code)).toContain('PROJECT_INACTIVE');
    const refused = await restore(admin, 'tasks', 'T-ARCH', {
      revision: checked.json().data.revision,
      confirmed: true
    });
    expect(refused.statusCode, refused.body).toBe(409);
  });

  it('never offers a permanently erased record as a restore candidate', async () => {
    await insertTask(db, { projectId: 'PRJ-A', taskName: 'Mistyped entry', dueDate: '2026-12-01' }, 'T-PURGED');
    const admin = await login('0001');
    const preflight = await app.inject({
      url: '/api/manager/deletion/preflight?entityType=TASKS&entityId=T-PURGED',
      headers: { cookie: admin.cookie! }
    });
    const revision = preflight.json().data.revision as number;
    const purged = await app.inject({
      method: 'POST',
      url: '/api/admin/tasks/T-PURGED/purge',
      headers: admin,
      payload: { revision, confirmed: true }
    });
    expect(purged.statusCode, purged.body).toBe(200);

    const checked = await restorePreflight(admin, 'tasks', 'T-PURGED');
    expect(checked.statusCode, checked.body).toBe(404);
    expect(checked.json().error.message).toContain('cannot be restored');
    const refused = await restore(admin, 'tasks', 'T-PURGED', { revision, confirmed: true });
    expect(refused.statusCode).toBe(404);
    const listed = await app.inject({ url: '/api/admin/deleted-records', headers: { cookie: admin.cookie! } });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(
      (listed.json().data.items as { entityId: string }[]).map((entry) => entry.entityId)
    ).not.toContain('T-PURGED');
  });
});

describe('the ADMIN Deleted Items view', () => {
  it('lists removed records with their location and recorded removal evidence', async () => {
    await db.query(
      "INSERT INTO subprojects(subproject_id,project_id,subproject_name,status) VALUES('SUB-LOC','PRJ-A','Delivery area','Planned')"
    );
    await insertTask(
      db,
      { projectId: 'PRJ-A', subprojectId: 'SUB-LOC', taskName: 'Removed in area', ownerMemberId: 'MEM-A', dueDate: '2026-12-01' },
      'T-LISTED'
    );
    const admin = await login('0001');
    await removeTask(admin, 'T-LISTED');

    const response = await app.inject({
      url: '/api/admin/deleted-records?entityType=TASKS&query=Removed%20in&page=1&pageSize=20',
      headers: { cookie: admin.cookie! }
    });
    expect(response.statusCode, response.body).toBe(200);
    const page = response.json().data as {
      items: {
        entityType: string;
        entityId: string;
        name: string;
        projectName: string;
        location: string;
        deletedAt: string | null;
        deletedByName: string | null;
        confirmationSource: string | null;
        restorable: boolean;
      }[];
      total: number;
    };
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      entityType: 'TASKS',
      entityId: 'T-LISTED',
      name: 'Removed in area',
      projectName: 'Alpha',
      location: 'Delivery area',
      deletedByName: 'Admin',
      confirmationSource: 'BUTTON',
      restorable: true
    });
    expect(page.items[0]!.deletedAt).not.toBeNull();
  });

  it('requires MANAGER or ADMIN, paginated and never loads the whole table', async () => {
    for (const id of ['T-D1', 'T-D2', 'T-D3']) {
      await insertTask(db, { projectId: 'PRJ-A', taskName: `Deleted ${id}`, dueDate: '2026-12-01' }, id);
    }
    await db.query("UPDATE tasks SET deleted_at = now() WHERE task_id IN ('T-D1','T-D2','T-D3')");
    const admin = await login('0001');
    const first = await app.inject({
      url: '/api/admin/deleted-records?page=1&pageSize=2',
      headers: { cookie: admin.cookie! }
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().data.items).toHaveLength(2);
    expect(first.json().data.total).toBe(3);
    expect(first.json().data.totalPages).toBe(2);
    const second = await app.inject({
      url: '/api/admin/deleted-records?page=2&pageSize=2',
      headers: { cookie: admin.cookie! }
    });
    expect(second.json().data.items).toHaveLength(1);

    for (const employeeId of ['0010', '0020']) {
      const headers = await login(employeeId);
      const refused = await app.inject({
        url: '/api/admin/deleted-records',
        headers: { cookie: headers.cookie! }
      });
      expect(refused.statusCode, `${employeeId}: ${refused.body}`).toBe(403);
    }
  });

  it('labels missing removal evidence as unavailable instead of inventing it', async () => {
    // A legacy row removed without an audit trail: the columns exist, the evidence does not.
    await insertTask(db, { projectId: 'PRJ-A', taskName: 'Legacy removed', dueDate: '2026-12-01' }, 'T-LEGACY');
    await db.query("UPDATE tasks SET deleted_at = now() WHERE task_id = 'T-LEGACY'");
    const admin = await login('0001');
    const response = await app.inject({
      url: '/api/admin/deleted-records?query=Legacy',
      headers: { cookie: admin.cookie! }
    });
    const item = (response.json().data.items as {
      deletedByName: string | null;
      deletedByMemberId: string | null;
      reason: string | null;
      confirmationSource: string | null;
    }[])[0];
    expect(item).toMatchObject({
      deletedByName: null,
      deletedByMemberId: null,
      reason: null,
      confirmationSource: null
    });
  });
});
