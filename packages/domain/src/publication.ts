/**
 * Shared-dashboard publication policy.
 *
 * Only an explicit allowlist of display fields is published, and only for a project whose
 * visibility is exactly INTERNAL. The snapshot is written into an inactive A/B slot, verified,
 * then committed with a single metadata write, so a failed run leaves the previous snapshot
 * readable.
 */
import type { PublishedTaskRow } from '@eh/contracts';
import { isPublishable } from './lifecycle';

export type PublishSourceTask = {
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  responsibilityId: string | null;
  responsibilityName: string;
  responsibilityColor: string;
  status: string;
  dueDate: string | null;
  plannedStart: string | null;
  ownerName: string;
  assigneeNames: string[];
  container: boolean;
  parentTaskId: string | null;
  reviewState: string;
  completedAt: string | null;
  progressPercent: number | null;
  pendingRequest: boolean;
  projectVisibility: string;
};

/** Everything not in this function's return value never reaches the snapshot. */
export function toPublishedRow(task: PublishSourceTask): PublishedTaskRow | null {
  if (!isPublishable(task.projectVisibility)) return null;
  return {
    taskId: task.taskId,
    taskName: task.taskName,
    projectId: task.projectId,
    projectName: task.projectName,
    responsibilityId: task.responsibilityId ?? '',
    responsibilityName: task.responsibilityName,
    responsibilityColor: task.responsibilityColor,
    status: task.status,
    dueDate: task.dueDate ?? '',
    plannedStart: task.plannedStart ?? '',
    ownerName: task.ownerName,
    assigneeNames: task.assigneeNames.filter((name) => !!name),
    container: task.container,
    parentTaskId: task.parentTaskId ?? '',
    reviewState: task.reviewState,
    completedAt: task.completedAt ?? '',
    progressPercent: task.progressPercent,
    pendingRequest: task.pendingRequest === true
  };
}

export function inactiveSlot(active: 'A' | 'B' | 'NONE'): 'A' | 'B' {
  return active === 'A' ? 'B' : 'A';
}

export type PublicationVerification = {
  headersMatch: boolean;
  rowCount: number;
  expectedRows: number;
  hash: string;
  expectedHash: string;
};

/** A commit is refused unless headers, row count and the content hash all match. */
export function verifyPublication(check: PublicationVerification): void {
  if (!check.headersMatch) throw new Error('Publication refused: snapshot headers do not match the contract');
  if (check.rowCount !== check.expectedRows) {
    throw new Error(`Publication refused: wrote ${check.rowCount} rows, expected ${check.expectedRows}`);
  }
  if (check.hash !== check.expectedHash) {
    throw new Error('Publication refused: snapshot content hash does not match');
  }
}

/** Deterministic JSON with sorted keys, so a hash is reproducible across hosts. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}
