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
    acknowledgeNonWorking: z.boolean().optional()
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

export const CreateSubprojectBody = z
  .object({
    idempotencyKey: IdempotencyKey,
    projectId: Id,
    parentSubprojectId: Id.nullable().optional(),
    subprojectName: Text(200).min(1),
    ownerId: Id.nullable().optional(),
    status: ProjectStatus.optional(),
    plannedStart: NullableIsoDate.optional(),
    plannedEnd: NullableIsoDate.optional(),
    deadline: NullableIsoDate.optional(),
    estimatedHours: z.number().min(0).max(1000000).nullable().optional(),
    nextAction: Text(500).optional()
  })
  .strict();

export const PatchSubprojectBody = z
  .object({
    revision: Revision,
    projectId: Id.optional(),
    parentSubprojectId: Id.nullable().optional(),
    subprojectName: Text(200).min(1).optional(),
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
    sortOrder: z.number().int().min(0).max(100000)
  })
  .strict();

export const ConfirmReasonBody = z
  .object({
    revision: Revision,
    confirmed: Confirm,
    reason: Text(1000).optional()
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
  .object({ includeDecided: z.coerce.boolean().default(false) })
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
    projectId: Id.optional(),
    subprojectId: Id.optional(),
    responsibilityId: Id.optional(),
    unassigned: z.coerce.boolean().default(false),
    status: TaskStatus.optional(),
    ownerMemberId: Id.optional(),
    query: z.string().trim().max(200).optional(),
    containerOnly: z.coerce.boolean().default(false),
    overdueOnly: z.coerce.boolean().default(false),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(['dueDate', 'priority', 'name', 'status', 'updated']).default('dueDate'),
    direction: z.enum(['asc', 'desc']).default('asc')
  })
  .strict();

export const ProjectListQuery = z
  .object({
    responsibilityId: Id.optional(),
    unassigned: z.coerce.boolean().default(false),
    status: ProjectStatus.optional(),
    query: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(['deadline', 'name', 'status', 'priority', 'updated']).default('deadline'),
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
