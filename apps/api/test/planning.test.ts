/**
 * Planning Board API tests against a real PostgreSQL instance.
 *
 * These cover what a mock cannot: author privacy, division authorization, revision and review
 * binding, one-transaction export (including rollback), idempotent replay and the absence of any
 * notification, calendar, completion or approval side effect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database, insertMember, insertResponsibility } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { freshDatabase, requireDatabase, seedTestDivisions } from '../../../packages/db/test/support/db';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;

const ADMIN = 'admin@example.co.jp';
const MANAGER = 'manager@example.co.jp';
const MANAGER2 = 'manager2@example.co.jp';
const MEMBER = 'member@example.co.jp';

async function signIn(email: string): Promise<{ cookie: string; csrf: string }> {
  const response = await app.inject({ method: 'POST', url: '/api/session', payload: { devEmail: email } });
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const body = response.json() as { data: { csrfToken: string } };
  return { cookie, csrf: body.data.csrfToken };
}

function headers(auth: { cookie: string; csrf: string }, mutate = false): Record<string, string> {
  const result: Record<string, string> = { cookie: auth.cookie };
  if (mutate) {
    result['x-csrf-token'] = auth.csrf;
    result.origin = 'http://localhost:5173';
  }
  return result;
}

function planItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    itemId: 'PI-1',
    type: 'SUBPROJECT',
    parentItemId: null,
    order: 0,
    name: 'Phase 1',
    startDate: '2026-11-02',
    finishDate: '2026-11-13',
    durationValue: null,
    durationUnit: null,
    durationBasis: null,
    ownerMemberId: null,
    assigneeIds: [],
    ...overrides
  };
}

function planBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Release plan',
    divisionId: 'DIV-DEV',
    responsibilityId: 'RSP-1',
    destinationMode: 'NEW_PROJECT',
    destinationProjectId: null,
    projectOwnerId: null,
    dashboardVisibility: 'RESTRICTED',
    scheduleMode: 'MANUAL',
    items: [
      planItem({ itemId: 'PI-1', type: 'SUBPROJECT', name: 'Design', startDate: '2026-11-02', finishDate: '2026-11-06', order: 0 }),
      planItem({ itemId: 'PI-2', type: 'TASK', parentItemId: 'PI-1', name: 'Draft', startDate: '2026-11-02', finishDate: '2026-11-06', order: 0 }),
      planItem({ itemId: 'PI-3', type: 'TASK', parentItemId: 'PI-1', name: 'Review', finishDate: '2026-11-10', order: 1 })
    ],
    idempotencyKey: 'plan-key-0001',
    ...overrides
  };
}

async function createPlan(auth: { cookie: string; csrf: string }, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/manager/plans',
    headers: headers(auth, true),
    payload: planBody(overrides)
  });
  return response;
}

async function reviewOf(
  planId: string,
  revision: number,
  auth: { cookie: string; csrf: string }
): Promise<{ reviewToken: string; errors: unknown[] }> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/manager/plans/${planId}/review?revision=${revision}`,
    headers: headers(auth)
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { data: { review: { reviewToken: string; errors: unknown[] } } }).data.review;
}

function exportBody(revision: number, reviewToken: string, key: string) {
  return { revision, idempotencyKey: key, reviewToken, confirmed: true };
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await insertMember(db, { name: 'Admin', email: ADMIN, role: 'ADMIN' }, 'MEM-ADMIN');
  await insertMember(db, { name: 'Manager', email: MANAGER, role: 'MANAGER' }, 'MEM-MANAGER');
  await insertMember(db, { name: 'Manager 2', email: MANAGER2, role: 'MANAGER' }, 'MEM-MANAGER2');
  await insertMember(db, { name: 'Member', email: MEMBER, role: 'MEMBER' }, 'MEM-MEMBER');
  await seedTestDivisions(db);
  await insertResponsibility(db, { name: 'Release', divisionId: 'DIV-DEV' }, 'RSP-1');
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'DEVELOPMENT',
    DATABASE_URL: requireDatabase(),
    MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp',
    DEV_AUTH_ENABLED: 'true',
    DEV_AUTH_EMAILS: [ADMIN, MANAGER, MANAGER2, MEMBER].join(','),
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

describe('plan draft authorization', () => {
  it('refuses a member and a manager without a membership in the division', async () => {
    const member = await signIn(MEMBER);
    const refused = await createPlan(member);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('AUTHORIZATION_DENIED');

    await db.query("DELETE FROM member_divisions WHERE member_id = 'MEM-MANAGER' AND division_id = 'DIV-DEV'");
    const manager = await signIn(MANAGER);
    const denied = await createPlan(manager);
    expect(denied.statusCode).toBe(403);
  });

  it('keeps a draft private to its author, including from another manager', async () => {
    const manager = await signIn(MANAGER);
    const created = await createPlan(manager);
    expect(created.statusCode).toBe(200);
    const planId = (created.json() as { data: { plan: { planId: string } } }).data.plan.planId;

    const other = await signIn(MANAGER2);
    const read = await app.inject({ method: 'GET', url: `/api/manager/plans/${planId}`, headers: headers(other) });
    expect(read.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/manager/plans', headers: headers(other) });
    expect((list.json() as { data: { total: number } }).data.total).toBe(0);
  });
});

describe('plan save', () => {
  it('creates, lists and saves with a revision check', async () => {
    const manager = await signIn(MANAGER);
    const created = await createPlan(manager);
    expect(created.statusCode).toBe(200);
    const plan = (created.json() as { data: { plan: Record<string, unknown> } }).data.plan;
    expect(plan.revision).toBe(1);
    const planId = plan.planId as string;

    const list = await app.inject({ method: 'GET', url: '/api/manager/plans', headers: headers(manager) });
    expect((list.json() as { data: { total: number } }).data.total).toBe(1);

    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/manager/plans/${planId}`,
      headers: headers(manager, true),
      payload: { ...planBody({ idempotencyKey: undefined }), revision: 1, title: 'Release plan v2' }
    });
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as { data: { plan: { revision: number; title: string } } }).data.plan).toMatchObject({
      revision: 2,
      title: 'Release plan v2'
    });

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/manager/plans/${planId}`,
      headers: headers(manager, true),
      payload: { ...planBody({ idempotencyKey: undefined }), revision: 1, title: 'Stale' }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('EDIT_CONFLICT');
  });

  it('refuses an ineligible assignee as one failed operation', async () => {
    await db.query(
      `INSERT INTO divisions (division_id, name, sort_order) VALUES ('DIV-ENG2', 'Other', 9) ON CONFLICT DO NOTHING`
    );
    await db.query(
      `INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind, assigned_by)
       VALUES ('MD-MGR2-DIV-ENG2', 'MEM-MANAGER', 'DIV-ENG2', 'WORK', 'test')`
    );
    await insertResponsibility(db, { name: 'Other area', divisionId: 'DIV-ENG2' }, 'RSP-2');
    const manager = await signIn(MANAGER);
    const response = await createPlan(manager, {
      divisionId: 'DIV-ENG2',
      responsibilityId: 'RSP-2',
      items: [planItem({ itemId: 'PI-1', type: 'TASK', parentItemId: null, ownerMemberId: 'MEM-MEMBER' })]
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
  });
});

describe('plan review and export', () => {
  it('creates the hierarchy and the assignment in one transaction and keeps order', async () => {
    const manager = await signIn(MANAGER);
    const created = await createPlan(manager, {
      items: [
        planItem({ itemId: 'PI-1', type: 'SUBPROJECT', name: 'Design', order: 1, startDate: '2026-11-02', finishDate: '2026-11-06' }),
        planItem({ itemId: 'PI-2', type: 'SUBPROJECT', parentItemId: 'PI-1', name: 'Mockups', order: 0, startDate: '2026-11-02', finishDate: '2026-11-04' }),
        planItem({ itemId: 'PI-3', type: 'TASK', parentItemId: 'PI-1', name: 'Draft', order: 1, finishDate: '2026-11-06', ownerMemberId: 'MEM-MEMBER', assigneeIds: ['MEM-MANAGER'] }),
        planItem({ itemId: 'PI-4', type: 'TASK', parentItemId: 'PI-3', name: 'Sub task', order: 0, finishDate: '2026-11-05' }),
        planItem({ itemId: 'PI-5', type: 'TASK', parentItemId: null, name: 'Kickoff', order: 0, finishDate: '2026-11-02' })
      ]
    });
    expect(created.statusCode).toBe(200);
    const plan = (created.json() as { data: { plan: { planId: string; revision: number } } }).data.plan;

    const review = await reviewOf(plan.planId, plan.revision, manager);
    expect(review.errors).toEqual([]);

    const exported = await app.inject({
      method: 'POST',
      url: `/api/manager/plans/${plan.planId}/export`,
      headers: headers(manager, true),
      payload: exportBody(plan.revision, review.reviewToken, 'export-key-0001')
    });
    expect(exported.statusCode).toBe(200);
    const result = (
      exported.json() as {
        data: {
          receipt: { counts: { subprojects: number; tasks: number }; destination: { projectId: string } };
          replayed: boolean;
        };
      }
    ).data;
    expect(result.replayed).toBe(false);
    expect(result.receipt.counts).toEqual({ subprojects: 2, tasks: 3 });

    const project = await db.one<{ project_id: string; status: string; dashboard_visibility: string }>(
      'SELECT project_id, status, dashboard_visibility FROM projects WHERE project_id = $1',
      [result.receipt.destination.projectId]
    );
    expect(project?.status).toBe('Active');
    expect(project?.dashboard_visibility).toBe('RESTRICTED');

    const subprojects = await db.many<{ subproject_id: string; parent_subproject_id: string | null; subproject_name: string; sort_order: number; status: string }>(
      'SELECT subproject_id, parent_subproject_id, subproject_name, sort_order, status FROM subprojects WHERE project_id = $1 ORDER BY subproject_name',
      [result.receipt.destination.projectId]
    );
    expect(subprojects).toHaveLength(2);
    const mockups = subprojects.find((entry) => entry.subproject_name === 'Mockups');
    expect(mockups?.parent_subproject_id).toBe(subprojects.find((entry) => entry.subproject_name === 'Design')?.subproject_id);
    expect(mockups?.sort_order).toBe(0);

    const tasks = await db.many<{ task_id: string; task_name: string; parent_task_id: string | null; subproject_id: string | null; due_date: string; owner_member_id: string | null; status: string; notification_enabled: boolean; sort_order: number; assignment_approved_at: string | null }>(
      `SELECT task_id, task_name, parent_task_id, subproject_id, due_date, owner_member_id, status,
              notification_enabled, sort_order, assignment_approved_at
         FROM tasks WHERE project_id = $1 ORDER BY task_name`,
      [result.receipt.destination.projectId]
    );
    expect(tasks.map((task) => task.task_name)).toEqual(['Draft', 'Kickoff', 'Sub task']);
    const draft = tasks.find((task) => task.task_name === 'Draft');
    expect(draft?.due_date).toBe('2026-11-06');
    expect(draft?.owner_member_id).toBe('MEM-MEMBER');
    expect(draft?.status).toBe('Assigned');
    expect(draft?.notification_enabled).toBe(false);
    expect(draft?.assignment_approved_at).toBeNull();
    const subTask = tasks.find((task) => task.task_name === 'Sub task');
    expect(subTask?.parent_task_id).toBe(draft?.task_id);
    const kickoff = tasks.find((task) => task.task_name === 'Kickoff');
    expect(kickoff?.subproject_id).toBeNull();

    const assignees = await db.many<{ member_id: string }>(
      'SELECT member_id FROM task_assignees WHERE task_id = $1 AND removed_at IS NULL',
      [draft?.task_id]
    );
    expect(assignees.map((row) => row.member_id)).toEqual(['MEM-MANAGER']);

    const outbox = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM outbox_jobs');
    expect(outbox?.count).toBe('0');
    const audit = await db.one<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_log WHERE action = 'PLAN_EXPORTED'"
    );
    expect(audit?.count).toBe('1');

    const planRow = await db.one<{ status: string; revision: number }>(
      'SELECT status, revision FROM plan_drafts WHERE plan_id = $1',
      [plan.planId]
    );
    expect(planRow).toEqual({ status: 'EXPORTED', revision: plan.revision + 1 });
  });

  it('replays an identical submission and rejects a conflicting or second export', async () => {
    const manager = await signIn(MANAGER);
    const created = await createPlan(manager);
    const plan = (created.json() as { data: { plan: { planId: string; revision: number } } }).data.plan;
    const review = await reviewOf(plan.planId, plan.revision, manager);

    const first = await app.inject({
      method: 'POST',
      url: `/api/manager/plans/${plan.planId}/export`,
      headers: headers(manager, true),
      payload: exportBody(plan.revision, review.reviewToken, 'export-key-0001')
    });
    expect(first.statusCode).toBe(200);
    const firstReceipt = (first.json() as { data: { receipt: { exportId: string } } }).data.receipt;

    const replay = await app.inject({
      method: 'POST',
      url: `/api/manager/plans/${plan.planId}/export`,
      headers: headers(manager, true),
      payload: exportBody(plan.revision, review.reviewToken, 'export-key-0001')
    });
    expect(replay.statusCode).toBe(200);
    const replayData = (replay.json() as { data: { receipt: { exportId: string }; replayed: boolean } }).data;
    expect(replayData.replayed).toBe(true);
    expect(replayData.receipt.exportId).toBe(firstReceipt.exportId);

    // The same key reused for a different reviewed request is refused instead of being replayed.
    const mismatch = await app.inject({
      method: 'POST',
      url: `/api/manager/plans/${plan.planId}/export`,
      headers: headers(manager, true),
      payload: exportBody(plan.revision, 'different-review-token-1234567890', 'export-key-0001')
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('IDEMPOTENCY_REPLAY');

    const second = await app.inject({
      method: 'POST',
      url: `/api/manager/plans/${plan.planId}/export`,
      headers: headers(manager, true),
      payload: exportBody(plan.revision, review.reviewToken, 'export-key-0002')
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('EDIT_CONFLICT');

    const receipt = await app.inject({
      method: 'GET',
      url: `/api/manager/plans/${plan.planId}/exports`,
      headers: headers(manager)
    });
    expect(receipt.statusCode).toBe(200);
    expect((receipt.json() as { data: { receipt: { exportId: string } } }).data.receipt.exportId).toBe(
      firstReceipt.exportId
    );
  });

  it('binds the export to the reviewed content', async () => {
    const manager = await signIn(MANAGER);
    const created = await createPlan(manager);
    const plan = (created.json() as { data: { plan: { planId: string; revision: number } } }).data.plan;
    const review = await reviewOf(plan.planId, plan.revision, manager);

    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/manager/plans/${plan.planId}`,
      headers: headers(manager, true),
      payload: {
        ...planBody({ idempotencyKey: undefined, title: 'Changed title' }),
        revision: plan.revision
      }
    });
    expect(saved.statusCode).toBe(200);
    const nextRevision = (saved.json() as { data: { plan: { revision: number } } }).data.plan.revision;

    const stale = await app.inject({
      method: 'POST',
      url: `/api/manager/plans/${plan.planId}/export`,
      headers: headers(manager, true),
      payload: exportBody(nextRevision, review.reviewToken, 'export-key-0003')
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('STALE_REQUEST');
  });

  it('refuses an owner that became inactive after the review', async () => {
    const manager = await signIn(MANAGER);
    const created = await createPlan(manager, {
      items: [planItem({ itemId: 'PI-1', type: 'TASK', parentItemId: null, ownerMemberId: 'MEM-MEMBER' })]
    });
    const plan = (created.json() as { data: { plan: { planId: string; revision: number } } }).data.plan;
    const review = await reviewOf(plan.planId, plan.revision, manager);
    await db.query("UPDATE members SET active = false WHERE member_id = 'MEM-MEMBER'");

    const refused = await app.inject({
      method: 'POST',
      url: `/api/manager/plans/${plan.planId}/export`,
      headers: headers(manager, true),
      payload: exportBody(plan.revision, review.reviewToken, 'export-key-0004')
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('VALIDATION_FAILED');
    const projects = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM projects');
    expect(projects?.count).toBe('0');
  });

  it('refuses the export when the authority was revoked after the review', async () => {
    const manager = await signIn(MANAGER);
    const created = await createPlan(manager);
    const plan = (created.json() as { data: { plan: { planId: string; revision: number } } }).data.plan;
    const review = await reviewOf(plan.planId, plan.revision, manager);
    await db.query("UPDATE members SET role = 'MEMBER' WHERE member_id = 'MEM-MANAGER'");

    const refused = await app.inject({
      method: 'POST',
      url: `/api/manager/plans/${plan.planId}/export`,
      headers: headers(manager, true),
      payload: exportBody(plan.revision, review.reviewToken, 'export-key-0005')
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('AUTHORIZATION_DENIED');
    const projects = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM projects');
    expect(projects?.count).toBe('0');
  });

  it('leaves no record behind when the export fails midway', async () => {
    const manager = await signIn(MANAGER);
    const created = await createPlan(manager, {
      title: 'Atomic plan',
      items: [
        planItem({ itemId: 'PI-1', type: 'SUBPROJECT', name: 'Phase', finishDate: '2026-11-06' }),
        planItem({ itemId: 'PI-2', type: 'TASK', parentItemId: 'PI-1', name: 'One', finishDate: '2026-11-04' }),
        planItem({ itemId: 'PI-3', type: 'TASK', parentItemId: 'PI-1', name: 'Two', finishDate: '2026-11-06' })
      ]
    });
    const plan = (created.json() as { data: { plan: { planId: string; revision: number } } }).data.plan;
    const review = await reviewOf(plan.planId, plan.revision, manager);

    await db.query(`
      CREATE OR REPLACE FUNCTION eh_test_fail_second_task() RETURNS trigger AS $$
      DECLARE existing integer;
      BEGIN
        SELECT count(*) INTO existing FROM tasks WHERE project_id = NEW.project_id;
        IF existing >= 1 THEN RAISE EXCEPTION 'forced second-task failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
    `);
    await db.query(
      'CREATE TRIGGER eh_test_fail_second_task BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION eh_test_fail_second_task()'
    );
    try {
      const failed = await app.inject({
        method: 'POST',
        url: `/api/manager/plans/${plan.planId}/export`,
        headers: headers(manager, true),
        payload: exportBody(plan.revision, review.reviewToken, 'export-key-0006')
      });
      expect(failed.statusCode).toBe(500);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS eh_test_fail_second_task ON tasks');
      await db.query('DROP FUNCTION IF EXISTS eh_test_fail_second_task()');
    }

    const projects = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM projects');
    const subprojects = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM subprojects');
    const tasks = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM tasks');
    const exports = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM plan_exports');
    expect([projects?.count, subprojects?.count, tasks?.count, exports?.count]).toEqual(['0', '0', '0', '0']);
    const planRow = await db.one<{ status: string }>('SELECT status FROM plan_drafts WHERE plan_id = $1', [
      plan.planId
    ]);
    expect(planRow?.status).toBe('DRAFT');
  });

  it('prevents two concurrent exports of the same plan', async () => {
    const manager = await signIn(MANAGER);
    const created = await createPlan(manager);
    const plan = (created.json() as { data: { plan: { planId: string; revision: number } } }).data.plan;
    const review = await reviewOf(plan.planId, plan.revision, manager);

    const [left, right] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/manager/plans/${plan.planId}/export`,
        headers: headers(manager, true),
        payload: exportBody(plan.revision, review.reviewToken, 'export-key-0007')
      }),
      app.inject({
        method: 'POST',
        url: `/api/manager/plans/${plan.planId}/export`,
        headers: headers(manager, true),
        payload: exportBody(plan.revision, review.reviewToken, 'export-key-0008')
      })
    ]);
    const codes = [left.statusCode, right.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const projects = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM projects');
    expect(projects?.count).toBe('1');
  });

  it('appends to an existing project without changing its other work', async () => {
    const manager = await signIn(MANAGER);
    const project = await app.inject({
      method: 'POST',
      url: '/api/manager/projects',
      headers: headers(manager, true),
      payload: {
        idempotencyKey: 'project-key-0001',
        projectName: 'Existing project',
        divisionId: 'DIV-DEV',
        responsibilityId: 'RSP-1'
      }
    });
    expect(project.statusCode).toBe(200);
    const projectId = (project.json() as { data: { project: { projectId: string } } }).data.project.projectId;

    const created = await createPlan(manager, {
      title: 'Append plan',
      destinationMode: 'EXISTING_PROJECT',
      destinationProjectId: projectId,
      responsibilityId: null,
      items: [planItem({ itemId: 'PI-1', type: 'TASK', parentItemId: null, name: 'Extra', finishDate: '2026-11-06' })]
    });
    const plan = (created.json() as { data: { plan: { planId: string; revision: number } } }).data.plan;
    const review = await reviewOf(plan.planId, plan.revision, manager);
    expect(review.errors).toEqual([]);
    const exported = await app.inject({
      method: 'POST',
      url: `/api/manager/plans/${plan.planId}/export`,
      headers: headers(manager, true),
      payload: exportBody(plan.revision, review.reviewToken, 'export-key-0009')
    });
    expect(exported.statusCode).toBe(200);
    const receipt = (exported.json() as { data: { receipt: { created: { projectId: string | null } } } }).data.receipt;
    expect(receipt.created.projectId).toBeNull();

    const projects = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM projects');
    expect(projects?.count).toBe('1');
    const tasks = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM tasks WHERE project_id = $1', [
      projectId
    ]);
    expect(tasks?.count).toBe('1');
  });
});
