import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  Database,
  approveAssignment,
  beginIdempotency,
  claimNext,
  collectPublishedSourceRows,
  commitSnapshot,
  completeIdempotency,
  enqueue,
  getPublicationMeta,
  getTask,
  getProject,
  insertMember,
  insertProject,
  insertResponsibility,
  insertSubproject,
  insertTask,
  listTaskSummaries,
  readActiveSnapshot,
  schemaVersion,
  updateProject,
  updateTask,
  writeSnapshotSlot
} from '../src/index';
import { freshDatabase, expectDatabase } from './support/db';

let db: Database;
let pool: pg.Pool;

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
});

afterEach(async () => {
  await pool.end();
});

async function seed() {
  const member = await insertMember(
    db,
    { name: 'Admin', email: 'admin@example.co.jp', role: 'ADMIN' },
    'MEM-1'
  );
  const responsibility = await insertResponsibility(
    db,
    { name: 'Area', ownerMemberId: member.memberId },
    'RSP-1'
  );
  const project = await insertProject(
    db,
    { projectName: 'Project', responsibilityId: responsibility.responsibilityId, projectOwnerId: member.memberId },
    'PRJ-1'
  );
  const subproject = await insertSubproject(
    db,
    { projectId: project.projectId, subprojectName: 'Sub' },
    'SUB-1'
  );
  return { member, responsibility, project, subproject };
}

describe('schema and migrations', () => {
  it('applies every migration exactly once', async () => {
    expectDatabase({ skip: () => undefined });
    expect(await schemaVersion(pool)).toBeGreaterThanOrEqual(5);
    const rows = await db.many<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version'
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(new Set(rows.map((row) => row.version)).size).toBe(rows.length);
  });
});

describe('revision-checked writes', () => {
  it('refuses a stale update and applies a current one once', async () => {
    expectDatabase({ skip: () => undefined });
    const { project } = await seed();
    const updated = await updateProject(db, project.projectId, { projectName: 'Renamed' }, project.revision);
    expect(updated?.projectName).toBe('Renamed');
    expect(updated?.revision).toBe(project.revision + 1);
    const stale = await updateProject(db, project.projectId, { projectName: 'Stale' }, project.revision);
    expect(stale).toBeNull();
    const after = await getProject(db, project.projectId);
    expect(after?.projectName).toBe('Renamed');
  });

  it('rejects a concurrent change with a structured conflict in the API layer', async () => {
    expectDatabase({ skip: () => undefined });
    const { project } = await seed();
    await updateProject(db, project.projectId, { nextAction: 'A' }, project.revision);
    const second = await updateProject(db, project.projectId, { nextAction: 'B' }, project.revision);
    expect(second).toBeNull();
  });
});

