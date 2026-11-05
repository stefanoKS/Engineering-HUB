/**
 * Mutation bodies.
 *
 * Every object is strict: a browser-supplied `role`, `actor`, `owner` or `confirmation` field
 * that is not part of this contract is a validation failure, never a silently ignored value.
 */
import { z } from 'zod';
import {
  DashboardVisibility,
  DurationBasis,
  DurationUnit,
  Priority,
  ProjectScheduleState,
  ProjectStatus,
  RequestDecision,
  RequestType,
  Role,
  TaskStatus
} from './enums';
import { Confirm, Id, IdempotencyKey, IsoDate, NullableIsoDate, Revision } from './common';

const Text = (max: number) => z.string().max(max);

export const CreateSessionBody = z
  .object({
    employeeId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).optional(),
    password: z.string().min(1).max(128).optional(),
    idToken: z.string().max(8000).optional(),
    devEmail: z.string().email().max(320).optional()
  })
  .strict();

export const CreateProjectBody = z
  .object({
    idempotencyKey: IdempotencyKey,
    projectName: Text(200).min(1),
    description: Text(5000).optional(),
    category: Text(100).optional(),
    responsibilityId: Id,
    projectOwnerId: Id.nullable().optional(),
    status: ProjectStatus.optional(),
    priority: Priority.optional(),
    plannedStart: NullableIsoDate.optional(),
    forecastEnd: NullableIsoDate.optional(),
    committedDeadline: NullableIsoDate.optional(),
    originalDeadline: NullableIsoDate.optional(),
    nextMilestone: Text(200).optional(),
    nextAction: Text(500).optional(),
    notificationEnabled: z.boolean().optional(),
    dashboardVisibility: DashboardVisibility.optional(),
    dashboardSummary: Text(1000).optional()
  })
  .strict();

export const PatchProjectBody = z
  .object({
    revision: Revision,
    projectName: Text(200).min(1).optional(),
    description: Text(5000).optional(),
    category: Text(100).optional(),
    responsibilityId: Id.nullable().optional(),
    projectOwnerId: Id.nullable().optional(),
    status: ProjectStatus.optional(),
    priority: Priority.optional(),
    plannedStart: NullableIsoDate.optional(),
    forecastEnd: NullableIsoDate.optional(),
    committedDeadline: NullableIsoDate.optional(),
    nextMilestone: Text(200).optional(),
    nextAction: Text(500).optional(),
    notificationEnabled: z.boolean().optional(),
    dashboardVisibility: DashboardVisibility.optional(),
    dashboardSummary: Text(1000).optional(),
    confirmDeadlineChange: z.boolean().optional(),
    acknowledgeNonWorking: z.boolean().optional(),
    /**
     * A completion, cancellation or reactivation is an explicit manager decision. The server
     * refuses a terminal transition without it, whatever the client rendered.
     */
    confirmStatusChange: z.boolean().optional()
  })
  .strict();

export const RevisionBody = z.object({ revision: Revision }).strict();

export const ArchiveBody = z
  .object({
    revision: Revision,
    confirmed: Confirm,
    reason: Text(1000).optional()
  })
  .strict();

export const DeleteBody = z
  .object({
    revision: Revision,
    confirmed: Confirm,
    reason: Text(1000).min(1),
    confirmation: z.string().min(1).max(200)
  })
  .strict();

export const RemoveBody = z
  .object({
    revision: Revision,
    confirmed: Confirm,
    reason: Text(1000).optional()
  })
  .strict();

export const CreateSubprojectBody = z
  .object({
    idempotencyKey: IdempotencyKey,
    projectId: Id,
    parentSubprojectId: Id.nullable().optional(),
    subprojectName: Text(200).min(1),
    description: Text(2000).optional(),
    ownerId: Id.nullable().optional(),
    status: ProjectStatus.optional(),
    plannedStart: NullableIsoDate.optional(),
    plannedEnd: NullableIsoDate.optional(),
    deadline: NullableIsoDate.optional(),
    estimatedHours: z.number().min(0).max(1000000).nullable().optional(),
    nextAction: Text(500).optional()
  })
  .strict();

/**
 * Member self-service subproject creation.
 *
 * A MEMBER files a subproject immediately, without a manager approval. Everything a manager may
 * decide stays server-side: the owner is the verified session, the status is `Active`, and the
 * browser cannot supply an owner, a role, a status, progress or an approval.
 */
export const CreateMySubprojectBody = z
  .object({
    idempotencyKey: IdempotencyKey,
    projectId: Id,
    parentSubprojectId: Id.nullable().optional(),
    subprojectName: Text(200).min(1),
    description: Text(2000).optional(),
    deadline: NullableIsoDate.optional()
  })
  .strict();

export const PatchSubprojectBody = z
  .object({
    revision: Revision,
    projectId: Id.optional(),
    parentSubprojectId: Id.nullable().optional(),
    subprojectName: Text(200).min(1).optional(),
    description: Text(2000).optional(),
    ownerId: Id.nullable().optional(),
    status: ProjectStatus.optional(),
    plannedStart: NullableIsoDate.optional(),
    plannedEnd: NullableIsoDate.optional(),
    deadline: NullableIsoDate.optional(),
    estimatedHours: z.number().min(0).max(1000000).nullable().optional(),
    nextAction: Text(500).optional(),
    confirmDeadlineChange: z.boolean().optional(),
    acknowledgeNonWorking: z.boolean().optional()
  })
  .strict();

