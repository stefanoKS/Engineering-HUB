/**
 * Division mapping contracts (ADMIN remediation of unmapped legacy work).
 *
 * The preview is a read-only proposal; the apply action is bound to the reviewed record IDs,
 * target division IDs and revisions. Neither the browser's counts, its actor, nor its proposal
 * reason is authority - the server recomputes everything inside the applying transaction.
 */
import { z } from 'zod';
import { Confirm, Id, IdempotencyKey, IsoTimestamp, Revision } from './common';

const Text = (max: number) => z.string().max(max);

export const MappingEntityType = z.enum(['RESPONSIBILITY', 'PROJECT']);
export type MappingEntityType = z.infer<typeof MappingEntityType>;

/** How a proposal was reached; `NONE` means no rule produced a target. */
export const MappingRule = z.enum(['EXPLICIT', 'RESPONSIBILITY', 'COMMON_MEMBERSHIP', 'NONE']);
export type MappingRule = z.infer<typeof MappingRule>;

/**
 * `SUGGESTED` - exactly one target; `AMBIGUOUS` - several compatible targets;
 * `CONFLICT` - a target is implied but an active relationship contradicts it;
 * `UNRESOLVED` - not enough evidence to propose anything.
 */
export const MappingState = z.enum(['SUGGESTED', 'AMBIGUOUS', 'CONFLICT', 'UNRESOLVED']);
export type MappingState = z.infer<typeof MappingState>;

export const MappingDivisionOption = z.object({
  divisionId: Id,
  name: z.string()
});
export type MappingDivisionOption = z.infer<typeof MappingDivisionOption>;
/** A candidate target a proposal considered. Same shape as an option, named for the rule. */
export const MappingCandidate = MappingDivisionOption;
export type MappingCandidate = MappingDivisionOption;

export const MappingLinkedProject = z.object({
  projectId: Id,
  projectName: z.string(),
  divisionId: Id.nullable(),
  status: z.string(),
  archived: z.boolean()
});
export type MappingLinkedProject = z.infer<typeof MappingLinkedProject>;

/** One assignment relationship used as evidence, split into active and historical. */
export const MappingAssignment = z.object({
  memberId: Id,
  name: z.string(),
  active: z.boolean(),
  historical: z.boolean(),
  /** Active `WORK` memberships only. Never a `READ` grant, a role or oversight. */
  workDivisionIds: z.array(Id),
  eligible: z.boolean(),
  relations: z.array(z.string())
});
export type MappingAssignment = z.infer<typeof MappingAssignment>;

export const MappingRecord = z.object({
  entityType: MappingEntityType,
  entityId: Id,
  name: z.string(),
  status: z.string(),
  archived: z.boolean(),
  revision: Revision,
  currentDivisionId: Id.nullable(),
  taskCount: z.number().int().min(0),
  subprojectCount: z.number().int().min(0),
  /** Every project a responsibility mapping would affect. Empty for a project record. */
  linkedProjects: z.array(MappingLinkedProject),
  state: MappingState,
  rule: MappingRule,
  proposedDivisionId: Id.nullable(),
  proposedDivisionName: z.string().nullable(),
  candidates: z.array(MappingDivisionOption),
  assignments: z.array(MappingAssignment),
  /** Machine-readable reasons a reviewed apply would be refused. */
  blockers: z.array(z.string()),
  /** What the preview could not decide, so the screen can say so instead of guessing. */
  unresolved: z.array(z.string())
});
export type MappingRecord = z.infer<typeof MappingRecord>;

export const MappingBackupStatus = z.object({
  /** True when a verified backup is required before an apply and none qualifies. */
  required: z.boolean(),
  verified: z.boolean(),
  backupId: z.string().nullable(),
  createdAt: IsoTimestamp.nullable(),
  /** A safe, actionable sentence for the operator. */
  message: z.string()
});
export type MappingBackupStatus = z.infer<typeof MappingBackupStatus>;

export const MappingSelection = z.object({
  /** The explicit ADMIN target, when one was supplied. */
  divisionId: Id.nullable(),
  responsibilityIds: z.array(Id),
  projectIds: z.array(Id)
});
export type MappingSelection = z.infer<typeof MappingSelection>;

export const UnmappedMappingView = z.object({
  counts: z.object({
    responsibilities: z.number().int().min(0),
    projects: z.number().int().min(0),
    archivedResponsibilities: z.number().int().min(0),
    archivedProjects: z.number().int().min(0),
    tasks: z.number().int().min(0),
    subprojects: z.number().int().min(0)
  }),
  items: z.array(MappingRecord),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  selection: MappingSelection,
  divisions: z.array(MappingDivisionOption),
  backup: MappingBackupStatus,
  /** The batch limit an apply accepts; a larger selection must be reviewed in batches. */
  batchLimit: z.number().int().min(1),
  generatedAt: IsoTimestamp
});
export type UnmappedMappingView = z.infer<typeof UnmappedMappingView>;

/**
 * A read-only preview request. `divisionId` is an explicit ADMIN proposal (rule A); the record
 * selectors narrow which records the preview explains. Nothing here mutates anything.
 */
export const MappingPreviewBody = z
  .object({
    divisionId: Id.optional(),
    responsibilityIds: z.array(Id).max(50).optional(),
    projectIds: z.array(Id).max(50).optional(),
    includeArchived: z.boolean().default(false),
    page: z.number().int().min(1).max(10000).default(1),
    pageSize: z.number().int().min(1).max(50).default(10),
    /** Which record types to list; the counts always describe both. */
    entityType: z.enum(['ALL', 'RESPONSIBILITY', 'PROJECT']).default('ALL')
  })
  .strict();
export type MappingPreviewBody = z.infer<typeof MappingPreviewBody>;

export const MappingBatchItem = z
  .object({
    entityType: MappingEntityType,
    entityId: Id,
    divisionId: Id,
    /** The revision the administrator reviewed; a mismatch refuses the whole batch. */
    revision: Revision
  })
  .strict();
export type MappingBatchItem = z.infer<typeof MappingBatchItem>;

export const MappingApplyBody = z
  .object({
    idempotencyKey: IdempotencyKey,
    batch: z.array(MappingBatchItem).min(1).max(200),
    confirmed: Confirm,
    /** The exact phrase the preview returned (`MAP <n> RECORDS`). */
    confirmation: z.string().min(1).max(200),
    reason: Text(1000).optional()
  })
  .strict();
export type MappingApplyBody = z.infer<typeof MappingApplyBody>;

export const MappingApplyResult = z.object({
  batchId: Id,
  responsibilities: z.number().int().min(0),
  projects: z.number().int().min(0),
  divisions: z.array(MappingDivisionOption),
  backupId: z.string().nullable(),
  replayed: z.boolean()
});
export type MappingApplyResult = z.infer<typeof MappingApplyResult>;
