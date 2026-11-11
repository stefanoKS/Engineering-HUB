/**
 * ADMIN division mapping of unmapped legacy work: preview, reviewed apply, backup gate, atomicity
 * and concurrency, against real PostgreSQL.
 *
 * The fixture reproduces the operational shape: memberships exist, but responsibilities and
 * projects have a NULL division. Unmapped work stays ADMIN-only, so every call here is authenticated
 * as an administrator unless the test is proving the refusal.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase } from '../../../packages/db/test/support/db';
import { mappingConfirmationText, proposeMapping, type MappingEvidence } from '../src/services/division-mapping';

const password = 'Division-mapping-password-123';
const LOCK_KEY = 'member-divisions';

const DEV = 'DIV-DEV';
const ENG = 'DIV-ENG';
const PROD = 'DIV-PROD';
const OLD = 'DIV-OLD';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

beforeAll(async () => {
  hash = await hashPassword(password);
});

async function replaceGrants(
  memberId: string,
  grants: { divisionId: string; accessKind: 'WORK' | 'READ' }[]
): Promise<void> {
  await db.query('DELETE FROM member_divisions WHERE member_id = $1', [memberId]);
  for (const grant of grants) {
    await db.query(
      `INSERT INTO member_divisions (relationship_id, member_id, division_id, access_kind, assigned_by)
       VALUES ($1,$2,$3,$4,'fixture')`,
      [`MD-${memberId}-${grant.divisionId}`, memberId, grant.divisionId, grant.accessKind]
    );
  }
}

async function verifiedBackup(id = 'BAK-TEST-1'): Promise<void> {
  await db.query(
    `INSERT INTO backup_log (backup_id, schema_version, backup_reference, result, checksum, size_bytes, manifest)
     VALUES ($1, 12, '/tmp/' || $1, 'OK', 'deadbeef', 1024, '{"localSaved":true}'::jsonb)
     ON CONFLICT (backup_id) DO UPDATE SET result = 'OK', checksum = 'deadbeef', created_at = now()`,
    [id]
  );
}

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(
    `INSERT INTO divisions (division_id, name, status, sort_order, retired_at) VALUES
       ('DIV-OLD','旧課','Retired',9, now())`
  );
  await db.query(`
    INSERT INTO members(member_id,name,role,active) VALUES
      ('MEM-ADMIN','Admin','ADMIN',true),
      ('MEM-MGR','Manager all divisions','MANAGER',true),
      ('MEM-MGR-DEV','Manager dev only','MANAGER',true),
      ('MEM-A','Dev member','MEMBER',true),
      ('MEM-B','Engineering member','MEMBER',true),
      ('MEM-READ','Read only in engineering','MEMBER',true),
      ('MEM-PAST','Former owner','MEMBER',false),
      ('MEM-GM','Overseer','GENERAL_MANAGER',true)
  `);
  await db.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
       ('MEM-ADMIN','1101',$1,false),('MEM-MGR','1102',$1,false),('MEM-MGR-DEV','1103',$1,false),
       ('MEM-GM','1104',$1,false)`,
    [hash]
  );
  await replaceGrants('MEM-ADMIN', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-MGR', [
    { divisionId: DEV, accessKind: 'WORK' },
    { divisionId: ENG, accessKind: 'WORK' },
    { divisionId: PROD, accessKind: 'WORK' }
  ]);
  await replaceGrants('MEM-MGR-DEV', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-A', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-B', [{ divisionId: ENG, accessKind: 'WORK' }]);
  await replaceGrants('MEM-READ', [
    { divisionId: DEV, accessKind: 'WORK' },
    { divisionId: ENG, accessKind: 'READ' }
  ]);
  await replaceGrants('MEM-PAST', [{ divisionId: DEV, accessKind: 'WORK' }]);
  await replaceGrants('MEM-GM', []);
  await db.query("UPDATE members SET all_divisions_read = true WHERE member_id = 'MEM-GM'");

  // ---- unmapped legacy work (division_id stays NULL) -------------------------------
  // One clear DEV project: its only active owner is a DEV member.
  await db.query("INSERT INTO responsibilities(responsibility_id,name,division_id) VALUES ('RSP-U1','未分類A',NULL)");
  await db.query(
    `INSERT INTO projects(project_id,project_name,responsibility_id,division_id,status,dashboard_visibility)
     VALUES ('PRJ-U1','Dev legacy project','RSP-U1',NULL,'Active','INTERNAL')`
  );
  await db.query(
    `INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status)
     VALUES ('TSK-U1','PRJ-U1','Dev legacy task','MEM-A','Not Started')`
  );

  // No common division: two active owners in different divisions.
  await db.query("INSERT INTO responsibilities(responsibility_id,name,division_id) VALUES ('RSP-U2','未分類B',NULL)");
  await db.query(
    `INSERT INTO projects(project_id,project_name,responsibility_id,division_id,status,dashboard_visibility)
     VALUES ('PRJ-U2','Split legacy project','RSP-U2',NULL,'Active','INTERNAL')`
  );
  await db.query(
    `INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status)
     VALUES ('TSK-U2','PRJ-U2','Dev side','MEM-A','Not Started')`
  );
  await db.query(
    `INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status)
     VALUES ('TSK-U3','PRJ-U2','Eng side','MEM-B','Not Started')`
  );

  // No evidence at all.
  await db.query("INSERT INTO responsibilities(responsibility_id,name,division_id) VALUES ('RSP-U3','未分類C',NULL)");

  // Ambiguous: the only active owner holds all three divisions.
  await db.query(
    `INSERT INTO projects(project_id,project_name,division_id,status,dashboard_visibility)
     VALUES ('PRJ-U4','Ambiguous legacy project',NULL,'Active','INTERNAL')`
  );
  await db.query(
    `INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status)
     VALUES ('TSK-U4','PRJ-U4','Everywhere owner','MEM-MGR','Not Started')`
  );

  // Historical: an inactive former owner is retained next to an active DEV owner.
  await db.query(
    `INSERT INTO projects(project_id,project_name,division_id,status,dashboard_visibility)
     VALUES ('PRJ-U5','Historical legacy project',NULL,'Active','INTERNAL')`
  );
  await db.query(
    `INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status)
     VALUES ('TSK-U5','PRJ-U5','Former owner kept','MEM-PAST','Not Started')`
  );
  await db.query(
    `INSERT INTO tasks(task_id,project_id,task_name,owner_member_id,status)
     VALUES ('TSK-U6','PRJ-U5','Current owner','MEM-A','Not Started')`
  );

  // Archived record that still needs mapping.
  await db.query(
    `INSERT INTO projects(project_id,project_name,division_id,status,archived_at,dashboard_visibility)
     VALUES ('PRJ-ARCH','Archived legacy project',NULL,'Archived', now(), 'INTERNAL')`
  );

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

async function preview(headers: Record<string, string>, body: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/admin/divisions/mapping/preview',
    headers,
    payload: { pageSize: 50, ...body }
  });
}

function record(items: { entityType: string; entityId: string }[], entityId: string) {
  const found = items.find((item) => item.entityId === entityId);
  if (!found) throw new Error(`record ${entityId} missing from the preview`);
  return found as unknown as {
    entityType: string;
    entityId: string;
    state: string;
    rule: string;
    proposedDivisionId: string | null;
    candidates: { divisionId: string }[];
    blockers: string[];
    unresolved: string[];
    revision: number;
    assignments: { memberId: string; active: boolean; historical: boolean; eligible: boolean }[];
    linkedProjects: { projectId: string }[];
  };
}

async function projectRevision(projectId: string): Promise<number> {
  const row = await db.one<{ revision: number }>('SELECT revision FROM projects WHERE project_id = $1', [projectId]);
  return Number(row?.revision ?? 0);
}

async function projectDivision(projectId: string): Promise<string | null> {
  const row = await db.one<{ division_id: string | null }>(
    'SELECT division_id FROM projects WHERE project_id = $1',
    [projectId]
  );
  return row?.division_id ?? null;
}

async function responsibilityDivision(id: string): Promise<string | null> {
  const row = await db.one<{ division_id: string | null }>(
    'SELECT division_id FROM responsibilities WHERE responsibility_id = $1',
    [id]
  );
  return row?.division_id ?? null;
}

async function auditCount(action: string): Promise<number> {
  const row = await db.one<{ total: string }>('SELECT count(*)::text AS total FROM audit_log WHERE action = $1', [
    action
  ]);
  return Number(row?.total ?? 0);
}

async function waitForLockWaiter(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await db.one<{ waiting: string }>(
      "SELECT count(*)::text AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"
    );
    if (Number(row?.waiting ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error('the request never queued on the division membership lock');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('proposal rules (pure)', () => {
  const divisions = new Map([
    [DEV, '設計・開発課'],
    [ENG, '設計・技術課'],
    [PROD, '生産・技術課']
  ]);
  const member = (memberId: string, workDivisionIds: string[], active = true): MappingEvidence => ({
    memberId,
    name: memberId,
    active,
    historical: !active,
    workDivisionIds,
    relations: ['TASK_OWNER']
  });

  it('follows a mapped responsibility (rule B) and refuses a contradiction', () => {
    const suggestion = proposeMapping({
      explicitDivisionId: null,
      responsibilityDivisionId: DEV,
      activeDivisions: divisions,
      evidence: [member('M1', [DEV])]
    });
    expect(suggestion).toMatchObject({ state: 'SUGGESTED', rule: 'RESPONSIBILITY', proposedDivisionId: DEV });

    const contradiction = proposeMapping({
      explicitDivisionId: null,
      responsibilityDivisionId: DEV,
      activeDivisions: divisions,
      evidence: [member('M2', [ENG])]
    });
    expect(contradiction.state).toBe('CONFLICT');
    expect(contradiction.blockers).toContain('INELIGIBLE_ACTIVE_ASSIGNEE:M2');
  });

  it('suggests one common division, keeps several ambiguous and reports none as a conflict', () => {
    expect(
      proposeMapping({
        explicitDivisionId: null,
        responsibilityDivisionId: null,
        activeDivisions: divisions,
        evidence: [member('M1', [DEV]), member('M2', [DEV, ENG])]
      })
    ).toMatchObject({ state: 'SUGGESTED', rule: 'COMMON_MEMBERSHIP', proposedDivisionId: DEV });

    const ambiguous = proposeMapping({
      explicitDivisionId: null,
      responsibilityDivisionId: null,
      activeDivisions: divisions,
      evidence: [member('M1', [DEV, ENG])]
    });
    expect(ambiguous.state).toBe('AMBIGUOUS');
    expect(ambiguous.candidates.map((candidate) => candidate.divisionId)).toEqual([DEV, ENG]);

    const conflict = proposeMapping({
      explicitDivisionId: null,
      responsibilityDivisionId: null,
      activeDivisions: divisions,
      evidence: [member('M1', [DEV]), member('M2', [ENG])]
    });
    expect(conflict.state).toBe('CONFLICT');
    expect(conflict.proposedDivisionId).toBeNull();
  });

  it('reports missing evidence as unresolved and never invents a target', () => {
    const unresolved = proposeMapping({
      explicitDivisionId: null,
      responsibilityDivisionId: null,
      activeDivisions: divisions,
      evidence: [member('M-PAST', [DEV], false)]
    });
    expect(unresolved.state).toBe('UNRESOLVED');
    expect(unresolved.unresolved).toContain('NO_ACTIVE_ASSIGNMENT_EVIDENCE');
    expect(unresolved.proposedDivisionId).toBeNull();
  });

  it('lets an explicit selection win but never bypass eligibility', () => {
    const accepted = proposeMapping({
      explicitDivisionId: ENG,
      responsibilityDivisionId: null,
      activeDivisions: divisions,
      evidence: [member('M1', [DEV, ENG])]
    });
    expect(accepted).toMatchObject({ state: 'SUGGESTED', rule: 'EXPLICIT', proposedDivisionId: ENG });

    const refused = proposeMapping({
      explicitDivisionId: ENG,
      responsibilityDivisionId: null,
      activeDivisions: divisions,
      evidence: [member('M1', [DEV])]
    });
    expect(refused.state).toBe('CONFLICT');
  });
});

describe('mapping preview', () => {
  it('reports unmapped counts, a suggestion per record and the archived split', async () => {
    const admin = await login('1101');
    const response = await preview(admin);
    expect(response.statusCode, response.body).toBe(200);
    const view = response.json().data;
    expect(view.counts).toMatchObject({ responsibilities: 3, projects: 4, archivedProjects: 1 });
    expect(view.counts.tasks).toBe(6);
    expect(view.batchLimit).toBeGreaterThan(0);
    expect(view.backup.verified).toBe(false);
    expect(view.divisions.map((entry: { divisionId: string }) => entry.divisionId)).not.toContain(OLD);

    const items = view.items as { entityType: string; entityId: string }[];
    expect(record(items, 'PRJ-U1')).toMatchObject({ state: 'SUGGESTED', proposedDivisionId: DEV });
    expect(record(items, 'PRJ-U2').state).toBe('CONFLICT');
    expect(record(items, 'PRJ-U4').state).toBe('AMBIGUOUS');
    expect(record(items, 'RSP-U3').state).toBe('UNRESOLVED');
    // The archived record is not silently omitted from the backlog count, but it is not in the
    // default page either.
    expect(items.map((item) => item.entityId)).not.toContain('PRJ-ARCH');
  });

  it('lists an archived record only when asked, without changing its lifecycle', async () => {
    const admin = await login('1101');
    const response = await preview(admin, { includeArchived: true });
    const view = response.json().data;
    const archived = (view.items as { entityId: string; archived: boolean; status: string }[]).find(
      (item) => item.entityId === 'PRJ-ARCH'
    );
    expect(archived).toMatchObject({ archived: true, status: 'Archived' });
    const row = await db.one<{ status: string }>("SELECT status FROM projects WHERE project_id = 'PRJ-ARCH'");
    expect(row?.status).toBe('Archived');
  });

  it('shows every linked project of a responsibility and marks the historical assignment', async () => {
    const admin = await login('1101');
    const response = await preview(admin, { responsibilityIds: ['RSP-U1'] });
    const view = response.json().data;
    const responsibility = record(view.items, 'RSP-U1');
    expect(responsibility.linkedProjects.map((link) => link.projectId)).toEqual(['PRJ-U1']);

    const historical = await preview(admin, { projectIds: ['PRJ-U5'] });
    const project = record(historical.json().data.items, 'PRJ-U5');
    const former = project.assignments.find((entry) => entry.memberId === 'MEM-PAST');
    // The person is inactive but the retained WORK relationship survives, so the assignment is
    // historical evidence: it is shown, it is not an active constraint, and it is never removed.
    expect(former).toMatchObject({ active: false, historical: true, eligible: true });
    expect(project.state).toBe('SUGGESTED');
    expect(project.proposedDivisionId).toBe(DEV);
  });

  it('is read-only and refuses a non-ADMIN', async () => {
    const admin = await login('1101');
    const before = await db.one<{ total: string }>('SELECT count(*)::text AS total FROM audit_log');
    const response = await preview(admin);
    expect(response.statusCode, response.body).toBe(200);
    const after = await db.one<{ total: string }>('SELECT count(*)::text AS total FROM audit_log');
    expect(after?.total).toBe(before?.total);
    expect(await projectDivision('PRJ-U1')).toBeNull();

    const manager = await login('1102');
    const refused = await preview(manager);
    expect(refused.statusCode, refused.body).toBe(403);
    const getRefused = await app.inject({ method: 'GET', url: '/api/admin/divisions/unmapped', headers: manager });
    expect(getRefused.statusCode, getRefused.body).toBe(403);
    const overseer = await login('1104');
    const gmRefused = await preview(overseer);
    expect(gmRefused.statusCode, gmRefused.body).toBe(403);
  });

  it('refuses a direct apply for a non-ADMIN', async () => {
    const manager = await login('1102');
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/divisions/mapping/apply',
      headers: manager,
      payload: {
        idempotencyKey: 'map-apply-guard-1',
        confirmed: true,
        confirmation: mappingConfirmationText(1),
        batch: [{ entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision: await projectRevision('PRJ-U1') }]
      }
    });
    expect(response.statusCode, response.body).toBe(403);
    expect(await projectDivision('PRJ-U1')).toBeNull();
  });
});

describe('reviewed apply', () => {
  async function apply(
    headers: Record<string, string>,
    batch: { entityType: string; entityId: string; divisionId: string; revision: number }[],
    options: { key?: string; confirmation?: string; reason?: string } = {}
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/admin/divisions/mapping/apply',
      headers,
      payload: {
        idempotencyKey: options.key ?? 'map-apply-key-1',
        confirmed: true,
        confirmation: options.confirmation ?? mappingConfirmationText(batch.length),
        reason: options.reason ?? 'Reviewed legacy mapping',
        batch
      }
    });
  }

  it('maps a reviewed project and a reviewed responsibility and audits both', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const batch = [
      {
        entityType: 'PROJECT',
        entityId: 'PRJ-U1',
        divisionId: DEV,
        revision: await projectRevision('PRJ-U1')
      },
      {
        entityType: 'RESPONSIBILITY',
        entityId: 'RSP-U1',
        divisionId: DEV,
        revision: 1
      }
    ];
    const response = await apply(admin, batch);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({ projects: 1, responsibilities: 1, replayed: false });
    expect(await projectDivision('PRJ-U1')).toBe(DEV);
    expect(await responsibilityDivision('RSP-U1')).toBe(DEV);
    expect(await auditCount('PROJECT_DIVISION_MAPPED')).toBe(1);
    expect(await auditCount('RESPONSIBILITY_DIVISION_MAPPED')).toBe(1);
    expect(await auditCount('DIVISION_MAPPING_APPLIED')).toBe(1);
    // The task keeps its owner and its identity; its division is derived from the project.
    const task = await db.one<{ owner_member_id: string; task_id: string }>(
      "SELECT task_id, owner_member_id FROM tasks WHERE task_id = 'TSK-U1'"
    );
    expect(task).toMatchObject({ task_id: 'TSK-U1', owner_member_id: 'MEM-A' });
  });

  it('makes mapped work visible to its division and keeps unmapped work ADMIN-only', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const devManager = await login('1103');
    const allDivisionsManager = await login('1102');
    const projectIds = async (headers: Record<string, string>): Promise<string[]> => {
      const response = await app.inject({ method: 'GET', url: '/api/manager/projects?pageSize=100', headers });
      expect(response.statusCode, response.body).toBe(200);
      return (response.json().data.items as { projectId: string }[]).map((item) => item.projectId);
    };

    // Unmapped work belongs to no division, so a scoped manager cannot see it however many
    // divisions they hold; only the administrator's remediation read is unrestricted.
    expect(await projectIds(devManager)).not.toContain('PRJ-U1');
    expect(await projectIds(allDivisionsManager)).not.toContain('PRJ-U1');
    expect(await projectIds(admin)).toContain('PRJ-U1');

    const response = await apply(admin, [
      { entityType: 'RESPONSIBILITY', entityId: 'RSP-U1', divisionId: DEV, revision: 1 },
      { entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision: await projectRevision('PRJ-U1') }
    ]);
    expect(response.statusCode, response.body).toBe(200);

    // No new grant and no re-login: visibility follows the stored division.
    expect(await projectIds(devManager)).toContain('PRJ-U1');
    expect(await projectIds(allDivisionsManager)).toContain('PRJ-U1');
    // The work belongs to DEV only: the same manager narrows to ENG and does not see it.
    const engList = await app.inject({
      method: 'GET',
      url: `/api/manager/projects?pageSize=100&divisionId=${ENG}`,
      headers: allDivisionsManager
    });
    expect(engList.statusCode, engList.body).toBe(200);
    expect((engList.json().data.items as { projectId: string }[]).map((item) => item.projectId)).not.toContain(
      'PRJ-U1'
    );
  });

  it('refuses without a verified backup and writes nothing', async () => {
    const admin = await login('1101');
    const response = await apply(admin, [
      { entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision: await projectRevision('PRJ-U1') }
    ]);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('MAPPING_BACKUP_REQUIRED');
    expect(await projectDivision('PRJ-U1')).toBeNull();
  });

  it('refuses a stale revision instead of overwriting a newer record', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const stale = (await projectRevision('PRJ-U1')) + 3;
    const response = await apply(admin, [
      { entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision: stale }
    ]);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('EDIT_CONFLICT');
    expect(await projectDivision('PRJ-U1')).toBeNull();
  });

  it('commits no record when one record in the batch is ineligible', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const response = await apply(admin, [
      { entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision: await projectRevision('PRJ-U1') },
      // PRJ-U2 is owned by a DEV member and an ENG member: ENG can never accept both.
      { entityType: 'PROJECT', entityId: 'PRJ-U2', divisionId: ENG, revision: await projectRevision('PRJ-U2') }
    ]);
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    expect(await projectDivision('PRJ-U1')).toBeNull();
    expect(await projectDivision('PRJ-U2')).toBeNull();
    expect(await auditCount('PROJECT_DIVISION_MAPPED')).toBe(0);
  });

  it('preserves an inactive historical owner while mapping the project', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const response = await apply(admin, [
      { entityType: 'PROJECT', entityId: 'PRJ-U5', divisionId: DEV, revision: await projectRevision('PRJ-U5') }
    ]);
    expect(response.statusCode, response.body).toBe(200);
    expect(await projectDivision('PRJ-U5')).toBe(DEV);
    const row = await db.one<{ owner_member_id: string }>(
      "SELECT owner_member_id FROM tasks WHERE task_id = 'TSK-U5'"
    );
    expect(row?.owner_member_id).toBe('MEM-PAST');
    const member = await db.one<{ active: boolean }>("SELECT active FROM members WHERE member_id = 'MEM-PAST'");
    expect(member?.active).toBe(false);
  });

  it('requires an exact confirmation phrase and refuses a duplicate record', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const revision = await projectRevision('PRJ-U1');
    const wrongPhrase = await apply(admin, [{ entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision }], {
      confirmation: 'MAP EVERYTHING'
    });
    expect(wrongPhrase.statusCode, wrongPhrase.body).toBe(400);
    expect(wrongPhrase.json().error.code).toBe('CONFIRMATION_REQUIRED');

    const duplicate = await apply(admin, [
      { entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision },
      { entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision }
    ]);
    expect(duplicate.statusCode, duplicate.body).toBe(400);
    expect(await projectDivision('PRJ-U1')).toBeNull();
  });

  it('applies a repeated submission exactly once', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const batch = [
      { entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision: await projectRevision('PRJ-U1') }
    ];
    const first = await apply(admin, batch, { key: 'map-duplicate-key' });
    expect(first.statusCode, first.body).toBe(200);
    const second = await apply(admin, batch, { key: 'map-duplicate-key' });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().data.replayed).toBe(true);
    expect(second.json().data.batchId).toBe(first.json().data.batchId);
    expect(await auditCount('PROJECT_DIVISION_MAPPED')).toBe(1);
    expect(await auditCount('DIVISION_MAPPING_APPLIED')).toBe(1);
  });

  it('refuses an already mapped record instead of remapping it', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const revision = await projectRevision('PRJ-U1');
    const first = await apply(admin, [{ entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision }], {
      key: 'map-first-key'
    });
    expect(first.statusCode, first.body).toBe(200);
    const second = await apply(admin, [{ entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: ENG, revision: revision + 1 }], {
      key: 'map-second-key'
    });
    expect(second.statusCode, second.body).toBe(409);
    expect(second.json().error.code).toBe('INVALID_TRANSITION');
    expect(await projectDivision('PRJ-U1')).toBe(DEV);
  });

  it('validates the whole responsibility scope before mapping the area', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    // RSP-U2 has two projects; mapping the area alone must fail because its projects disagree.
    const response = await apply(admin, [
      { entityType: 'RESPONSIBILITY', entityId: 'RSP-U2', divisionId: DEV, revision: 1 }
    ]);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('INVALID_TRANSITION');
    expect(await responsibilityDivision('RSP-U2')).toBeNull();

    // With both projects in the same batch and the same target, the whole scope passes.
    const accepted = await apply(
      admin,
      [
        { entityType: 'PROJECT', entityId: 'PRJ-U2', divisionId: DEV, revision: await projectRevision('PRJ-U2') },
        { entityType: 'RESPONSIBILITY', entityId: 'RSP-U2', divisionId: DEV, revision: 1 }
      ],
      { key: 'map-scope-key' }
    );
    // PRJ-U2 still carries an ENG owner, so the batch is refused for eligibility, not for scope.
    expect(accepted.statusCode, accepted.body).toBe(400);
    expect(await responsibilityDivision('RSP-U2')).toBeNull();
  });

  it('refuses a batch larger than the documented limit', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const batch = Array.from({ length: 101 }, (_, index) => ({
      entityType: 'PROJECT',
      entityId: `PRJ-SYNTH-${index}`,
      divisionId: DEV,
      revision: 1
    }));
    const response = await apply(admin, batch, { confirmation: mappingConfirmationText(batch.length) });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('concurrency around the reviewed apply', () => {
  it('cannot bypass a role demotion that commits while the apply waits for the lock', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const revision = await projectRevision('PRJ-U1');
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);
    try {
      const pending = app.inject({
        method: 'POST',
        url: '/api/admin/divisions/mapping/apply',
        headers: admin,
        payload: {
          idempotencyKey: 'map-race-key-1',
          confirmed: true,
          confirmation: mappingConfirmationText(1),
          batch: [{ entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision }]
        }
      });
      await waitForLockWaiter();
      await blocker.query("UPDATE members SET role = 'MANAGER' WHERE member_id = 'MEM-ADMIN'");
      await blocker.query('COMMIT');
      const response = await pending;
      expect(response.statusCode, response.body).toBe(403);
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
    expect(await projectDivision('PRJ-U1')).toBeNull();
    expect(await auditCount('PROJECT_DIVISION_MAPPED')).toBe(0);
  });

  it('cannot bypass an active assignee whose membership was removed while the apply waited', async () => {
    await verifiedBackup();
    const admin = await login('1101');
    const revision = await projectRevision('PRJ-U1');
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);
    try {
      const pending = app.inject({
        method: 'POST',
        url: '/api/admin/divisions/mapping/apply',
        headers: admin,
        payload: {
          idempotencyKey: 'map-race-key-2',
          confirmed: true,
          confirmation: mappingConfirmationText(1),
          batch: [{ entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision }]
        }
      });
      await waitForLockWaiter();
      await blocker.query(
        "UPDATE member_divisions SET removed_at = now(), removed_by = 'test' WHERE member_id = 'MEM-A' AND division_id = 'DIV-DEV'"
      );
      await blocker.query('COMMIT');
      const response = await pending;
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('DIVISION_MEMBERSHIP_REQUIRED');
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
    expect(await projectDivision('PRJ-U1')).toBeNull();
  });
});
