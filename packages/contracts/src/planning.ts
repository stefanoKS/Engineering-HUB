/**
 * Planning Board contracts (計画ボード).
 *
 * A plan is a private, author-owned working document. It holds a strict allowlist of draft fields
 * and never an operational record: nothing here becomes a task, a subproject or a project until
 * the reviewed export runs. The browser supplies identifiers, names, dates and assignment
 * selections only - never a role, an actor, an owner capability, a status or a confirmation that
 * the server has not asked for.
 */
import { z } from 'zod';
import { Confirm, Id, IdempotencyKey, IsoDate, NullableIsoDate, Revision } from './common';
import { DashboardVisibility, DurationBasis, DurationUnit } from './enums';

/** The draft document version. An unknown version is refused, never reinterpreted. */
export const PLAN_CONTRACT_VERSION = '1.0';

/** Hard limits, enforced at the API boundary and shown honestly in the interface. */
export const PLAN_LIMITS = {
  maxItems: 200,
  maxTitleLength: 200,
  maxNameLength: 200,
  maxAssigneesPerItem: 50,
  maxPlansPerAuthor: 200
} as const;

export const PlanItemType = z.enum(['SUBPROJECT', 'TASK']);
export type PlanItemType = z.infer<typeof PlanItemType>;

export const PlanScheduleMode = z.enum(['MANUAL', 'DURATION']);
export type PlanScheduleMode = z.infer<typeof PlanScheduleMode>;

export const PlanStatus = z.enum(['DRAFT', 'EXPORTED', 'ARCHIVED']);
export type PlanStatus = z.infer<typeof PlanStatus>;

export const PlanDestinationMode = z.enum(['NEW_PROJECT', 'EXISTING_PROJECT']);
export type PlanDestinationMode = z.infer<typeof PlanDestinationMode>;

export const PlanItem = z.object({
  itemId: Id,
  type: PlanItemType,
  parentItemId: z.string().nullable(),
  /** Manual position among the siblings of one parent; never a record identity. */
  order: z.number().int().min(0).max(100000),
  name: z.string(),
  startDate: IsoDate.nullable(),
  finishDate: IsoDate.nullable(),
  durationValue: z.number().nullable(),
  durationUnit: DurationUnit.nullable(),
  durationBasis: DurationBasis.nullable(),
  ownerMemberId: z.string().nullable(),
  assigneeIds: z.array(Id)
});
export type PlanItem = z.infer<typeof PlanItem>;

export const PlanExportReceipt = z.object({
  exportId: Id,
  planId: Id,
  planRevision: Revision,
  exportedAt: z.string().min(1),
  contractVersion: z.string().min(1),
  destination: z.object({
    mode: PlanDestinationMode,
    projectId: Id,
    projectName: z.string(),
    divisionId: z.string().nullable(),
    responsibilityId: z.string().nullable()
  }),
  counts: z.object({ subprojects: z.number().int().min(0), tasks: z.number().int().min(0) }),
  created: z.object({
    projectId: z.string().nullable(),
    subprojectIds: z.array(Id),
    taskIds: z.array(Id)
  }),
  mapping: z.array(
    z.object({
      itemId: Id,
      recordType: z.enum(['SUBPROJECT', 'TASK']),
      recordId: Id
    })
  )
});
export type PlanExportReceipt = z.infer<typeof PlanExportReceipt>;

export const PlanDraft = z.object({
  planId: Id,
  contractVersion: z.string().min(1),
  title: z.string(),
  status: PlanStatus,
  authorMemberId: Id,
  divisionId: z.string().nullable(),
  responsibilityId: z.string().nullable(),
  destinationMode: PlanDestinationMode,
  destinationProjectId: z.string().nullable(),
  projectOwnerId: z.string().nullable(),
  dashboardVisibility: DashboardVisibility,
  scheduleMode: PlanScheduleMode,
  revision: Revision,
  exportedAt: z.string().nullable(),
  exportReceipt: PlanExportReceipt.nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(PlanItem)
});
export type PlanDraft = z.infer<typeof PlanDraft>;

export const PlanSummary = z.object({
  planId: Id,
  title: z.string(),
  status: PlanStatus,
  divisionId: z.string().nullable(),
  responsibilityId: z.string().nullable(),
  destinationMode: PlanDestinationMode,
  destinationProjectId: z.string().nullable(),
  scheduleMode: PlanScheduleMode,
  itemCount: z.number().int().min(0),
  revision: Revision,
  exportedAt: z.string().nullable(),
  updatedAt: z.string()
});
export type PlanSummary = z.infer<typeof PlanSummary>;

export const PlanList = z.object({
  items: z.array(PlanSummary),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0)
});
export type PlanList = z.infer<typeof PlanList>;

export const PlanReviewErrorCode = z.enum([
  'MISSING_TITLE',
  'MISSING_DIVISION',
  'MISSING_RESPONSIBILITY',
  'MISSING_DESTINATION',
  'DESTINATION_UNAVAILABLE',
  'MISSING_NAME',
  'MISSING_FINISH',
  'MISSING_DURATION',
  'INVALID_DATE',
  'INVALID_RANGE',
  'HIERARCHY',
  'INELIGIBLE_OWNER',
  'INELIGIBLE_ASSIGNEE',
  'EMPTY_PLAN'
]);
export type PlanReviewErrorCode = z.infer<typeof PlanReviewErrorCode>;

