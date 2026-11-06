/**
 * The canonical task schedule state, end to end.
 *
 * The display state is derived on the server from the plan dates and the Asia/Tokyo business date,
 * so these tests check the API boundary: the DTO carries the state and the missing boundary, the
 * filter resolves the same rule before paging, and open-work counting keeps planned and undated
 * work while never counting done or cancelled work as overdue.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertMember, insertProject } from '@eh/db';
import { addDays, businessDate } from '@eh/domain';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { freshDatabase, requireDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;

const MANAGER = 'manager@example.co.jp';
const MEMBER = 'member@example.co.jp';

const today = businessDate();
const yesterday = addDays(today, -1);
const tomorrow = addDays(today, 1);
const nextWeek = addDays(today, 7);

async function signIn(email: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: email } });
  expect(response.statusCode).toBe(200);
  return String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '';
}

async function insertRaw(input: {
  id: string;
  name: string;
  status?: string;
  plannedStart?: string | null;
  dueDate?: string | null;
}): Promise<void> {
  await db.query(
    `INSERT INTO tasks (task_id, project_id, task_name, status, owner_member_id, planned_start, due_date)
     VALUES ($1,'PRJ-A',$2,$3,'MEM-A',$4,$5)`,
    [input.id, input.name, input.status ?? 'In Progress', input.plannedStart ?? null, input.dueDate ?? null]
  );
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await insertMember(db, { name: 'Manager', email: MANAGER, role: 'MANAGER' }, 'MEM-MANAGER');
  await insertMember(db, { name: 'Aki Tanaka', email: MEMBER, role: 'MEMBER' }, 'MEM-A');
  await insertProject(db, { projectName: 'Alpha', status: 'Active' }, 'PRJ-A');
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'DEVELOPMENT',
    DATABASE_URL: requireDatabase(),
    MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAILS: [MANAGER, MEMBER].join(','),
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

type TaskListBody = {
  items: {
    taskId: string;
    status: string;
    displayStatus: string;
    scheduleMissing?: string;
    dueDate: string | null;
    plannedStart: string | null;
  }[];
  total: number;
  page: number;
  pageSize: number;
};

async function managerTasks(query: string): Promise<TaskListBody> {
  const cookie = await signIn(MANAGER);
  const response = await app.inject({ url: `/api/manager/tasks?${query}`, headers: { cookie } });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { data: TaskListBody }).data;
}

type DrillItem = {
  taskId: string;
  status: string;
  displayStatus: string;
  scheduleMissing?: string;
  dueDate: string | null;
  completedDate: string | null;
};

async function drill(query: string): Promise<{ items: DrillItem[]; total: number }> {
  const cookie = await signIn(MANAGER);
  const response = await app.inject({
    url: `/api/manager/reports/workload/tasks?${query}`,
    headers: { cookie }
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { data: { items: DrillItem[]; total: number } }).data;
}

describe('task list display state', () => {
  beforeEach(async () => {
    await insertRaw({ id: 'TSK-PLANNED', name: 'Starts tomorrow', plannedStart: tomorrow, dueDate: nextWeek });
    await insertRaw({ id: 'TSK-PROGRESS', name: 'Started yesterday', plannedStart: yesterday, dueDate: nextWeek });
    await insertRaw({ id: 'TSK-STARTNOT', name: 'Finish only', dueDate: nextWeek });
    await insertRaw({ id: 'TSK-UNDATED', name: 'No dates', status: 'Assigned' });
    await insertRaw({ id: 'TSK-LATE', name: 'Late without start', dueDate: yesterday });
    await insertRaw({ id: 'TSK-DONE', name: 'Done, past finish', status: 'Done', plannedStart: yesterday, dueDate: yesterday });
    await insertRaw({ id: 'TSK-CANCELLED', name: 'Cancelled, past finish', status: 'Cancelled', dueDate: yesterday });
    await insertRaw({ id: 'TSK-REVERSED', name: 'Start after finish', plannedStart: nextWeek, dueDate: tomorrow });
    await insertRaw({ id: 'TSK-REVERSED-LATE', name: 'Start after a passed finish', plannedStart: nextWeek, dueDate: yesterday });
  });

  it('derives every state from the plan dates and the stored terminal status', async () => {
    const page = await managerTasks('pageSize=50&includeInactive=true');
    const byId = new Map(page.items.map((task) => [task.taskId, task]));
    expect(byId.get('TSK-PLANNED')).toMatchObject({ displayStatus: 'PLANNED', scheduleMissing: 'NONE' });
    expect(byId.get('TSK-PROGRESS')).toMatchObject({ displayStatus: 'IN_PROGRESS', scheduleMissing: 'NONE' });
    expect(byId.get('TSK-STARTNOT')).toMatchObject({ displayStatus: 'START_NOT_SET', scheduleMissing: 'START' });
    expect(byId.get('TSK-UNDATED')).toMatchObject({ displayStatus: 'DATES_NOT_SET', scheduleMissing: 'BOTH' });
    // A missing start does not prevent a task from becoming late after its finish.
    expect(byId.get('TSK-LATE')).toMatchObject({ displayStatus: 'OVERDUE', scheduleMissing: 'START' });
    // A reversed interval is a warning, not a silently repaired schedule.
    expect(byId.get('TSK-REVERSED')).toMatchObject({ displayStatus: 'INVALID_DATES' });
    // The stored workflow value is never rewritten by the derived state.
    expect(byId.get('TSK-UNDATED')?.status).toBe('Assigned');
    expect(byId.get('TSK-PLANNED')?.status).toBe('In Progress');

    // A terminal stored status wins over its own past finish, and completion needs no timestamp.
    const done = await managerTasks('displayStatus=DONE&pageSize=25');
    expect(done.items.find((task) => task.taskId === 'TSK-DONE')).toMatchObject({
      status: 'Done',
      displayStatus: 'DONE'
    });
    const cancelled = await managerTasks('displayStatus=CANCELLED&pageSize=25');
    expect(cancelled.items.find((task) => task.taskId === 'TSK-CANCELLED')).toMatchObject({
      status: 'Cancelled',
      displayStatus: 'CANCELLED'
    });
  });

  it('filters on the displayed state before paging and reports the scope total', async () => {
    const planned = await managerTasks('displayStatus=PLANNED&page=1&pageSize=1');
    expect(planned.total).toBe(1);
    expect(planned.items.map((task) => task.taskId)).toEqual(['TSK-PLANNED']);

    const undated = await managerTasks('displayStatus=DATES_NOT_SET&pageSize=25');
    expect(undated.total).toBe(1);
    expect(undated.items.map((task) => task.taskId)).toEqual(['TSK-UNDATED']);

    const startNotSet = await managerTasks('displayStatus=START_NOT_SET&pageSize=25');
    expect(startNotSet.total).toBe(1);
    expect(startNotSet.items.map((task) => task.taskId)).toEqual(['TSK-STARTNOT']);

    const inProgress = await managerTasks('displayStatus=IN_PROGRESS&pageSize=25');
    expect(inProgress.total).toBe(1);
    expect(inProgress.items.map((task) => task.taskId)).toEqual(['TSK-PROGRESS']);

    const overdue = await managerTasks('displayStatus=OVERDUE&pageSize=25');
    expect(overdue.total).toBe(2);
    expect(overdue.items.map((task) => task.taskId).sort()).toEqual(['TSK-LATE', 'TSK-REVERSED-LATE']);

    const invalid = await managerTasks('displayStatus=INVALID_DATES&pageSize=25');
    expect(invalid.total).toBe(2);
    expect(invalid.items.map((task) => task.taskId).sort()).toEqual(['TSK-REVERSED', 'TSK-REVERSED-LATE']);
    // The warning is displayed, and the canonical overdue accounting still sees the same row
    // instead of hiding it behind the warning.
    expect(invalid.items.find((task) => task.taskId === 'TSK-REVERSED-LATE')).toMatchObject({
      displayStatus: 'INVALID_DATES',
      dueDate: yesterday
    });
  });

  it('keeps the open-work scope inclusive of planned and undated work', async () => {
    const open = await managerTasks('workState=OPEN&pageSize=50');
    const ids = open.items.map((task) => task.taskId).sort();
    expect(ids).toEqual([
      'TSK-LATE',
      'TSK-PLANNED',
      'TSK-PROGRESS',
      'TSK-REVERSED',
      'TSK-REVERSED-LATE',
      'TSK-STARTNOT',
      'TSK-UNDATED'
    ]);
    // The scope total is the server's answer, not the size of the page that happened to fit.
    const paged = await managerTasks('workState=OPEN&pageSize=2');
    expect(paged.items).toHaveLength(2);
    expect(paged.total).toBe(7);
  });
});

describe('workload drilldown display state', () => {
  it('carries the canonical state and the missing boundary', async () => {
    await insertRaw({ id: 'TSK-W-PLANNED', name: 'Planned', plannedStart: tomorrow, dueDate: nextWeek });
    await insertRaw({ id: 'TSK-W-PROGRESS', name: 'Progress', plannedStart: yesterday, dueDate: nextWeek });
    await insertRaw({ id: 'TSK-W-STARTNOT', name: 'Start not set', dueDate: nextWeek });
    await insertRaw({ id: 'TSK-W-DONE', name: 'Done', status: 'Done', plannedStart: yesterday, dueDate: yesterday });
    await db.query('UPDATE tasks SET completed_at = $1 WHERE task_id = $2', [`${today}T02:00:00.000Z`, 'TSK-W-DONE']);

    const window = await drill(
      `mode=CUSTOM&start=${yesterday}&end=${nextWeek}&kind=DUE&page=1&pageSize=50`
    );
    const byId = new Map(window.items.map((item) => [item.taskId, item]));
    expect(byId.get('TSK-W-PLANNED')).toMatchObject({ displayStatus: 'PLANNED', scheduleMissing: 'NONE' });
    expect(byId.get('TSK-W-PROGRESS')).toMatchObject({ displayStatus: 'IN_PROGRESS', scheduleMissing: 'NONE' });
    expect(byId.get('TSK-W-STARTNOT')).toMatchObject({ displayStatus: 'START_NOT_SET', scheduleMissing: 'START' });
    expect(byId.get('TSK-W-DONE')).toMatchObject({ status: 'Done', displayStatus: 'DONE', scheduleMissing: 'NONE' });
    // No private field travels with the report row.
    expect(JSON.stringify(window.items)).not.toMatch(
      /ownerMemberId|estimatedHours|actualHours|acceptanceCriteria|notification/i
    );
  });

  it('lists open work without a finish as undated instead of inventing a deadline', async () => {
    await insertRaw({ id: 'TSK-W-UNDATED', name: 'No dates', status: 'Assigned' });
    const undated = await drill(`mode=WEEK&anchor=${today}&kind=UNDATED&page=1&pageSize=50`);
    expect(undated.items.map((item) => item.taskId)).toContain('TSK-W-UNDATED');
    const item = undated.items.find((entry) => entry.taskId === 'TSK-W-UNDATED');
    expect(item).toMatchObject({ displayStatus: 'DATES_NOT_SET', scheduleMissing: 'BOTH', dueDate: null });
  });
});

describe('overview counting', () => {
  it('counts planned and undated open work but never done or cancelled work as overdue', async () => {
    await insertRaw({ id: 'TSK-O-PLANNED', name: 'Planned', plannedStart: tomorrow, dueDate: nextWeek });
    await insertRaw({ id: 'TSK-O-UNDATED', name: 'Undated', status: 'Not Started' });
    await insertRaw({ id: 'TSK-O-LATE', name: 'Late', plannedStart: yesterday, dueDate: yesterday });
    await insertRaw({ id: 'TSK-O-REVERSED', name: 'Reversed', plannedStart: nextWeek, dueDate: yesterday });
    await insertRaw({ id: 'TSK-O-DONE', name: 'Done', status: 'Done', plannedStart: yesterday, dueDate: yesterday });
    await insertRaw({ id: 'TSK-O-CANCELLED', name: 'Cancelled', status: 'Cancelled', dueDate: yesterday });

    const cookie = await signIn(MANAGER);
    const response = await app.inject({ url: '/api/manager/overview?upcomingDays=7', headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200);
    const data = (response.json() as {
      data: { counts: { openWork: number; overdueWork: number; completedWork: number; cancelledWork: number } };
    }).data;

    // Planned and undated work is open work; "open" is not a synonym for "in progress".
    expect(data.counts.openWork).toBe(4);
    // A reversed interval is displayed as a warning but stays in the deadline accounting.
    expect(data.counts.overdueWork).toBe(2);
    expect(data.counts.completedWork).toBe(1);
    expect(data.counts.cancelledWork).toBe(1);
  });
});
