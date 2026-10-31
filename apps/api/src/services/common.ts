/** Shared write-path helpers: audit, outbox and idempotency. */
import { createHash } from 'node:crypto';
import type { Database, Transaction } from '@eh/db';
import { beginIdempotency, completeIdempotency, enqueue, insertAudit } from '@eh/db';
import { DomainError, type Identity } from '@eh/domain';

export type ServiceCtx = {
  db: Database;
  identity: Identity;
  correlationId: string;
};

export type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
  result?: 'OK' | 'REFUSED' | 'FAILED';
};

export async function audit(tx: Transaction, ctx: ServiceCtx, entry: AuditEntry): Promise<void> {
  await insertAudit(tx, {
    ...entry,
    actorEmail: ctx.identity.email,
    actorMemberId: ctx.identity.memberId,
    correlationId: ctx.correlationId
  });
}

export async function enqueueJob(
  tx: Transaction,
  ctx: ServiceCtx,
  input: { kind: string; payload: Record<string, unknown>; dedupeKey?: string | null }
): Promise<void> {
  await enqueue(tx, { ...input, correlationId: ctx.correlationId });
}

export function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

/**
 * Runs a create-style command exactly once per idempotency key.
 *
 * The key row, the record, its audit row and its outbox job commit together, so a retry after a
 * timeout either replays the stored answer or finds the operation still in progress - it never
 * creates a second record.
 */
export async function runIdempotent<T>(
  ctx: ServiceCtx,
  input: { scope: string; key: string; request: unknown },
  produce: (tx: Transaction) => Promise<T>
): Promise<{ data: T; replayed: boolean }> {
  const hash = hashRequest(input.request);
  return ctx.db.transaction(async (tx) => {
    const state = await beginIdempotency(tx, input.scope, input.key, hash);
    if (state.kind === 'REPLAY') {
      return { data: state.response as T, replayed: true };
    }
    if (state.kind === 'IN_PROGRESS') {
      throw new DomainError('IDEMPOTENCY_REPLAY', 'This operation is still in progress; retry shortly', {}, true);
    }
    if (state.kind === 'MISMATCH') {
      throw new DomainError('IDEMPOTENCY_REPLAY', 'This idempotency key was already used for a different request');
    }
    const data = await produce(tx);
    await completeIdempotency(tx, input.scope, input.key, data);
    return { data, replayed: false };
  });
}

export function requireConfirmation(supplied: boolean | undefined, message: string): void {
  if (supplied !== true) throw new DomainError('CONFIRMATION_REQUIRED', message);
}

export function requireTypedConfirmation(supplied: string, expected: string): void {
  if (String(supplied ?? '').trim() !== expected) {
    throw new DomainError('CONFIRMATION_REQUIRED', `Type exactly "${expected}" to confirm`, { expected });
  }
}