const TaskFields = {
  taskName: Text(200).min(1).optional(),
  description: Text(20000).optional(),
  subprojectId: Id.nullable().optional(),
  parentTaskId: Id.nullable().optional(),
  ownerMemberId: Id.nullable().optional(),
  status: TaskStatus.optional(),
  priority: Priority.optional(),
  plannedStart: NullableIsoDate.optional(),
  deadline: NullableIsoDate.optional(),
  estimatedHours: z.number().min(0).max(1000000).nullable().optional(),
  actualHours: z.number().min(0).max(1000000).nullable().optional(),
  progressPercent: z.number().min(0).max(100).nullable().optional(),
  dependencyIds: z.array(Id).max(200).optional(),
  acceptanceCriteria: Text(20000).optional(),
  nextAction: Text(500).optional(),
  requiredSkillId: Id.nullable().optional(),
  requiredSkillLevel: z.number().int().min(0).max(4).nullable().optional(),
  notificationEnabled: z.boolean().optional(),
  publicNote: Text(2000).optional(),
  plannedDurationValue: z.number().min(0).max(10000).nullable().optional(),
  plannedDurationUnit: DurationUnit.nullable().optional(),
  plannedDurationBasis: DurationBasis.nullable().optional(),
  assigneeIds: z.array(Id).max(100).optional()
};

export const CreateTaskBody = z
  .object({
    idempotencyKey: IdempotencyKey,
    projectId: Id,
    ...TaskFields,
    taskName: Text(200).min(1),
    deadline: IsoDate,
    acknowledgeNonWorking: z.boolean().optional()
  })
  .strict();

/**
 * Member self-service task creation.
 *
 * Deliberately narrower than the manager command: the owner, the assignees, the status, the
 * progress and the hierarchy parent are decided by the server, never by the browser.
 */
export const CreateMyTaskBody = z
  .object({
    idempotencyKey: IdempotencyKey,
    projectId: Id,
    subprojectId: Id.nullable().optional(),
    taskName: Text(200).min(1),
    description: Text(20000).optional(),
    plannedStart: NullableIsoDate.optional(),
    deadline: IsoDate,
    priority: Priority.optional(),
    acknowledgeNonWorking: z.boolean().optional()
  })
  .strict();

export const PatchTaskBody = z
  .object({
    revision: Revision,
    ...TaskFields,
    confirmDeadlineChange: z.boolean().optional(),
    acknowledgeNonWorking: z.boolean().optional()
  })
  .strict();

export const ApproveAssignmentBody = z
  .object({
    revision: Revision,
    confirmed: Confirm
  })
  .strict();

export const ConfirmScheduleBody = z
  .object({
    revision: Revision,
    confirmed: Confirm,
    notes: Text(1000).optional()
  })
  .strict();

export const OverrideCompleteBody = z
  .object({
    revision: Revision,
    reason: Text(1000).min(1),
    confirmation: z.string().min(1).max(200)
  })
  .strict();

/**
 * A manager deciding that authorized work is finished, without a prior request.
 *
 * The role is always the verified session role; the browser supplies only the revision and the
 * confirmation.
 */
export const CompleteTaskBody = z
  .object({
    revision: Revision,
    confirmed: Confirm,
    note: Text(1000).optional()
  })
  .strict();

/**
 * Local login accounts.
 *
 * `memberId` links the new login to an existing member and keeps that member's name, role,
 * assignments and history untouched. Without it the command creates the member and the login
 * together in one transaction.
 */
export const CreateAccountBody = z
  .object({
    idempotencyKey: IdempotencyKey,
    employeeId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
    password: z.string().min(4).max(128),
    name: Text(200).min(1).optional(),
    role: Role.optional(),
    memberId: Id.optional()
  })
  .strict();

export const ResetAccountPasswordBody = z
  .object({ password: z.string().min(4).max(128), confirmed: Confirm })
  .strict();

export const SaveResponsibilityBody = z
  .object({
    responsibilityId: Id.optional(),
    idempotencyKey: IdempotencyKey.optional(),
    revision: Revision.optional(),
    name: Text(200).min(1).optional(),
    description: Text(5000).optional(),
    ownerMemberId: Id.nullable().optional(),
    status: z.enum(['Active', 'Retired']).optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    colorHex: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable()
      .optional(),
    additionalMemberIds: z.array(Id).max(100).optional()
  })
  .strict();

export const MoveResponsibilityBody = z
  .object({
    revision: Revision,
    direction: z.enum(['UP', 'DOWN']),
    /** The row the editor saw adjacent to this one; prevents stale reorders. */
    expectedNeighborId: Id.nullable()
  })
  .strict();

export const ConfirmReasonBody = z
  .object({
    revision: Revision,
    confirmed: Confirm,
    reason: Text(1000).optional()
  })
  .strict();

