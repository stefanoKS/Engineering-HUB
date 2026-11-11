/**
 * Read-only timeline projection.
 *
 * The timeline is a read: it reuses the existing visibility policy and the one counting rule, it
 * keeps plan, deadline and completion as separate facts, and a child range is derived on the
 * server from dated descendants instead of a rendered page.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  Database,
  insertMember,
  insertProject,
  insertResponsibility,
  insertSubproject,
  insertTask
} from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { freshDatabase, requireDatabase, seedTestDivisions } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;

const ADMIN = 'admin@example.co.jp';
const MANAGER = 'manager@example.co.jp';
const MEMBER = 'member@example.co.jp';
const VIEWER = 'viewer@example.co.jp';
const EMAILS = [ADMIN, MANAGER, MEMBER, VIEWER];

type Auth = { cookie: string };

async function signIn(email: string): Promise<Auth> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: email } });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '' };
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await insertMember(db, { name: 'Admin', email: ADMIN, role: 'ADMIN' }, 'MEM-ADMIN');
  await insertMember(db, { name: 'Manager', email: MANAGER, role: 'MANAGER' }, 'MEM-MANAGER');
  await insertMember(db, { name: 'Member', email: MEMBER, role: 'MEMBER' }, 'MEM-MEMBER');
  await insertMember(db, { name: 'Viewer', email: VIEWER, role: 'VIEWER' }, 'MEM-VIEWER');
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'DEVELOPMENT',
    DATABASE_URL: requireDatabase(),
    MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAILS: EMAILS.join(','),
    PUBLIC_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    MAIL_FROM_ADDRESS: 'noreply@example.co.jp',
    SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: 'sheet-id'
  });
  await seedTestDivisions(db);
  app = await buildApp({ config, db, inbox: new NullInboxSource(), logger: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await pool.end();
});

async function seed(): Promise<void> {
  await insertResponsibility(db, { name: 'Design area' }, 'RSP-T');
  await insertResponsibility(db, { name: 'Quality area' }, 'RSP-Q');
  await insertProject(
    db,
    {
      projectName: 'Visible project',
      responsibilityId: 'RSP-T',
      status: 'Active',
      dashboardVisibility: 'INTERNAL',
      plannedStart: '2026-03-01',
      forecastEnd: '2026-06-30',
      committedDeadline: '2026-07-15'
    },
    'PRJ-V'
  );
  await insertSubproject(
    db,
    {
      projectId: 'PRJ-V',
      subprojectName: 'Prototype',
      status: 'Active',
      plannedStart: '2026-03-05',
      plannedEnd: '2026-04-20',
      deadline: '2026-04-25'
    },
    'SUB-V1'
  );
  await insertSubproject(
    db,
    { projectId: 'PRJ-V', parentSubprojectId: 'SUB-V1', subprojectName: 'Evaluation', status: 'Active' },
    'SUB-V2'
  );
  // A planned task, a deadline-only task, an undated task, a container with a dated child, and a
  // completed task.
  await insertTask(
    db,
    {
      projectId: 'PRJ-V',
      subprojectId: 'SUB-V1',
      taskName: 'Planned work',
      plannedStart: '2026-03-10',
      dueDate: '2026-03-20',
      ownerMemberId: 'MEM-MEMBER',
      status: 'In Progress'
    },
    'TSK-PLAN'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-V', taskName: 'Deadline only', dueDate: '2026-05-01', ownerMemberId: 'MEM-MEMBER', status: 'Assigned' },
    'TSK-DUE'
  );
  // An undated record is possible in the stored data, so it must be representable on the timeline.
  await db.query(
    `INSERT INTO tasks (task_id, project_id, task_name, status, priority)
     VALUES ('TSK-NONE', 'PRJ-V', 'No dates', 'Not Started', 'Medium')`
  );
  await insertTask(
    db,
    { projectId: 'PRJ-V', subprojectId: 'SUB-V2', taskName: 'Container work', dueDate: '2026-09-30', status: 'In Progress' },
    'TSK-BOX'
  );
  await insertTask(
    db,
    {
      projectId: 'PRJ-V',
      subprojectId: 'SUB-V2',
      parentTaskId: 'TSK-BOX',
      taskName: 'Child work',
      plannedStart: '2026-09-01',
      dueDate: '2026-09-10',
      status: 'In Progress'
    },
    'TSK-CHILD'
  );
  await insertTask(
    db,
    {
      projectId: 'PRJ-V',
      taskName: 'Finished work',
      plannedStart: '2026-02-01',
      dueDate: '2026-02-10',
      status: 'Done'
    },
    'TSK-DONE'
  );
  await db.query("UPDATE tasks SET completed_at = '2026-02-11T02:00:00.000Z' WHERE task_id = 'TSK-DONE'");
  await insertTask(
    db,
    { projectId: 'PRJ-V', taskName: 'Inconsistent dates', plannedStart: '2026-08-20', dueDate: '2026-08-01', status: 'Assigned' },
    'TSK-ODD'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-V', taskName: 'Cancelled work', dueDate: '2026-04-01', status: 'Cancelled' },
    'TSK-CANCEL'
  );

  await insertProject(
    db,
    { projectName: 'Private project', status: 'Active', dashboardVisibility: 'RESTRICTED', committedDeadline: '2026-10-01' },
    'PRJ-P'
  );
  await insertTask(db, { projectId: 'PRJ-P', taskName: 'Private work', dueDate: '2026-10-02', status: 'In Progress' }, 'TSK-P');

  await insertProject(db, { projectName: 'Archived project', status: 'Active' }, 'PRJ-A');
  await insertTask(db, { projectId: 'PRJ-A', taskName: 'Archived work', dueDate: '2026-01-10' }, 'TSK-A');
  // An archived project keeps the archived marker the schema requires.
  await db.query("UPDATE projects SET status = 'Archived', archived_at = now() WHERE project_id = 'PRJ-A'");
}

function overview(auth: Auth, query: Record<string, string> = {}) {
  const search = new URLSearchParams(query).toString();
  return app.inject({
    method: 'GET',
    url: '/api/work/timeline' + (search ? `?${search}` : ''),
    headers: { cookie: auth.cookie }
  });
}

function branch(auth: Auth, projectId: string, query: Record<string, string> = {}) {
  const search = new URLSearchParams({ projectId, ...query }).toString();
  return app.inject({
    method: 'GET',
    url: '/api/work/timeline?' + search,
    headers: { cookie: auth.cookie }
  });
}

describe('all-project timeline view', () => {
  it('publishes only permitted projects with plan, deadline, counting and a descendant range', async () => {
    await seed();
    const member = await signIn(MEMBER);
    const response = await overview(member, { pageSize: '25' });
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data as {
      items: {
        projectId: string;
        plannedStart: string | null;
        forecastEnd: string | null;
        committedDeadline: string | null;
        openWork: number;
        completedWork: number;
        childRange: { start: string | null; end: string | null; datedItems: number; totalItems: number };
        undated: boolean;
        scheduleStart: string | null;
        scheduleFinish: string | null;
        dateSource: string;
      }[];
      total: number;
      page: number;
      totalPages: number;
      responsibilities: { responsibilityId: string }[];
    };
    expect(data.items.map((item) => item.projectId)).toEqual(['PRJ-V']);
    expect(data).toMatchObject({ total: 1, page: 1, totalPages: 1 });
    const project = data.items[0]!;
    // Plan, commitment and derived child range stay separate fields.
    expect(project.plannedStart).toBe('2026-03-01');
    expect(project.forecastEnd).toBe('2026-06-30');
    expect(project.committedDeadline).toBe('2026-07-15');
    // The range covers eligible leaf work only: a container's misleading stored date is excluded.
    expect(project.childRange.start).toBe('2026-02-01');
    expect(project.childRange.end).toBe('2026-09-10');
    expect(project.childRange.datedItems).toBeGreaterThan(0);
    expect(project.childRange.totalItems).toBeGreaterThan(project.childRange.datedItems);
    // Counting uses leaf work: the container TSK-BOX is never counted, so the five open leaves
    // (planned, deadline-only, undated, the container's child and the inconsistent row) are the
    // whole open figure, and the completed leaf is reported separately.
    expect(project.openWork).toBe(5);
    expect(project.completedWork).toBe(1);
    expect(project.undated).toBe(false);
    expect(project.scheduleStart).toBe('2026-03-01');
    expect(project.scheduleFinish).toBe('2026-07-15');
    expect(project.dateSource).toBe('EXPLICIT');
    expect(data.responsibilities.map((entry) => entry.responsibilityId)).toContain('RSP-T');
    expect(data.responsibilities.map((entry) => entry.responsibilityId)).not.toContain('RSP-Q');
  });

  it('answers the same range for a one-item page, so a summary never depends on page size', async () => {
    await seed();
    const member = await signIn(MEMBER);
    const small = await overview(member, { pageSize: '1' });
    const wide = await overview(member, { pageSize: '100' });
    expect(small.json().data.items).toHaveLength(1);
    expect(small.json().data.items[0].childRange).toEqual(wide.json().data.items[0].childRange);
  });

  it('shows a manager the restricted project and keeps archived work out of the default view', async () => {
    await seed();
    const manager = await signIn(MANAGER);
    const response = await overview(manager);
    const ids = (response.json().data.items as { projectId: string }[]).map((item) => item.projectId);
    expect(ids).toContain('PRJ-V');
    expect(ids).toContain('PRJ-P');
    expect(ids).not.toContain('PRJ-A');
    const withArchived = await overview(manager, { includeArchived: 'true' });
    expect((withArchived.json().data.items as { projectId: string }[]).map((item) => item.projectId)).toContain('PRJ-A');
    // A member may not ask for archived work at all.
    const member = await signIn(MEMBER);
    expect((await overview(member, { includeArchived: 'true' })).statusCode).toBe(403);
  });

  it('filters by responsibility on the server and reports the filtered total', async () => {
    await seed();
    const member = await signIn(MEMBER);
    const filtered = await overview(member, { responsibilityId: 'RSP-T' });
    expect((filtered.json().data.items as { projectId: string }[]).map((item) => item.projectId)).toEqual(['PRJ-V']);
    const empty = await overview(member, { responsibilityId: 'RSP-Q' });
    expect(empty.json().data.items).toEqual([]);
    expect(empty.json().data.total).toBe(0);
  });
});

describe('one project branch', () => {
  it('carries the hierarchy, deadline-only and undated work, and inconsistent dates unchanged', async () => {
    await seed();
    const member = await signIn(MEMBER);
    const response = await branch(member, 'PRJ-V');
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data as {
      project: { projectId: string; undated: boolean };
      subprojects: { subprojectId: string; depth: number; plannedStart: string | null; deadline: string | null; childRange: { start: string | null; end: string | null }; scheduleStart: string | null; scheduleFinish: string | null }[];
      tasks: {
        taskId: string;
        plannedStart: string | null;
        dueDate: string | null;
        depth: number;
        container: boolean;
        completedAt: string | null;
        undated: boolean;
        inconsistent: boolean;
        childRange: { start: string | null; end: string | null };
        scheduleFinish: string | null;
      }[];
      truncated: boolean;
      taskTotal: number;
    };
    expect(data.project.projectId).toBe('PRJ-V');
    expect(data.subprojects.map((entry) => entry.subprojectId).sort()).toEqual(['SUB-V1', 'SUB-V2']);
    const nested = data.subprojects.find((entry) => entry.subprojectId === 'SUB-V2');
    expect(nested?.depth).toBe(2);
    // Folder schedules derive from eligible leaves, never obsolete stored folder dates.
    const prototype = data.subprojects.find((entry) => entry.subprojectId === 'SUB-V1');
    expect(prototype).toMatchObject({ plannedStart: '2026-03-05', deadline: '2026-04-25' });
    expect(prototype?.scheduleStart).toBe('2026-03-10');
    expect(prototype?.scheduleFinish).toBe('2026-03-20');

    const planned = data.tasks.find((task) => task.taskId === 'TSK-PLAN');
    expect(planned).toMatchObject({ plannedStart: '2026-03-10', dueDate: '2026-03-20', undated: false });
    // Deadline only: no invented start date.
    const deadlineOnly = data.tasks.find((task) => task.taskId === 'TSK-DUE');
    expect(deadlineOnly).toMatchObject({ plannedStart: null, dueDate: '2026-05-01', undated: false });
    const undated = data.tasks.find((task) => task.taskId === 'TSK-NONE');
    expect(undated).toMatchObject({ plannedStart: null, dueDate: null, undated: true });
    // A container ignores its own stored date and derives its display range from its leaf child.
    const container = data.tasks.find((task) => task.taskId === 'TSK-BOX');
    expect(container).toMatchObject({ container: true, plannedStart: null, dueDate: '2026-09-30' });
    expect(container?.childRange.start).toBe('2026-09-01');
    expect(container?.scheduleFinish).toBe('2026-09-10');
    // A recorded completion is reported separately from the deadline.
    const done = data.tasks.find((task) => task.taskId === 'TSK-DONE');
    expect(done?.completedAt).toContain('2026-02-11');
    expect(done?.dueDate).toBe('2026-02-10');
    // Inconsistent stored dates raise a flag and are not corrected.
    const odd = data.tasks.find((task) => task.taskId === 'TSK-ODD');
    expect(odd).toMatchObject({ inconsistent: true, plannedStart: '2026-08-20', dueDate: '2026-08-01' });
    // Cancelled work is a manager view.
    expect(data.tasks.some((task) => task.taskId === 'TSK-CANCEL')).toBe(false);
    expect(data.truncated).toBe(false);
    expect(data.taskTotal).toBe(data.tasks.length);
  });

  it('shows cancelled work to a manager and hides completed work only when asked', async () => {
    await seed();
    const manager = await signIn(MANAGER);
    const all = await branch(manager, 'PRJ-V');
    expect((all.json().data.tasks as { taskId: string }[]).some((task) => task.taskId === 'TSK-CANCEL')).toBe(true);
    const active = await branch(manager, 'PRJ-V', { includeCompleted: 'false' });
    expect((active.json().data.tasks as { taskId: string }[]).some((task) => task.taskId === 'TSK-DONE')).toBe(false);
  });

  it('resolves a selected subproject subtree on the server and rejects a project-direct sibling scope', async () => {
    await seed();
    const member = await signIn(MEMBER);
    const scoped = await branch(member, 'PRJ-V', { subprojectId: 'SUB-V1' });
    expect(scoped.statusCode, scoped.body).toBe(200);
    const data = scoped.json().data as {
      subprojects: { subprojectId: string }[];
      tasks: { taskId: string; subprojectId: string | null }[];
    };
    expect(data.subprojects.map((entry) => entry.subprojectId).sort()).toEqual(['SUB-V1', 'SUB-V2']);
    expect(data.tasks.map((entry) => entry.taskId)).toContain('TSK-PLAN');
    expect(data.tasks.map((entry) => entry.taskId)).not.toContain('TSK-DUE');
    expect((await branch(member, 'PRJ-V', { subprojectId: 'SUB-UNKNOWN' })).statusCode).toBe(404);
  });

  it('refuses a restricted project for a MEMBER and an unknown identifier for everyone', async () => {
    await seed();
    const member = await signIn(MEMBER);
    const viewer = await signIn(VIEWER);
    expect((await branch(member, 'PRJ-P')).statusCode).toBe(404);
    expect((await branch(viewer, 'PRJ-P')).statusCode).toBe(404);
    expect((await branch(viewer, 'PRJ-V')).statusCode).toBe(200);
    expect((await branch(member, 'PRJ-UNKNOWN')).statusCode).toBe(404);
    const manager = await signIn(MANAGER);
    expect((await branch(manager, 'PRJ-P')).statusCode).toBe(200);
  });

  it('never mutates a record while the timeline is read', async () => {
    await seed();
    const member = await signIn(MEMBER);
    const before = await db.one<{ revision: number; updated_at: string; status: string }>(
      "SELECT revision, updated_at, status FROM tasks WHERE task_id = 'TSK-PLAN'"
    );
    await overview(member);
    await branch(member, 'PRJ-V');
    await branch(member, 'PRJ-V', { includeCompleted: 'false' });
    const after = await db.one<{ revision: number; updated_at: string; status: string }>(
      "SELECT revision, updated_at, status FROM tasks WHERE task_id = 'TSK-PLAN'"
    );
    expect(after).toEqual(before);
  });

  it('refuses an unauthenticated read', async () => {
    await seed();
    const response = await app.inject({ method: 'GET', url: '/api/work/timeline' });
    expect(response.statusCode).toBe(401);
  });
});
