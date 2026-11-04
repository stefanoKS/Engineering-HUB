/**
 * Member creation of tasks and subprojects against real PostgreSQL.
 *
 * A MEMBER files work immediately: creation is not an approval step, but the owner, the status and
 * the hierarchy stay server-side. These tests prove that a member cannot create a project, cannot
 * write a privileged field, cannot cross a project boundary, cannot exceed the four-level nesting
 * policy and cannot duplicate a subproject with a retried idempotency key - while completion still
 * needs a manager decision.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertProject, insertSubproject } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

const password = 'Member-create-password-123';

beforeAll(async () => {
  hash = await hashPassword(password);
});

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(
    "INSERT INTO members(member_id,name,role) VALUES('MEM-ADMIN','Admin','ADMIN'),('MEM-MANAGER','Manager','MANAGER'),('MEM-A','Member A','MEMBER'),('MEM-B','Member B','MEMBER'),('MEM-VIEW','Viewer','VIEWER')"
  );
  await db.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
      ('MEM-ADMIN','0001',$1,false),('MEM-MANAGER','0002',$1,false),('MEM-A','0010',$1,false),
      ('MEM-B','0011',$1,false),('MEM-VIEW','0020',$1,false)`,
    [hash]
  );
  await insertProject(db, { projectName: 'Alpha', status: 'Active', dashboardVisibility: 'INTERNAL' }, 'PRJ-A');
  await insertProject(db, { projectName: 'Beta', status: 'Active', dashboardVisibility: 'INTERNAL' }, 'PRJ-B');
  await insertProject(db, { projectName: 'Old', status: 'Active', dashboardVisibility: 'INTERNAL' }, 'PRJ-OLD');
  await db.query("UPDATE projects SET status = 'Archived', archived_at = now() WHERE project_id = 'PRJ-OLD'");
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

function createSubproject(headers: Record<string, string>, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/employee/subprojects', headers, payload });
}

describe('member subproject creation', () => {
  it('creates a root subproject immediately, owned by the verified member', async () => {
    const member = await login('0010');
    const response = await createSubproject(member, {
      idempotencyKey: 'member-sub-root-1',
      projectId: 'PRJ-A',
      subprojectName: '試作評価',
      description: 'First trial',
      deadline: '2026-12-20'
    });
    expect(response.statusCode, response.body).toBe(200);
    const created = response.json().data as {
      subproject: { subprojectId: string; ownerId: string; status: string; depth: number; parentSubprojectId: string | null };
      replayed: boolean;
    };
    expect(created.replayed).toBe(false);
    expect(created.subproject.ownerId).toBe('MEM-A');
    expect(created.subproject.status).toBe('Active');
    expect(created.subproject.depth).toBe(1);
    expect(created.subproject.parentSubprojectId).toBeNull();

    // No approval request is created for a creation.
    const requests = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM task_requests');
    expect(Number(requests?.count ?? 0)).toBe(0);

    // The creation is recorded in the audit trail with its identity and creator.
    const audited = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE action = 'SUBPROJECT_CREATED' AND entity_id = $1 AND actor_member_id = 'MEM-A'",
      [created.subproject.subprojectId]
    );
    expect(Number(audited?.count ?? 0)).toBe(1);
  });

  it('creates a nested subproject and offers it for an immediate task', async () => {
    const member = await login('0010');
    const root = await createSubproject(member, {
      idempotencyKey: 'member-sub-nest-root',
      projectId: 'PRJ-A',
      subprojectName: 'Root area'
    });
    const rootId = (root.json().data as { subproject: { subprojectId: string } }).subproject.subprojectId;
    const child = await createSubproject(member, {
      idempotencyKey: 'member-sub-nest-child',
      projectId: 'PRJ-A',
      parentSubprojectId: rootId,
      subprojectName: 'Child area'
    });
    expect(child.statusCode, child.body).toBe(200);
    const childRecord = (child.json().data as { subproject: { subprojectId: string; depth: number; parentSubprojectId: string } })
      .subproject;
    expect(childRecord.depth).toBe(2);
    expect(childRecord.parentSubprojectId).toBe(rootId);

    // The hierarchy metadata reaches the member's creation options.
    const options = await app.inject({ url: '/api/employee/my-work/projects', headers: { cookie: member.cookie! } });
    expect(options.statusCode, options.body).toBe(200);
    const option = (
      options.json() as {
        data: { items: { projectId: string; subprojects: { subprojectId: string; parentSubprojectId: string | null; depth: number }[] }[] };
      }
    ).data.items.find((entry) => entry.projectId === 'PRJ-A');
    const childOption = option?.subprojects.find((entry) => entry.subprojectId === childRecord.subprojectId);
    expect(childOption).toMatchObject({ parentSubprojectId: rootId, depth: 2 });

    // A task can be filed under the subproject that was just created.
    const task = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: member,
      payload: {
        idempotencyKey: 'member-task-under-new-sub',
        projectId: 'PRJ-A',
        subprojectId: childRecord.subprojectId,
        taskName: 'Evaluate the trial part',
        deadline: '2026-12-24'
      }
    });
    expect(task.statusCode, task.body).toBe(200);
    const stored = await db.one<{ subproject_id: string; owner_member_id: string }>(
      'SELECT subproject_id, owner_member_id FROM tasks WHERE task_id = $1',
      [(task.json() as { data: { taskId: string } }).data.taskId]
    );
    expect(stored?.subproject_id).toBe(childRecord.subprojectId);
    expect(stored?.owner_member_id).toBe('MEM-A');
  });

  it('replays an identical retry without creating a second subproject', async () => {
    const member = await login('0010');
    const payload = {
      idempotencyKey: 'member-sub-replay',
      projectId: 'PRJ-A',
      subprojectName: 'Replayed area'
    };
    const first = await createSubproject(member, payload);
    const second = await createSubproject(member, payload);
    expect(second.statusCode, second.body).toBe(200);
    expect((second.json().data as { replayed: boolean }).replayed).toBe(true);
    expect((first.json().data as { subproject: { subprojectId: string } }).subproject.subprojectId).toBe(
      (second.json().data as { subproject: { subprojectId: string } }).subproject.subprojectId
    );
    const rows = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM subprojects WHERE subproject_name = 'Replayed area'"
    );
    expect(Number(rows?.count ?? 0)).toBe(1);
  });

  it('refuses privileged fields and a member-supplied owner or status', async () => {
    const member = await login('0010');
    for (const extra of [
      { ownerId: 'MEM-B' },
      { status: 'Planned' },
      { estimatedHours: 10 },
      { progressPercent: 80 },
      { role: 'ADMIN' }
    ]) {
      const response = await createSubproject(member, {
        idempotencyKey: `privileged-${Object.keys(extra)[0]}`,
        projectId: 'PRJ-A',
        subprojectName: 'Injected',
        ...extra
      });
      expect(response.statusCode, `${Object.keys(extra)[0]}: ${response.body}`).toBe(400);
    }
  });

  it('refuses an empty name, a blank project and a cross-project parent', async () => {
    const member = await login('0010');
    const other = await insertSubproject(db, { projectId: 'PRJ-B', subprojectName: 'Beta area' }, 'SUB-B');
    const blankName = await createSubproject(member, {
      idempotencyKey: 'blank-name',
      projectId: 'PRJ-A',
      subprojectName: '   '
    });
    expect(blankName.statusCode, blankName.body).toBe(400);
    const crossProject = await createSubproject(member, {
      idempotencyKey: 'cross-project-parent',
      projectId: 'PRJ-A',
      parentSubprojectId: other.subprojectId,
      subprojectName: 'Wrong side'
    });
    expect(crossProject.statusCode, crossProject.body).toBe(400);
    expect((crossProject.json() as { error: { code: string } }).error.code).toBe('HIERARCHY_INVALID');
    const unknownProject = await createSubproject(member, {
      idempotencyKey: 'unknown-project',
      projectId: 'PRJ-MISSING',
      subprojectName: 'Nowhere'
    });
    expect(unknownProject.statusCode, unknownProject.body).toBe(404);
  });

  it('refuses an archived project and an archived parent', async () => {
    const member = await login('0010');
    const archivedProject = await createSubproject(member, {
      idempotencyKey: 'archived-project',
      projectId: 'PRJ-OLD',
      subprojectName: 'Under an archived project'
    });
    expect(archivedProject.statusCode, archivedProject.body).toBe(409);
    expect((archivedProject.json() as { error: { code: string } }).error.code).toBe('INVALID_TRANSITION');

    const archivedParent = await insertSubproject(
      db,
      { projectId: 'PRJ-A', subprojectName: 'Closed area', status: 'Archived' },
      'SUB-CLOSED'
    );
    const underArchived = await createSubproject(member, {
      idempotencyKey: 'archived-parent',
      projectId: 'PRJ-A',
      parentSubprojectId: archivedParent.subprojectId,
      subprojectName: 'Under an archived parent'
    });
    expect(underArchived.statusCode, underArchived.body).toBe(400);
    expect((underArchived.json() as { error: { code: string } }).error.code).toBe('HIERARCHY_INVALID');
  });

  it('refuses to exceed the four-level subproject policy', async () => {
    const member = await login('0010');
    let parentId: string | null = null;
    for (let level = 1; level <= 4; level += 1) {
      const response = await createSubproject(member, {
        idempotencyKey: `depth-level-${level}`,
        projectId: 'PRJ-A',
        ...(parentId ? { parentSubprojectId: parentId } : {}),
        subprojectName: `Level ${level}`
      });
      expect(response.statusCode, response.body).toBe(200);
      parentId = (response.json() as { data: { subproject: { subprojectId: string } } }).data.subproject.subprojectId;
    }
    const tooDeep = await createSubproject(member, {
      idempotencyKey: 'depth-level-five',
      projectId: 'PRJ-A',
      parentSubprojectId: parentId,
      subprojectName: 'Level 5'
    });
    expect(tooDeep.statusCode, tooDeep.body).toBe(400);
    expect((tooDeep.json() as { error: { code: string } }).error.code).toBe('HIERARCHY_DEPTH');
  });
});

describe('creation authorization', () => {
  it('keeps the member endpoint closed to a manager, an administrator and a viewer', async () => {
    for (const employeeId of ['0002', '0001', '0020']) {
      const headers = await login(employeeId);
      const response = await createSubproject(headers, {
        idempotencyKey: `denied-${employeeId}`,
        projectId: 'PRJ-A',
        subprojectName: 'Denied area'
      });
      expect(response.statusCode, `${employeeId}: ${response.body}`).toBe(403);
    }
    const rows = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM subprojects WHERE subproject_name = 'Denied area'"
    );
    expect(Number(rows?.count ?? 0)).toBe(0);
  });

  it('still refuses project creation and direct completion for a MEMBER', async () => {
    const member = await login('0010');
    const project = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: member,
      payload: {
        idempotencyKey: 'member-project',
        projectName: 'Member project',
        responsibilityId: 'RSP-1'
      }
    });
    expect(project.statusCode, project.body).toBe(403);

    const task = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: member,
      payload: {
        idempotencyKey: 'member-completion-guard',
        projectId: 'PRJ-A',
        taskName: 'Needs a manager decision',
        deadline: '2026-12-31'
      }
    });
    const taskId = (task.json() as { data: { taskId: string } }).data.taskId;
    const direct = await app.inject({
      method: 'POST',
      url: `/api/manager/tasks/${taskId}/complete`,
      headers: member,
      payload: { revision: 1, confirmed: true }
    });
    expect(direct.statusCode, direct.body).toBe(403);
    const stored = await db.one<{ status: string }>('SELECT status FROM tasks WHERE task_id = $1', [taskId]);
    expect(stored?.status).toBe('Not Started');
  });
});