export const PlanReviewWarningCode = z.enum([
  'UNDATED',
  'START_WITHOUT_FINISH',
  'FINISH_WITHOUT_START',
  'NON_WORKING_FINISH',
  'PAST_FINISH',
  'PARENT_WITHOUT_DATES'
]);
export type PlanReviewWarningCode = z.infer<typeof PlanReviewWarningCode>;

export const PlanReviewIssue = z.object({
  itemId: z.string().nullable(),
  field: z.string(),
  code: PlanReviewErrorCode,
  message: z.string()
});
export type PlanReviewIssue = z.infer<typeof PlanReviewIssue>;

export const PlanReviewWarning = z.object({
  itemId: z.string().nullable(),
  field: z.string(),
  code: PlanReviewWarningCode,
  message: z.string()
});
export type PlanReviewWarning = z.infer<typeof PlanReviewWarning>;

export const PlanReviewItem = z.object({
  itemId: Id,
  type: PlanItemType,
  depth: z.number().int().min(1),
  path: z.array(z.string()),
  name: z.string(),
  startDate: z.string().nullable(),
  finishDate: z.string().nullable(),
  startDerived: z.boolean(),
  ownerMemberId: z.string().nullable(),
  ownerName: z.string(),
  assigneeNames: z.array(z.string()),
  exportTarget: z.enum(['SUBPROJECT', 'TASK'])
});
export type PlanReviewItem = z.infer<typeof PlanReviewItem>;

export const PlanReview = z.object({
  planId: Id,
  planRevision: Revision,
  contractVersion: z.string().min(1),
  scheduleMode: PlanScheduleMode,
  /** Binds an export to the reviewed content; a material edit invalidates it. */
  reviewToken: z.string().min(16).max(128),
  destination: z.object({
    mode: PlanDestinationMode,
    divisionId: z.string().nullable(),
    divisionName: z.string(),
    responsibilityId: z.string().nullable(),
    responsibilityName: z.string(),
    projectId: z.string().nullable(),
    projectName: z.string(),
    projectOwnerId: z.string().nullable(),
    projectOwnerName: z.string(),
    visibility: DashboardVisibility
  }),
  counts: z.object({
    subprojects: z.number().int().min(0),
    tasks: z.number().int().min(0),
    dated: z.number().int().min(0),
    undated: z.number().int().min(0),
    unassigned: z.number().int().min(0)
  }),
  items: z.array(PlanReviewItem),
  errors: z.array(PlanReviewIssue),
  warnings: z.array(PlanReviewWarning)
});
export type PlanReview = z.infer<typeof PlanReview>;

export const PlanExportResult = z.object({
  receipt: PlanExportReceipt,
  replayed: z.boolean()
});
export type PlanExportResult = z.infer<typeof PlanExportResult>;

/* ------------------------------- bodies ---------------------------------- */

const PlanItemBody = z
  .object({
    itemId: Id,
    type: PlanItemType,
    parentItemId: Id.nullable(),
    order: z.number().int().min(0).max(100000),
    name: z.string().max(PLAN_LIMITS.maxNameLength),
    startDate: NullableIsoDate,
    finishDate: NullableIsoDate,
    durationValue: z.number().positive().max(10000).nullable(),
    durationUnit: DurationUnit.nullable(),
    durationBasis: DurationBasis.nullable(),
    ownerMemberId: Id.nullable(),
    assigneeIds: z.array(Id).max(PLAN_LIMITS.maxAssigneesPerItem)
  })
  .strict();

const PlanFields = {
  title: z.string().trim().min(1).max(PLAN_LIMITS.maxTitleLength),
  divisionId: Id.nullable(),
  responsibilityId: Id.nullable(),
  destinationMode: PlanDestinationMode,
  destinationProjectId: Id.nullable(),
  projectOwnerId: Id.nullable(),
  dashboardVisibility: DashboardVisibility,
  scheduleMode: PlanScheduleMode,
  items: z.array(PlanItemBody).max(PLAN_LIMITS.maxItems)
};

export const SavePlanBody = z
  .object({
    ...PlanFields
  })
  .strict();
export type SavePlanBody = z.infer<typeof SavePlanBody>;

export const CreatePlanBody = z
  .object({
    ...PlanFields,
    idempotencyKey: IdempotencyKey
  })
  .strict();
export type CreatePlanBody = z.infer<typeof CreatePlanBody>;

export const UpdatePlanBody = z
  .object({
    ...PlanFields,
    revision: Revision
  })
  .strict();
export type UpdatePlanBody = z.infer<typeof UpdatePlanBody>;

export const ArchivePlanBody = z
  .object({ revision: Revision, confirmed: Confirm })
  .strict();

/**
 * One export attempt is one idempotency identity, bound to the reviewed content token. A repeated
 * identical submission replays the stored receipt; a different request under the same key is
 * refused instead of creating a second plan.
 */
export const ExportPlanBody = z
  .object({
    revision: Revision,
    idempotencyKey: IdempotencyKey,
    reviewToken: z.string().min(16).max(128),
    confirmed: Confirm
  })
  .strict();

export const ReviewPlanQuery = z
  .object({ revision: z.coerce.number().int().min(1).max(1_000_000) })
  .strict();

export const PlanListQuery = z
  .object({
    status: z.enum(['ALL', 'DRAFT', 'EXPORTED', 'ARCHIVED']).default('ALL'),
    query: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20)
  })
  .strict();

export const PlanExportQuery = z
  .object({ exportId: z.string().min(1).max(64) })
  .strict();
