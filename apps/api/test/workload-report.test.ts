/**
 * Date-based workload report against a real PostgreSQL instance.
 *
 * These cover the rules a manager relies on: the server resolves every period, the figures never
 * invent hours, a shared task is counted once but attributed to each assignee, a removed assignee
 * contributes nothing, cancelled and archived work stays out, and only ADMIN/MANAGER may read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertMember, insertProject, insertTask } from '@eh/db';
import { addDays, businessDate, startOfWorkWeek } from '@eh/domain';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { freshDatabase, requireDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;

const ADMIN = 'admin@example.co.jp';
const MANAGER = 'manager@example.co.jp';
const MEMBER = 'member@example.co.jp';
const VIEWER = 'viewer@example.co.jp';

const today = businessDate();
const yesterday = addDays(today, -1);
const tomorrow = addDays(today, 1);
const weekStart = startOfWorkWeek(today);
const sunday = addDays(weekStart, 6);
const nextMonday = addDays(weekStart, 7);

async function signIn(email: string): Promise<{ cookie: string; csrf: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: email } });
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const body = response.json() as { data: { csrfToken: string } };
  return { cookie, csrf: body.data.csrfToken };
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await insertMember(db, { name: 'Admin', email: ADMIN, role: 'ADMIN' }, 'MEM-ADMIN');
  await insertMember(db, { name: 'Manager', email: MANAGER, role: 'MANAGER' }, 'MEM-MANAGER');
  await insertMember(db, { name: 'Aki Tanaka', email: MEMBER, role: 'MEMBER' }, 'MEM-A');
  await insertMember(db, { name: 'Ben Suzuki', email: 'ben@example.co.jp', role: 'MEMBER' }, 'MEM-B');
  await insertMember(db, { name: 'Cho Yamada', email: 'cho@example.co.jp', role: 'MEMBER' }, 'MEM-C');
  await insertMember(db, { name: 'Reader', email: VIEWER, role: 'VIEWER' }, 'MEM-VIEWER');
  await insertProject(db, { projectName: 'Alpha', status: 'Active' }, 'PRJ-A');
  await insertProject(db, { projectName: 'Beta', status: 'Active' }, 'PRJ-B');
  await db.query("INSERT INTO projects (project_id, project_name, status, archived_at) VALUES ('PRJ-OLD','Old','Archived', now())");
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'DEVELOPMENT',
    DATABASE_URL: requireDatabase(),
    MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAILS: [ADMIN, MANAGER, MEMBER, VIEWER, 'ben@example.co.jp', 'cho@example.co.jp'].join(','),
    PUBLIC_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    MAIL_FROM_ADDRESS: 'noreply@example.co.jp',
    SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: 'sheet-id'
  });
  app = await buildApp({ config, db, inbox: new NullInboxSource(), logger: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await pool.end();
});

type ReportBody = {
  summary: Record<string, number>;
  employees: {
    memberId: string;
    memberName: string;
    dueTasks: number;
    completedTasks: number;
    overdueTasks: number;
    undatedTasks: number;
  }[];
  buckets: { key: string; start: string; end: string; dueTasks: number; completedTasks: number; overdueTasks: number }[];
  assignmentBasis: string;
  today: string;
  start: string;
  end: string;
  granularity: string;
};

type DrillBody = {
  kind: string;
  from: string;
  to: string;
  items: { taskId: string; projectName: string; status?: string; displayStatus?: string }[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

async function report(query: string): Promise<ReportBody> {
  const auth = await signIn(MANAGER);
  const response = await app.inject({
    method: 'GET',
    url: `/api/manager/reports/workload?${query}`,
    headers: { cookie: auth.cookie }
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { data: ReportBody }).data;
}

async function drill(query: string): Promise<DrillBody> {
  const auth = await signIn(MANAGER);
  const response = await app.inject({
    method: 'GET',
    url: `/api/manager/reports/workload/tasks?${query}`,
    headers: { cookie: auth.cookie }
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { data: DrillBody }).data;
}

async function task(input: {
  id: string;
  name: string;
  dueDate?: string | null;
  status?: string;
  owner?: string | null;
  project?: string;
  parentTaskId?: string | null;
}): Promise<void> {
  const dueDate = input.dueDate ?? null;
  if (dueDate === null) {
    await db.query(
      `INSERT INTO tasks (task_id, project_id, task_name, status, owner_member_id, parent_task_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [input.id, input.project ?? 'PRJ-A', input.name, input.status ?? 'In Progress', input.owner ?? null, input.parentTaskId ?? null]
    );
    return;
  }
  await insertTask(
    db,
    {
      projectId: input.project ?? 'PRJ-A',
      taskName: input.name,
      ownerMemberId: input.owner ?? null,
      status: input.status ?? 'In Progress',
      dueDate,
      parentTaskId: input.parentTaskId ?? null
    },
    input.id
  );
}

describe('date-based figures', () => {
  it('counts due, completed, overdue, undated and backlog without inventing hours', async () => {
    await task({ id: 'TSK-DUE', name: 'Due today', dueDate: today, owner: 'MEM-A' });
    await task({ id: 'TSK-LATE', name: 'Late', dueDate: yesterday, owner: 'MEM-A' });
    await task({ id: 'TSK-DUE-DONE', name: 'Due today, done earlier', dueDate: today, status: 'Done', owner: 'MEM-A' });
    await db.query('UPDATE tasks SET completed_at = $1 WHERE task_id = $2', [`${yesterday}T02:00:00.000Z`, 'TSK-DUE-DONE']);
    await task({ id: 'TSK-DONE-TODAY', name: 'Completed today', dueDate: yesterday, status: 'Done', owner: 'MEM-B' });
    await db.query('UPDATE tasks SET completed_at = $1 WHERE task_id = $2', [`${today}T03:00:00.000Z`, 'TSK-DONE-TODAY']);
    await task({ id: 'TSK-UNDATED', name: 'No deadline', dueDate: null, status: 'Assigned', owner: 'MEM-B' });
    await task({ id: 'TSK-CANCELLED', name: 'Cancelled', dueDate: today, status: 'Cancelled', owner: 'MEM-A' });

    const day = await report(`mode=DAY&anchor=${today}`);
    expect(day.summary).toMatchObject({
      dueTasks: 2,
      completedTasks: 1,
      overdueTasks: 1,
      undatedTasks: 1,
      overdueWithinPeriod: 0,
      backlogBeforePeriod: 1,
      uniqueTasks: 5
    });
    expect(day.summary.assignments).toBe(5);
    // No hour, capacity or utilisation figure exists in the payload at all.
    const serialized = JSON.stringify(day);
    expect(serialized).not.toMatch(/remainingHours|capacityHours|utilization|actualHours|overloadWarning/);
    expect(day.assignmentBasis).toBe('CURRENT_ASSIGNMENTS');
    expect(day.today).toBe(today);
  });

  it('keeps a container task out of the counts and counts its child once', async () => {
    await task({ id: 'TSK-BOX', name: 'Phase container', dueDate: today, owner: 'MEM-A' });
    await task({ id: 'TSK-LEAF', name: 'Phase leaf', dueDate: today, owner: 'MEM-B', parentTaskId: 'TSK-BOX' });

    const day = await report(`mode=DAY&anchor=${today}`);
    expect(day.summary.dueTasks).toBe(1);
    const employees = day.employees as { memberId: string; dueTasks: number }[];
    expect(employees.find((row) => row.memberId === 'MEM-B')?.dueTasks).toBe(1);
    expect(employees.find((row) => row.memberId === 'MEM-A')?.dueTasks).toBe(0);
  });

  it('counts a shared task once but attributes it to every active assignee', async () => {
    await task({ id: 'TSK-SHARED', name: 'Shared work', dueDate: today, owner: 'MEM-A' });
    await db.query(
      `INSERT INTO task_assignees (assignment_id, task_id, member_id, removed_at)
       VALUES ('ASG-1','TSK-SHARED','MEM-B',NULL), ('ASG-2','TSK-SHARED','MEM-C', now())`
    );

    const day = await report(`mode=DAY&anchor=${today}`);
    expect(day.summary.dueTasks).toBe(1);
    expect(day.summary.uniqueTasks).toBe(1);
    expect(day.summary.assignments).toBe(2);

    const employees = day.employees as { memberId: string; dueTasks: number }[];
    expect(employees.find((row) => row.memberId === 'MEM-A')?.dueTasks).toBe(1);
    expect(employees.find((row) => row.memberId === 'MEM-B')?.dueTasks).toBe(1);
    // The removed assignee keeps no current workload.
    expect(employees.find((row) => row.memberId === 'MEM-C')?.dueTasks).toBe(0);
  });

  it('excludes archived projects and cancelled work from every figure', async () => {
    await db.query(
      `INSERT INTO tasks (task_id, project_id, task_name, status, owner_member_id, due_date)
       VALUES ('TSK-OLD','PRJ-OLD','Archived work','In Progress','MEM-A',$1)`,
      [today]
    );
    await task({ id: 'TSK-CAN', name: 'Cancelled', dueDate: today, status: 'Cancelled', owner: 'MEM-A' });
    const day = await report(`mode=DAY&anchor=${today}`);
    expect(day.summary).toMatchObject({ dueTasks: 0, uniqueTasks: 0, assignments: 0 });
  });

  it('uses Monday to Sunday week boundaries and includes a Sunday deadline', async () => {
    await task({ id: 'TSK-SUN', name: 'Sunday work', dueDate: sunday, owner: 'MEM-A' });
    await task({ id: 'TSK-NEXT', name: 'Next Monday work', dueDate: nextMonday, owner: 'MEM-A' });
    const week = await report(`mode=WEEK&anchor=${today}`);
    expect(week.start).toBe(weekStart);
    expect(week.end).toBe(sunday);
    expect(week.buckets).toHaveLength(7);
    expect(week.summary.dueTasks).toBe(1);

    const nextWeek = await report(`mode=WEEK&anchor=${nextMonday}`);
    expect(nextWeek.summary.dueTasks).toBe(1);
  });

  it('reports a completion that falls in the period even when the deadline did not', async () => {
    await task({ id: 'TSK-LATE-DONE', name: 'Closed later', dueDate: addDays(today, -40), status: 'Done', owner: 'MEM-A' });
    await db.query('UPDATE tasks SET completed_at = $1 WHERE task_id = $2', [`${today}T01:30:00.000Z`, 'TSK-LATE-DONE']);
    const month = await report(`mode=MONTH&anchor=${today}`);
    expect(month.summary.dueTasks).toBe(0);
    expect(month.summary.completedTasks).toBe(1);
    expect(month.summary.uniqueTasks).toBe(1);
  });

  it('keeps today off the overdue figures and yesterday on them', async () => {
    await task({ id: 'TSK-TODAY', name: 'Due today', dueDate: today, owner: 'MEM-A' });
    await task({ id: 'TSK-YESTERDAY', name: 'Due yesterday', dueDate: yesterday, owner: 'MEM-A' });
    const day = await report(`mode=DAY&anchor=${today}`);
    expect(day.summary.overdueTasks).toBe(1);
    expect(day.summary.backlogBeforePeriod).toBe(1);
    expect(day.summary.overdueWithinPeriod).toBe(0);

    const custom = await report(`mode=CUSTOM&start=${yesterday}&end=${today}`);
    expect(custom.summary.dueTasks).toBe(2);
    expect(custom.summary.overdueWithinPeriod).toBe(1);
  });

  it('breaks the period into the documented buckets', async () => {
    await task({ id: 'TSK-A', name: 'A', dueDate: today, owner: 'MEM-A' });
    const day = await report(`mode=DAY&anchor=${today}`);
    expect(day.granularity).toBe('DAY');
    expect(day.buckets).toEqual([
      { key: today, start: today, end: today, dueTasks: 1, completedTasks: 0, overdueTasks: 0 }
    ]);

    const year = await report(`mode=YEAR&anchor=${today}`);
    expect(year.granularity).toBe('MONTH');
    expect(year.buckets).toHaveLength(12);
  });

  it('sorts the member table by overdue by default and by name on request', async () => {
    await task({ id: 'TSK-OV', name: 'Late', dueDate: yesterday, owner: 'MEM-B' });
    await task({ id: 'TSK-DUE-A', name: 'Due', dueDate: today, owner: 'MEM-A' });
    const byOverdue = (await report(`mode=DAY&anchor=${today}`)).employees as { memberId: string; overdueTasks: number }[];
    expect(byOverdue[0]?.memberId).toBe('MEM-B');

    const byName = (await report(`mode=DAY&anchor=${today}&sort=name&direction=asc`)).employees as { memberName: string }[];
    const names = byName.map((row) => row.memberName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('filters the report by member, project and responsibility', async () => {
    await db.query("INSERT INTO responsibilities (responsibility_id, name) VALUES ('RES-1','Design')");
    await db.query("UPDATE projects SET responsibility_id = 'RES-1' WHERE project_id = 'PRJ-A'");
    await task({ id: 'TSK-ALPHA', name: 'Alpha work', dueDate: today, owner: 'MEM-A' });
    await task({ id: 'TSK-BETA', name: 'Beta work', dueDate: today, owner: 'MEM-B', project: 'PRJ-B' });

    expect((await report(`mode=DAY&anchor=${today}&projectId=PRJ-B`)).summary.dueTasks).toBe(1);
    expect((await report(`mode=DAY&anchor=${today}&responsibilityId=RES-1`)).summary.dueTasks).toBe(1);
    expect((await report(`mode=DAY&anchor=${today}&memberId=MEM-B`)).summary.dueTasks).toBe(1);
    const filtered = (await report(`mode=DAY&anchor=${today}&memberId=MEM-B`)).employees as { memberId: string }[];
    expect(filtered).toHaveLength(1);
  });
});

describe('drilldown', () => {
  it('returns the tasks behind one figure with the period they were counted in', async () => {
    await task({ id: 'TSK-1', name: 'First', dueDate: today, owner: 'MEM-A' });
    await task({ id: 'TSK-2', name: 'Second', dueDate: today, owner: 'MEM-B' });
    await task({ id: 'TSK-3', name: 'Third', dueDate: yesterday, owner: 'MEM-B' });

    const first = await drill(`mode=DAY&anchor=${today}&kind=DUE&page=1&pageSize=2`);
    expect(first).toMatchObject({ kind: 'DUE', from: today, to: today, total: 2, page: 1, totalPages: 1 });
    expect(first.items.map((item: { taskId: string }) => item.taskId).sort()).toEqual(['TSK-1', 'TSK-2']);
    expect(first.items[0]).toMatchObject({ projectName: 'Alpha' });

    const paginated = await drill(`mode=DAY&anchor=${today}&kind=DUE&page=2&pageSize=1`);
    expect(paginated).toMatchObject({ total: 2, page: 2, totalPages: 2 });
    expect(paginated.items).toHaveLength(1);

    const overdue = await drill(`mode=DAY&anchor=${today}&kind=BACKLOG`);
    expect(overdue.items.map((item: { taskId: string }) => item.taskId)).toEqual(['TSK-3']);
  });

  it('respects a timeline bucket window', async () => {
    await task({ id: 'TSK-W1', name: 'First half', dueDate: weekStart, owner: 'MEM-A' });
    await task({ id: 'TSK-W2', name: 'Second half', dueDate: sunday, owner: 'MEM-A' });
    const bucket = await drill(`mode=WEEK&anchor=${today}&kind=DUE&from=${sunday}&to=${sunday}`);
    expect(bucket.items.map((item: { taskId: string }) => item.taskId)).toEqual(['TSK-W2']);
  });

  it('carries the display state so a done row is never presented as overdue', async () => {
    await task({ id: 'TSK-DONE', name: 'Finished', dueDate: yesterday, owner: 'MEM-A', status: 'Done' });
    await task({ id: 'TSK-OPEN', name: 'Late', dueDate: yesterday, owner: 'MEM-A' });

    const window = await drill(`mode=WEEK&anchor=${today}&kind=DUE&from=${yesterday}&to=${yesterday}`);
    const byId = new Map(window.items.map((item) => [item.taskId, item]));
    // The stored status and the derived display state travel together, so the report can never
    // paint a completed row with an overdue badge from the date alone.
    expect(byId.get('TSK-DONE')).toMatchObject({ status: 'Done', displayStatus: 'DONE' });
    expect(byId.get('TSK-OPEN')).toMatchObject({ status: 'In Progress', displayStatus: 'OVERDUE' });

    // Only eligible open work is in the overdue backlog; the done row keeps its own state.
    const backlog = await drill(`mode=DAY&anchor=${today}&kind=BACKLOG`);
    expect(backlog.items.map((item: { taskId: string }) => item.taskId)).toEqual(['TSK-OPEN']);
  });

  it('reports the real total for a page past the end instead of a false empty result', async () => {
    await task({ id: 'TSK-ONLY', name: 'Only', dueDate: today, owner: 'MEM-A' });
    const empty = await drill(`mode=DAY&anchor=${today}&kind=DUE&page=5&pageSize=10`);
    expect(empty.total).toBe(1);
    expect(empty.items).toEqual([]);
  });
});

describe('validation and authorization', () => {
  it('refuses an inverted or excessive custom range and an unknown mode', async () => {
    const auth = await signIn(MANAGER);
    for (const query of [
      `mode=CUSTOM&start=${today}&end=${yesterday}`,
      'mode=CUSTOM&start=2024-01-01&end=2026-01-02',
      `mode=QUARTER&anchor=${today}`,
      'mode=CUSTOM&start=2026-02-30&end=2026-03-01'
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/manager/reports/workload?${query}`,
        headers: { cookie: auth.cookie }
      });
      expect(response.statusCode).toBe(400);
      expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('denies MEMBER, VIEWER and an unauthenticated caller', async () => {
    const unauthenticated = await app.inject({ method: 'GET', url: '/api/manager/reports/workload' });
    expect(unauthenticated.statusCode).toBe(401);

    for (const email of [MEMBER, VIEWER]) {
      const auth = await signIn(email);
      for (const url of ['/api/manager/reports/workload', '/api/manager/reports/workload/tasks?kind=DUE']) {
        const response = await app.inject({ method: 'GET', url, headers: { cookie: auth.cookie } });
        expect(response.statusCode).toBe(403);
        expect((response.json() as { error: { code: string } }).error.code).toBe('AUTHORIZATION_DENIED');
      }
    }
  });

  it('lets ADMIN and MANAGER read the report', async () => {
    for (const email of [ADMIN, MANAGER]) {
      const auth = await signIn(email);
      const response = await app.inject({
        method: 'GET',
        url: `/api/manager/reports/workload?mode=DAY&anchor=${today}`,
        headers: { cookie: auth.cookie }
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('refreshes the same date-based report for the requested period', async () => {
    const auth = await signIn(MANAGER);
    await task({ id: 'TSK-R', name: 'Refreshed', dueDate: today, owner: 'MEM-A' });
    const response = await app.inject({
      method: 'POST',
      url: `/api/manager/reports/refresh?mode=DAY&anchor=${today}`,
      headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf, origin: 'http://localhost:5173' }
    });
    expect(response.statusCode).toBe(200);
    const data = (response.json() as { data: { workload: ReportBody } }).data;
    expect(data.workload.summary.dueTasks).toBe(1);
    expect(data.workload.start).toBe(today);
  });

  it('does not report tomorrow as due today', async () => {
    await task({ id: 'TSK-TOMORROW', name: 'Tomorrow', dueDate: tomorrow, owner: 'MEM-A' });
    const day = await report(`mode=DAY&anchor=${today}`);
    expect(day.summary.dueTasks).toBe(0);
    expect(day.summary.backlogBeforePeriod).toBe(0);
  });
});
