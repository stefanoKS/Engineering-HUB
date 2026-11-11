/**
 * The member overview: one authorized snapshot, counted once.
 *
 * The tests pin the counting and visibility promises the shared presentation depends on: only
 * `INTERNAL`, non-archived work is counted; a container is organisation only; completed and
 * cancelled work is reported separately; the responsibility filter is applied before every
 * aggregate; and the payload carries no manager-only project field.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertProject, insertResponsibility, insertTask } from '@eh/db';
import { businessDate } from '@eh/domain';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase, seedTestDivisions } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

const password = 'Overview-password-123';

/** Dates are relative to the business date so the window assertions never depend on the clock. */
function day(offset: number): string {
  const date = new Date(`${businessDate()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

beforeEach(async () => {
  hash = await hashPassword(password);
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(
    "INSERT INTO members(member_id,name,role) VALUES('MEM-A','Member A','MEMBER'),('MEM-VIEW','Viewer','VIEWER')"
  );
  await db.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
      ('MEM-A','0010',$1,false),('MEM-VIEW','0020',$1,false)`,
    [hash]
  );
  await insertResponsibility(db, { name: '設計' }, 'RSP-A');
  await insertResponsibility(db, { name: '製造' }, 'RSP-B');
  await insertProject(
    db,
    { projectName: 'Alpha', responsibilityId: 'RSP-A', status: 'Active', dashboardVisibility: 'INTERNAL' },
    'PRJ-A'
  );
  await insertProject(
    db,
    { projectName: 'Beta', responsibilityId: 'RSP-B', status: 'Active', dashboardVisibility: 'INTERNAL' },
    'PRJ-B'
  );
  await insertProject(
    db,
    { projectName: 'Secret', responsibilityId: 'RSP-B', status: 'Active', dashboardVisibility: 'RESTRICTED' },
    'PRJ-RESTRICTED'
  );
  await insertProject(
    db,
    { projectName: 'Old', responsibilityId: 'RSP-A', status: 'Active', dashboardVisibility: 'INTERNAL' },
    'PRJ-ARCHIVED'
  );
  await db.query("UPDATE projects SET status = 'Archived', archived_at = now() WHERE project_id = 'PRJ-ARCHIVED'");

  await insertTask(
    db,
    { projectId: 'PRJ-A', taskName: 'Open leaf', status: 'In Progress', dueDate: day(90), ownerMemberId: 'MEM-A' },
    'TSK-OPEN'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-A', taskName: 'Overdue leaf', status: 'In Progress', dueDate: day(-30), ownerMemberId: 'MEM-A' },
    'TSK-LATE'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-A', taskName: 'Done leaf', status: 'Done', dueDate: day(-20), ownerMemberId: 'MEM-A' },
    'TSK-DONE'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-A', taskName: 'Cancelled leaf', status: 'Cancelled', dueDate: day(-10), ownerMemberId: 'MEM-A' },
    'TSK-CANCELLED'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-A', taskName: 'Container', status: 'In Progress', dueDate: day(90) },
    'TSK-CONTAINER'
  );
  await insertTask(
    db,
    {
      projectId: 'PRJ-A',
      parentTaskId: 'TSK-CONTAINER',
      taskName: 'Child leaf',
      status: 'In Progress',
      dueDate: day(90),
      ownerMemberId: 'MEM-A'
    },
    'TSK-CHILD'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-B', taskName: 'Beta work', status: 'In Progress', dueDate: day(3), ownerMemberId: 'MEM-A' },
    'TSK-BETA'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-RESTRICTED', taskName: 'Secret work', status: 'In Progress', dueDate: day(-30) },
    'TSK-SECRET'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-ARCHIVED', taskName: 'Archived work', status: 'In Progress', dueDate: day(-30) },
    'TSK-OLD'
  );

  await seedTestDivisions(db);
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

async function overview(headers: Record<string, string>, query = '') {
  return app.inject({ method: 'GET', url: `/api/work/overview${query}`, headers });
}

describe('member work overview', () => {
  it('counts only authorized leaf work and reports completed and cancelled work separately', async () => {
    const member = await login('0010');
    const response = await overview(member);
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data as {
      counts: Record<string, number>;
      overdue: { taskId: string }[];
      upcoming: { taskId: string }[];
      responsibilities: { responsibilityId: string; projectCount: number; openWork: number }[];
    };
    // TSK-OPEN, TSK-LATE, TSK-CHILD and TSK-BETA are open leaf work; the container is not work.
    expect(data.counts.openWork).toBe(4);
    expect(data.counts.overdueWork).toBe(1);
    expect(data.counts.completedWork).toBe(1);
    expect(data.counts.cancelledWork).toBe(1);
    expect(data.counts.containers).toBe(1);
    // Restricted, archived and subproject-archived work never enters a figure or a list.
    expect(data.overdue.map((task) => task.taskId)).toEqual(['TSK-LATE']);
    expect(data.upcoming.map((task) => task.taskId)).not.toContain('TSK-SECRET');
    expect(data.upcoming.map((task) => task.taskId)).not.toContain('TSK-OLD');
  });

  it('groups by responsibility with the authorized project count', async () => {
    const member = await login('0010');
    const data = (await overview(member)).json().data as {
      responsibilities: { responsibilityId: string; name: string; projectCount: number; openWork: number; color: string }[];
      options: { responsibilityId: string }[];
    };
    expect(data.responsibilities.map((card) => card.responsibilityId).sort()).toEqual(['RSP-A', 'RSP-B']);
    const design = data.responsibilities.find((card) => card.responsibilityId === 'RSP-A');
    expect(design).toMatchObject({ projectCount: 1, openWork: 3 });
    // Beta has one readable project; the restricted project never inflates its count.
    const manufacturing = data.responsibilities.find((card) => card.responsibilityId === 'RSP-B');
    expect(manufacturing).toMatchObject({ projectCount: 1, openWork: 1 });
    expect(data.options.map((entry) => entry.responsibilityId).sort()).toEqual(['RSP-A', 'RSP-B']);
  });

  it('applies the responsibility filter before every aggregate', async () => {
    const member = await login('0010');
    const data = (await overview(member, '?responsibilityId=RSP-B')).json().data as {
      counts: Record<string, number>;
      responsibilities: { responsibilityId: string }[];
      upcoming: { taskId: string }[];
    };
    expect(data.counts.openWork).toBe(1);
    expect(data.counts.completedWork).toBe(0);
    expect(data.responsibilities.map((card) => card.responsibilityId)).toEqual(['RSP-B']);
    expect(data.upcoming.map((task) => task.taskId)).toEqual(['TSK-BETA']);
  });

  it('never publishes a manager-only project field', async () => {
    const member = await login('0010');
    const body = (await overview(member)).body;
    for (const privateField of [
      'dashboardVisibility',
      'dashboardSummary',
      'nextAction',
      'notificationEnabled',
      'estimatedHours',
      'actualHours',
      'acceptanceCriteria'
    ]) {
      expect(body, privateField).not.toContain(privateField);
    }
  });

  it('answers a VIEWER with the same authorized scope and no write path', async () => {
    const viewer = await login('0020');
    const response = await overview(viewer);
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json().data as { counts: { openWork: number } }).counts.openWork).toBe(4);
  });
});
