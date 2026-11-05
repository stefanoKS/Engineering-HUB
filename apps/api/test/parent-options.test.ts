/**
 * Bounded parent-task selection.
 *
 * The picker is a server read: search and paging apply to the eligible candidates, a same-named
 * branch stays distinguishable by its full path, and the selected value survives a search or a
 * page change. Save-time hierarchy validation stays authoritative.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertMember, insertProject, insertTask } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { freshDatabase, requireDatabase } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;

const ADMIN = 'admin@example.co.jp';
const MEMBER = 'member@example.co.jp';

type Auth = { cookie: string; csrf: string };

async function signIn(email: string): Promise<Auth> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: email } });
  expect(response.statusCode, response.body).toBe(200);
  return {
    cookie: String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '',
    csrf: (response.json() as { data: { csrfToken: string } }).data.csrfToken
  };
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await insertMember(db, { name: 'Admin', email: ADMIN, role: 'ADMIN' }, 'MEM-ADMIN');
  await insertMember(db, { name: 'Member', email: MEMBER, role: 'MEMBER' }, 'MEM-MEMBER');
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'DEVELOPMENT',
    DATABASE_URL: requireDatabase(),
    MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAILS: [ADMIN, MEMBER].join(','),
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

async function seed(): Promise<void> {
  await insertProject(db, { projectName: 'Picker project', status: 'Active' }, 'PRJ-PK');
  // Two same-named branches, one direct project task and a deep chain.
  await insertTask(db, { projectId: 'PRJ-PK', taskName: 'Repeated', dueDate: '2026-05-01' }, 'TSK-ROOT');
  await insertTask(
    db,
    { projectId: 'PRJ-PK', parentTaskId: 'TSK-ROOT', taskName: 'Repeated', dueDate: '2026-05-02' },
    'TSK-LEAF'
  );
  await insertTask(
    db,
    { projectId: 'PRJ-PK', parentTaskId: 'TSK-LEAF', taskName: 'Deep', dueDate: '2026-05-03' },
    'TSK-DEEP'
  );
  await insertTask(db, { projectId: 'PRJ-PK', taskName: 'Direct work', dueDate: '2026-05-04' }, 'TSK-DIRECT');
  for (let index = 0; index < 40; index += 1) {
    const padded = String(index).padStart(2, '0');
    await insertTask(
      db,
      { projectId: 'PRJ-PK', taskName: `Bulk ${padded}`, dueDate: '2026-06-01' },
      `TSK-BULK-${padded}`
    );
  }
}

function options(auth: Auth, query: Record<string, string>) {
  const search = new URLSearchParams(query).toString();
  return app.inject({
    method: 'GET',
    url: '/api/manager/tasks/parent-options?' + search,
    headers: { cookie: auth.cookie }
  });
}

describe('parent task options', () => {
  it('pages the eligible candidates and reports the matching total', async () => {
    await seed();
    const admin = await signIn(ADMIN);
    const first = await options(admin, { projectId: 'PRJ-PK', subprojectId: '', page: '1', pageSize: '25' });
    expect(first.statusCode, first.body).toBe(200);
    const body = first.json().data as { items: { id: string }[]; total: number; totalPages: number; page: number };
    // The deepest task cannot hold another level, so it is not a candidate.
    expect(body.total).toBe(43);
    expect(body.items).toHaveLength(25);
    expect(body.totalPages).toBe(2);
    const second = await options(admin, { projectId: 'PRJ-PK', subprojectId: '', page: '2', pageSize: '25' });
    const secondBody = second.json().data as { items: { id: string }[]; page: number };
    expect(secondBody.page).toBe(2);
    expect(secondBody.items).toHaveLength(18);
    // No candidate appears on both pages, and nothing is lost between them.
    const all = [...body.items, ...secondBody.items].map((item) => item.id);
    expect(new Set(all).size).toBe(43);
  });

  it('searches beyond the first page and keeps full paths unambiguous', async () => {
    await seed();
    const admin = await signIn(ADMIN);
    const bulk = await options(admin, { projectId: 'PRJ-PK', subprojectId: '', query: 'Bulk 39' });
    const items = (bulk.json().data as { items: { id: string; path: string }[] }).items;
    expect(items.map((item) => item.id)).toEqual(['TSK-BULK-39']);
    expect(items[0]?.path).toBe('Bulk 39');

    const repeated = await options(admin, { projectId: 'PRJ-PK', subprojectId: '', query: 'Repeated' });
    const paths = (repeated.json().data as { items: { path: string }[] }).items.map((item) => item.path);
    expect(paths).toEqual(['Repeated', 'Repeated / Repeated']);
  });

  it('excludes the edited task and its descendants', async () => {
    await seed();
    const admin = await signIn(ADMIN);
    const response = await options(admin, { projectId: 'PRJ-PK', subprojectId: '', excludeTaskId: 'TSK-ROOT' });
    const ids = (response.json().data as { items: { id: string }[] }).items.map((item) => item.id);
    expect(ids).not.toContain('TSK-ROOT');
    expect(ids).not.toContain('TSK-LEAF');
    expect(ids).not.toContain('TSK-DEEP');
    expect(ids).toContain('TSK-DIRECT');
  });

  it('keeps a selected parent readable when it is not on the current page', async () => {
    await seed();
    const admin = await signIn(ADMIN);
    const response = await options(admin, {
      projectId: 'PRJ-PK',
      subprojectId: '',
      query: 'Direct',
      page: '1',
      selectedId: 'TSK-BULK-07'
    });
    const data = response.json().data as { items: { id: string }[]; selected: { id: string; path: string } | null };
    expect(data.items.map((item) => item.id)).toEqual(['TSK-DIRECT']);
    expect(data.selected).toEqual({ id: 'TSK-BULK-07', name: 'Bulk 07', path: 'Bulk 07', depth: 1, parentTaskId: null, container: false, status: expect.any(String) });
  });

  it('never offers a task that cannot hold another level and refuses a member', async () => {
    await seed();
    const admin = await signIn(ADMIN);
    const response = await options(admin, { projectId: 'PRJ-PK', subprojectId: '', query: 'Deep' });
    // TSK-DEEP is at the deepest permitted level, so it is not a candidate.
    expect((response.json().data as { items: unknown[] }).items).toHaveLength(0);
    const member = await signIn(MEMBER);
    expect((await options(member, { projectId: 'PRJ-PK' })).statusCode).toBe(403);
  });

  it('validates the request', async () => {
    await seed();
    const admin = await signIn(ADMIN);
    expect((await options(admin, { subprojectId: '' })).statusCode).toBe(400);
    expect((await options(admin, { projectId: 'PRJ-PK', page: '0' })).statusCode).toBe(400);
  });
});
