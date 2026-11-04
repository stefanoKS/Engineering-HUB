/**
 * Screen payloads. Each one is a single round trip with bounded size; a view never asks the
 * browser to join tables or filter an already paged list.
 */
import { z } from 'zod';
import {
  AuditEntry,
  HealthStatus,
  MemberSummary,
  ProgressRollup,
  ProjectSummary,
  RequestQueue,
  ResponsibilityCard,
  Skill,
  TaskRequest,
  TaskSummary
} from './dto';
import { Id, IsoDate, IsoTimestamp, Revision, paged } from './common';
import { Priority, ProjectStatus, RequestType, TaskStatus } from './enums';

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
  projectId: z.string().optional(),
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
  upcomingWindow: z.object({
    days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    from: IsoDate,
    to: IsoDate
  }),
  overdue: z.array(TaskSummary),
  overdueTotal: z.number().int().min(0),
  upcoming: z.array(TaskSummary),
  upcomingTotal: z.number().int().min(0),
  responsibilities: z.array(ResponsibilityCard),
  projects: z.array(ProjectSummary),
  pendingRequests: z.array(TaskRequest),
  generatedAt: IsoTimestamp
});
export type Overview = z.infer<typeof Overview>;

export const OverviewQuery = z
  .object({
    responsibilityId: Id.optional(),
    unassigned: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
    upcomingDays: z.coerce
      .number()
      .pipe(z.union([z.literal(7), z.literal(14), z.literal(30)]))
      .default(7)
  })
  .strict();
export type OverviewQuery = z.infer<typeof OverviewQuery>;

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

/**
 * Date-based workload report.
 *
 * Every figure is a task count over calendar dates. There is no hour, capacity or utilisation
 * field: the task system no longer requires an estimate, and a missing estimate is never zero
 * working time.
 */
export const WorkloadMode = z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR', 'CUSTOM']);
export type WorkloadMode = z.infer<typeof WorkloadMode>;

export const WorkloadGranularity = z.enum(['DAY', 'WEEK', 'MONTH']);
export type WorkloadGranularity = z.infer<typeof WorkloadGranularity>;

export const WorkloadDrilldownKind = z.enum([
  'DUE',
  'COMPLETED',
  'OVERDUE',
  'OVERDUE_IN_PERIOD',
  'UNDATED',
  'BACKLOG'
]);
export type WorkloadDrilldownKind = z.infer<typeof WorkloadDrilldownKind>;

export const WorkloadEmployeeSort = z.enum(['overdue', 'due', 'name']);
export type WorkloadEmployeeSort = z.infer<typeof WorkloadEmployeeSort>;

const WORKLOAD_FILTERS = {
  mode: WorkloadMode.default('WEEK'),
  anchor: IsoDate.optional(),
  start: IsoDate.optional(),
  end: IsoDate.optional(),
  memberId: Id.optional(),
  projectId: Id.optional(),
  responsibilityId: Id.optional()
};

/** Query for `GET /api/manager/reports/workload`; the server resolves the period. */
export const WorkloadQuery = z.object({
  ...WORKLOAD_FILTERS,
  granularity: WorkloadGranularity.optional(),
  memberQuery: z.string().trim().max(100).optional(),
  sort: WorkloadEmployeeSort.default('overdue'),
  direction: z.enum(['asc', 'desc']).optional()
});
export type WorkloadQuery = z.infer<typeof WorkloadQuery>;

/** Query for the paginated drilldown behind a summary card, a timeline bar or an employee row. */
export const WorkloadDrilldownQuery = z.object({
  ...WORKLOAD_FILTERS,
  kind: WorkloadDrilldownKind.default('DUE'),
  /** Bounds a timeline bucket; the period still bounds the report itself. */
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});
export type WorkloadDrilldownQuery = z.infer<typeof WorkloadDrilldownQuery>;

export const WorkloadSummary = z.object({
  /** Tasks whose current due date falls inside the period, cancelled work excluded. */
  dueTasks: z.number().int().min(0),
  /** Tasks whose stored completion instant falls inside the period. */
  completedTasks: z.number().int().min(0),
  /** Unfinished tasks whose current due date is before today in Asia/Tokyo. */
  overdueTasks: z.number().int().min(0),
  /** Unfinished tasks with no due date at all. */
  undatedTasks: z.number().int().min(0),
  /** Unfinished tasks due inside the period that are already overdue as of today. */
  overdueWithinPeriod: z.number().int().min(0),
  /** Unfinished tasks already due before the period starts. */
  backlogBeforePeriod: z.number().int().min(0),
  /** Distinct tasks behind the four cards; never the sum of the employee rows. */
  uniqueTasks: z.number().int().min(0),
  /** Employee-task pairs of those tasks: one shared task counts once per assignee here. */
  assignments: z.number().int().min(0)
});
export type WorkloadSummary = z.infer<typeof WorkloadSummary>;

