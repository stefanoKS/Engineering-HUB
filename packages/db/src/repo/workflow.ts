/**
 * Workflow repositories: employee requests, audit evidence and permanent deletion.
 *
 * A decision is one transaction: claim the request, apply the single task effect, write the
 * history row, write the audit row and enqueue the outbox job. A failure rolls all of it back,
 * so the API never reports failure after part of the change was committed.
 */
import type { TaskRequest } from '@eh/contracts';
import type { Queryable } from '../pool';
import { newId } from '../ids';
import { toRequest, type RequestRow } from '../map';

type Db = Queryable;

const REQUEST_SELECT = `
  SELECT request_id, request_type, task_id, project_id, requester_name, submitted_at,
         original_due_date, requested_due_date, reason, explanation, completion_note, status,
         reviewer, decided_at, decision_note, task_revision_at_submission, due_date_at_submission,
         reported_completion_at, accepted_completion_at, inbox_request_id, imported_at,
         snapshot_version, stale_reason, revision
    FROM task_requests`;

export async function listRequests(db: Db, includeDecided: boolean): Promise<TaskRequest[]> {
  const rows = await db.many<RequestRow>(
    `${REQUEST_SELECT}
      WHERE ($1::boolean OR status IN ('PENDING','PROCESSING','STALE'))
      ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'PROCESSING' THEN 1 WHEN 'STALE' THEN 2 ELSE 3 END,
               submitted_at DESC
      LIMIT 500`,
    [includeDecided]
  );
  return rows.map(toRequest);
}

export async function getRequest(db: Db, requestId: string): Promise<TaskRequest | null> {
  const row = await db.one<RequestRow>(`${REQUEST_SELECT} WHERE request_id = $1`, [requestId]);
  return row ? toRequest(row) : null;
}

export async function getRequestByInboxId(db: Db, inboxRequestId: string): Promise<TaskRequest | null> {
  const row = await db.one<RequestRow>(`${REQUEST_SELECT} WHERE inbox_request_id = $1`, [inboxRequestId]);
  return row ? toRequest(row) : null;
}

/** Row lock for a decision: two managers deciding the same request serialize here. */
export async function lockRequest(db: Db, requestId: string): Promise<TaskRequest | null> {
  const row = await db.one<RequestRow>(`${REQUEST_SELECT} WHERE request_id = $1 FOR UPDATE`, [requestId]);
  return row ? toRequest(row) : null;
}

export async function hasPendingRequest(db: Db, taskId: string): Promise<boolean> {
  const row = await db.one<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM task_requests WHERE task_id = $1 AND status IN ('PENDING','PROCESSING')) AS exists",
    [taskId]
  );
  return row?.exists === true;
}

export async function countPendingRequests(db: Db): Promise<number> {
  const row = await db.one<{ count: string }>(
    "SELECT count(*)::text AS count FROM task_requests WHERE status IN ('PENDING','PROCESSING')"
  );
  return Number(row?.count ?? 0);
}

export async function listPendingRequests(db: Db, limit = 20): Promise<TaskRequest[]> {
  const rows = await db.many<RequestRow>(
    `${REQUEST_SELECT}
      WHERE status IN ('PENDING','PROCESSING')
      ORDER BY submitted_at ASC, request_id ASC
      LIMIT $1`,
    [Math.min(limit, 200)]
  );
  return rows.map(toRequest);
}

export type RequestInsert = {
  requestId: string;
  requestType: TaskRequest['requestType'];
  taskId: string;
  projectId: string | null;
  requesterName: string;
  originalDueDate: string | null;
  requestedDueDate: string | null;
  reason: string;
  explanation: string;
  completionNote: string;
  taskRevisionAtSubmission: string;
  dueDateAtSubmission: string | null;
  snapshotVersion: string;
  inboxRequestId: string | null;
  status?: string;
};

export async function insertRequest(db: Db, input: RequestInsert): Promise<TaskRequest> {
  await db.query(
    `INSERT INTO task_requests
       (request_id, request_type, task_id, project_id, requester_name, original_due_date,
        requested_due_date, reason, explanation, completion_note, status,
        task_revision_at_submission, due_date_at_submission, snapshot_version, inbox_request_id, imported_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (inbox_request_id) DO NOTHING`,
    [
      input.requestId,
      input.requestType,
      input.taskId,
      input.projectId,
      input.requesterName,
      input.originalDueDate,
      input.requestedDueDate,
      input.reason,
      input.explanation,
      input.completionNote,
      input.status ?? 'PENDING',
      input.taskRevisionAtSubmission,
      input.dueDateAtSubmission,
      input.snapshotVersion,
      input.inboxRequestId,
      input.inboxRequestId ? new Date().toISOString() : null
    ]
  );
  const created = await getRequest(db, input.requestId);
  if (!created) {
    const existing = input.inboxRequestId ? await getRequestByInboxId(db, input.inboxRequestId) : null;
    if (existing) return existing;
    throw new Error('Request insert returned no row');
  }
  return created;
}

export async function claimRequest(db: Db, requestId: string): Promise<RequestRow | null> {
  const row = await db.one<RequestRow>(
    `UPDATE task_requests
        SET status = 'PROCESSING', revision = revision + 1, failure_reason = ''
      WHERE request_id = $1 AND status IN ('PENDING','PROCESSING')
      RETURNING request_id, request_type, task_id, project_id, requester_name, submitted_at,
                original_due_date, requested_due_date, reason, explanation, completion_note, status,
                reviewer, decided_at, decision_note, task_revision_at_submission, due_date_at_submission,
                reported_completion_at, accepted_completion_at, inbox_request_id, imported_at,
                snapshot_version, stale_reason, revision`,
    [requestId]
  );
  return row ?? null;
}

