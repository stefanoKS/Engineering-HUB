/**
 * Screen payloads. Each one is a single round trip with bounded size; a view never asks the
 * browser to join tables or filter an already paged list.
 */
import { z } from 'zod';
import {
  AuditEntry,
  HealthStatus,
  MemberSummary,
  ProjectSummary,
  RequestQueue,
  ResponsibilityCard,
  Skill,
  TaskRequest,
  TaskSummary
} from './dto';
import { IsoDate, IsoTimestamp, Revision } from './common';
import { ProjectStatus, RequestType, TaskStatus } from './enums';

export const ScopeCounts = z.object({
  workItems: z.number().int().min(0),
  containers: z.number().int().min(0),
  activeWork: z.number().int().min(0),
  openWork: z.number().int().min(0),
  overdueWork: z.number().int().min(0),
  completedWork: z.number().int().min(0),
  cancelledWork: z.number().int().min(0)
});
export type ScopeCounts = z.infer<typeof ScopeCounts>;

export const Reference = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  parentId: z.string().nullable().optional()
});
export type Reference = z.infer<typeof Reference>;

export const TaskIndexEntry = z.object({
  taskId: z.string(),
  taskName: z.string(),
  projectId: z.string(),
  status: TaskStatus,
  parentTaskId: z.string().nullable(),
  dueDate: IsoDate.nullable(),
  revision: Revision
});
export type TaskIndexEntry = z.infer<typeof TaskIndexEntry>;

export const Overview = z.object({
  scope: z.object({
    responsibilityId: z.string(),
    unassigned: z.boolean(),
    label: z.string()
  }),
  counts: ScopeCounts,
  upcoming: z.array(TaskSummary),
  responsibilities: z.array(ResponsibilityCard),
  projects: z.array(ProjectSummary),
  pendingRequests: z.array(TaskRequest),
  generatedAt: IsoTimestamp
});
export type Overview = z.infer<typeof Overview>;

export const Actor = z.object({
  memberId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']),
  active: z.boolean(),
  verified: z.boolean(),
  selfServiceEnabled: z.boolean()
});
export type Actor = z.infer<typeof Actor>;

export const Bootstrap = z.object({
  actor: Actor,
  app: z.object({
    version: z.string(),
    apiVersion: z.string(),
    schemaVersion: z.number().int(),
    defaultLocale: z.enum(['ja', 'en']),
    environment: z.string()
  }),
  references: z.object({
    responsibilities: z.array(Reference),
    members: z.array(MemberSummary),
    skills: z.array(Skill),
    subprojects: z.array(Reference)
  }),
  projects: z.array(ProjectSummary),
  projectLimit: z.number().int().min(1),
  taskIndex: z.array(TaskIndexEntry),
  taskIndexComplete: z.boolean(),
  taskTotal: z.number().int().min(0),
  taskIndexLimit: z.number().int().min(1)
});
export type Bootstrap = z.infer<typeof Bootstrap>;

export const MemberProfileView = z.object({
  member: MemberSummary.extend({
    email: z.string().optional(),
    department: z.string().optional(),
    position: z.string().optional(),
    weeklyCapacityHours: z.number().nullable().optional()
  }),
  current: z.array(TaskSummary),
  previous: z.array(TaskSummary),
  activity: z.array(AuditEntry),
  ownership: z.object({
    current: z.number().int().min(0),
    previous: z.number().int().min(0),
    additionalCurrent: z.number().int().min(0),
    historicalOnly: z.number().int().min(0),
    limitation: z.string(),
    evidence: z.string()
  })
});
export type MemberProfileView = z.infer<typeof MemberProfileView>;

export const WorkloadRow = z.object({
  memberId: z.string(),
  memberName: z.string(),
  weekStart: IsoDate,
  remainingHours: z.number().min(0),
  capacityHours: z.number().min(0),
  utilization: z.number().nullable(),
  unknownEstimateTasks: z.number().int().min(0),
  actualHours: z.number().min(0),
  overdueTasks: z.number().int().min(0),
  overloadWarning: z.boolean()
});
export type WorkloadRow = z.infer<typeof WorkloadRow>;

export const WorkloadReport = z.object({
  weeks: z.array(IsoDate),
  rows: z.array(WorkloadRow),
  asOf: IsoDate
});
export type WorkloadReport = z.infer<typeof WorkloadReport>;

