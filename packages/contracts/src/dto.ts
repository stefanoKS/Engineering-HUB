/**
 * Narrow, explicitly allowlisted DTOs.
 *
 * A DTO is the only thing that leaves the API. Private fields (member e-mail for viewers,
 * assessments, audit payloads, request text on the employee endpoint) are never added to a
 * response object and filtered later - they are absent from the query projection.
 */
import { z } from 'zod';
import {
  DashboardVisibility,
  DivisionAccessKind,
  DivisionStatus,
  DurationBasis,
  DurationUnit,
  IssueSeverity,
  IssueStatus,
  NotificationResult,
  PhaseStatus,
  PlannedStartSource,
  Priority,
  ProjectScheduleState,
  ProjectStatus,
  RequestStatus,
  ScheduleMissingPart,
  RequestType,
  ResponsibilityStatus,
  Role,
  TaskStatus
} from './enums';
import { Id, IsoDate, IsoTimestamp, Revision } from './common';

/** One member/division relationship as an administrator edits it. */
export const DivisionGrant = z.object({
  divisionId: Id,
  accessKind: DivisionAccessKind
});
export type DivisionGrant = z.infer<typeof DivisionGrant>;

/**
 * An administrator-managed division (課).
 *
 * The identifier is stable and never derived from the name, so renaming a division never rewrites
 * a project, a task, an audit row or a published identifier.
 */
export const Division = z.object({
  divisionId: Id,
  name: z.string(),
  status: DivisionStatus,
  sortOrder: z.number().int(),
  retiredAt: IsoTimestamp.nullable(),
  revision: Revision,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
});
export type Division = z.infer<typeof Division>;

/** The narrow reference a selector and a project form read. */
export const DivisionReference = z.object({
  divisionId: Id,
  name: z.string(),
  status: DivisionStatus,
  sortOrder: z.number().int().optional()
});
export type DivisionReference = z.infer<typeof DivisionReference>;

export const Member = z.object({
  memberId: Id,
  name: z.string(),
  email: z.string().optional(),
  department: z.string().optional(),
  position: z.string().optional(),
  active: z.boolean(),
  managerId: z.string().nullable(),
  weeklyCapacityHours: z.number().nullable().optional(),
  role: Role,
  /** The login identifier when a local account exists; never a password or a hash. */
  employeeId: z.string().optional(),
  /** Active memberships and additional read grants, so the editor shows the stored reality. */
  divisionGrants: z.array(DivisionGrant).optional(),
  /** GENERAL_MANAGER oversight of every division, including future ones. */
  allDivisionsRead: z.boolean().optional(),
  revision: Revision,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
});
export type Member = z.infer<typeof Member>;

export const MemberSummary = z.object({
  memberId: Id,
  name: z.string(),
  active: z.boolean(),
  role: Role,
  /** The login identifier, when a local account exists. Absent for a member without a login. */
  employeeId: z.string().optional(),
  /**
   * Division display names only. They disambiguate two people who share a display name; a member
   * identifier, an e-mail address and an access kind never appear here.
   */
  divisionNames: z.array(z.string()).optional(),
  /**
   * Identifiers of the divisions where this person holds a WORK membership, so an assignment
   * selector can offer only the people eligible for the target work. The server re-validates
   * every selected identifier; a filtered list is never the authorization.
   */
  workDivisionIds: z.array(z.string()).optional()
});
export type MemberSummary = z.infer<typeof MemberSummary>;

export const ResponsibilityMember = z.object({
  memberId: Id,
  name: z.string(),
  active: z.boolean(),
  assignedAt: IsoTimestamp,
  assignedBy: z.string(),
  primary: z.boolean()
});
export type ResponsibilityMember = z.infer<typeof ResponsibilityMember>;

export const Responsibility = z.object({
  responsibilityId: Id,
  name: z.string(),
  description: z.string(),
  /** The division this area belongs to; a project in the area can never sit in another one. */
  divisionId: z.string().nullable(),
  divisionName: z.string(),
  ownerMemberId: z.string().nullable(),
  ownerName: z.string(),
  status: ResponsibilityStatus,
  sortOrder: z.number().int(),
  color: z.string(),
  retiredAt: IsoTimestamp.nullable(),
  revision: Revision,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  additionalMemberIds: z.array(Id),
  members: z.array(ResponsibilityMember)
});
export type Responsibility = z.infer<typeof Responsibility>;