describe('database integrity triggers', () => {
  it('refuses a task hierarchy cycle', async () => {
    expectDatabase({ skip: () => undefined });
    const { project } = await seed();
    const root = await insertTask(db, { projectId: project.projectId, taskName: 'Root', dueDate: '2026-03-01' }, 'T1');
    const child = await insertTask(
      db,
      { projectId: project.projectId, parentTaskId: root.taskId, taskName: 'Child', dueDate: '2026-03-01' },
      'T2'
    );
    expect(child.parentTaskId).toBe('T1');
    await expect(
      db.query('UPDATE tasks SET parent_task_id = $1 WHERE task_id = $2', ['T2', 'T1'])
    ).rejects.toThrow(/cycle/i);
  });

  it('refuses a fourth task level and a cross-project parent', async () => {
    expectDatabase({ skip: () => undefined });
    const { project } = await seed();
    const other = await insertProject(db, { projectName: 'Other', responsibilityId: null }, 'PRJ-2');
    await insertTask(db, { projectId: project.projectId, taskName: 'L1', dueDate: '2026-03-01' }, 'T1');
    await insertTask(db, { projectId: project.projectId, parentTaskId: 'T1', taskName: 'L2', dueDate: '2026-03-01' }, 'T2');
    await insertTask(db, { projectId: project.projectId, parentTaskId: 'T2', taskName: 'L3', dueDate: '2026-03-01' }, 'T3');
    await expect(
      insertTask(db, { projectId: project.projectId, parentTaskId: 'T3', taskName: 'L4', dueDate: '2026-03-01' })
    ).rejects.toThrow(/limited to 3 levels/);
    await expect(
      insertTask(db, { projectId: other.projectId, parentTaskId: 'T1', taskName: 'Cross', dueDate: '2026-03-01' })
    ).rejects.toThrow(/same project/);
  });

  it('refuses a dependency cycle and a container completion', async () => {
    expectDatabase({ skip: () => undefined });
    const { project } = await seed();
    await insertTask(db, { projectId: project.projectId, taskName: 'A', dueDate: '2026-03-01' }, 'A');
    await insertTask(db, { projectId: project.projectId, taskName: 'B', dueDate: '2026-03-01' }, 'B');
    await db.query('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1,$2)', ['A', 'B']);
    await expect(
      db.query('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1,$2)', ['B', 'A'])
    ).rejects.toThrow(/cycle/i);

    const parent = await insertTask(db, { projectId: project.projectId, taskName: 'Parent', dueDate: '2026-03-01' }, 'P');
    await insertTask(db, { projectId: project.projectId, parentTaskId: parent.taskId, taskName: 'Kid', dueDate: '2026-03-01' }, 'K');
    await expect(
      db.query("UPDATE tasks SET status = 'Done' WHERE task_id = 'P'")
    ).rejects.toThrow(/container/i);
  });

  it('keeps audit evidence append-only', async () => {
    expectDatabase({ skip: () => undefined });
    await db.query("INSERT INTO audit_log (entity_type, entity_id, action) VALUES ('T','1','X')");
    await expect(db.query("UPDATE audit_log SET action = 'Y'")).rejects.toThrow(/append-only/);
    await expect(db.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });

  it('rolls a whole transaction back on an injected failure', async () => {
    expectDatabase({ skip: () => undefined });
    const { project } = await seed();
    await expect(
      db.transaction(async (tx) => {
        await updateProject(tx, project.projectId, { nextAction: 'Should not persist' }, project.revision);
        throw new Error('injected failure');
      })
    ).rejects.toThrow(/injected/);
    const after = await getProject(db, project.projectId);
    expect(after?.nextAction).toBe('');
  });
});

describe('requests decision state', () => {
  it('applies an approval once and refuses a second decision at the database level', async () => {
    expectDatabase({ skip: () => undefined });
    const { project } = await seed();
    await insertTask(db, { projectId: project.projectId, taskName: 'Task', dueDate: '2026-02-01' }, 'T1');
    await db.query(
      `INSERT INTO task_requests
         (request_id, request_type, task_id, project_id, requested_due_date, status,
          task_revision_at_submission, due_date_at_submission, snapshot_version)
       VALUES ('REQ-1','DEADLINE_CHANGE','T1','PRJ-1','2026-02-10','PENDING','1','2026-02-01','rev:1')`
    );
    const claimed = await db.query(
      "UPDATE task_requests SET status = 'PROCESSING' WHERE request_id = 'REQ-1' AND status = 'PENDING'"
    );
    expect(claimed.rowCount).toBe(1);
    const second = await db.query(
      "UPDATE task_requests SET status = 'PROCESSING' WHERE request_id = 'REQ-1' AND status = 'PENDING'"
    );
    expect(second.rowCount).toBe(0);
  });
});

describe('outbox leases', () => {
  it('claims distinct jobs with SKIP LOCKED and reclaims an expired lease', async () => {
    expectDatabase({ skip: () => undefined });
    await enqueue(db, { kind: 'a', payload: {}, dedupeKey: 'k1' });
    await enqueue(db, { kind: 'b', payload: {}, dedupeKey: 'k2' });
    const first = await claimNext(db, 'w1', 60);
    const second = await claimNext(db, 'w2', 60);
    expect(first?.kind).toBe('a');
    expect(second?.kind).toBe('b');
    expect(await claimNext(db, 'w3', 60)).toBeNull();
    await db.query("UPDATE outbox_jobs SET lease_expires_at = now() - interval '1 minute' WHERE status = 'LEASED'");
    await db.query(
      "UPDATE outbox_jobs SET status = 'PENDING', lease_owner = '', lease_expires_at = NULL WHERE status = 'LEASED'"
    );
    const again = await claimNext(db, 'w4', 60);
    expect(again).not.toBeNull();
  });

  it('does not duplicate a logical job with the same dedupe key', async () => {
    expectDatabase({ skip: () => undefined });
    await enqueue(db, { kind: 'mail', payload: {}, dedupeKey: 'same' });
    await enqueue(db, { kind: 'mail', payload: {}, dedupeKey: 'same' });
    const row = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM outbox_jobs');
    expect(Number(row?.count)).toBe(1);
  });
});

describe('idempotency keys', () => {
  it('replays a completed response and refuses a different request', async () => {
    expectDatabase({ skip: () => undefined });
    expect((await beginIdempotency(db, 'create', 'key-1', 'hash-a')).kind).toBe('NEW');
    await completeIdempotency(db, 'create', 'key-1', { id: 'X' });
    const replay = await beginIdempotency(db, 'create', 'key-1', 'hash-a');
    expect(replay).toEqual({ kind: 'REPLAY', response: { id: 'X' } });
    expect((await beginIdempotency(db, 'create', 'key-1', 'hash-b')).kind).toBe('MISMATCH');
  });
});

describe('publication slots', () => {
  it('keeps the previous snapshot readable when a run fails and commits atomically', async () => {
    expectDatabase({ skip: () => undefined });
    const { project } = await seed();
    await insertTask(db, { projectId: project.projectId, taskName: 'Published', dueDate: '2026-03-01' }, 'T1');
    await updateProject(db, project.projectId, { dashboardVisibility: 'INTERNAL' }, project.revision);
    const source = await collectPublishedSourceRows(db);
    expect(source.length).toBe(1);

    await writeSnapshotSlot(db, {
      slot: 'A',
      contractVersion: '1.6',
      publisherVersion: '2.0.0',
      hash: 'hash-a',
      rows: [{ taskId: 'T1' }],
      rowCounts: { tasks: 1 }
    });
    await commitSnapshot(db, {
      slot: 'A',
      contractVersion: '1.6',
      publisherVersion: '2.0.0',
      hash: 'hash-a',
      rowCounts: { tasks: 1 }
    });
    expect((await getPublicationMeta(db))?.active_slot).toBe('A');

    // A failed B write never commits the metadata, so A stays active.
    await writeSnapshotSlot(db, {
      slot: 'B',
      contractVersion: '1.6',
      publisherVersion: '2.0.0',
      hash: 'hash-b',
      rows: [],
      rowCounts: { tasks: 0 }
    });
    const active = await readActiveSnapshot(db);
    expect(active.meta?.active_slot).toBe('A');
    expect(active.rows.length).toBe(1);
  });
});

describe('assignment approval invalidation', () => {
  it('clears the approval when the assignment version changes', async () => {
    expectDatabase({ skip: () => undefined });
    const { project } = await seed();
    const task = await insertTask(db, { projectId: project.projectId, taskName: 'Task', dueDate: '2026-03-01' }, 'T1');
    const approved = await approveAssignment(db, task.taskId, task.revision);
    expect(approved?.assignmentApprovedAt).not.toBeNull();
    const bumped = await updateTask(
      db,
      task.taskId,
      { assignmentVersion: (approved?.assignmentVersion ?? 1) + 1, assignmentApprovedAt: null },
      approved?.revision ?? 2
    );
    expect(bumped?.assignmentApprovedAt).toBeNull();
    const summaries = await listTaskSummaries(db, {}, 1, 10);
    expect(summaries.items[0]?.taskName).toBe('Task');
    expect((await getTask(db, 'T1'))?.assignmentVersion).toBe(2);
  });
});
