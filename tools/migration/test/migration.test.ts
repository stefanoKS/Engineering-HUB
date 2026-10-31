import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { Database } from '@eh/db';
import { inventory } from '../src/inventory';
import { validateSnapshot } from '../src/validate';
import { importSnapshot } from '../src/import';
import { reconcileSnapshot } from '../src/reconcile';
import type { SourceSnapshot } from '../src/types';
import { freshDatabase } from '../../../packages/db/test/support/db';

let snapshot: SourceSnapshot;
let db: Database;
let pool: pg.Pool;

beforeEach(async () => {
  const raw = await readFile(join(__dirname, '..', 'fixtures', 'v1-snapshot.json'), 'utf8');
  snapshot = JSON.parse(raw) as SourceSnapshot;
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
});

afterEach(async () => {
  await pool.end();
});

describe('inventory', () => {
  it('reports rows, known headers, custom columns and formulas', () => {
    const report = inventory(snapshot);
    const projects = report.tables.find((table) => table.name === 'PROJECTS');
    expect(projects?.rows).toBe(1);
    expect(projects?.formulas).toBe(1);
    expect(report.unsupported.some((entry) => entry.reason.includes('formula'))).toBe(true);
  });

  it('never silently drops an unknown column', () => {
    const tables = snapshot.tables;
    const projects = tables.PROJECTS;
    if (!projects) throw new Error('fixture missing PROJECTS');
    projects.headers.push('Local_Notes');
    projects.rows = projects.rows.map((row) => [...row, 'custom value']);
    const report = inventory(snapshot);
    const entry = report.tables.find((table) => table.name === 'PROJECTS');
    expect(entry?.customColumns).toContain('Local_Notes');
    expect(report.unsupported.some((unsupported) => unsupported.header === 'Local_Notes')).toBe(true);
  });
});

describe('dry-run validation', () => {
  it('accepts the fixture', () => {
    const issues = validateSnapshot(snapshot);
    expect(issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
  });

  it('detects duplicate identifiers, broken references, bad dates and cycles', () => {
    const tasks = snapshot.tables.TASKS;
    if (!tasks) throw new Error('fixture missing TASKS');
    const row = tasks.rows[0];
    if (!row) throw new Error('fixture missing a task');
    tasks.rows.push([...row]); // duplicate TSK-1
    const second = tasks.rows[1];
    if (!second) throw new Error('fixture missing a task');
    const broken = [...second];
    broken[0] = 'TSK-BAD';
    broken[1] = 'PRJ-MISSING';
    broken[3] = 'TSK-BAD';
    broken[10] = '2026-02-31';
    tasks.rows.push(broken);

    const issues = validateSnapshot(snapshot);
    const codes = issues.map((issue) => `${issue.field}:${issue.message}`);
    expect(codes.some((entry) => entry.includes('Duplicate identifier'))).toBe(true);
    expect(codes.some((entry) => entry.includes('Reference not found: PRJ-MISSING'))).toBe(true);
    expect(codes.some((entry) => entry.includes('Invalid date'))).toBe(true);
    expect(codes.some((entry) => entry.includes('its own parent') || entry.includes('Hierarchy cycle'))).toBe(true);
  });
});

describe('import and reconciliation', () => {
  it('rolls a dry run back completely', async () => {
    const result = await importSnapshot(db, snapshot, { dryRun: true });
    expect(result.dryRun).toBe(true);
    const members = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM members');
    expect(Number(members?.count)).toBe(0);
  });

  it('preserves identifiers, hierarchy and history, and forces automation off', async () => {
    const result = await importSnapshot(db, snapshot, { runId: 'RUN-1' });
    expect(result.counts.members).toBe(3);
    expect(result.counts.projects).toBe(1);
    expect(result.counts.tasks).toBe(3);
    expect(result.counts.task_dependencies).toBe(1);

    const task = await db.one<{ parent_task_id: string | null; status: string; assignment_version: number }>(
      'SELECT parent_task_id, status, assignment_version FROM tasks WHERE task_id = $1',
      ['TSK-2']
    );
    expect(task?.parent_task_id).toBe('TSK-1');
    expect(task?.status).toBe('In Progress');
    expect(task?.assignment_version).toBe(2);

    const dependency = await db.one<{ depends_on_task_id: string }>(
      'SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1',
      ['TSK-3']
    );
    expect(dependency?.depends_on_task_id).toBe('TSK-2');

    // A manager relationship is preserved as a soft row.
    const assignee = await db.one<{ member_id: string; removed_at: string | null }>(
      'SELECT member_id, removed_at FROM task_assignees WHERE task_id = $1',
      ['TSK-2']
    );
    expect(assignee?.member_id).toBe('MEM-MANAGER');
    expect(assignee?.removed_at).toBeNull();

    // Automation never activates as a side effect of a migration.
    const settings = await db.many<{ setting_id: string; value: string }>(
      "SELECT setting_id, value FROM app_settings WHERE setting_id IN ('EMAIL_MODE','EMERGENCY_STOP','SHARED_DASHBOARD_PUBLISH_ENABLED','CALENDAR_SYNC_ENABLED') ORDER BY setting_id"
    );
    const map = Object.fromEntries(settings.map((row) => [row.setting_id, row.value]));
    expect(map.EMAIL_MODE).toBe('OFF');
    expect(map.EMERGENCY_STOP).toBe('true');
    expect(map.SHARED_DASHBOARD_PUBLISH_ENABLED).toBe('false');
    expect(map.CALENDAR_SYNC_ENABLED).toBe('false');

    // Historical evidence is present and not resent.
    const ledger = await db.one<{ result: string }>('SELECT result FROM notification_ledger WHERE notification_id = $1', [
      'NTF-1'
    ]);
    expect(ledger?.result).toBe('SENT');
    const request = await db.one<{ status: string; task_revision_at_submission: string }>(
      'SELECT status, task_revision_at_submission FROM task_requests WHERE request_id = $1',
      ['REQ-1']
    );
    expect(request?.status).toBe('PENDING');
    expect(request?.task_revision_at_submission).toBe('2');
    const audit = await db.one<{ count: string }>("SELECT count(*)::text AS count FROM audit_log WHERE action = 'MIGRATION_IMPORTED'");
    expect(Number(audit?.count)).toBe(1);
  });

  it('reconciles a clean import and reports a tampered row', async () => {
    const result = await importSnapshot(db, snapshot, { runId: 'RUN-2' });
    const clean = await reconcileSnapshot(db, snapshot, result.runId);
    expect(clean.ok, JSON.stringify(clean.tables.filter((table) => table.mismatchedFields.length))).toBe(true);

    await db.query("UPDATE tasks SET task_name = 'Tampered' WHERE task_id = 'TSK-1'");
    const dirty = await reconcileSnapshot(db, snapshot, result.runId);
    expect(dirty.ok).toBe(false);
    const tasks = dirty.tables.find((table) => table.table === 'tasks');
    expect(tasks?.mismatchedFields.some((field) => field.field === 'task_name')).toBe(true);
  });

  it('refuses a second import into a populated database', async () => {
    await importSnapshot(db, snapshot, { runId: 'RUN-3' });
    await expect(importSnapshot(db, snapshot, { runId: 'RUN-4' })).rejects.toThrow(/already contains records/);
  });
});
