import { authorizeWorkEdit } from './work-edit';
import { writableDivisionIds } from '@eh/domain';
/**
 * Removal and restoration of a task or a subproject.
 *
 * Two capabilities with deliberately different reach live here:
 *
 * - `removeEntity` is the *recoverable* removal. It is available to an ADMIN and to a MANAGER
 *   inside a division where that manager holds `WORK` membership; it stamps `deleted_at`, keeps
 *   the row, its identifier and every historical record, and appends `RECORD_REMOVED`.
 * - `deleteEntity` is the guarded, ADMIN-only *permanent* erasure of a demonstrably mistaken,
 *   empty record. It refuses every piece of operational evidence and falls back to archive. A
 *   durable intent (`RECORD_DELETE_PREPARED` audit plus a tombstone with the record snapshot) is
 *   written before the row disappears, and success is reported only after `RECORD_DELETED` exists.
 *
 * `restoreEntity` brings a recoverably removed row back as the same record; `listDeletedRecords`
 * and `restorePreflight` describe what an ADMIN may restore. None of these recreates a record,
 * cascades to neighbours or retries an uncertain outcome.
 */
import {
  deleteRecord,
  deleteResponsibilityMemberRows,
  getProject,
  getSubproject,
  getSubprojectIncludingDeleted,
  getTaskIncludingDeleted,
  insertTombstone,
  listTombstones,
  listAudit
} from '@eh/db';
import type {
  DeletedRecord,
  DeletedRecordPage,
  DeletionPreflight,
  ResponsibilityDeletionPreflight,
  RestorePreflight
} from '@eh/contracts';
import {
  DomainError,
  MAX_SUBPROJECT_DEPTH,
  MAX_TASK_DEPTH,
  assertReadableDivision,
  assertWritableDivision,
  canRecoverablyDeleteRecord,
  canRestoreDeletedRecord,
  confirmationRecord,
  deletionPreflight,
  requireRole,
  responsibilityDeletionPreflight
} from '@eh/domain';
import { audit, requireTypedConfirmation, type ServiceCtx } from './common';
import { lockDivisionMutation, reauthorizeInTransaction } from './divisions';

type EntityType = 'PROJECTS' | 'SUBPROJECTS' | 'TASKS';

type DbLike = Pick<ServiceCtx['db'], 'one' | 'many' | 'query'>;

type RemovalEntityType = 'SUBPROJECTS' | 'TASKS';

type RemovalBlocker = { code: string; detail: string };

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
  const scheduleConfirmations = await countRows(
    db,
    'SELECT count(*)::text AS count FROM schedule_confirmations WHERE task_id = $1',
    [entityId]
  );
  const historicalAudit = await countRows(
    db,
    `SELECT count(*)::text AS count
       FROM audit_log
      WHERE entity_type = 'TASKS'
        AND entity_id = $1
        AND action = ANY($2::text[])`,
    [entityId, ['ASSIGNMENT_APPROVED', 'SCHEDULE_CONFIRMED', 'TASK_COMPLETED_DIRECT', 'COMPLETION_OVERRIDDEN']]
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
  return {
    entityType,
    entityId,
    deletable: blockers.length === 0,
    blockers,
    dependencyCount: dependants.length,
    descendantCount: children.length,
    retainedHistory:
      record.status === 'Done' ||
      Number(record.actual_hours ?? 0) > 0 ||
      !!record.assignment_approved_at ||
      scheduleConfirmations > 0 ||
      historicalAudit > 0,
    confirmationText: '',
    revision: record.revision
  };
}

export async function removalPreflight(
  ctx: ServiceCtx,
  entityType: RemovalEntityType,
  entityId: string
): Promise<DeletionPreflight> {
  requireRole(ctx.identity, 'MEMBER');
  await assertRemovableRecord(ctx, entityType, entityId);
  return evaluateRemoval(ctx.db, entityType, entityId);
}

/**
 * The record-level gate of a recoverable removal.
 *
 * Two independent questions are asked against authoritative data: the verified role may remove a
 * task or a subproject at all, and the caller may write in the division of the project that
 * carries the record. A manager with read-only access in that division, a GENERAL_MANAGER and a
 * MEMBER all stop here. The read is a pre-check; `removeEntity` repeats it through the transaction
 * handle before the first mutation.
 */
