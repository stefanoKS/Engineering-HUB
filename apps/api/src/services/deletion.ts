/**
 * The narrow, ADMIN-only permanent deletion.
 *
 * `deleteEntity` is the only code path in V2 allowed to remove a row, and only for a
 * demonstrably mistaken, empty record. Every piece of operational evidence refuses deletion
 * and falls back to archive. A durable intent (`RECORD_DELETE_PREPARED` audit plus a tombstone
 * with the record snapshot) is written before the row disappears, and success is reported only
 * after `RECORD_DELETED` exists.
 */
import {
  deleteRecord,
  getProject,
  getSubproject,
  getTaskIncludingDeleted,
  insertTombstone,
  listTombstones,
  listAudit
} from '@eh/db';
import type { DeletionPreflight } from '@eh/contracts';
import { DomainError, deletionPreflight, requireRole } from '@eh/domain';
import { audit, requireTypedConfirmation, type ServiceCtx } from './common';

type EntityType = 'PROJECTS' | 'SUBPROJECTS' | 'TASKS';

type DbLike = Pick<ServiceCtx['db'], 'one' | 'many' | 'query'>;

type RemovalEntityType = 'SUBPROJECTS' | 'TASKS';

type RemovalBlocker = { code: string; detail: string };

const REMOVAL_REASON = 'Administrative removal of a mistakenly created record';

const NON_OPERATIONAL_AUDIT_ACTIONS: Record<EntityType, readonly string[]> = {
  PROJECTS: ['PROJECT_CREATED'],
  SUBPROJECTS: ['SUBPROJECT_CREATED', 'SUBPROJECT_UPDATED'],
  TASKS: ['TASK_CREATED', 'TASK_UPDATED', 'RECORD_REMOVED']
};

async function countRows(db: DbLike, sql: string, params: unknown[]): Promise<number> {
  const row = await db.one<{ count: string }>(sql, params);
  return Number(row?.count ?? 0);
}