export const ResponsibilityCard = z.object({
  responsibilityId: z.string(),
  name: z.string(),
  color: z.string(),
  ownerName: z.string(),
  status: ResponsibilityStatus,
  projectCount: z.number().int().min(0),
  openWork: z.number().int().min(0),
  overdueWork: z.number().int().min(0),
  completedWork: z.number().int().min(0),
  cancelledWork: z.number().int().min(0),
  containers: z.number().int().min(0),
  progressPercent: z.number().min(0).max(100).nullable()
});
export type ResponsibilityCard = z.infer<typeof ResponsibilityCard>;

/**
 * The displayed schedule status of one project. Calculated by the server from the plan dates and
 * the Asia/Tokyo business date; never persisted and never accepted from a browser.
 */
export const ProjectScheduleDisplay = z.object({
  state: ProjectScheduleState,
  missing: ScheduleMissingPart
});
export type ProjectScheduleDisplay = z.infer<typeof ProjectScheduleDisplay>;

export const Project = z.object({
  projectId: Id,
  projectName: z.string(),
  description: z.string(),
  category: z.string(),
  /** The canonical division of the work. Tasks and subprojects derive it through this project. */
  divisionId: z.string().nullable(),
  divisionName: z.string(),
  responsibilityId: z.string().nullable(),
  responsibilityName: z.string(),
  projectOwnerId: z.string().nullable(),
  projectOwnerName: z.string(),
  /** The stored lifecycle fact; display uses `schedule` instead of this value. */
  status: ProjectStatus,
  /** Derived from the plan dates and today's business date; never stored. */
  schedule: ProjectScheduleDisplay,
  priority: Priority,
  plannedStart: IsoDate.nullable(),
  forecastEnd: IsoDate.nullable(),
  committedDeadline: IsoDate.nullable(),
  originalDeadline: IsoDate.nullable(),
  actualCompletion: IsoDate.nullable(),
  progressPercent: z.number().min(0).max(100).nullable(),
  health: z.string(),
  nextMilestone: z.string(),
  nextAction: z.string(),
  notificationEnabled: z.boolean(),
  dashboardVisibility: DashboardVisibility,
  dashboardSummary: z.string(),
  archivedAt: IsoTimestamp.nullable(),
  revision: Revision,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
});
export type Project = z.infer<typeof Project>;