/**
 * ADMIN-only permanent removal of an unused responsibility.
 *
 * `confirmation` is the typed phrase the preflight returned (`DELETE <id>`); the browser derives
 * it from the record it selected, never from free text. `reason` is optional because the dialog is
 * one Yes/No confirmation; an omitted reason is recorded as the documented default.
 */
export const DeleteResponsibilityBody = z
  .object({
    revision: Revision,
    confirmed: Confirm,
    reason: Text(1000).optional(),
    confirmation: z.string().min(1).max(200)
  })
  .strict();

export const SaveMemberBody = z
  .object({
    memberId: Id.optional(),
    idempotencyKey: IdempotencyKey.optional(),
    revision: Revision.optional(),
    name: Text(200).min(1).optional(),
    email: z.string().email().max(320).optional(),
    department: Text(100).optional(),
    position: Text(100).optional(),
    active: z.boolean().optional(),
    managerId: Id.nullable().optional(),
    weeklyCapacityHours: z.number().min(0).max(168).nullable().optional(),
    role: Role.optional()
  })
  .strict();

export const CreateSkillBody = z
  .object({
    skillName: Text(200).min(1),
    category: Text(100).optional(),
    description: Text(2000).optional(),
    requiredLevel: z.number().int().min(0).max(4).nullable().optional()
  })
  .strict();

export const AssessSkillBody = z
  .object({
    memberId: Id,
    skillId: Id,
    currentLevel: z.number().int().min(0).max(4),
    assessmentDate: IsoDate.optional(),
    evidence: Text(2000).optional(),
    trainingAction: Text(2000).optional(),
    nextReviewDate: NullableIsoDate.optional()
  })
  .strict();

export const DecisionBody = z
  .object({
    requestId: Id,
    decision: RequestDecision,
    revision: Revision,
    note: Text(2000).optional(),
    confirmed: Confirm
  })
  .strict();

export const RequestQueueQuery = z
  .object({
    includeDecided: z.union([z.boolean(), z.enum(['true', 'false'])]).transform(value => value === true || value === 'true').default(false),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
  })
  .strict();

export const AutomationSaveBody = z
  .object({
    revision: z.string().min(1).max(200),
    changes: z.record(z.string().min(1).max(120), z.string().max(4000)),
    confirmed: Confirm,
    confirmation: z.string().min(1).max(120).optional()
  })
  .strict();

export const PublishBody = z.object({ confirmed: Confirm }).strict();

export const ReconcileBody = z
  .object({ confirmed: Confirm, confirmation: z.string().min(1).max(200) })
  .strict();

export const SubmitRequestBody = z
  .object({
    clientRequestId: Id,
    taskId: Id,
    requestType: RequestType,
    requesterName: Text(200).optional(),
    requestedDueDate: NullableIsoDate.optional(),
    reason: Text(2000).optional(),
    explanation: Text(5000).optional(),
    completionNote: Text(5000).optional()
  })
  .strict();

export const EmployeeTimelineQuery = z
  .object({ taskIds: z.array(Id).max(500).optional() })
  .strict();

export const TaskListQuery = z
  .object({
    tree: z.enum(['true', 'false']).optional(),
    treeParentId: Id.optional(),
    projectId: Id.optional(),
    subprojectId: Id.optional(),
    responsibilityId: Id.optional(),
    unassigned: z.coerce.boolean().default(false),
    status: TaskStatus.optional(),
    /** All unfinished leaf work in the active project/subproject scope, including overdue work. */
    workState: z.literal('OPEN').optional(),
    /** Filter by the derived, user-facing state (進行中 / 期限超過 / 完了 / 取消). */
    displayStatus: z.enum(['IN_PROGRESS', 'OVERDUE', 'DONE', 'CANCELLED']).optional(),
    ownerMemberId: Id.optional(),
    query: z.string().trim().max(200).optional(),
    containerOnly: z.coerce.boolean().default(false),
    overdueOnly: z.coerce.boolean().default(false),
    /** Archived projects, archived subprojects and Cancelled work stay hidden unless asked for. */
    includeInactive: z.coerce.boolean().default(false),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(['dueDate', 'priority', 'name', 'project', 'owner', 'status', 'updated']).default('dueDate'),
    direction: z.enum(['asc', 'desc']).default('asc')
  })
  .strict();

export const ProjectListQuery = z
  .object({
    responsibilityId: Id.optional(),
    unassigned: z.coerce.boolean().default(false),
    status: ProjectStatus.optional(),
    /** The derived schedule state; resolved on the server before pagination. */
    schedule: ProjectScheduleState.optional(),
    query: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z
      .enum(['deadline', 'name', 'responsibility', 'owner', 'status', 'schedule', 'priority', 'updated'])
      .default('deadline'),
    direction: z.enum(['asc', 'desc']).default('asc')
  })
  .strict();

export const SearchQuery = z
  .object({ query: z.string().trim().min(1).max(200), limit: z.coerce.number().int().min(1).max(50).default(20) })
  .strict();

export const EditorQuery = z
  .object({
    type: z.enum(['task', 'project', 'member', 'responsibility', 'subproject']),
    id: Id
  })
  .strict();