async function hasDisallowedAuditHistory(
  db: DbLike,
  entityType: EntityType,
  entityId: string
): Promise<boolean> {
  const row = await db.one<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM audit_log
        WHERE entity_type = $1
          AND entity_id = $2
          AND NOT (action = ANY($3::text[]))
     ) AS exists`,
    [entityType, entityId, NON_OPERATIONAL_AUDIT_ACTIONS[entityType]]
  );
  return row?.exists === true;
}

type PreflightOptions = { lock?: boolean };

async function lockTarget(db: DbLike, entityType: EntityType, entityId: string): Promise<void> {
  // The row lock serialises a concurrent removal, relationship insert or revision bump behind
  // this preflight: the blockers and the revision are evaluated against the current row, not a
  // snapshot taken before the transaction started.
  const table =
    entityType === 'PROJECTS' ? 'projects' : entityType === 'SUBPROJECTS' ? 'subprojects' : 'tasks';
  const column =
    entityType === 'PROJECTS' ? 'project_id' : entityType === 'SUBPROJECTS' ? 'subproject_id' : 'task_id';
  await db.query(`SELECT 1 FROM ${table} WHERE ${column} = $1 FOR UPDATE`, [entityId]);
}

async function evaluatePreflight(
  db: DbLike,
  ctx: ServiceCtx,
  entityType: EntityType,
  entityId: string,
  options: PreflightOptions = {}
): Promise<DeletionPreflight> {
  if (options.lock) await lockTarget(db, entityType, entityId);
  if (entityType === 'PROJECTS') {
    const project = await getProject(db, entityId);
    const tombstone = project ? null : await db.one('SELECT 1 FROM record_deletions WHERE entity_type = $1 AND entity_id = $2', [entityType, entityId]);
    if (!project || tombstone) {
      return {
        entityType,
        entityId,
        deletable: false,
        blockers: [{ code: 'NOT_FOUND_OR_DELETED', detail: 'The record does not exist or was already removed' }],
        dependencyCount: 0,
        descendantCount: 0,
        confirmationText: `DELETE ${entityId}`,
        revision: null
      };
    }
    const descendants = await countRows(
      db,
      'SELECT count(*)::text AS count FROM subprojects WHERE project_id = $1 AND deleted_at IS NULL',
      [entityId]
    );
    const tasks = await countRows(db, 'SELECT count(*)::text AS count FROM tasks WHERE project_id = $1 AND deleted_at IS NULL', [entityId]);
    const milestones = await countRows(db, 'SELECT count(*)::text AS count FROM milestones WHERE project_id = $1', [entityId]);
    const issues = await countRows(db, 'SELECT count(*)::text AS count FROM issues WHERE project_id = $1', [entityId]);
    const history = await hasDisallowedAuditHistory(db, entityType, entityId);
    const result = deletionPreflight({
      entityType,
      entityId,
      archived: project.status === 'Archived',
      descendantCount: descendants,
      taskCount: tasks + milestones + issues,
      published: project.dashboardVisibility === 'INTERNAL',
      auditHistory: history
    });
    return {
      entityType,
      entityId,
      deletable: result.deletable,
      blockers: result.blockers,
      erasePlan: [{ code: 'PROJECT_ROW', count: 1, detail: `Project row ${entityId}` }],
      dependencyCount: 0,
      descendantCount: descendants,
      confirmationText: result.confirmationText,
      revision: project.revision
    };
  }

  if (entityType === 'SUBPROJECTS') {
    const subproject = await getSubproject(db, entityId);
    const tombstone = subproject ? null : await db.one('SELECT 1 FROM record_deletions WHERE entity_type = $1 AND entity_id = $2', [entityType, entityId]);
    if (!subproject || tombstone) {
      return {
        entityType,
        entityId,
        deletable: false,
        blockers: [{ code: 'NOT_FOUND_OR_DELETED', detail: 'The record does not exist or was already removed' }],
        dependencyCount: 0,
        descendantCount: 0,
        confirmationText: `DELETE ${entityId}`,
        revision: null
      };
    }
    const descendants = await countRows(
      db,
      'SELECT count(*)::text AS count FROM subprojects WHERE parent_subproject_id = $1 AND deleted_at IS NULL',
      [entityId]
    );
    const tasks = await countRows(db, 'SELECT count(*)::text AS count FROM tasks WHERE subproject_id = $1 AND deleted_at IS NULL', [entityId]);
    const linked = await countRows(
      db,
      'SELECT count(*)::text AS count FROM milestones WHERE subproject_id = $1',
      [entityId]
    );
    const history = await hasDisallowedAuditHistory(db, entityType, entityId);
    const result = deletionPreflight({
      entityType,
      entityId,
      archived: subproject.status === 'Archived',
      descendantCount: descendants,
      taskCount: tasks + linked,
      auditHistory: history
    });
    return {
      entityType,
      entityId,
      deletable: result.deletable,
      blockers: result.blockers,
      erasePlan: [{ code: 'SUBPROJECT_ROW', count: 1, detail: `Subproject row ${entityId}` }],
      dependencyCount: 0,
      descendantCount: descendants,
      confirmationText: result.confirmationText,
      revision: subproject.revision
    };
  }

  const task = await getTaskIncludingDeleted(db, entityId);
  const tombstone = task ? null : await db.one('SELECT 1 FROM record_deletions WHERE entity_type = $1 AND entity_id = $2', [entityType, entityId]);
  if (!task || tombstone) {
    return {
      entityType,
      entityId,
      deletable: false,
      blockers: [{ code: 'NOT_FOUND_OR_DELETED', detail: 'The record does not exist or was already removed' }],
      dependencyCount: 0,
      descendantCount: 0,
      confirmationText: `DELETE ${entityId}`,
      revision: null
    };
  }
  const children = await countRows(db, 'SELECT count(*)::text AS count FROM tasks WHERE parent_task_id = $1', [entityId]);
  const referenced = await countRows(db, 'SELECT count(*)::text AS count FROM task_dependencies WHERE depends_on_task_id = $1', [entityId]);
  const requests = await countRows(db, 'SELECT count(*)::text AS count FROM task_requests WHERE task_id = $1', [entityId]);
  const approvedCompletions = await countRows(
    db,
    `SELECT count(*)::text AS count
       FROM task_requests
      WHERE task_id = $1 AND request_type = 'COMPLETION_REPORT' AND status = 'APPROVED'`,
    [entityId]
  );
  const notifications = await countRows(db, 'SELECT count(*)::text AS count FROM notification_ledger WHERE task_id = $1', [entityId]);
  const deadlineHistory = await countRows(db, 'SELECT count(*)::text AS count FROM task_deadline_history WHERE task_id = $1', [entityId]);
  const scheduleConfirmations = await countRows(db, 'SELECT count(*)::text AS count FROM schedule_confirmations WHERE task_id = $1', [entityId]);
  const assignmentRows = await countRows(db, 'SELECT count(*)::text AS count FROM task_assignees WHERE task_id = $1', [entityId]);
  const outgoingDependencies = await countRows(
    db,
    'SELECT count(*)::text AS count FROM task_dependencies WHERE task_id = $1',
    [entityId]
  );
  const linkedIssues = await countRows(db, 'SELECT count(*)::text AS count FROM issues WHERE task_id = $1', [entityId]);
  const calendarLinks = await countRows(
    db,
    "SELECT count(*)::text AS count FROM calendar_links WHERE entity_type = 'TASK' AND entity_id = $1",
    [entityId]
  );
  const activeJobs = await countRows(
    db,
    `SELECT count(*)::text AS count
       FROM outbox_jobs
      WHERE status IN ('PENDING','LEASED')
        AND (payload->>'taskId' = $1 OR payload->>'entityId' = $1)`,
    [entityId]
  );
  const publicationReferences = await countRows(
    db,
    `SELECT count(*)::text AS count
       FROM published_snapshots snapshot
      WHERE EXISTS (
        SELECT 1
          FROM jsonb_array_elements(snapshot.rows) row
         WHERE row->>'taskId' = $1
      )`,
    [entityId]
  );
  const auditedEffort = await countRows(
    db,
    `SELECT count(*)::text AS count
       FROM audit_log
      WHERE entity_type = 'TASKS'
        AND entity_id = $1
        AND action = 'TASK_UPDATED'
        AND CASE
              WHEN new_value->>'actualHours' ~ '^[0-9]+([.][0-9]+)?$'
                THEN (new_value->>'actualHours')::numeric
              ELSE 0
            END > 0
        AND (previous_value->>'actualHours') IS DISTINCT FROM (new_value->>'actualHours')`,
    [entityId]
  );
  const protectedAudit = await db.many<{ action: string; count: string }>(
    `SELECT action, count(*)::text AS count
       FROM audit_log
      WHERE entity_type = 'TASKS'
        AND entity_id = $1
        AND NOT (action = ANY($2::text[]))
      GROUP BY action
      ORDER BY action`,
    [entityId, NON_OPERATIONAL_AUDIT_ACTIONS.TASKS]
  );
  const actualHours = task.actualHours ?? 0;
  const completedWork = task.status === 'Done' || approvedCompletions > 0;
  const corroboratedEffort = actualHours > 0 && auditedEffort > 0;
  const result = deletionPreflight({
    entityType,
    entityId,
    descendantCount: children,
    dependencyCount: referenced,
    recordedEffort: completedWork || corroboratedEffort,
    approvals: !!task.assignmentApprovedAt,
    requests: requests > 0,
    notifications: notifications > 0,
    deadlineHistory: deadlineHistory > 0,
    scheduleConfirmations: scheduleConfirmations > 0,
    published: publicationReferences > 0,
    auditHistory: protectedAudit.length > 0
  });
  const blockers = result.blockers.map((blocker) => {
    if (blocker.code === 'HAS_DESCENDANTS') {
      return { ...blocker, detail: `${children} child task row(s) still reference this task` };
    }
    if (blocker.code === 'DEPENDENCY_REFERENCED') {
      return { ...blocker, detail: `${referenced} other task dependency row(s) reference this task` };
    }
    if (blocker.code === 'RECORDED_EFFORT') {
      const reasons = [
        task.status === 'Done' ? 'task status is Done' : '',
        approvedCompletions > 0 ? `${approvedCompletions} approved completion request(s)` : '',
        corroboratedEffort ? `${actualHours} actual hour(s) recorded by an audited task update` : ''
      ].filter(Boolean);
      return { ...blocker, detail: `Protected completed work or recorded effort: ${reasons.join('; ')}` };
    }
    if (blocker.code === 'REQUESTS') {
      return {
        ...blocker,
        detail: `${requests} employee request(s) reference this task` +
          (approvedCompletions ? `, including ${approvedCompletions} approved completion request(s)` : '')
      };
    }
    if (blocker.code === 'PUBLISHED') {
      return { ...blocker, detail: `${publicationReferences} stored publication snapshot(s) reference this task` };
    }
    if (blocker.code === 'NOTIFICATIONS') {
      return { ...blocker, detail: `${notifications} notification ledger row(s) reference this task` };
    }
    if (blocker.code === 'DEADLINE_HISTORY') {
      return { ...blocker, detail: `${deadlineHistory} deadline history row(s) reference this task` };
    }
    if (blocker.code === 'SCHEDULE_CONFIRMATIONS') {
      return { ...blocker, detail: `${scheduleConfirmations} schedule confirmation row(s) reference this task` };
    }
    if (blocker.code === 'APPROVALS') {
      return { ...blocker, detail: 'The task has a current assignment approval timestamp' };
    }
    if (blocker.code === 'AUDIT_HISTORY') {
      return {
        ...blocker,
        detail: `Protected audit evidence exists: ${protectedAudit.map((row) => `${row.action} (${row.count})`).join(', ')}`
      };
    }
    return blocker;
  });
  if (actualHours > 0 && !corroboratedEffort && !completedWork) {
    blockers.push({
      code: 'UNVERIFIED_LEGACY_EFFORT',
      detail: `${actualHours} legacy actual hour(s) are stored without corroborating work evidence; the value is not assumed to be genuine, but physical erasure cannot discard it automatically`
    });
  }
  if (linkedIssues > 0) {
    blockers.push({ code: 'ACTIVE_WORKFLOW', detail: `${linkedIssues} issue record(s) reference this task` });
  }
  if (calendarLinks > 0) {
    blockers.push({ code: 'ACTIVE_WORKFLOW', detail: `${calendarLinks} external calendar link(s) reference this task` });
  }
  if (activeJobs > 0) {
    blockers.push({ code: 'NOTIFICATIONS', detail: `${activeJobs} pending or leased worker job(s) reference this task` });
  }
  return {
    entityType,
    entityId,
    deletable: blockers.length === 0,
    blockers,
    erasePlan: [
      { code: 'TASK_ROW', count: 1, detail: `Task row ${entityId}` },
      ...(assignmentRows
        ? [{ code: 'TASK_ASSIGNEES', count: assignmentRows, detail: `${assignmentRows} task assignee relationship row(s)` }]
        : []),
      ...(outgoingDependencies
        ? [{ code: 'TASK_DEPENDENCIES', count: outgoingDependencies, detail: `${outgoingDependencies} outgoing dependency row(s)` }]
        : [])
    ],
    dependencyCount: referenced,
    descendantCount: children,
    confirmationText: result.confirmationText,
    revision: task.revision
  };
}

export async function preflight(ctx: ServiceCtx, entityType: EntityType, entityId: string): Promise<DeletionPreflight> {
  requireRole(ctx.identity, 'ADMIN');
  return evaluatePreflight(ctx.db, ctx, entityType, entityId);
}

async function evaluateRemoval(
  db: DbLike,
  entityType: RemovalEntityType,
  entityId: string,
  options: PreflightOptions = {}
): Promise<DeletionPreflight> {
  if (options.lock) await lockTarget(db, entityType, entityId);
  const blockers: RemovalBlocker[] = [];
  const blocked = (code: string, detail: string): void => {
    blockers.push({ code, detail });
  };

  if (entityType === 'SUBPROJECTS') {
    const record = await db.one<{
      subproject_name: string;
      status: string;
      deleted_at: string | null;
      revision: number;
    }>(
      `SELECT subproject_name, status, deleted_at, revision
         FROM subprojects WHERE subproject_id = $1`,
      [entityId]
    );
    if (!record || record.deleted_at) {
      return {
        entityType,
        entityId,
        deletable: false,
        blockers: [{ code: 'NOT_FOUND_OR_DELETED', detail: 'The subproject was already removed or does not exist' }],
        dependencyCount: 0,
        descendantCount: 0,
        confirmationText: '',
        revision: record?.revision ?? null
      };
    }
    const descendants = await db.many<{ subproject_name: string }>(
      `SELECT subproject_name
         FROM subprojects
        WHERE parent_subproject_id = $1 AND deleted_at IS NULL
        ORDER BY subproject_name`,
      [entityId]
    );
    const tasks = await db.many<{ task_name: string }>(
      `SELECT task_name
         FROM tasks
        WHERE subproject_id = $1 AND deleted_at IS NULL
        ORDER BY task_name`,
      [entityId]
    );
    const milestones = await db.many<{ milestone_name: string }>(
      `SELECT milestone_name
         FROM milestones
        WHERE subproject_id = $1 AND status <> 'Closed'
        ORDER BY milestone_name`,
      [entityId]
    );
    if (descendants.length) {
      blocked('HAS_DESCENDANTS', `Move or remove child subprojects first: ${descendants.map((row) => row.subproject_name).join(', ')}`);
    }
    if (tasks.length) {
      blocked('HAS_TASKS', `Move or remove tasks first: ${tasks.map((row) => row.task_name).join(', ')}`);
    }
    if (milestones.length) {
      blocked('ACTIVE_WORKFLOW', `Resolve active milestones first: ${milestones.map((row) => row.milestone_name).join(', ')}`);
    }
    return {
      entityType,
      entityId,
      deletable: blockers.length === 0,
      blockers,
      dependencyCount: milestones.length,
      descendantCount: descendants.length,
      confirmationText: '',
      revision: record.revision
    };
  }

  const record = await db.one<{
    task_name: string;
    status: string;
    actual_hours: string | number | null;
    assignment_approved_at: string | null;
    deleted_at: string | null;
    revision: number;
  }>(
    `SELECT task_name, status, actual_hours, assignment_approved_at, deleted_at, revision
       FROM tasks WHERE task_id = $1`,
    [entityId]
  );
  if (!record || record.deleted_at) {
    return {
      entityType,
      entityId,
      deletable: false,
      blockers: [{ code: 'NOT_FOUND_OR_DELETED', detail: 'The task was already removed or does not exist' }],
      dependencyCount: 0,
      descendantCount: 0,
      confirmationText: '',
      revision: record?.revision ?? null
    };
  }
  const children = await db.many<{ task_name: string }>(
    `SELECT task_name
       FROM tasks
      WHERE parent_task_id = $1 AND deleted_at IS NULL
      ORDER BY task_name`,
    [entityId]
  );
  const dependants = await db.many<{ task_name: string }>(
    `SELECT t.task_name
       FROM task_dependencies d
       JOIN tasks t ON t.task_id = d.task_id
      WHERE d.depends_on_task_id = $1 AND t.deleted_at IS NULL
      ORDER BY t.task_name`,
    [entityId]
  );
  const requests = await db.many<{ request_id: string; request_type: string }>(
    `SELECT request_id, request_type
       FROM task_requests
      WHERE task_id = $1 AND status IN ('PENDING','PROCESSING')
      ORDER BY submitted_at`,
    [entityId]
  );
  const pendingLedger = await countRows(
    db,
    `SELECT count(*)::text AS count
       FROM notification_ledger
      WHERE task_id = $1 AND result IN ('PENDING','DELIVERY_UNCERTAIN')`,
    [entityId]
  );
  const jobs = await db.many<{ job_id: string; kind: string }>(
    `SELECT job_id::text, kind
       FROM outbox_jobs
      WHERE status IN ('PENDING','LEASED')
        AND (payload->>'taskId' = $1 OR payload->>'entityId' = $1)
      ORDER BY job_id
      ${options.lock ? 'FOR UPDATE' : ''}`,
    [entityId]
  );
  if (children.length) {
    blocked('HAS_DESCENDANTS', `Remove or move child tasks first: ${children.map((row) => row.task_name).join(', ')}`);
  }
  if (dependants.length) {
    blocked('DEPENDENCY_REFERENCED', `Resolve dependencies from: ${dependants.map((row) => row.task_name).join(', ')}`);
  }
  if (requests.length) {
    blocked('REQUESTS', `Resolve pending requests first: ${requests.map((row) => `${row.request_type} ${row.request_id}`).join(', ')}`);
  }
  if (pendingLedger || jobs.length) {
    blocked(
      'NOTIFICATIONS',
      `Resolve pending notification/calendar work first (${pendingLedger + jobs.length} item(s))`
    );
  }
  if (record.status === 'Done' || Number(record.actual_hours ?? 0) > 0) {
    blocked('RECORDED_EFFORT', 'Completed work or recorded effort requires the protected completion/history workflow');
  }
  if (record.assignment_approved_at) {
    blocked('APPROVALS', 'The current assignment is approved; clear the active operational decision first');
  }
  return {
    entityType,
    entityId,
    deletable: blockers.length === 0,
    blockers,
    dependencyCount: dependants.length,
    descendantCount: children.length,
    confirmationText: '',
    revision: record.revision
  };
}

export async function removalPreflight(
  ctx: ServiceCtx,
  entityType: RemovalEntityType,
  entityId: string
): Promise<DeletionPreflight> {
  requireRole(ctx.identity, 'ADMIN');
  return evaluateRemoval(ctx.db, entityType, entityId);
}

export async function removeEntity(
  ctx: ServiceCtx,
  entityType: RemovalEntityType,
  entityId: string,
  input: { revision: number; confirmed: true }
): Promise<{ entityType: RemovalEntityType; entityId: string; revision: number; alreadyRemoved: boolean }> {
  requireRole(ctx.identity, 'ADMIN');
  if (!input.confirmed) throw new DomainError('CONFIRMATION_REQUIRED', 'Removal requires explicit confirmation');

  return ctx.db.transaction(async (tx) => {
    const existing = await tx.one<{ revision: number; deleted_at: string | null }>(
      `SELECT revision, deleted_at
         FROM ${entityType === 'TASKS' ? 'tasks' : 'subprojects'}
        WHERE ${entityType === 'TASKS' ? 'task_id' : 'subproject_id'} = $1
        FOR UPDATE`,
      [entityId]
    );
    if (!existing) throw new DomainError('NOT_FOUND', `Record not found: ${entityId}`);
    if (existing.deleted_at) {
      return { entityType, entityId, revision: existing.revision, alreadyRemoved: true };
    }
    const checked = await evaluateRemoval(tx, entityType, entityId, { lock: true });
    if (!checked.deletable) {
      throw new DomainError('INVALID_TRANSITION', 'This record cannot be removed', {
        blockers: checked.blockers
      });
    }
    if (checked.revision !== input.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }
    const table = entityType === 'TASKS' ? 'tasks' : 'subprojects';
    const column = entityType === 'TASKS' ? 'task_id' : 'subproject_id';
    const previous = entityType === 'TASKS'
      ? await getTaskIncludingDeleted(tx, entityId)
      : await getSubproject(tx, entityId);
    const updated = await tx.one<{ revision: number }>(
      `UPDATE ${table}
          SET deleted_at = now(), updated_at = now(), revision = revision + 1
        WHERE ${column} = $1 AND revision = $2 AND deleted_at IS NULL
        RETURNING revision`,
      [entityId, input.revision]
    );
    if (!updated) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType,
      entityId,
      action: 'RECORD_REMOVED',
      previousValue: previous,
      newValue: {
        reason: REMOVAL_REASON,
        removedBy: ctx.identity.memberId,
        revision: updated.revision
      }
    });
    if (entityType === 'TASKS') {
      await tx.query(
        `INSERT INTO outbox_jobs(kind, payload, dedupe_key, correlation_id)
         VALUES ('publication.run', $1::jsonb, $2, $3)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          JSON.stringify({ reason: 'TASK_REMOVED', taskId: entityId }),
          `publication:task-removed:${entityId}:${updated.revision}`,
          ctx.correlationId
        ]
      );
    }
    return { entityType, entityId, revision: updated.revision, alreadyRemoved: false };
  });
}

