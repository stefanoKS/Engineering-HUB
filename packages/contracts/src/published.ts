/**
 * The employee publication contract.
 *
 * Only allowlisted display fields leave the private workbook. Member identifiers, e-mail
 * addresses, roles, skills, capacity data, request text, descriptions, acceptance criteria and
 * audit data never appear here, and an unknown or mixed contract version fails closed.
 */
import { z } from 'zod';

export const PUBLISHED_CONTRACT_VERSION = '1.6' as const;
export const READABLE_CONTRACT_VERSIONS = ['1.4', '1.5', '1.6'] as const;

export const PUBLISHED_HEADERS = [
  'Task_ID',
  'Task_Name',
  'Project_ID',
  'Project_Name',
  'Responsibility_ID',
  'Responsibility_Name',
  'Responsibility_Color',
  'Status',
  'Due_Date',
  'Planned_Start',
  'Owner_Name',
  'Assignee_Names',
  'Container',
  'Parent_Task_ID',
  'Review_State',
  'Completed_At',
  'Progress_Percent',
  'Pending_Request'
] as const;

export const PublishedTaskRow = z.object({
  taskId: z.string(),
  taskName: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  responsibilityId: z.string(),
  responsibilityName: z.string(),
  responsibilityColor: z.string(),
  status: z.string(),
  dueDate: z.string(),
  plannedStart: z.string(),
  ownerName: z.string(),
  assigneeNames: z.array(z.string()),
  container: z.boolean(),
  parentTaskId: z.string(),
  reviewState: z.string(),
  completedAt: z.string(),
  progressPercent: z.number().nullable(),
  pendingRequest: z.boolean()
});
export type PublishedTaskRow = z.infer<typeof PublishedTaskRow>;

export const PublishedMeta = z.object({
  contractVersion: z.string(),
  publisherVersion: z.string(),
  publishedAt: z.string(),
  rowCounts: z.record(z.string(), z.number().int().min(0)),
  hash: z.string(),
  slot: z.enum(['A', 'B'])
});
export type PublishedMeta = z.infer<typeof PublishedMeta>;

/** Rejects a mixed or unknown contract instead of reading it as the current one. */
export function assertReadableContract(version: string): void {
  if (!(READABLE_CONTRACT_VERSIONS as readonly string[]).includes(version)) {
    throw new Error(`UNSUPPORTED_CONTRACT: ${version || '(blank)'}`);
  }
  if (version !== PUBLISHED_CONTRACT_VERSION) {
    // Older contracts stay readable for one application update, but only through their own
    // exact header row, which the caller verifies before using this module.
    return;
  }
}