export async function finalizeRequest(
  db: Db,
  input: {
    requestId: string;
    status: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'STALE';
    reviewer: string;
    note: string;
    staleReason?: string;
    acceptedCompletionAt?: string | null;
  }
): Promise<void> {
  await db.query(
    `UPDATE task_requests
        SET status = $2, reviewer = $3, decided_at = now(), decision_note = $4,
            stale_reason = COALESCE($5, stale_reason),
            accepted_completion_at = $6,
            revision = revision + 1
      WHERE request_id = $1`,
    [
      input.requestId,
      input.status,
      input.reviewer,
      input.note,
      input.staleReason ?? null,
      input.acceptedCompletionAt ?? null
    ]
  );
}

export async function failClaim(db: Db, requestId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE task_requests SET status = 'PENDING', failure_reason = $2, revision = revision + 1
      WHERE request_id = $1 AND status = 'PROCESSING'`,
    [requestId, reason]
  );
}

/* -------------------------------- audit ---------------------------------- */

export async function insertAudit(
  db: Db,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    previousValue?: unknown;
    newValue?: unknown;
    actorEmail: string;
    actorMemberId: string;
    result?: 'OK' | 'REFUSED' | 'FAILED';
    correlationId?: string;
    requestId?: string;
  }
): Promise<string> {
  const row = await db.one<{ audit_id: string }>(
    `INSERT INTO audit_log
       (entity_type, entity_id, action, previous_value, new_value, actor_email, actor_member_id,
        result, correlation_id, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING audit_id::text AS audit_id`,
    [
      input.entityType,
      input.entityId,
      input.action,
      input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
      input.newValue === undefined ? null : JSON.stringify(input.newValue),
      input.actorEmail,
      input.actorMemberId,
      input.result ?? 'OK',
      input.correlationId ?? '',
      input.requestId ?? ''
    ]
  );
  return row?.audit_id ?? '';
}

export async function listAudit(
  db: Db,
  filter: { entityType?: string; entityId?: string; actions?: string[]; limit?: number }
) {
  const rows = await db.many<{
    audit_id: string;
    occurred_at: string;
    entity_type: string;
    entity_id: string;
    action: string;
    previous_value: unknown;
    new_value: unknown;
    actor_email: string;
    result: string;
    correlation_id: string | null;
  }>(
    `SELECT audit_id::text, occurred_at, entity_type, entity_id, action, previous_value, new_value,
            actor_email, result, NULLIF(correlation_id, '') AS correlation_id
       FROM audit_log
      WHERE ($1::text IS NULL OR entity_type = $1)
        AND ($2::text IS NULL OR entity_id = $2)
        AND ($3::text[] IS NULL OR action = ANY($3::text[]))
      ORDER BY occurred_at DESC, audit_id DESC
      LIMIT $4`,
    [
      filter.entityType ?? null,
      filter.entityId ?? null,
      filter.actions && filter.actions.length ? filter.actions : null,
      Math.min(filter.limit ?? 50, 500)
    ]
  );
  return rows.map((row) => ({
    auditId: row.audit_id,
    occurredAt: row.occurred_at,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    previousValue: row.previous_value,
    newValue: row.new_value,
    actor: row.actor_email,
    result: row.result,
    correlationId: row.correlation_id
  }));
}

/* ------------------------------ deletion --------------------------------- */

export async function insertTombstone(
  db: Db,
  input: {
    entityType: 'PROJECTS' | 'SUBPROJECTS' | 'TASKS';
    entityId: string;
    deletedBy: string;
    reason: string;
    lastRevision: number;
    snapshot: unknown;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO record_deletions (tombstone_id, entity_type, entity_id, deleted_by, reason, last_revision, snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId('DEL'), input.entityType, input.entityId, input.deletedBy, input.reason, input.lastRevision, JSON.stringify(input.snapshot)]
  );
}

/** The only destructive statement in the application, called after every preflight gate. */
export async function deleteRecord(
  db: Db,
  entityType: 'PROJECTS' | 'SUBPROJECTS' | 'TASKS',
  entityId: string
): Promise<boolean> {
  const table = entityType === 'PROJECTS' ? 'projects' : entityType === 'SUBPROJECTS' ? 'subprojects' : 'tasks';
  const column = entityType === 'PROJECTS' ? 'project_id' : entityType === 'SUBPROJECTS' ? 'subproject_id' : 'task_id';
  const result = await db.query(`DELETE FROM ${table} WHERE ${column} = $1`, [entityId]);
  return (result.rowCount ?? 0) > 0;
}

export async function listTombstones(db: Db, entityType?: string) {
  const rows = await db.many<{
    tombstone_id: string;
    entity_type: string;
    entity_id: string;
    deleted_at: string;
    deleted_by: string;
    reason: string;
    last_revision: number;
    reconciled_at: string | null;
  }>(
    `SELECT tombstone_id, entity_type, entity_id, deleted_at, deleted_by, reason, last_revision, reconciled_at
       FROM record_deletions WHERE ($1::text IS NULL OR entity_type = $1)
      ORDER BY deleted_at DESC LIMIT 200`,
    [entityType ?? null]
  );
  return rows;
}

export async function getTombstone(db: Db, entityType: string, entityId: string) {
  return db.one<{ tombstone_id: string; entity_type: string; entity_id: string; deleted_at: string }>(
    'SELECT tombstone_id, entity_type, entity_id, deleted_at FROM record_deletions WHERE entity_type = $1 AND entity_id = $2',
    [entityType, entityId]
  );
}
