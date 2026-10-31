/**
 * Shared-dashboard publication.
 *
 * The snapshot is built from an allowlist, hashed, written into the inactive slot, verified and
 * then committed by one metadata write. A failure leaves the previously committed snapshot
 * readable and is recorded in the audit trail and the metadata row.
 */
import { createHash } from 'node:crypto';
import type { PublicationStatus } from '@eh/contracts';
import {
  collectPublishedSourceRows,
  commitSnapshot,
  getPublicationMeta,
  getSettings,
  readActiveSnapshot,
  recordPublicationFailure,
  writeSnapshotSlot
} from '@eh/db';
import {
  canonicalJson,
  DomainError,
  inactiveSlot,
  requireRole,
  settingFlag,
  SETTING_KEYS,
  toPublishedRow,
  verifyPublication,
  type PublishSourceTask
} from '@eh/domain';
import { PUBLISHED_CONTRACT_VERSION } from '@eh/contracts';
import { audit, requireConfirmation, type ServiceCtx } from './common';
import type { AppConfig } from '../config';

export const PUBLISHER_VERSION = '2.0.0';

export async function publicationStatus(ctx: ServiceCtx, config: AppConfig): Promise<PublicationStatus> {
  requireRole(ctx.identity, 'MANAGER');
  const settings = await getSettings(ctx.db);
  const meta = await getPublicationMeta(ctx.db);
  return {
    enabled: settingFlag(settings, SETTING_KEYS.SHARED_DASHBOARD_PUBLISH_ENABLED, false),
    contractVersion: meta?.contract_version || PUBLISHED_CONTRACT_VERSION,
    lastPublishedAt: meta?.published_at ?? null,
    lastResult: meta?.last_result ?? '',
    lastError: meta?.last_error ?? '',
    rows: meta?.row_counts ?? {},
    hash: meta?.hash ?? '',
    activeSlot: meta?.active_slot ?? 'NONE',
    destinationConfigured: config.snapshotDestinationConfigured
  };
}

export async function collectPublishedRows(ctx: ServiceCtx): Promise<PublishSourceTask[]> {
  const rows = await collectPublishedSourceRows(ctx.db);
  return rows.map((row) => ({
    taskId: row.task_id,
    taskName: row.task_name,
    projectId: row.project_id,
    projectName: row.project_name,
    responsibilityId: row.responsibility_id,
    responsibilityName: row.responsibility_name ?? '',
    responsibilityColor: row.responsibility_color ?? '',
    status: row.status,
    dueDate: row.due_date,
    plannedStart: row.planned_start,
    ownerName: row.owner_name ?? '',
    assigneeNames: row.assignee_names ?? [],
    container: row.container,
    parentTaskId: row.parent_task_id,
    reviewState: row.review_state,
    completedAt: row.completed_at,
    progressPercent: row.progress_percent,
    pendingRequest: row.pending_request,
    projectVisibility: row.dashboard_visibility
  }));
}
function hashRows(rows: unknown[]): string {
  return createHash('sha256').update(canonicalJson(rows), 'utf8').digest('hex');
}

export async function publishNow(ctx: ServiceCtx, input: { confirmed: true }) {
  requireRole(ctx.identity, 'ADMIN');
  requireConfirmation(input.confirmed, 'Publishing the shared dashboard requires explicit confirmation');
  const settings = await getSettings(ctx.db);
  if (!settingFlag(settings, SETTING_KEYS.SHARED_DASHBOARD_PUBLISH_ENABLED, false)) {
    throw new DomainError('INVALID_TRANSITION', 'Shared dashboard publication is disabled');
  }
  const source = await collectPublishedRows(ctx);
  const rows = source
    .map(toPublishedRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const hash = hashRows(rows);
  const meta = await getPublicationMeta(ctx.db);
  const slot = inactiveSlot(meta?.active_slot ?? 'NONE');
  const rowCounts = { tasks: rows.length };

  try {
    return await ctx.db.transaction(async (tx) => {
      await writeSnapshotSlot(tx, {
        slot,
        contractVersion: PUBLISHED_CONTRACT_VERSION,
        publisherVersion: PUBLISHER_VERSION,
        hash,
        rows,
        rowCounts
      });
      const written = await tx.one<{ count: string; hash: string }>(
        `SELECT jsonb_array_length(rows)::text AS count, hash FROM published_snapshots WHERE slot = $1`,
        [slot]
      );
      verifyPublication({
        headersMatch: true,
        rowCount: Number(written?.count ?? -1),
        expectedRows: rows.length,
        hash: written?.hash ?? '',
        expectedHash: hash
      });
      await commitSnapshot(tx, {
        slot,
        contractVersion: PUBLISHED_CONTRACT_VERSION,
        publisherVersion: PUBLISHER_VERSION,
        hash,
        rowCounts
      });
      await audit(tx, ctx, {
        entityType: 'PUBLISHED_SNAPSHOT',
        entityId: slot,
        action: 'PUBLICATION_COMPLETED',
        newValue: { slot, hash, rows: rows.length, contractVersion: PUBLISHED_CONTRACT_VERSION }
      });
      return { slot, hash, rows: rows.length, contractVersion: PUBLISHED_CONTRACT_VERSION };
    });
  } catch (error) {
    await recordPublicationFailure(ctx.db, (error as Error).message).catch(() => undefined);
    throw error;
  }
}

/** Employee snapshot read: the committed slot only, never the management tables. */
export async function readSnapshot(ctx: ServiceCtx) {
  const snapshot = await readActiveSnapshot(ctx.db);
  if (!snapshot.meta || snapshot.meta.active_slot === 'NONE') return null;
  return {
    contractVersion: snapshot.meta.contract_version,
    publishedAt: snapshot.meta.published_at,
    rows: snapshot.rows
  };
}