async function assertRemovableRecord(
  ctx: ServiceCtx,
  entityType: RemovalEntityType,
  entityId: string,
  db: DbLike = ctx.db
): Promise<{ divisionId: string | null; projectId: string; revision: number; deletedAt: string | null }> {
  if (!canRecoverablyDeleteRecord(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Removing this record requires a manager account');
  }
  const row = await db.one<{
    revision: number;
    deleted_at: string | null;
    project_id: string;
    division_id: string | null;
  }>(
    entityType === 'TASKS'
      ? `SELECT t.revision, t.deleted_at, t.project_id, p.division_id
           FROM tasks t JOIN projects p ON p.project_id = t.project_id
          WHERE t.task_id = $1`
      : `SELECT s.revision, s.deleted_at, s.project_id, p.division_id
           FROM subprojects s JOIN projects p ON p.project_id = s.project_id
          WHERE s.subproject_id = $1`,
    [entityId]
  );
  if (!row) throw new DomainError('NOT_FOUND', `Record not found: ${entityId}`);
  // A record outside the caller's readable divisions answers like an unknown one; a record inside a
  // readable but read-only division is an authorization refusal.
  assertReadableDivision(ctx.divisions, row.division_id);
  assertWritableDivision(ctx.divisions, row.division_id);
  await authorizeWorkEdit(ctx, row.project_id, db);
  return {
    divisionId: row.division_id,
    projectId: row.project_id,
    revision: row.revision,
    deletedAt: row.deleted_at
  };
}

/**
 * Recovers the record's stable identity without creating or moving anything.
 *
 * The tombstone table only describes a *permanent* erasure, so its presence means the row no
 * longer exists and cannot be restored through this workflow. The answer is reported so the
 * interface can say so instead of offering an action the server would refuse.
 */
async function assertRestorableRecord(
  ctx: ServiceCtx,
  entityType: RemovalEntityType,
  entityId: string,
  db: DbLike = ctx.db
): Promise<{
  revision: number;
  deletedAt: string | null;
  projectId: string;
  divisionId: string | null;
  name: string;
  subprojectId: string | null;
  parentId: string | null;
  level: number;
}> {
  if (!canRestoreDeletedRecord(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Restoring a removed record requires a manager account');
  }
  const row = await db.one<{
    revision: number;
    deleted_at: string | null;
    project_id: string;
    division_id: string | null;
    name: string;
    subproject_id: string | null;
    parent_id: string | null;
    level: number;
  }>(
    entityType === 'TASKS'
      ? `SELECT t.revision, t.deleted_at, t.project_id, p.division_id, t.task_name AS name,
                t.subproject_id, t.parent_task_id AS parent_id, eh_task_depth(t.task_id) AS level
           FROM tasks t JOIN projects p ON p.project_id = t.project_id
          WHERE t.task_id = $1`
      : `SELECT s.revision, s.deleted_at, s.project_id, p.division_id, s.subproject_name AS name,
                s.parent_subproject_id AS subproject_id,
                s.parent_subproject_id AS parent_id, eh_subproject_depth(s.subproject_id) AS level
           FROM subprojects s JOIN projects p ON p.project_id = s.project_id
          WHERE s.subproject_id = $1`,
    [entityId]
  );
  if (!row) {
    const tombstone = await db.one(
      'SELECT 1 FROM record_deletions WHERE entity_type = $1 AND entity_id = $2',
      [entityType, entityId]
    );
    throw new DomainError(
      'NOT_FOUND',
      tombstone
        ? 'This record was erased permanently and cannot be restored through the application'
        : `Record not found: ${entityId}`
    );
  }
  assertReadableDivision(ctx.divisions, row.division_id);
  assertWritableDivision(ctx.divisions, row.division_id);
  return {
    revision: Number(row.revision),
    deletedAt: row.deleted_at,
    projectId: row.project_id,
    divisionId: row.division_id,
    name: row.name,
    subprojectId: row.subproject_id,
    parentId: row.parent_id,
    level: Number(row.level)
  };
}

/**
 * Why a removed record cannot be restored right now.
 *
 * Nothing is repaired silently: a deleted parent, an archived or cancelled project, a removed
 * subproject that carried the task and a hierarchy that no longer fits are all reported with an
 * actionable explanation. Restoring a record never restores, moves or deletes its neighbours.
 */
async function restoreBlockers(
  db: DbLike,
  entityType: RemovalEntityType,
  row: { projectId: string; subprojectId: string | null; parentId: string | null; level: number }
): Promise<RemovalBlocker[]> {
  const blockers: RemovalBlocker[] = [];
  const project = await db.one<{ project_name: string; status: string; deleted_at: string | null }>(
    'SELECT project_name, status, deleted_at FROM projects WHERE project_id = $1',
    [row.projectId]
  );
  if (!project) {
    blockers.push({ code: 'PROJECT_DELETED', detail: 'The project of this record no longer exists' });
  } else if (project.deleted_at) {
    blockers.push({
      code: 'PROJECT_DELETED',
      detail: `Restore the project ${project.project_name} first; this record belongs to it`
    });
  } else if (project.status === 'Archived' || project.status === 'Cancelled') {
    blockers.push({
      code: 'PROJECT_INACTIVE',
      detail: `The project ${project.project_name} is ${project.status}; an ADMIN must reopen it before this record can return`
    });
  }

  if (entityType === 'SUBPROJECTS') {
    if (row.parentId) {
      const parent = await db.one<{ subproject_name: string; deleted_at: string | null }>(
        'SELECT subproject_name, deleted_at FROM subprojects WHERE subproject_id = $1',
        [row.parentId]
      );
      if (!parent || parent.deleted_at) {
        blockers.push({
          code: 'PARENT_DELETED',
          detail: 'The parent subproject is removed; restore the parent first'
        });
      }
    }
    if (row.level > MAX_SUBPROJECT_DEPTH) {
      blockers.push({
        code: 'HIERARCHY_DEPTH',
        detail: `Subprojects are limited to ${MAX_SUBPROJECT_DEPTH} levels`
      });
    }
    return blockers;
  }

  if (row.level > MAX_TASK_DEPTH) {
    blockers.push({ code: 'HIERARCHY_DEPTH', detail: `Tasks are limited to ${MAX_TASK_DEPTH} levels` });
  }
  if (row.subprojectId) {
    const subproject = await db.one<{ subproject_name: string; deleted_at: string | null }>(
      'SELECT subproject_name, deleted_at FROM subprojects WHERE subproject_id = $1',
      [row.subprojectId]
    );
    if (!subproject || subproject.deleted_at) {
      blockers.push({
        code: 'PARENT_DELETED',
        detail: 'The subproject of this task is removed; restore the subproject first'
      });
    }
  }
  if (row.parentId) {
    const parent = await db.one<{ task_name: string; deleted_at: string | null }>(
      'SELECT task_name, deleted_at FROM tasks WHERE task_id = $1',
      [row.parentId]
    );
    if (!parent || parent.deleted_at) {
      blockers.push({
        code: 'PARENT_DELETED',
        detail: 'The parent task is removed; restore the parent first'
      });
    }
  }
  return blockers;
}

/** The ADMIN answer a restoration dialog reads before it offers the confirmation button. */
export async function restorePreflight(
  ctx: ServiceCtx,
  entityType: RemovalEntityType,
  entityId: string
): Promise<RestorePreflight> {
  requireRole(ctx.identity, 'MANAGER');
  const row = await assertRestorableRecord(ctx, entityType, entityId);
  if (!row.deletedAt) {
    return {
      entityType,
      entityId,
      name: row.name,
      restorable: false,
      blockers: [{ code: 'NOT_DELETED', detail: 'This record is not removed, so there is nothing to restore' }],
      revision: row.revision
    };
  }
  const blockers = await restoreBlockers(ctx.db, entityType, row);
  return {
    entityType,
    entityId,
    name: row.name,
    restorable: blockers.length === 0,
    blockers,
    revision: row.revision
  };
}

/**
 * Restores one recoverably removed task or subproject.
 *
 * The stored row and its identifier come back; nothing is recreated. The confirmation is the
 * red-panel button (no typed phrase, no mandatory reason), the revision the editor loaded is
 * re-checked under the row lock, and a repeated delivery returns the stored answer without a
 * second audit row.
 */
export async function restoreEntity(
  ctx: ServiceCtx,
  entityType: RemovalEntityType,
  entityId: string,
  input: { revision: number; confirmed: true }
): Promise<{ entityType: RemovalEntityType; entityId: string; revision: number; alreadyRestored: boolean }> {
  requireRole(ctx.identity, 'MANAGER');
  if (input.confirmed !== true) {
    throw new DomainError('CONFIRMATION_REQUIRED', 'Restoring a removed record requires explicit confirmation');
  }

  return ctx.db.transaction(async (tx) => {
    // The canonical lock order of a division-scoped write: the advisory locks first, then the
    // target row. The division is read *after* the row is locked, so a transfer committed while
    // this request waited cannot leave the authorization describing a different division.
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    if (!canRestoreDeletedRecord(fresh.identity)) {
      throw new DomainError('AUTHORIZATION_DENIED', 'Restoring a removed record requires a manager account');
    }
    await lockTarget(tx, entityType, entityId);
    const row = await assertRestorableRecord({ ...ctx, identity: fresh.identity, divisions: fresh.scope }, entityType, entityId, tx);
    if (!row.deletedAt) {
      // A retried delivery of an already completed restoration: no second effect, no second audit.
      return { entityType, entityId, revision: row.revision, alreadyRestored: true };
    }
    const blockers = await restoreBlockers(tx, entityType, row);
    if (blockers.length) {
      throw new DomainError('INVALID_TRANSITION', 'This record cannot be restored right now', { blockers });
    }
    if (row.revision !== input.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }
    const table = entityType === 'TASKS' ? 'tasks' : 'subprojects';
    const column = entityType === 'TASKS' ? 'task_id' : 'subproject_id';
    const updated = await tx.one<{ revision: number }>(
      `UPDATE ${table}
          SET deleted_at = NULL, updated_at = now(), revision = revision + 1
        WHERE ${column} = $1 AND revision = $2 AND deleted_at IS NOT NULL
        RETURNING revision`,
      [entityId, input.revision]
    );
    if (!updated) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType,
      entityId,
      action: 'RECORD_RESTORED',
      previousValue: { deletedAt: row.deletedAt, revision: input.revision, name: row.name },
      newValue: {
        ...confirmationRecord('RESTORE'),
        restoredBy: ctx.identity.memberId,
        revision: updated.revision,
        projectId: row.projectId
      }
    });
    if (entityType === 'TASKS') {
      await tx.query(
        `INSERT INTO outbox_jobs(kind, payload, dedupe_key, correlation_id)
         VALUES ('publication.run', $1::jsonb, $2, $3)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          JSON.stringify({ reason: 'TASK_RESTORED', taskId: entityId }),
          `publication:task-restored:${entityId}:${updated.revision}`,
          ctx.correlationId
        ]
      );
    }
    return { entityType, entityId, revision: updated.revision, alreadyRestored: false };
  });
}

/**
 * One bounded page of the ADMIN Deleted Items view.
 *
 * Only tasks and subprojects appear here: those are the records a manager may remove recoverably.
 * A permanently erased record has no row left, so it is not a restore candidate and is never
 * listed as one. Deletion metadata is read from the removal audit row; when that evidence is
 * missing the fields stay `null` instead of being invented.
 */
export async function listDeletedRecords(
  ctx: ServiceCtx,
  query: { entityType: 'ALL' | 'TASKS' | 'SUBPROJECTS'; query?: string; page: number; pageSize: number }
): Promise<DeletedRecordPage> {
  requireRole(ctx.identity, 'MANAGER');
  const divisionIds = writableDivisionIds(ctx.divisions) ?? null;
  const search = `%${(query.query ?? '').trim()}%`;
  const types = query.entityType === 'ALL' ? ['TASKS', 'SUBPROJECTS'] : [query.entityType];
  const rows = await ctx.db.many<{
    entity_type: 'TASKS' | 'SUBPROJECTS';
    entity_id: string;
    name: string;
    project_id: string;
    project_name: string;
    location: string;
    deleted_at: string;
    revision: number;
    deleted_by: string | null;
    deleted_by_name: string | null;
    reason: string | null;
    confirmation_source: string | null;
    subproject_id: string | null;
    parent_id: string | null;
    level: number;
  }>(
    `WITH deleted AS (
       SELECT 'TASKS'::text AS entity_type, t.task_id AS entity_id, t.task_name AS name,
              t.project_id, t.deleted_at, t.revision,
              t.subproject_id AS subproject_id,
              t.parent_task_id AS parent_id,
              eh_task_depth(t.task_id) AS level
         FROM tasks t
        WHERE t.deleted_at IS NOT NULL
       UNION ALL
       SELECT 'SUBPROJECTS'::text, s.subproject_id, s.subproject_name,
              s.project_id, s.deleted_at, s.revision,
              s.parent_subproject_id, s.parent_subproject_id,
              eh_subproject_depth(s.subproject_id)
         FROM subprojects s
        WHERE s.deleted_at IS NOT NULL
     )
     SELECT d.entity_type, d.entity_id, d.name, d.project_id, p.project_name,
            COALESCE(parent.subproject_name, '') AS location,
            d.deleted_at, d.revision,
            NULLIF(removal.new_value->>'removedBy', '') AS deleted_by,
            actor.name AS deleted_by_name,
            NULLIF(removal.new_value->>'reason', '') AS reason,
            NULLIF(removal.new_value->>'confirmationSource', '') AS confirmation_source,
            d.subproject_id, d.parent_id, d.level
       FROM deleted d
       JOIN projects p ON p.project_id = d.project_id
       LEFT JOIN subprojects parent ON parent.subproject_id = d.subproject_id
       LEFT JOIN LATERAL (
         SELECT new_value
           FROM audit_log
          WHERE entity_type = d.entity_type AND entity_id = d.entity_id AND action = 'RECORD_REMOVED'
          ORDER BY occurred_at DESC, audit_id DESC
          LIMIT 1
       ) removal ON true
       LEFT JOIN members actor ON actor.member_id = NULLIF(removal.new_value->>'removedBy', '')
      WHERE d.entity_type = ANY($1::text[])
         AND ($5::text[] IS NULL OR p.division_id = ANY($5::text[]))
        AND ($2::text = '%%' OR d.name ILIKE $2 OR p.project_name ILIKE $2)
      ORDER BY d.deleted_at DESC, d.entity_id
      LIMIT $3 OFFSET $4`,
    [types, search, query.pageSize, (query.page - 1) * query.pageSize, divisionIds]
  );
  const counted = await ctx.db.one<{ total: string }>(
    `SELECT (SELECT count(*) FROM tasks t WHERE t.deleted_at IS NOT NULL AND 'TASKS' = ANY($1::text[])
               AND ($3::text[] IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.project_id = t.project_id AND p.division_id = ANY($3::text[])))
              AND ($2::text = '%%' OR t.task_name ILIKE $2
                   OR EXISTS (SELECT 1 FROM projects p WHERE p.project_id = t.project_id AND p.project_name ILIKE $2)))
          + (SELECT count(*) FROM subprojects s WHERE s.deleted_at IS NOT NULL AND 'SUBPROJECTS' = ANY($1::text[])
               AND ($3::text[] IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.project_id = s.project_id AND p.division_id = ANY($3::text[])))
              AND ($2::text = '%%' OR s.subproject_name ILIKE $2
                   OR EXISTS (SELECT 1 FROM projects p WHERE p.project_id = s.project_id AND p.project_name ILIKE $2)))
            AS total`,
    [types, search, divisionIds]
  );
  const total = Number(counted?.total ?? 0);
  const items: DeletedRecord[] = [];
  for (const row of rows) {
    const blockers = await restoreBlockers(ctx.db, row.entity_type, {
      projectId: row.project_id,
      subprojectId: row.subproject_id,
      parentId: row.parent_id,
      level: Number(row.level)
    });
    items.push({
      entityType: row.entity_type,
      entityId: row.entity_id,
      name: row.name,
      projectId: row.project_id,
      projectName: row.project_name,
      location: row.location,
      deletedAt: row.deleted_at,
      deletedByMemberId: row.deleted_by,
      deletedByName: row.deleted_by_name,
      reason: row.reason,
      confirmationSource: row.confirmation_source,
      revision: Number(row.revision),
      restorable: blockers.length === 0,
      blockers
    });
  }
  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize)
  };
}

export async function removeEntity(
  ctx: ServiceCtx,
  entityType: RemovalEntityType,
  entityId: string,
  input: { revision: number; confirmed: true; reason?: string }
): Promise<{ entityType: RemovalEntityType; entityId: string; revision: number; alreadyRemoved: boolean }> {
  requireRole(ctx.identity, 'MEMBER');
  if (input.confirmed !== true) throw new DomainError('CONFIRMATION_REQUIRED', 'Removal requires explicit confirmation');

  return ctx.db.transaction(async (tx) => {
    // The canonical lock order of a division-scoped write: the advisory locks first, then the
    // target row. The division is read *after* the row is locked, so a transfer committed while
    // this request waited cannot leave the authorization describing a different division.
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    await lockTarget(tx, entityType, entityId);
    await assertRemovableRecord({ ...ctx, identity: fresh.identity, divisions: fresh.scope }, entityType, entityId, tx);
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
      : await getSubprojectIncludingDeleted(tx, entityId);
    if (!previous) throw new DomainError('NOT_FOUND', `Record not found: ${entityId}`);
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
        ...confirmationRecord('REMOVE', input.reason),
        removedBy: ctx.identity.memberId,
        removedByRole: ctx.identity.role,
        previousStatus: entityType === 'TASKS' ? previous.status : undefined,
        previousRevision: input.revision,
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

/**
 * The guarded permanent erasure.
 *
 * A project erasure keeps its typed `DELETE <id>` confirmation and requires a reason, because that
 * interaction was not part of the approved no-typing change. A task or subproject erasure uses the
 * same ADMIN-only red-panel button confirmation as a recoverable removal; every physical-erasure
 * safeguard (blockers, revision, tombstone, audit intent) is unchanged, and the stored reason is
 * the application-generated description rather than an invented user explanation.
 */
export async function deleteEntity(
  ctx: ServiceCtx,
  entityType: EntityType,
  entityId: string,
  input: { revision: number; confirmed?: boolean; reason?: string; confirmation?: string }
): Promise<{ entityType: EntityType; entityId: string; tombstoneId: string }> {
  requireRole(ctx.identity, 'ADMIN');
  const typedConfirmation = entityType === 'PROJECTS';
  const suppliedReason = String(input.reason ?? '').trim();
  if (typedConfirmation && !suppliedReason) {
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
  if (typedConfirmation) {
    requireTypedConfirmation(input.confirmation ?? '', checked.confirmationText);
  } else if (input.confirmed !== true) {
    throw new DomainError('CONFIRMATION_REQUIRED', 'A permanent erasure requires explicit confirmation');
  }
  const confirmation = confirmationRecord('PURGE', suppliedReason);
  const reason = suppliedReason || confirmation.confirmationDescription;

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
      newValue: { reason, ...confirmation }
    });

    const tombstoneId = await insertTombstone(tx, {
      entityType,
      entityId,
      deletedBy: ctx.identity.email,
      reason,
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
      newValue: { tombstoneId, reason, ...confirmation }
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

/* --------------------- responsibility area deletion ---------------------- */

/** The documented reason stored when the one-click confirmation omits a free-text reason. */
const RESPONSIBILITY_DELETE_REASON = 'Created by mistake';

type ResponsibilityRow = {
  responsibility_id: string;
  name: string;
  status: 'Active' | 'Retired';
  revision: number;
};

type ResponsibilityMemberRow = {
  assignment_id: string;
  member_id: string;
  assigned_at: string;
  assigned_by: string;
  removed_at: string | null;
  removed_by: string;
};

async function evaluateResponsibilityPreflight(
  db: DbLike,
  entityId: string,
  options: PreflightOptions = {}
): Promise<ResponsibilityDeletionPreflight> {
  if (options.lock) {
    // Serialises a concurrent project assignment, membership change or revision bump behind this
    // preflight, so the blockers and the revision are read from the current row.
    await db.query('SELECT 1 FROM responsibilities WHERE responsibility_id = $1 FOR UPDATE', [entityId]);
  }
  const record = await db.one<ResponsibilityRow>(
    'SELECT responsibility_id, name, status, revision FROM responsibilities WHERE responsibility_id = $1',
    [entityId]
  );
  if (!record) {
    return {
      entityType: 'RESPONSIBILITIES',
      entityId,
      name: '',
      status: null,
      deletable: false,
      blockers: [
        { code: 'NOT_FOUND_OR_DELETED', detail: 'The responsibility does not exist or was already deleted' }
      ],
      projectCount: 0,
      archivedProjectCount: 0,
      deletedProjectCount: 0,
      activeMemberCount: 0,
      historicalMemberCount: 0,
      auditReferenceCount: 0,
      publishedReferenceCount: 0,
      activeJobCount: 0,
      erasePlan: [],
      confirmationText: `DELETE ${entityId}`,
      revision: null
    };
  }

  // Every project row counts, whatever its status: an archived or logically deleted project still
  // stores the stable responsibility identifier and would be left dangling by a physical deletion.
  const projects = await db.one<{ total: string; archived: string; deleted: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE status = 'Archived')::text AS archived,
            count(*) FILTER (WHERE deleted_at IS NOT NULL)::text AS deleted
       FROM projects WHERE responsibility_id = $1`,
    [entityId]
  );
  const members = await db.one<{ active: string; historical: string }>(
    `SELECT count(*) FILTER (WHERE removed_at IS NULL)::text AS active,
            count(*) FILTER (WHERE removed_at IS NOT NULL)::text AS historical
       FROM responsibility_members WHERE responsibility_id = $1`,
    [entityId]
  );
  const auditReferences = await countRows(
    db,
    "SELECT count(*)::text AS count FROM audit_log WHERE entity_type = 'RESPONSIBILITIES' AND entity_id = $1",
    [entityId]
  );
  const publishedReferences = await countRows(
    db,
    `SELECT count(*)::text AS count
       FROM published_snapshots snapshot
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(snapshot.rows) row WHERE row->>'responsibilityId' = $1
      )`,
    [entityId]
  );
  const activeJobs = await countRows(
    db,
    `SELECT count(*)::text AS count
       FROM outbox_jobs
      WHERE status IN ('PENDING','LEASED')
        AND (payload->>'responsibilityId' = $1 OR payload->>'entityId' = $1)`,
    [entityId]
  );
  const retiredIdentifier =
    (await countRows(
      db,
      "SELECT count(*)::text AS count FROM record_deletions WHERE entity_type = 'RESPONSIBILITIES' AND entity_id = $1",
      [entityId]
    )) > 0;

  const projectCount = Number(projects?.total ?? 0);
  const archivedProjectCount = Number(projects?.archived ?? 0);
  const deletedProjectCount = Number(projects?.deleted ?? 0);
  const activeMemberCount = Number(members?.active ?? 0);
  const historicalMemberCount = Number(members?.historical ?? 0);
  const result = responsibilityDeletionPreflight({
    entityId,
    projectCount,
    archivedProjectCount,
    deletedProjectCount,
    publishedReferenceCount: publishedReferences,
    activeJobCount: activeJobs,
    retiredIdentifier
  });

  const memberLinks = activeMemberCount + historicalMemberCount;
  return {
    entityType: 'RESPONSIBILITIES',
    entityId,
    name: record.name,
    status: record.status,
    deletable: result.deletable,
    blockers: result.blockers,
    projectCount,
    archivedProjectCount,
    deletedProjectCount,
    activeMemberCount,
    historicalMemberCount,
    auditReferenceCount: auditReferences,
    publishedReferenceCount: publishedReferences,
    activeJobCount: activeJobs,
    erasePlan: [
      { code: 'RESPONSIBILITY_ROW', count: 1, detail: `Responsibility row ${entityId}` },
      ...(memberLinks
        ? [
            {
              code: 'RESPONSIBILITY_MEMBERS',
              count: memberLinks,
              detail: `${memberLinks} member link(s) recorded in the deletion tombstone and then removed`
            }
          ]
        : [])
    ],
    confirmationText: result.confirmationText,
    revision: record.revision
  };
}

/** ADMIN-only eligibility read for permanently removing an unused responsibility area. */
export async function responsibilityPreflight(
  ctx: ServiceCtx,
  entityId: string
): Promise<ResponsibilityDeletionPreflight> {
  requireRole(ctx.identity, 'ADMIN');
  return evaluateResponsibilityPreflight(ctx.db, entityId);
}

/**
 * Permanently removes an unused responsibility area.
 *
 * Only the responsibility row and its administrative member links are removed; the tombstone
 * keeps the full snapshot (including soft-removed links) and the append-only audit log keeps the
 * actor and the reason. Projects are never reassigned or deleted - a project that still names the
 * area refuses the operation and the manager retires it instead.
 */
export async function deleteResponsibility(
  ctx: ServiceCtx,
  entityId: string,
  input: { revision: number; confirmed: true; reason?: string; confirmation: string }
): Promise<{ entityType: 'RESPONSIBILITIES'; entityId: string; name: string; tombstoneId: string }> {
  requireRole(ctx.identity, 'ADMIN');
  if (!input.confirmed) throw new DomainError('CONFIRMATION_REQUIRED', 'Deletion requires explicit confirmation');
  const reason = String(input.reason ?? '').trim() || RESPONSIBILITY_DELETE_REASON;

  const checked = await evaluateResponsibilityPreflight(ctx.db, entityId);
  if (!checked.deletable) {
    throw new DomainError('INVALID_TRANSITION', 'This responsibility cannot be deleted', {
      blockers: checked.blockers,
      projectCount: checked.projectCount
    });
  }
  if (checked.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  requireTypedConfirmation(input.confirmation, checked.confirmationText);

  return ctx.db.transaction(async (tx) => {
    const locked = await evaluateResponsibilityPreflight(tx, entityId, { lock: true });
    if (!locked.deletable) {
      throw new DomainError('INVALID_TRANSITION', 'This responsibility cannot be deleted', {
        blockers: locked.blockers,
        projectCount: locked.projectCount
      });
    }
    if (locked.revision !== input.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }

    const links = await tx.many<ResponsibilityMemberRow>(
      `SELECT assignment_id, member_id, assigned_at, assigned_by, removed_at, removed_by
         FROM responsibility_members
        WHERE responsibility_id = $1
        ORDER BY assigned_at, assignment_id`,
      [entityId]
    );
    const snapshot = {
      responsibilityId: entityId,
      name: locked.name,
      status: locked.status,
      revision: input.revision,
      memberLinks: links.map((row) => ({
        assignmentId: row.assignment_id,
        memberId: row.member_id,
        assignedAt: row.assigned_at,
        assignedBy: row.assigned_by,
        removedAt: row.removed_at,
        removedBy: row.removed_by
      }))
    };

    await audit(tx, ctx, {
      entityType: 'RESPONSIBILITIES',
      entityId,
      action: 'RECORD_DELETE_PREPARED',
      previousValue: snapshot,
      newValue: { reason }
    });

    const tombstoneId = await insertTombstone(tx, {
      entityType: 'RESPONSIBILITIES',
      entityId,
      deletedBy: ctx.identity.email,
      reason,
      lastRevision: input.revision,
      snapshot
    });

    // Administrative-only relationships: the preflight refused every project reference, so no
    // operational record can be reached here, and the tombstone already holds their snapshot.
    await deleteResponsibilityMemberRows(tx, entityId);

    const removed = await deleteRecord(tx, 'RESPONSIBILITIES', entityId);
    if (!removed) throw new DomainError('NOT_FOUND', `Responsibility not found: ${entityId}`);

    await audit(tx, ctx, {
      entityType: 'RESPONSIBILITIES',
      entityId,
      action: 'RECORD_DELETED',
      previousValue: snapshot,
      newValue: { tombstoneId, reason }
    });

    return { entityType: 'RESPONSIBILITIES' as const, entityId, name: locked.name, tombstoneId };
  });
}