export const ProjectSummary = z.object({
  projectId: Id,
  projectName: z.string(),
  divisionId: z.string().nullable(),
  divisionName: z.string(),
  responsibilityId: z.string().nullable(),
  responsibilityName: z.string(),
  projectOwnerId: z.string().nullable(),
  status: ProjectStatus,
  /** The badge a list, card or filter shows: derived, never the stored lifecycle value. */
  schedule: ProjectScheduleDisplay,
  priority: Priority,
  committedDeadline: IsoDate.nullable(),
  deadlineState: z.enum(['NONE', 'OK', 'DUE_SOON', 'OVERDUE', 'COMPLETED']),
  progressPercent: z.number().min(0).max(100).nullable(),
  health: z.string(),
  nextAction: z.string(),
  dashboardVisibility: DashboardVisibility,
  containerCount: z.number().int().min(0),
  openWork: z.number().int().min(0),
  overdueWork: z.number().int().min(0),
  /**
   * Server-computed availability of a write on *this* record, resolved from the caller's division
   * scope before paging. It is a presentation aid for a mixed or all-division list: a manager who
   * may only read one division must not be offered an edit there. It is never authority - every
   * command re-checks the scope on the server - and it is absent on a read-only projection.
   */
  canWrite: z.boolean().optional(),
  revision: Revision
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProgressRollup = z.object({
  tasks: z.number().int().min(0),
  containers: z.number().int().min(0),
  leaves: z.number().int().min(0),
  doneLeaves: z.number().int().min(0),
  cancelledLeaves: z.number().int().min(0),
  weightTotal: z.number().min(0),
  weightDone: z.number().min(0),
  percent: z.number().min(0).max(100).nullable(),
  unknownEffort: z.number().int().min(0)
});
export type ProgressRollup = z.infer<typeof ProgressRollup>;

export const Subproject = z.object({
  subprojectId: Id,
  projectId: Id,
  parentSubprojectId: z.string().nullable(),
  subprojectName: z.string(),
  description: z.string(),
  ownerId: z.string().nullable(),
  ownerName: z.string(),
  status: ProjectStatus,
  /** Derived schedule badge; a subproject does not store a second lifecycle enum. */
  schedule: ProjectScheduleDisplay,
  plannedStart: IsoDate.nullable(),
  plannedEnd: IsoDate.nullable(),
  deadline: IsoDate.nullable(),
  progressPercent: z.number().min(0).max(100).nullable(),
  estimatedHours: z.number().nullable(),
  nextAction: z.string(),
  depth: z.number().int().min(1),
  progress: ProgressRollup.optional(),
  revision: Revision,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
});
export type Subproject = z.infer<typeof Subproject>;

export const DeadlineState = z.enum(['NONE', 'OK', 'DUE_SOON', 'OVERDUE', 'COMPLETED']);
export type DeadlineState = z.infer<typeof DeadlineState>;

export const ReviewState = z.enum(['NONE', 'PENDING', 'APPROVED', 'STALE']);
export type ReviewState = z.infer<typeof ReviewState>;

/**
 * The displayed task schedule state.
 *
 * Derived from the plan dates (`plannedStart`, `dueDate`) and the Asia/Tokyo business date at read
 * time; it is never stored, never accepted from a browser and never advanced by a scheduled job.
 * The stored `TaskStatus` value stays the workflow fact (assignment, blocking, completion) and is
 * a secondary detail, never the primary schedule badge. `OVERDUE` keeps its existing semantic
 * identifier for 遅延, and `INVALID_DATES` is a schedule-data warning rather than a lifecycle
 * state.
 */
export const DisplayTaskStatus = z.enum([
  'DONE',
  'CANCELLED',
  'INVALID_DATES',
  'OVERDUE',
  'PLANNED',
  'IN_PROGRESS',
  'START_NOT_SET',
  'DATES_NOT_SET'
]);
export type DisplayTaskStatus = z.infer<typeof DisplayTaskStatus>;

export const Task = z.object({
  taskId: Id,
  projectId: Id,
  subprojectId: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  taskName: z.string(),
  description: z.string(),
  ownerMemberId: z.string().nullable(),
  ownerName: z.string(),
  status: TaskStatus,
  /** Derived from the plan dates and the business date; never persisted. */
  displayStatus: DisplayTaskStatus,
  /** Which plan boundary the display state had to state as missing; a detail, not a state. */
  scheduleMissing: ScheduleMissingPart.optional(),
  priority: Priority,
  plannedStart: IsoDate.nullable(),
  dueDate: IsoDate.nullable(),
  estimatedHours: z.number().nullable(),
  actualHours: z.number().nullable(),
  progressPercent: z.number().min(0).max(100).nullable(),
  dependencyIds: z.array(Id),
  acceptanceCriteria: z.string(),
  nextAction: z.string(),
  requiredSkillId: z.string().nullable(),
  requiredSkillLevel: z.number().int().nullable(),
  assignmentVersion: z.number().int().min(1),
  assignmentApprovedAt: IsoTimestamp.nullable(),
  notificationEnabled: z.boolean(),
  notificationBaseline: z.string(),
  publicNote: z.string(),
  plannedDurationValue: z.number().nullable(),
  plannedDurationUnit: DurationUnit.nullable(),
  plannedDurationBasis: DurationBasis.nullable(),
  plannedStartSource: PlannedStartSource.nullable(),
  completedAt: IsoTimestamp.nullable(),
  createdByMemberId: z.string().nullable().optional(),
  creationChannel: z.enum(['LEGACY', 'MANAGER', 'MEMBER']).optional(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  revision: Revision
});
export type Task = z.infer<typeof Task>;

export const TaskSummary = z.object({
  taskId: Id,
  projectId: Id,
  projectName: z.string(),
  subprojectId: z.string().nullable(),
  responsibilityId: z.string().nullable(),
  parentTaskId: z.string().nullable(),
  taskName: z.string(),
  status: TaskStatus,
  displayStatus: DisplayTaskStatus,
  scheduleMissing: ScheduleMissingPart.optional(),
  priority: Priority,
  ownerMemberId: z.string().nullable(),
  ownerName: z.string(),
  assigneeNames: z.array(z.string()),
  /** Every active assignee, primary owner included, deduplicated in a stable order. */
  assigneeIds: z.array(Id),
  dueDate: IsoDate.nullable(),
  plannedStart: IsoDate.nullable(),
  progressPercent: z.number().min(0).max(100).nullable(),
  container: z.boolean(),
  /** Tree rows included only to provide a path to matching descendants. */
  contextOnly: z.boolean().optional(),
  depth: z.number().int().min(1),
  reviewState: ReviewState,
  overdue: z.boolean(),
  deadlineState: DeadlineState,
  /**
   * Server-computed availability of a write on this task, resolved through its project's division
   * before paging. A presentation aid for a mixed or all-division list, never authority: every
   * command re-checks the division on the server. Absent on a read-only projection.
   */
  canWrite: z.boolean().optional(),
  revision: Revision
});
export type TaskSummary = z.infer<typeof TaskSummary>;

export const TaskDetail = z.object({
  record: Task,
  /**
   * Display-only context: the project name and the subproject chain (root first). It carries no
   * owner, deadline or other private field, so the read-only task screen can show the same
   * breadcrumb a manager sees.
   */
  context: z.object({
    projectId: Id,
    projectName: z.string(),
    subprojects: z.array(z.object({ subprojectId: z.string(), subprojectName: z.string() }))
  }),
  assignees: z.array(ResponsibilityMember),
  additionalAssigneeIds: z.array(Id),
  /** The unified effective assignment: primary owner plus active additional assignees. */
  assigneeIds: z.array(Id),
  assigneeHistory: z.array(ResponsibilityMember),
  confirmations: z.array(
    z.object({
      scheduleConfirmationId: Id,
      taskId: Id,
      active: z.boolean(),
      version: z.number().int(),
      plannedStart: IsoDate.nullable(),
      dueDate: IsoDate.nullable(),
      estimatedHours: z.number().nullable(),
      confirmedAt: IsoTimestamp,
      confirmedBy: z.string(),
      notes: z.string()
    })
  ),
  deadlineHistory: z.array(
    z.object({
      historyId: Id,
      previousDueDate: IsoDate.nullable(),
      newDueDate: IsoDate.nullable(),
      previousPlannedStart: IsoDate.nullable(),
      newPlannedStart: IsoDate.nullable(),
      reason: z.string(),
      changedAt: IsoTimestamp,
      changedBy: z.string(),
      source: z.string()
    })
  ),
  children: z.array(TaskSummary),
  /** Hierarchy depth of this task (1 = top level), used to explain child-task eligibility. */
  depth: z.number().int().min(1),
  /** Whether this record may be written by the caller; a presentation aid, never authority. */
  canWrite: z.boolean().optional()
});
export type TaskDetail = z.infer<typeof TaskDetail>;

export const Skill = z.object({
  skillId: Id,
  skillName: z.string(),
  category: z.string(),
  description: z.string(),
  requiredLevel: z.number().int().nullable()
});
export type Skill = z.infer<typeof Skill>;

export const SkillAssessment = z.object({
  memberSkillId: Id,
  memberId: Id,
  memberName: z.string(),
  skillId: Id,
  skillName: z.string(),
  currentLevel: z.number().int(),
  assessmentDate: IsoDate.nullable(),
  assessedBy: z.string().nullable(),
  evidence: z.string(),
  trainingAction: z.string(),
  nextReviewDate: IsoDate.nullable()
});
export type SkillAssessment = z.infer<typeof SkillAssessment>;

export const Milestone = z.object({
  milestoneId: Id,
  projectId: Id,
  subprojectId: z.string().nullable(),
  milestoneName: z.string(),
  ownerId: z.string().nullable(),
  targetDate: IsoDate.nullable(),
  actualDate: IsoDate.nullable(),
  gateType: z.string(),
  status: z.string(),
  acceptanceCriteria: z.string(),
  verificationResult: z.string()
});
export type Milestone = z.infer<typeof Milestone>;

export const Issue = z.object({
  issueId: Id,
  projectId: Id,
  subprojectId: z.string().nullable(),
  taskId: z.string().nullable(),
  description: z.string(),
  severity: IssueSeverity,
  status: IssueStatus,
  ownerId: z.string().nullable(),
  raisedDate: IsoDate.nullable(),
  targetCloseDate: IsoDate.nullable(),
  correctiveAction: z.string()
});
export type Issue = z.infer<typeof Issue>;

export const TaskRequest = z.object({
  requestId: Id,
  /** Display-only task context, so a reviewer can judge the request without opening the task. */
  taskName: z.string(),
  projectName: z.string(),
  subprojectName: z.string(),
  requestType: RequestType,
  taskId: Id,
  projectId: z.string().nullable(),
  requesterName: z.string(),
  submittedAt: IsoTimestamp,
  originalDueDate: IsoDate.nullable(),
  requestedDueDate: IsoDate.nullable(),
  reason: z.string(),
  explanation: z.string(),
  completionNote: z.string(),
  status: RequestStatus,
  reviewer: z.string(),
  decidedAt: IsoTimestamp.nullable(),
  decisionNote: z.string(),
  taskRevisionAtSubmission: z.string(),
  dueDateAtSubmission: IsoDate.nullable(),
  reportedCompletionAt: IsoTimestamp.nullable(),
  acceptedCompletionAt: IsoTimestamp.nullable(),
  inboxRequestId: z.string(),
  importedAt: IsoTimestamp.nullable(),
  snapshotVersion: z.string(),
  staleReason: z.string(),
  requesterMemberId: z.string().nullable().optional(),
  revision: Revision
});
export type TaskRequest = z.infer<typeof TaskRequest>;

export const RequestQueue = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().min(1),
  items: z.array(TaskRequest),
  total: z.number().int().min(0),
  imported: z.object({
    attempted: z.boolean(),
    configured: z.boolean(),
    imported: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    failed: z.number().int().min(0),
    message: z.string()
  })
});
export type RequestQueue = z.infer<typeof RequestQueue>;

export const ScheduleConfirmation = z.object({
  scheduleConfirmationId: Id,
  taskId: Id,
  active: z.boolean(),
  version: z.number().int(),
  plannedStart: IsoDate.nullable(),
  dueDate: IsoDate.nullable(),
  estimatedHours: z.number().nullable(),
  confirmedAt: IsoTimestamp,
  confirmedBy: z.string(),
  notes: z.string()
});
export type ScheduleConfirmation = z.infer<typeof ScheduleConfirmation>;

export const ProjectPhase = z.object({
  projectPhaseId: Id,
  projectId: Id,
  phaseId: z.string().nullable(),
  phaseName: z.string(),
  phaseOrder: z.number().int(),
  durationDays: z.number().nullable(),
  bufferDays: z.number().nullable(),
  dependencyIds: z.array(Id),
  plannedStart: IsoDate.nullable(),
  plannedEnd: IsoDate.nullable(),
  status: PhaseStatus,
  committedDeadline: IsoDate.nullable(),
  planVersion: z.number().int(),
  active: z.boolean()
});
export type ProjectPhase = z.infer<typeof ProjectPhase>;

export const AuditEntry = z.object({
  auditId: z.string(),
  occurredAt: IsoTimestamp,
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  previousValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  actor: z.string(),
  result: z.string(),
  correlationId: z.string().nullable()
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const NotificationEntry = z.object({
  notificationId: z.string(),
  notificationKey: z.string(),
  taskId: z.string().nullable(),
  recipient: z.string(),
  notificationType: z.string(),
  assignmentVersion: z.number().int().nullable(),
  createdAt: IsoTimestamp,
  sentAt: IsoTimestamp.nullable(),
  result: NotificationResult,
  errorDetails: z.string(),
  reconciledAt: IsoTimestamp.nullable(),
  reconciledBy: z.string()
});
export type NotificationEntry = z.infer<typeof NotificationEntry>;

export const HealthStatus = z.object({
  status: z.enum(['ok', 'degraded', 'fail']),
  version: z.string(),
  schemaVersion: z.number().int(),
  environment: z.string(),
  database: z.enum(['ok', 'fail']),
  outbox: z.object({
    pending: z.number().int().min(0),
    leased: z.number().int().min(0),
    failed: z.number().int().min(0),
    oldestPendingAt: IsoTimestamp.nullable()
  }),
  emailMode: z.enum(['OFF', 'PREVIEW', 'LIVE']),
  emergencyStop: z.boolean(),
  calendarEnabled: z.boolean(),
  dashboardPublicationEnabled: z.boolean(),
  lastBackupAt: IsoTimestamp.nullable(),
  lastBackupOk: z.boolean(),
  backup: z
    .object({
      lastLocalAt: IsoTimestamp.nullable(),
      lastLocalOk: z.boolean(),
      lastDriveAt: IsoTimestamp.nullable(),
      lastFailureAt: IsoTimestamp.nullable(),
      lastFailure: z.string()
    })
    .optional()
});
export type HealthStatus = z.infer<typeof HealthStatus>;