export async function deleteEntity(
  ctx: ServiceCtx,
  entityType: EntityType,
  entityId: string,
  input: { revision: number; confirmed: true; reason: string; confirmation: string }
): Promise<{ entityType: EntityType; entityId: string; tombstoneId: string }> {
  requireRole(ctx.identity, 'ADMIN');
  if (!String(input.reason ?? '').trim()) {
    throw new DomainError('VALIDATION_FAILED', 'A reason is required for a permanent removal');
  }
  const checked = await preflight(ctx, entityType, entityId);
  if (!checked.deletable) {
    throw new DomainError('INVALID_TRANSITION', 'This record cannot be removed permanently', {
      blockers: checked.blockers
    });
  }
  if (checked.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  requireTypedConfirmation(input.confirmation, checked.confirmationText);

  return ctx.db.transaction(async (tx) => {
    // Authoritative check: the target row is locked and every blocker and the revision are
    // evaluated against the current state inside the same transaction as the removal.
    const locked = await evaluatePreflight(tx, ctx, entityType, entityId, { lock: true });
    if (!locked.deletable) {
      throw new DomainError('INVALID_TRANSITION', 'This record cannot be removed permanently', {
        blockers: locked.blockers
      });
    }
    if (locked.revision !== input.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }
    const record =
      entityType === 'PROJECTS'
        ? await getProject(tx, entityId)
        : entityType === 'SUBPROJECTS'
          ? await getSubproject(tx, entityId)
          : await getTaskIncludingDeleted(tx, entityId);
    if (!record) throw new DomainError('NOT_FOUND', `Record not found: ${entityId}`);

    await audit(tx, ctx, {
      entityType,
      entityId,
      action: 'RECORD_DELETE_PREPARED',
      previousValue: record,
      newValue: { reason: input.reason }
    });

    const tombstoneId = await insertTombstone(tx, {
      entityType,
      entityId,
      deletedBy: ctx.identity.email,
      reason: input.reason,
      lastRevision: input.revision,
      snapshot: record
    });

    // Relationship rows of the mistaken entry are removed with it; the preflight already refused
    // descendants, dependencies, deadline history, schedule decisions, requests, notifications and
    // recorded effort, so no evidence row can be reached here.
    if (entityType === 'TASKS') {
      await tx.query('DELETE FROM task_assignees WHERE task_id = $1', [entityId]);
      await tx.query('DELETE FROM task_dependencies WHERE task_id = $1', [entityId]);
    }

    const removed = await deleteRecord(tx, entityType, entityId);
    if (!removed) throw new DomainError('NOT_FOUND', `Record not found: ${entityId}`);

    await audit(tx, ctx, {
      entityType,
      entityId,
      action: 'RECORD_DELETED',
      previousValue: record,
      newValue: { tombstoneId, reason: input.reason }
    });
    return { entityType, entityId, tombstoneId };
  });
}

/**
 * Finishes an interrupted removal: it appends a missing `RECORD_DELETED` record for a row that
 * is verifiably gone. It never deletes anything and never removes a tombstone.
 */
export async function reconcileDeletions(
  ctx: ServiceCtx,
  input: { confirmed: true; confirmation: string }
): Promise<{ checked: number; appended: number }> {
  requireRole(ctx.identity, 'ADMIN');
  requireTypedConfirmation(input.confirmation, 'RECONCILE DELETIONS');
  const tombstones = await listTombstones(ctx.db);
  let appended = 0;
  for (const tombstone of tombstones) {
    const entries = await listAudit(ctx.db, {
      entityType: tombstone.entity_type,
      entityId: tombstone.entity_id,
      actions: ['RECORD_DELETED'],
      limit: 1
    });
    if (entries.length) continue;
    await ctx.db.transaction(async (tx) => {
      await audit(tx, ctx, {
        entityType: tombstone.entity_type,
        entityId: tombstone.entity_id,
        action: 'RECORD_DELETED',
        newValue: { tombstoneId: tombstone.tombstone_id, reconciled: true }
      });
      await tx.query(
        'UPDATE record_deletions SET reconciled_at = now(), reconciled_by = $2 WHERE tombstone_id = $1',
        [tombstone.tombstone_id, ctx.identity.email]
      );
    });
    appended += 1;
  }
  return { checked: tombstones.length, appended };
}
