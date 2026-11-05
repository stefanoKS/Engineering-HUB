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
import { Database, REQUIRED_SCHEMA_VERSION, insertProject, insertSubproject, saveSettings } from '@eh/db';
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

  it('hides cancelled and archived work from the default list and restricts the history view', async () => {
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
    // Archived and cancelled history is a management view, refused before any read.
    const refused = await app.inject({ url: '/api/work/tasks?includeInactive=true', headers: { cookie: viewer.cookie! } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('AUTHORIZATION_DENIED');
    const manager = await login('0002');
    const including = await app.inject({ url: '/api/work/tasks?includeInactive=true', headers: { cookie: manager.cookie! } });
    expect(including.statusCode, including.body).toBe(200);
    const allIds = (including.json() as { data: { items: { taskId: string }[] } }).data.items.map((task) => task.taskId);
    expect(allIds).toContain('TSK-CAN');
    expect(allIds).toContain('TSK-OLD');
  });
});

describe('project visibility policy', () => {
  async function fixtures(): Promise<void> {
    await db.query(
      "INSERT INTO projects(project_id,project_name,status,dashboard_visibility) VALUES('PRJ-R','Restricted','Active','RESTRICTED')"
    );
    await db.query(
      "INSERT INTO projects(project_id,project_name,status,archived_at) VALUES('PRJ-ARC','Archived','Archived', now())"
    );
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES('T-PUB','PRJ-A','Public work','In Progress','2026-12-01'),('T-RES','PRJ-R','Restricted work','In Progress','2026-12-01'),('T-ARC','PRJ-ARC','Archived work','In Progress','2026-12-01')"
    );
  }

  it('shows MEMBER and VIEWER only INTERNAL, non-archived work', async () => {
    await fixtures();
    for (const employeeId of ['0010', '0020']) {
      const headers = await login(employeeId);
      const response = await app.inject({ url: '/api/work/tasks', headers: { cookie: headers.cookie! } });
      expect(response.statusCode, response.body).toBe(200);
      const ids = (response.json() as { data: { items: { taskId: string }[] } }).data.items.map((task) => task.taskId);
      expect(ids).toContain('T-PUB');
      expect(ids).not.toContain('T-RES');
      expect(ids).not.toContain('T-ARC');
      // Guessed and restricted identifiers are indistinguishable from a missing record.
      for (const taskId of ['T-RES', 'T-ARC', 'TSK-GUESSED-0001']) {
        const detail = await app.inject({ url: `/api/work/tasks/${taskId}`, headers: { cookie: headers.cookie! } });
        expect(detail.statusCode, `${employeeId} ${taskId}`).toBe(404);
        expect(detail.json().error.code).toBe('NOT_FOUND');
        expect(detail.body).not.toContain('Restricted work');
      }
      const publicDetail = await app.inject({ url: '/api/work/tasks/T-PUB', headers: { cookie: headers.cookie! } });
      expect(publicDetail.statusCode).toBe(200);
    }
  });

  it('keeps restricted and archived work visible to a manager', async () => {
    await fixtures();
    const manager = await login('0002');
    const response = await app.inject({
      url: '/api/work/tasks?includeInactive=true',
      headers: { cookie: manager.cookie! }
    });
    expect(response.statusCode, response.body).toBe(200);
    const ids = (response.json() as { data: { items: { taskId: string }[] } }).data.items.map((task) => task.taskId);
    expect(ids).toEqual(expect.arrayContaining(['T-PUB', 'T-RES', 'T-ARC']));
    for (const taskId of ['T-RES', 'T-ARC', 'T-PUB']) {
      const detail = await app.inject({ url: `/api/work/tasks/${taskId}`, headers: { cookie: manager.cookie! } });
      expect(detail.statusCode, taskId).toBe(200);
    }
  });

  it('offers a paginated read-only project list and an allowlisted project detail', async () => {
    await fixtures();
    const member = await login('0010');
    const list = await app.inject({ url: '/api/work/projects?pageSize=10', headers: { cookie: member.cookie! } });
    expect(list.statusCode, list.body).toBe(200);
    const body = list.json().data as { items: { projectId: string }[]; total: number; totalPages: number };
    expect(body.items.map((project) => project.projectId)).toContain('PRJ-A');
    expect(body.items.map((project) => project.projectId)).not.toContain('PRJ-R');
    expect(body.items.map((project) => project.projectId)).not.toContain('PRJ-ARC');
    expect(body.totalPages).toBeGreaterThanOrEqual(1);

    const detail = await app.inject({ url: '/api/work/projects/PRJ-A', headers: { cookie: member.cookie! } });
    expect(detail.statusCode, detail.body).toBe(200);
    const record = detail.json().data.record as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(
      ['activeTaskCount', 'committedDeadline', 'completedTaskCount', 'description', 'health', 'priority', 'projectId', 'projectName', 'progressPercent', 'projectOwnerName', 'responsibilityName', 'status'].sort()
    );
    expect(detail.body).not.toContain('dashboardSummary');
    expect(detail.body).not.toContain('notificationEnabled');

    for (const projectId of ['PRJ-R', 'PRJ-ARC', 'PRJ-GUESSED']) {
      const refused = await app.inject({ url: `/api/work/projects/${projectId}`, headers: { cookie: member.cookie! } });
      expect(refused.statusCode, projectId).toBe(404);
    }
  });
});

