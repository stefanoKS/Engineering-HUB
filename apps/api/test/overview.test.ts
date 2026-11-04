import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertMember, insertProject, insertResponsibility } from '@eh/db';
import { businessDate } from '@eh/domain';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { freshDatabase, requireDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;

const MANAGER = 'overview-manager@example.co.jp';
const ADMIN = 'overview-admin@example.co.jp';
const MEMBER = 'overview-member@example.co.jp';
const VIEWER = 'overview-viewer@example.co.jp';

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function signIn(email: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: email } });
  expect(response.statusCode).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0]!;
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await insertMember(db, { name: 'Manager', email: MANAGER, role: 'MANAGER' }, 'MEM-OV-MANAGER');
  await insertMember(db, { name: 'Admin', email: ADMIN, role: 'ADMIN' }, 'MEM-OV-ADMIN');
  await insertMember(db, { name: 'Member', email: MEMBER, role: 'MEMBER' }, 'MEM-OV-MEMBER');
  await insertMember(db, { name: 'Viewer', email: VIEWER, role: 'VIEWER' }, 'MEM-OV-VIEWER');
  await insertResponsibility(db, { name: 'Design' }, 'RSP-OV');
  await insertProject(
    db,
    {
      projectName: 'Scoped project',
      responsibilityId: 'RSP-OV',
      status: 'Active',
      dashboardVisibility: 'INTERNAL'
    },
    'PRJ-OV'
  );
  await insertProject(
    db,
    { projectName: 'Unassigned project', status: 'Active', dashboardVisibility: 'INTERNAL' },
    'PRJ-UNASSIGNED'
  );
  app = await buildApp({
    db,
    inbox: new NullInboxSource(),
    logger: false,
    config: loadConfig({
      NODE_ENV: 'test',
      APP_ENV: 'DEVELOPMENT',
      DATABASE_URL: requireDatabase(),
      DEV_AUTH_ENABLED: 'true',
      DEV_AUTH_EMAILS: `${ADMIN},${MANAGER},${MEMBER},${VIEWER}`,
      MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
      PUBLIC_ORIGIN: 'http://localhost:5173'
    })
  });
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

describe('manager overview deadline windows', () => {
  it('uses exact calendar-day boundaries, keeps overdue separate and matches All Work totals', async () => {
    const today = businessDate();
    const rows = [
      ['TSK-OLD', 'Oldest overdue', addDays(today, -8), 'In Progress', null],
      ['TSK-YESTERDAY', 'Yesterday overdue', addDays(today, -1), 'Assigned', null],
      ['TSK-TODAY', 'Due today', today, 'In Progress', null],
      ['TSK-WEEKEND', 'Weekend deadline', addDays(today, 3), 'Not Started', null],
      ['TSK-END', 'End boundary', addDays(today, 6), 'Blocked', null],
      ['TSK-AFTER', 'After boundary', addDays(today, 7), 'On Hold', null],
      ['TSK-DONE', 'Done history', addDays(today, -2), 'Done', null],
      ['TSK-PARENT', 'Container', today, 'In Progress', null],
      ['TSK-CHILD', 'Leaf child', today, 'In Progress', 'TSK-PARENT']
    ] as const;
    for (const [id, name, dueDate, status, parentTaskId] of rows) {
      await db.query(
        `INSERT INTO tasks(task_id,project_id,task_name,status,due_date,parent_task_id)
         VALUES($1,'PRJ-OV',$2,$3,$4,$5)`,
        [id, name, status, dueDate, parentTaskId]
      );
    }
    await db.query(
      `INSERT INTO tasks(task_id,project_id,task_name,status,due_date)
       VALUES('TSK-UNASSIGNED','PRJ-UNASSIGNED','Other scope','In Progress',$1)`,
      [today]
    );

    const cookie = await signIn(MANAGER);
    const response = await app.inject({
      url: '/api/manager/overview?responsibilityId=RSP-OV&upcomingDays=7',
      headers: { cookie }
    });
    expect(response.statusCode, response.body).toBe(200);
    const data = response.json().data as {
      upcomingWindow: { days: number; from: string; to: string };
      upcoming: { taskId: string }[];
      overdue: { taskId: string }[];
      overdueTotal: number;
      counts: { openWork: number; overdueWork: number; completedWork: number };
    };
    expect(data.upcomingWindow).toEqual({ days: 7, from: today, to: addDays(today, 6) });
    expect(data.upcoming.map((task) => task.taskId)).toEqual([
      'TSK-CHILD',
      'TSK-TODAY',
      'TSK-WEEKEND',
      'TSK-END'
    ]);
    expect(data.upcoming.map((task) => task.taskId)).not.toContain('TSK-AFTER');
    expect(data.overdue.map((task) => task.taskId)).toEqual(['TSK-OLD', 'TSK-YESTERDAY']);
    expect(data.overdueTotal).toBe(2);

    const open = await app.inject({
      url: '/api/manager/tasks?tree=true&workState=OPEN&responsibilityId=RSP-OV&pageSize=100',
      headers: { cookie }
    });
    const overdue = await app.inject({
      url: '/api/manager/tasks?tree=true&displayStatus=OVERDUE&responsibilityId=RSP-OV&pageSize=100',
      headers: { cookie }
    });
    const done = await app.inject({
      url: '/api/manager/tasks?tree=true&displayStatus=DONE&responsibilityId=RSP-OV&pageSize=100',
      headers: { cookie }
    });
    expect(open.json().data.matchedTotal).toBe(data.counts.openWork);
    expect(overdue.json().data.matchedTotal).toBe(data.counts.overdueWork);
    expect(done.json().data.matchedTotal).toBe(data.counts.completedWork);
    expect(open.body).toContain('Yesterday overdue');
  });

  it.each([
    [7, 6],
    [14, 13],
    [30, 29]
  ])('returns an inclusive %i-day window', async (days, offset) => {
    const cookie = await signIn(MANAGER);
    const response = await app.inject({
      url: `/api/manager/overview?upcomingDays=${days}`,
      headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    const window = response.json().data.upcomingWindow;
    expect(window.days).toBe(days);
    expect(window.to).toBe(addDays(window.from, offset));
  });

  it('defaults to seven days and rejects unsupported windows', async () => {
    const cookie = await signIn(MANAGER);
    const defaultResponse = await app.inject({ url: '/api/manager/overview', headers: { cookie } });
    expect(defaultResponse.json().data.upcomingWindow.days).toBe(7);
    const invalid = await app.inject({ url: '/api/manager/overview?upcomingDays=365', headers: { cookie } });
    expect(invalid.statusCode).toBe(400);
  });

  it.each([ADMIN, MANAGER])('allows the manager overview for %s', async (email) => {
    const cookie = await signIn(email);
    const response = await app.inject({ url: '/api/manager/overview?upcomingDays=7', headers: { cookie } });
    expect(response.statusCode).toBe(200);
  });

  it.each([MEMBER, VIEWER])('keeps the manager overview unavailable to %s', async (email) => {
    const cookie = await signIn(email);
    const response = await app.inject({ url: '/api/manager/overview?upcomingDays=7', headers: { cookie } });
    expect(response.statusCode).toBe(403);
  });
});