export const WorkloadBucketCounts = z.object({
  key: z.string(),
  start: IsoDate,
  end: IsoDate,
  dueTasks: z.number().int().min(0),
  completedTasks: z.number().int().min(0),
  overdueTasks: z.number().int().min(0)
});
export type WorkloadBucketCounts = z.infer<typeof WorkloadBucketCounts>;

export const WorkloadEmployeeRow = z.object({
  memberId: Id,
  memberName: z.string(),
  active: z.boolean(),
  dueTasks: z.number().int().min(0),
  completedTasks: z.number().int().min(0),
  overdueTasks: z.number().int().min(0),
  undatedTasks: z.number().int().min(0)
});
export type WorkloadEmployeeRow = z.infer<typeof WorkloadEmployeeRow>;

export const WorkloadReport = z.object({
  mode: WorkloadMode,
  /** Inclusive Asia/Tokyo calendar dates the server resolved from the requested mode. */
  start: IsoDate,
  end: IsoDate,
  today: IsoDate,
  granularity: WorkloadGranularity,
  summary: WorkloadSummary,
  buckets: z.array(WorkloadBucketCounts),
  employees: z.array(WorkloadEmployeeRow),
  /**
   * Assignment tables record who is assigned now. The report is therefore a view of current
   * assignments grouped by the selected dates, never a reconstructed historical snapshot.
   */
  assignmentBasis: z.literal('CURRENT_ASSIGNMENTS'),
  generatedAt: IsoTimestamp
});
export type WorkloadReport = z.infer<typeof WorkloadReport>;

export const WorkloadTaskRow = z.object({
  taskId: Id,
  taskName: z.string(),
  projectId: Id,
  projectName: z.string(),
  subprojectName: z.string().nullable(),
  status: TaskStatus,
  dueDate: IsoDate.nullable(),
  completedDate: IsoDate.nullable(),
  assigneeNames: z.array(z.string()),
  revision: Revision
});
export type WorkloadTaskRow = z.infer<typeof WorkloadTaskRow>;

export const WorkloadTaskPage = paged(WorkloadTaskRow).extend({
  kind: WorkloadDrilldownKind,
  from: IsoDate,
  to: IsoDate
});
export type WorkloadTaskPage = z.infer<typeof WorkloadTaskPage>;

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
  erasePlan: z.array(z.object({
    code: z.string(),
    count: z.number().int().min(0),
    detail: z.string()
  })).optional(),
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
  displayStatus: z.enum(['IN_PROGRESS', 'OVERDUE', 'DONE', 'CANCELLED']),
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

/** One row of the member's own work list. Only the member's own assignment is present. */
export const MyWorkItem = z.object({
  container: z.boolean(),
  taskId: z.string(),
  taskName: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  subprojectName: z.string(),
  status: TaskStatus,
  displayStatus: z.enum(['IN_PROGRESS', 'OVERDUE', 'DONE', 'CANCELLED']),
  priority: z.string(),
  dueDate: IsoDate.nullable(),
  progressPercent: z.number().nullable(),
  actualHours: z.number().nullable(),
  reviewState: z.enum(['NONE', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'STALE']),
  lastRequestStatus: z.string(),
  lastRequestType: z.string(),
  pendingRequest: z.boolean(),
  creationChannel: z.enum(['LEGACY', 'MANAGER', 'MEMBER']),
  completedAt: IsoTimestamp.nullable(),
  revision: Revision
});
export type MyWorkItem = z.infer<typeof MyWorkItem>;

export const MyWorkList = z.object({
  items: z.array(MyWorkItem),
  /** Total for the requested section, never a browser-side split of a mixed page. */
  total: z.number().int().min(0),
  activeTotal: z.number().int().min(0),
  completedTotal: z.number().int().min(0)
});
export type MyWorkList = z.infer<typeof MyWorkList>;

/** The active projects (and their non-archived subprojects) a member may file work under. */
export const MyWorkProjectOption = z.object({
  projectId: z.string(),
  projectName: z.string(),
  responsibilityName: z.string(),
  subprojects: z.array(z.object({ subprojectId: z.string(), subprojectName: z.string() }))
});
export type MyWorkProjectOption = z.infer<typeof MyWorkProjectOption>;