describe('member project explorer', () => {
  it('serves the project and subproject descriptions a member may read, never a restricted one', async () => {
    await db.query("UPDATE projects SET description = $1 WHERE project_id = 'PRJ-A'", ['Alpha overview\nSecond line']);
    await db.query(
      "INSERT INTO projects(project_id,project_name,status,dashboard_visibility,description) VALUES('PRJ-R','Restricted','Active','RESTRICTED','Top secret plan')"
    );
    await insertSubproject(db, { projectId: 'PRJ-A', subprojectName: 'Area A', description: 'Area A detail\nline two' }, 'SUB-A');
    await insertSubproject(
      db,
      { projectId: 'PRJ-A', subprojectName: 'Area A1', parentSubprojectId: 'SUB-A', description: 'Nested detail' },
      'SUB-A1'
    );
    await insertSubproject(db, { projectId: 'PRJ-R', subprojectName: 'Hidden area', description: 'Restricted detail' }, 'SUB-R');
    await db.query(
      "INSERT INTO tasks(task_id,project_id,subproject_id,task_name,status,due_date) VALUES('T-A','PRJ-A','SUB-A1','Nested work','In Progress','2026-12-01')"
    );

    const member = await login('0010');
    const detail = await app.inject({ url: '/api/work/projects/PRJ-A', headers: { cookie: member.cookie! } });
    expect(detail.statusCode, detail.body).toBe(200);
    const data = detail.json().data as {
      record: { description: string; activeTaskCount: number; completedTaskCount: number };
      subprojects: { subprojectId: string; description: string }[];
    };
    expect(data.record.description).toBe('Alpha overview\nSecond line');
    expect(data.record.activeTaskCount).toBe(1);
    expect(data.record.completedTaskCount).toBe(0);
    expect(data.subprojects.map((entry) => entry.subprojectId)).toEqual(['SUB-A', 'SUB-A1']);
    expect(data.subprojects.find((entry) => entry.subprojectId === 'SUB-A1')?.description).toBe('Nested detail');
    expect(detail.body).not.toContain('Restricted detail');
    expect(detail.body).not.toContain('Top secret plan');

    // A RESTRICTED description is never reachable, not even through a guessed identifier.
    const refused = await app.inject({ url: '/api/work/projects/PRJ-R', headers: { cookie: member.cookie! } });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.body).not.toContain('Top secret plan');
  });

  it('lets a manager write a subproject description and keeps an existing row on the empty default', async () => {
    await insertSubproject(db, { projectId: 'PRJ-A', subprojectName: 'Legacy area' }, 'SUB-LEGACY');
    const legacy = await db.one<{ description: string }>(
      "SELECT description FROM subprojects WHERE subproject_id = 'SUB-LEGACY'"
    );
    expect(legacy?.description).toBe('');

    const manager = await login('0002');
    const created = await app.inject({
      method: 'POST',
      url: '/api/manager/subprojects',
      headers: manager,
      payload: {
        idempotencyKey: 'sub-description-create-1',
        projectId: 'PRJ-A',
        subprojectName: 'Spec area',
        description: 'First line\nSecond line',
        nextAction: 'Review drawing'
      }
    });
    expect(created.statusCode, created.body).toBe(200);
    const subproject = (
      created.json() as { data: { subproject: { subprojectId: string; description: string; revision: number } } }
    ).data.subproject;
    expect(subproject.description).toBe('First line\nSecond line');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/manager/subprojects/${subproject.subprojectId}`,
      headers: manager,
      payload: { revision: subproject.revision, description: 'Updated detail' }
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((patched.json() as { data: { subproject: { description: string } } }).data.subproject.description).toBe(
      'Updated detail'
    );
    // A partial patch never rewrites the columns the manager did not address.
    const stored = await db.one<{ next_action: string; status: string; owner_id: string | null }>(
      'SELECT next_action, status, owner_id FROM subprojects WHERE subproject_id = $1',
      [subproject.subprojectId]
    );
    expect(stored).toMatchObject({ next_action: 'Review drawing', status: 'Planned', owner_id: null });

    const member = await login('0010');
    const read = await app.inject({ url: '/api/work/projects/PRJ-A', headers: { cookie: member.cookie! } });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.body).toContain('Updated detail');
  });

  it('offers responsibility filtering and TaskScope counts on the read-only project list', async () => {
    await db.query("INSERT INTO responsibilities(responsibility_id,name) VALUES('RES-1','Design')");
    await db.query("UPDATE projects SET responsibility_id = 'RES-1' WHERE project_id = 'PRJ-A'");
    await db.query(
      "INSERT INTO projects(project_id,project_name,status,dashboard_visibility) VALUES('PRJ-B','Beta','Active','INTERNAL')"
    );
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES('T-OPEN','PRJ-A','Open work','In Progress','2026-12-01'),('T-DONE','PRJ-A','Done work','Done','2026-12-01'),('T-B','PRJ-B','Beta work','In Progress','2026-12-01')"
    );
    const member = await login('0010');
    const all = await app.inject({ url: '/api/work/projects?pageSize=10', headers: { cookie: member.cookie! } });
    expect(all.statusCode, all.body).toBe(200);
    const allData = all.json().data as {
      items: { projectId: string; activeTaskCount: number; completedTaskCount: number }[];
      responsibilities: { responsibilityId: string; name: string }[];
    };
    expect(allData.responsibilities).toEqual([{ responsibilityId: 'RES-1', name: 'Design' }]);
    const alpha = allData.items.find((project) => project.projectId === 'PRJ-A');
    expect(alpha?.activeTaskCount).toBe(1);
    expect(alpha?.completedTaskCount).toBe(1);

    const filtered = await app.inject({
      url: '/api/work/projects?responsibilityId=RES-1',
      headers: { cookie: member.cookie! }
    });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect((filtered.json().data as { items: { projectId: string }[] }).items.map((project) => project.projectId)).toEqual([
      'PRJ-A'
    ]);
  });

  it('searches the project name only and never a private column', async () => {
    await db.query("UPDATE projects SET next_action = 'Secret next action' WHERE project_id = 'PRJ-A'");
    const member = await login('0010');
    const byPrivate = await app.inject({
      url: '/api/work/projects?query=Secret',
      headers: { cookie: member.cookie! }
    });
    expect(byPrivate.statusCode, byPrivate.body).toBe(200);
    expect((byPrivate.json().data as { items: { projectId: string }[] }).items).toEqual([]);
    const byName = await app.inject({
      url: '/api/work/projects?query=alpha',
      headers: { cookie: member.cookie! }
    });
    expect(
      (byName.json().data as { items: { projectId: string }[] }).items.map((project) => project.projectId)
    ).toEqual(['PRJ-A']);
  });

  it('describes a read-only task with its project and subproject path', async () => {
    await insertSubproject(db, { projectId: 'PRJ-A', subprojectName: 'Area A' }, 'SUB-A');
    await insertSubproject(db, { projectId: 'PRJ-A', subprojectName: 'Area A1', parentSubprojectId: 'SUB-A' }, 'SUB-A1');
    await db.query(
      "INSERT INTO tasks(task_id,project_id,subproject_id,task_name,description,status,due_date) VALUES('T-DESC','PRJ-A','SUB-A1','Described task',$1,'In Progress','2026-12-01')",
      ['First line\nSecond line']
    );
    const member = await login('0010');
    const detail = await app.inject({ url: '/api/work/tasks/T-DESC', headers: { cookie: member.cookie! } });
    expect(detail.statusCode, detail.body).toBe(200);
    const data = detail.json().data as {
      record: { description: string };
      context: { projectName: string; subprojects: { subprojectName: string }[] };
    };
    expect(data.record.description).toBe('First line\nSecond line');
    expect(data.context.projectName).toBe('Alpha');
    expect(data.context.subprojects.map((entry) => entry.subprojectName)).toEqual(['Area A', 'Area A1']);
  });

  it('keeps a description a member wrote when the task is read back', async () => {
    const member = await login('0010');
    const created = await app.inject({
      method: 'POST',
      url: '/api/employee/my-work',
      headers: member,
      payload: {
        idempotencyKey: 'member-described-task-1',
        projectId: 'PRJ-A',
        taskName: 'Member described work',
        description: 'Line one\nLine two',
        deadline: '2026-12-15'
      }
    });
    expect(created.statusCode, created.body).toBe(200);
    const taskId = (created.json() as { data: { taskId: string } }).data.taskId;
    const detail = await app.inject({ url: `/api/work/tasks/${taskId}`, headers: { cookie: member.cookie! } });
    expect(detail.statusCode, detail.body).toBe(200);
    const data = detail.json().data as { record: { description: string; taskName: string } };
    expect(data.record.taskName).toBe('Member described work');
    expect(data.record.description).toBe('Line one\nLine two');
  });

  it('refuses project, subproject and task mutations from MEMBER and VIEWER', async () => {
    await insertSubproject(db, { projectId: 'PRJ-A', subprojectName: 'Guard area' }, 'SUB-G');
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES('T-G','PRJ-A','Guarded','In Progress','2026-12-01')"
    );
    for (const employeeId of ['0010', '0020']) {
      const headers = await login(employeeId);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/manager/subprojects',
            headers,
            payload: { idempotencyKey: `denied-${employeeId}-sub`, projectId: 'PRJ-A', subprojectName: 'Denied' }
          })
        ).statusCode,
        `${employeeId} create`
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/manager/subprojects/SUB-G',
            headers,
            payload: { revision: 1, description: 'changed' }
          })
        ).statusCode,
        `${employeeId} patch subproject`
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/manager/projects/PRJ-A',
            headers,
            payload: { revision: 1, description: 'changed' }
          })
        ).statusCode,
        `${employeeId} patch project`
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/manager/tasks/T-G',
            headers,
            payload: { revision: 1, taskName: 'changed' }
          })
        ).statusCode,
        `${employeeId} patch task`
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/api/manager/subprojects/SUB-G',
            headers,
            payload: { revision: 1, confirmed: true, reason: 'x', confirmation: 'DELETE SUB-G' }
          })
        ).statusCode,
        `${employeeId} delete subproject`
      ).toBe(403);
      // The read-only projection is not a write path.
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/work/projects/PRJ-A',
            headers,
            payload: { revision: 1, description: 'changed' }
          })
        ).statusCode,
        `${employeeId} work patch`
      ).toBe(404);
    }
    const unchanged = await db.one<{ description: string }>(
      "SELECT description FROM subprojects WHERE subproject_id = 'SUB-G'"
    );
    expect(unchanged?.description).toBe('');
  });
});

describe('active list behaviour', () => {
  it('excludes completed work from the default list and serves it through an explicit filter', async () => {
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES('T-OPEN','PRJ-A','Open work','In Progress','2026-12-01'),('T-DONE','PRJ-A','Finished work','Done','2026-12-01')"
    );
    for (const employeeId of ['0010', '0002']) {
      const headers = await login(employeeId);
      const standard = await app.inject({ url: '/api/work/tasks', headers: { cookie: headers.cookie! } });
      const ids = (standard.json() as { data: { items: { taskId: string }[] } }).data.items.map((task) => task.taskId);
      expect(ids).toContain('T-OPEN');
      expect(ids).not.toContain('T-DONE');
      const done = await app.inject({ url: '/api/work/tasks?displayStatus=DONE', headers: { cookie: headers.cookie! } });
      expect(done.statusCode, done.body).toBe(200);
      const doneIds = (done.json() as { data: { items: { taskId: string }[]; total: number } }).data;
      expect(doneIds.items.map((task) => task.taskId)).toEqual(['T-DONE']);
      expect(doneIds.total).toBe(1);
    }
  });

  it('keeps pagination totals and the tree ancestry consistent with the filters', async () => {
    const values: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      values.push(`('T-${String(index).padStart(2, '0')}','PRJ-A','Bulk task ${index}','In Progress','2026-12-01')`);
    }
    await db.query(`INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES ${values.join(',')}`);
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES('T-DONE-BULK','PRJ-A','Finished bulk','Done','2026-12-01')"
    );
    const member = await login('0010');
    const first = await app.inject({ url: '/api/work/tasks?pageSize=25&page=1', headers: { cookie: member.cookie! } });
    const firstPage = first.json().data as { items: unknown[]; total: number; totalPages: number };
    expect(firstPage.total).toBe(30);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.items).toHaveLength(25);
    const second = await app.inject({ url: '/api/work/tasks?pageSize=25&page=2', headers: { cookie: member.cookie! } });
    expect((second.json().data as { items: unknown[] }).items).toHaveLength(5);

    // A matching child keeps its parent as ancestry context, and the counts stay filter-scoped.
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,status,due_date) VALUES('T-ROOT','PRJ-A','Assembly','In Progress','2026-12-02'),('T-CHILD','PRJ-A','Unique wiring step','In Progress','2026-12-02')"
    );
    await db.query("UPDATE tasks SET parent_task_id = 'T-ROOT' WHERE task_id = 'T-CHILD'");
    const tree = await app.inject({
      url: '/api/work/tasks?tree=true&query=Unique%20wiring&pageSize=25',
      headers: { cookie: member.cookie! }
    });
    expect(tree.statusCode, tree.body).toBe(200);
    const treeBody = tree.json().data as { items: { taskId: string }[]; matchedTotal: number; total: number };
    expect(treeBody.matchedTotal).toBe(1);
    expect(treeBody.items.map((task) => task.taskId)).toEqual(['T-ROOT']);
  });
});

describe('partial edits preserve recorded data', () => {
  it('leaves deadline, assignment, planned start, hours, progress and duration untouched', async () => {
    await db.query(
      `INSERT INTO tasks(task_id,project_id,task_name,description,owner_member_id,status,priority,planned_start,
         due_date,estimated_hours,actual_hours,progress_percent,planned_duration_value,planned_duration_unit,
         planned_duration_basis,planned_start_source,assignment_version,assignment_approved_at)
       VALUES('T-LEGACY','PRJ-A','Legacy task','Original','MEM-A','In Progress','High','2026-10-01',
         '2026-12-01',12.5,4.25,35,5,'DAY','WORKING_DAYS','LEGACY',2,now())`
    );
    await db.query(
      "INSERT INTO task_assignees(assignment_id,task_id,member_id,assigned_by) VALUES('ASG-1','T-LEGACY','MEM-B','fixture')"
    );
    const manager = await login('0002');
    const detail = await app.inject({ url: '/api/manager/tasks/T-LEGACY', headers: { cookie: manager.cookie! } });
    const revision = (detail.json() as { data: { record: { revision: number } } }).data.record.revision;

    // A name-only edit is a partial patch.
    const renamed = await app.inject({
      method: 'PATCH',
      url: '/api/manager/tasks/T-LEGACY',
      headers: manager,
      payload: { revision, taskName: 'Legacy task renamed' }
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const stored = await db.one<Record<string, unknown>>(
      `SELECT task_name, due_date::text AS due_date, planned_start::text AS planned_start,
              estimated_hours, actual_hours, progress_percent, planned_duration_value,
              planned_start_source, owner_member_id, assignment_version
         FROM tasks WHERE task_id = 'T-LEGACY'`
    );
    expect(stored).toMatchObject({
      task_name: 'Legacy task renamed',
      due_date: '2026-12-01',
      planned_start: '2026-10-01',
      progress_percent: 35,
      planned_start_source: 'LEGACY',
      owner_member_id: 'MEM-A',
      assignment_version: 2
    });
    expect(Number(stored?.estimated_hours)).toBe(12.5);
    expect(Number(stored?.actual_hours)).toBe(4.25);
    expect(Number(stored?.planned_duration_value)).toBe(5);
    const assignees = await db.many<{ member_id: string }>(
      'SELECT member_id FROM task_assignees WHERE task_id = $1 AND removed_at IS NULL ORDER BY member_id',
      ['T-LEGACY']
    );
    expect(assignees.map((row) => row.member_id)).toEqual(['MEM-B']);

    // A deadline change on work without a duration keeps the stored start instead of inventing one.
    await db.query(
      `INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status,priority,planned_start,due_date,
         estimated_hours,actual_hours,progress_percent,planned_start_source)
       VALUES('T-NODUR','PRJ-A','Deadline only','MEM-A','In Progress','Medium','2026-10-01','2026-12-01',
         8,2,20,'LEGACY')`
    );
    const moved = await app.inject({
      method: 'PATCH',
      url: '/api/manager/tasks/T-NODUR',
      headers: manager,
      payload: { revision: 1, deadline: '2026-12-15', confirmDeadlineChange: true }
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const afterDeadline = await db.one<{ due_date: string; planned_start: string; estimated_hours: string; actual_hours: string }>(
      `SELECT due_date::text AS due_date, planned_start::text AS planned_start,
              estimated_hours::text AS estimated_hours, actual_hours::text AS actual_hours
         FROM tasks WHERE task_id = 'T-NODUR'`
    );
    expect(afterDeadline?.due_date).toBe('2026-12-15');
    expect(afterDeadline?.planned_start).toBe('2026-10-01');
    expect(Number(afterDeadline?.estimated_hours)).toBe(8);
    expect(Number(afterDeadline?.actual_hours)).toBe(2);
  });

  it('keeps an existing inactive assignee and refuses a new inactive assignment', async () => {
    await db.query(
      "INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status,due_date) VALUES('T-INACT','PRJ-A','Inactive owner','MEM-B','In Progress','2026-12-01')"
    );
    await db.query("INSERT INTO members(member_id,name,active) VALUES('MEM-OLD','Former Staff',false)");
    await db.query("UPDATE members SET active = false WHERE member_id = 'MEM-B'");
    const manager = await login('0002');
    const renamed = await app.inject({
      method: 'PATCH',
      url: '/api/manager/tasks/T-INACT',
      headers: manager,
      payload: { revision: 1, taskName: 'Inactive owner renamed' }
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const stored = await db.one<{ owner_member_id: string }>("SELECT owner_member_id FROM tasks WHERE task_id = 'T-INACT'");
    expect(stored?.owner_member_id).toBe('MEM-B');

    const revision = (renamed.json() as { data: { task: { revision: number } } }).data.task.revision;
    const refused = await app.inject({
      method: 'PATCH',
      url: '/api/manager/tasks/T-INACT',
      headers: manager,
      payload: { revision, assigneeIds: ['MEM-B', 'MEM-OLD'] }
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('VALIDATION_FAILED');
    // The refused assignment wrote nothing.
    const untouched = await db.one<{ owner_member_id: string; revision: number }>(
      "SELECT owner_member_id, revision FROM tasks WHERE task_id = 'T-INACT'"
    );
    expect(untouched?.owner_member_id).toBe('MEM-B');
    expect(untouched?.revision).toBe(revision);
  });

  it('shows a pending completion indicator to every assignee while the receipt stays private', async () => {
    await saveSettings(db, { REQUEST_SUBMISSION_ENABLED: 'true' }, 'MEM-ADMIN');
    const manager = await login('0002');
    const taskId = await createTaskAsManager(manager, { name: 'Shared report', assigneeIds: ['MEM-A', 'MEM-B'] });
    const memberA = await login('0010');
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/employee/requests',
      headers: memberA,
      payload: { clientRequestId: 'shared-indicator-1', taskId, requestType: 'COMPLETION_REPORT', completionNote: 'Done by A' }
    });
    expect(submitted.statusCode, submitted.body).toBe(200);

    const listA = await app.inject({ url: '/api/employee/my-work', headers: { cookie: memberA.cookie! } });
    const itemA = (listA.json() as { data: { items: { taskId: string; pendingRequest: boolean; reviewState: string }[] } }).data.items.find(
      (item) => item.taskId === taskId
    );
    expect(itemA?.pendingRequest).toBe(true);
    expect(itemA?.reviewState).toBe('PENDING');

    // Another assignee sees the same task-level pending state, whoever filed the report.
    const memberB = await login('0011');
    const listB = await app.inject({ url: '/api/employee/my-work', headers: { cookie: memberB.cookie! } });
    const itemB = (listB.json() as { data: { items: { taskId: string; pendingRequest: boolean; reviewState: string }[] } }).data.items.find(
      (item) => item.taskId === taskId
    );
    expect(itemB?.pendingRequest).toBe(true);
    expect(itemB?.reviewState).toBe('PENDING');

    // The receipt list still belongs to the actual reporter only.
    const mineB = await app.inject({ url: '/api/employee/requests/mine', headers: { cookie: memberB.cookie! } });
    expect((mineB.json() as { data: { items: unknown[] } }).data.items).toHaveLength(0);
    const mineA = await app.inject({ url: '/api/employee/requests/mine', headers: { cookie: memberA.cookie! } });
    expect((mineA.json() as { data: { items: { taskId: string }[] } }).data.items.map((entry) => entry.taskId)).toEqual([
      taskId
    ]);
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
    expect(ledger?.version).toBe(REQUIRED_SCHEMA_VERSION);
    await db.query('DELETE FROM schema_migrations WHERE version = $1', [ledger!.version]);
    const response = await app.inject({ url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'migration-required',
      requiredSchemaVersion: REQUIRED_SCHEMA_VERSION
    });
    expect(response.json().error.code).toBe('DATABASE_MIGRATION_REQUIRED');
    await db.query(
      'INSERT INTO schema_migrations(version, name, checksum, duration_ms) VALUES($1,$2,$3,$4)',
      [ledger!.version, ledger!.name, ledger!.checksum, ledger!.duration_ms]
    );
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(200);
  });
});