export const PlanPreview = z.object({
  plannedStart: IsoDate.nullable(),
  plannedEnd: IsoDate.nullable(),
  durationWorkingDays: z.number().nullable(),
  warnings: z.array(
    z.object({
      code: z.enum([
        'MISSING_DEADLINE',
        'PAST_DEADLINE',
        'NON_WORKING_DEADLINE',
        'MISSING_DURATION',
        'PAST_START',
        'MILESTONE_OVERLAP'
      ]),
      message: z.string(),
      params: z.record(z.string(), z.string()).optional(),
      requiresAcknowledgement: z.boolean()
    })
  )
});
export type PlanPreview = z.infer<typeof PlanPreview>;

export const AutomationSetting = z.object({
  key: z.string(),
  value: z.string(),
  description: z.string(),
  updatedAt: IsoTimestamp,
  updatedBy: z.string(),
  status: z.string().optional(),
  adminOnly: z.boolean(),
  approved: z.boolean()
});
export type AutomationSetting = z.infer<typeof AutomationSetting>;

export const AutomationSettingsView = z.object({
  settings: z.array(AutomationSetting),
  revision: z.string(),
  effectiveEmailMode: z.enum(['OFF', 'PREVIEW', 'LIVE']),
  emergencyStop: z.boolean(),
  liveRequirements: z.array(z.object({ key: z.string(), satisfied: z.boolean(), detail: z.string() }))
});
export type AutomationSettingsView = z.infer<typeof AutomationSettingsView>;

export const PublicationStatus = z.object({
  enabled: z.boolean(),
  contractVersion: z.string(),
  lastPublishedAt: IsoTimestamp.nullable(),
  lastResult: z.string(),
  lastError: z.string(),
  rows: z.record(z.string(), z.number().int().min(0)),
  hash: z.string(),
  activeSlot: z.enum(['A', 'B', 'NONE']),
  destinationConfigured: z.boolean()
});
export type PublicationStatus = z.infer<typeof PublicationStatus>;

export const StatusView = HealthStatus.extend({
  valid: z.boolean(),
  errorCount: z.number().int().min(0),
  rowCounts: z.record(z.string(), z.number().int().min(0)),
  appVersion: z.string(),
  schemaVersion: z.number().int(),
  migrationVersion: z.number().int(),
  contractVersion: z.string()
});
export type StatusView = z.infer<typeof StatusView>;

export const DeletionPreflight = z.object({
  entityType: z.enum(['PROJECTS', 'SUBPROJECTS', 'TASKS']),
  entityId: z.string(),
  deletable: z.boolean(),
  blockers: z.array(z.object({ code: z.string(), detail: z.string() })),
  dependencyCount: z.number().int().min(0),
  descendantCount: z.number().int().min(0),
  confirmationText: z.string(),
  revision: Revision.nullable()
});
export type DeletionPreflight = z.infer<typeof DeletionPreflight>;

export const EmployeeTask = z.object({
  taskId: z.string(),
  taskName: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  responsibilityName: z.string(),
  status: TaskStatus,
  dueDate: IsoDate.nullable(),
  plannedStart: IsoDate.nullable(),
  ownerName: z.string(),
  assigneeNames: z.array(z.string()),
  container: z.boolean(),
  progressPercent: z.number().min(0).max(100).nullable(),
  reviewState: z.string(),
  completedAt: IsoTimestamp.nullable(),
  pendingRequest: z.boolean(),
  projectAccent: z.string()
});
export type EmployeeTask = z.infer<typeof EmployeeTask>;

export const EmployeeSnapshot = z.object({
  contractVersion: z.string(),
  publishedAt: IsoTimestamp,
  submissionEnabled: z.boolean(),
  submissionClosedMessage: z.string(),
  tasks: z.array(EmployeeTask),
  stale: z.boolean()
});
export type EmployeeSnapshot = z.infer<typeof EmployeeSnapshot>;

export const EmployeeSubmission = z.object({
  requestId: z.string(),
  requestType: RequestType,
  taskId: z.string(),
  submittedAt: IsoTimestamp,
  state: z.enum(['RECEIVED', 'DUPLICATE'])
});
export type EmployeeSubmission = z.infer<typeof EmployeeSubmission>;

export const RequestQueueView = RequestQueue;
export type RequestQueueView = z.infer<typeof RequestQueueView>;

export const ProjectDetail = z.object({
  record: z.unknown(),
  progress: z.unknown(),
  subprojects: z.array(z.unknown()),
  tasks: z.array(TaskSummary),
  milestones: z.array(z.unknown()),
  phases: z.array(z.unknown())
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

export const ProjectStatusFilter = ProjectStatus;
export const TaskStatusFilter = TaskStatus;
