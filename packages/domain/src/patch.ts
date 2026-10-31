/**
 * Write rules shared by every edit path.
 *
 * An edit is a partial patch: a field the manager did not address keeps its stored value, and a
 * blank is never written to a column the editor never showed. Identity, creation and audit
 * identifiers are immutable, and a stale revision is refused instead of overwriting newer data.
 */
import { DomainError, fail } from './errors';

export const IMMUTABLE_FIELDS = [
  'projectId',
  'taskId',
  'subprojectId',
  'memberId',
  'responsibilityId',
  'originalDeadline',
  'createdAt',
  'auditId',
  'migrationId',
  'inboxRequestId',
  'revision'
] as const;

export function assertNoImmutableFields(body: Record<string, unknown>): void {
  for (const field of IMMUTABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      // `revision` is a concurrency marker, not an editable value; it is accepted separately.
      if (field === 'revision') continue;
      if (field === 'projectId' && body[field] !== undefined) {
        // A create body names its parent project; an edit body never changes an ID column.
        continue;
      }
      fail.immutable(field);
    }
  }
}

/** Drops `undefined` so a PATCH cannot blank a field it did not mention. */
export function definedOnly<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) result[key as keyof T] = value as T[keyof T];
  }
  return result;
}

export function assertRevision(expected: number | null | undefined, stored: number): void {
  if (expected === null || expected === undefined) {
    throw new DomainError('VALIDATION_FAILED', 'A revision is required for this edit');
  }
  if (expected !== stored) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved', {
      expected,
      stored
    });
  }
}

/** A committed deadline never changes silently. */
export function assertDeadlineChangeConfirmed(
  previousDueDate: string | null,
  nextDueDate: string | null | undefined,
  confirmed: boolean
): void {
  if (nextDueDate === undefined) return;
  const changed = (previousDueDate ?? '') !== (nextDueDate ?? '');
  if (changed && confirmed !== true) {
    throw new DomainError(
      'CONFIRMATION_REQUIRED',
      'A deadline change requires explicit confirmation',
      { previous: previousDueDate, next: nextDueDate }
    );
  }
}

export function assertWarningsAcknowledged(
  warnings: readonly { code: string; requiresAcknowledgement: boolean }[],
  acknowledged: boolean
): void {
  const blocking = warnings.filter((warning) => warning.requiresAcknowledgement);
  if (blocking.length && acknowledged !== true) {
    throw new DomainError('CONFIRMATION_REQUIRED', 'A non-working deadline requires explicit acknowledgement', {
      warnings: blocking.map((warning) => warning.code)
    });
  }
}

export type AssignmentShape = {
  ownerMemberId: string | null;
  assigneeIds: readonly string[];
};

/** A material assignment change invalidates a stored approval and bumps the version. */
export function assignmentChanged(previous: AssignmentShape, next: AssignmentShape): boolean {
  if ((previous.ownerMemberId ?? '') !== (next.ownerMemberId ?? '')) return true;
  const before = [...new Set(previous.assigneeIds)].sort();
  const after = [...new Set(next.assigneeIds)].sort();
  return before.length !== after.length || before.some((id, index) => id !== after[index]);
}

export function nextAssignmentState(
  previous: AssignmentShape,
  next: AssignmentShape,
  version: number
): { version: number; approvedAt: null; changed: boolean } {
  const changed = assignmentChanged(previous, next);
  return {
    changed,
    version: changed ? version + 1 : version,
    approvedAt: changed ? null : null
  };
}

/** Progress is clamped to 0-100 and never inferred from durations. */
export function clampPercent(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.max(0, Math.min(100, number)) * 100) / 100;
}

export function requireText(value: unknown, field: string, max = 200): string {
  const text = String(value ?? '').trim();
  if (!text) throw new DomainError('VALIDATION_FAILED', `${field} is required`, { field });
  if (text.length > max) {
    throw new DomainError('VALIDATION_FAILED', `${field} is too long`, { field, max });
  }
  return text;
}
