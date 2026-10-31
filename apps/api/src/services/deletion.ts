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

async function countRows(ctx: ServiceCtx, sql: string, params: unknown[]): Promise<number> {
  const row = await ctx.db.one<{ count: string }>(sql, params);
  return Number(row?.count ?? 0);
}

async function hasHistory(ctx: ServiceCtx, entityType: string, entityId: string, allowedActions: string[]): Promise<boolean> {
  const entries = await listAudit(ctx.db, { entityType, entityId, limit: 100 });
  return entries.some((entry) => !allowedActions.includes(entry.action));
}

export async function preflight(ctx: ServiceCtx, entityType: EntityType, entityId: string): Promise<DeletionPreflight> {
  requireRole(ctx.identity, 'ADMIN');
  if (entityType === 'PROJECTS') {
    const project = await getProject(ctx.db, entityId);
    const tombstone = project ? null : await ctx.db.one('SELECT 1 FROM record_deletions WHERE entity_type = $1 AND entity_id = $2', [entityType, entityId]);
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
      ctx,
      'SELECT count(*)::text AS count FROM subprojects WHERE project_id = $1 AND deleted_at IS NULL',
      [entityId]
    );
    const tasks = await countRows(ctx, 'SELECT count(*)::text AS count FROM tasks WHERE project_id = $1 AND deleted_at IS NULL', [entityId]);
    const milestones = await countRows(ctx, 'SELECT count(*)::text AS count FROM milestones WHERE project_id = $1', [entityId]);
    const issues = await countRows(ctx, 'SELECT count(*)::text AS count FROM issues WHERE project_id = $1', [entityId]);
    const history = await hasHistory(ctx, entityType, entityId, ['PROJECT_CREATED']);
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
      dependencyCount: 0,
      descendantCount: descendants,
      confirmationText: result.confirmationText,
      revision: project.revision
    };
  }

  if (entityType === 'SUBPROJECTS') {
    const subproject = await getSubproject(ctx.db, entityId);
    const tombstone = subproject ? null : await ctx.db.one('SELECT 1 FROM record_deletions WHERE entity_type = $1 AND entity_id = $2', [entityType, entityId]);
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
      ctx,
      'SELECT count(*)::text AS count FROM subprojects WHERE parent_subproject_id = $1 AND deleted_at IS NULL',
      [entityId]
    );
    const tasks = await countRows(ctx, 'SELECT count(*)::text AS count FROM tasks WHERE subproject_id = $1 AND deleted_at IS NULL', [entityId]);
    const linked = await countRows(
      ctx,
      'SELECT count(*)::text AS count FROM milestones WHERE subproject_id = $1',
      [entityId]
    );
    const history = await hasHistory(ctx, entityType, entityId, ['SUBPROJECT_CREATED']);
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
      dependencyCount: 0,
      descendantCount: descendants,
      confirmationText: result.confirmationText,
      revision: subproject.revision
    };
  }

  const task = await getTaskIncludingDeleted(ctx.db, entityId);
  const tombstone = task ? null : await ctx.db.one('SELECT 1 FROM record_deletions WHERE entity_type = $1 AND entity_id = $2', [entityType, entityId]);
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
  const children = await countRows(ctx, 'SELECT count(*)::text AS count FROM tasks WHERE parent_task_id = $1 AND deleted_at IS NULL', [entityId]);
  const referenced = await countRows(ctx, 'SELECT count(*)::text AS count FROM task_dependencies WHERE depends_on_task_id = $1', [entityId]);
  const requests = await countRows(ctx, 'SELECT count(*)::text AS count FROM task_requests WHERE task_id = $1', [entityId]);
  const notifications = await countRows(ctx, 'SELECT count(*)::text AS count FROM notification_ledger WHERE task_id = $1', [entityId]);
  const deadlineHistory = await countRows(ctx, 'SELECT count(*)::text AS count FROM task_deadline_history WHERE task_id = $1', [entityId]);
  const scheduleConfirmations = await countRows(ctx, 'SELECT count(*)::text AS count FROM schedule_confirmations WHERE task_id = $1', [entityId]);
  const project = await getProject(ctx.db, task.projectId);
  const history = await hasHistory(ctx, entityType, entityId, ['TASK_CREATED']);
  const result = deletionPreflight({
    entityType,
    entityId,
    descendantCount: children,
    dependencyCount: referenced,
    recordedEffort: (task.actualHours ?? 0) > 0 || task.status === 'Done',
    approvals: !!task.assignmentApprovedAt,
    requests: requests > 0,
    notifications: notifications > 0,
    deadlineHistory: deadlineHistory > 0,
    scheduleConfirmations: scheduleConfirmations > 0,
    published: project?.dashboardVisibility === 'INTERNAL',
    auditHistory: history
  });
  return {
    entityType,
    entityId,
    deletable: result.deletable,
    blockers: result.blockers,
    dependencyCount: referenced,
    descendantCount: children,
    confirmationText: result.confirmationText,
    revision: task.revision
  };
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

    const tombstoneId = `DEL-${entityId}`;
    await insertTombstone(tx, {
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