export const MyWorkProjectOptions = z.object({
  items: z.array(MyWorkProjectOption),
  taskCreationEnabled: z.boolean()
});
export type MyWorkProjectOptions = z.infer<typeof MyWorkProjectOptions>;

/**
 * A member's own request receipt. It carries state only: never a manager note, a reviewer
 * address or another member's submission.
 */
export const MemberRequest = z.object({
  requestId: z.string(),
  requestType: RequestType,
  taskId: z.string(),
  taskName: z.string(),
  projectName: z.string(),
  status: z.string(),
  submittedAt: IsoTimestamp,
  decidedAt: IsoTimestamp.nullable(),
  decisionNote: z.string(),
  staleReason: z.string(),
  revision: Revision
});
export type MemberRequest = z.infer<typeof MemberRequest>;

export const MemberRequests = z.object({
  items: z.array(MemberRequest),
  submissionEnabled: z.boolean()
});
export type MemberRequests = z.infer<typeof MemberRequests>;

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

/** One local login account, as the administration screen sees it (never a password hash). */
export const LocalAccount = z.object({
  employeeId: z.string(),
  memberId: z.string(),
  name: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']),
  active: z.boolean(),
  mustChangePassword: z.boolean()
});
export type LocalAccount = z.infer<typeof LocalAccount>;

export const LocalAccountList = z.object({
  items: z.array(LocalAccount),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(1)
});
export type LocalAccountList = z.infer<typeof LocalAccountList>;

/** An existing member without a login, which an administrator may link a new account to. */
export const LinkableMember = z.object({
  memberId: z.string(),
  name: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']),
  active: z.boolean(),
  employeeId: z.string().nullable()
});
export type LinkableMember = z.infer<typeof LinkableMember>;

export const LinkableMemberList = z.object({
  items: z.array(LinkableMember),
  total: z.number().int().min(0)
});
export type LinkableMemberList = z.infer<typeof LinkableMemberList>;

/**
 * Read-only project projection for MEMBER and VIEWER.
 *
 * It carries only what the permitted screens render: identity, name, description, responsibility,
 * owner name, status, priority, deadline, health, derived progress and the TaskScope counts for
 * open and completed work. Notification settings, the dashboard summary, milestones, phases,
 * internal notes and the next action are absent rather than filtered in the browser.
 */
export const WorkProject = z.object({
  projectId: z.string(),
  projectName: z.string(),
  description: z.string(),
  responsibilityName: z.string(),
  projectOwnerName: z.string(),
  status: ProjectStatus,
  priority: Priority,
  committedDeadline: IsoDate.nullable(),
  progressPercent: z.number().min(0).max(100).nullable(),
  health: z.string(),
  /** Open leaf work in active work; a container task is never counted. */
  activeTaskCount: z.number().int().min(0),
  /** Completed leaf work, reported separately and never mixed into the open figure. */
  completedTaskCount: z.number().int().min(0)
});
export type WorkProject = z.infer<typeof WorkProject>;

export const WorkResponsibilityOption = z.object({
  responsibilityId: z.string(),
  name: z.string()
});
export type WorkResponsibilityOption = z.infer<typeof WorkResponsibilityOption>;

export const WorkProjectList = z.object({
  items: z.array(WorkProject),
  /** The responsibilities that group at least one readable project, for the member filter. */
  responsibilities: z.array(WorkResponsibilityOption),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0)
});
export type WorkProjectList = z.infer<typeof WorkProjectList>;

export const WorkSubproject = z.object({
  subprojectId: z.string(),
  subprojectName: z.string(),
  description: z.string(),
  parentSubprojectId: z.string().nullable(),
  status: ProjectStatus,
  deadline: IsoDate.nullable(),
  depth: z.number().int().min(1),
  progress: ProgressRollup
});
export type WorkSubproject = z.infer<typeof WorkSubproject>;

export const WorkProjectDetail = z.object({
  record: WorkProject,
  progress: ProgressRollup,
  subprojects: z.array(WorkSubproject),
  tasks: z.array(TaskSummary)
});
export type WorkProjectDetail = z.infer<typeof WorkProjectDetail>;

/** A read-only page of active work for any signed-in role (MEMBER and VIEWER never mutate). */
export const WorkTaskPage = z.object({
  items: z.array(TaskSummary),
  matchedTotal: z.number().int().min(0).optional(),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0)
});
export type WorkTaskPage = z.infer<typeof WorkTaskPage>;
