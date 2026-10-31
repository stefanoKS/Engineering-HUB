/**
 * Row -> DTO mapping.
 *
 * Every query lists its columns explicitly; no `SELECT *` reaches a response. This module is
 * the one place where a stored snake_case row becomes a camelCase contract object, so a column
 * that is not mapped here cannot leak by accident.
 */
import type {
  Member,
  Project,
  Responsibility,
  Skill,
  Subproject,
  Task,
  TaskRequest
} from '@eh/contracts';
import { effectiveRole } from '@eh/domain';

export type MemberRow = {
  member_id: string;
  name: string;
  email: string;
  department: string;
  position: string;
  active: boolean;
  manager_id: string | null;
  weekly_capacity_hours: number | null;
  role: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
};

export function toMember(row: MemberRow): Member {
  return {
    memberId: row.member_id,
    name: row.name,
    email: row.email,
    department: row.department,
    position: row.position,
    active: row.active,
    managerId: row.manager_id,
    weeklyCapacityHours: row.weekly_capacity_hours,
    role: effectiveRole(row.role),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type ResponsibilityRow = {
  responsibility_id: string;
  name: string;
  description: string;
  owner_member_id: string | null;
  owner_name: string | null;
  status: 'Active' | 'Retired';
  sort_order: number;
  color_hex: string | null;
  retired_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export function toResponsibility(
  row: ResponsibilityRow,
  members: Responsibility['members'] = []
): Responsibility {
  return {
    responsibilityId: row.responsibility_id,
    name: row.name,
    description: row.description,
    ownerMemberId: row.owner_member_id,
    ownerName: row.owner_name ?? '',
    status: row.status,
    sortOrder: row.sort_order,
    color: row.color_hex ?? '',
    retiredAt: row.retired_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    additionalMemberIds: members.filter((member) => !member.primary).map((member) => member.memberId),
    members
  };
}

export type ProjectRow = {
  project_id: string;
  project_name: string;
  description: string;
  category: string;
  responsibility_id: string | null;
  responsibility_name: string | null;
  project_owner_id: string | null;
  project_owner_name: string | null;
  status: Project['status'];
  priority: Project['priority'];
  planned_start: string | null;
  forecast_end: string | null;
  committed_deadline: string | null;
  original_deadline: string | null;
  actual_completion: string | null;
  progress_percent: number | null;
  health: string;
  next_milestone: string;
  next_action: string;
  notification_enabled: boolean;
  dashboard_visibility: Project['dashboardVisibility'];
  dashboard_summary: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
};

export function toProject(row: ProjectRow): Project {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    description: row.description,
    category: row.category,
    responsibilityId: row.responsibility_id,
    responsibilityName: row.responsibility_name ?? '',
    projectOwnerId: row.project_owner_id,
    projectOwnerName: row.project_owner_name ?? '',
    status: row.status,
    priority: row.priority,
    plannedStart: row.planned_start,
    forecastEnd: row.forecast_end,
    committedDeadline: row.committed_deadline,
    originalDeadline: row.original_deadline,
    actualCompletion: row.actual_completion,
    progressPercent: row.progress_percent,
    health: row.health,
    nextMilestone: row.next_milestone,
    nextAction: row.next_action,
    notificationEnabled: row.notification_enabled,
    dashboardVisibility: row.dashboard_visibility,
    dashboardSummary: row.dashboard_summary,
    archivedAt: row.archived_at,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type TaskRow = {
  task_id: string;
  project_id: string;
  subproject_id: string | null;
  parent_task_id: string | null;
  task_name: string;
  description: string;
  owner_member_id: string | null;
  owner_name: string | null;
  status: Task['status'];
  priority: Task['priority'];
  planned_start: string | null;
  due_date: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  progress_percent: number | null;
  acceptance_criteria: string;
  next_action: string;
  required_skill_id: string | null;
  required_skill_level: number | null;
  assignment_version: number;
  assignment_approved_at: string | null;
  notification_enabled: boolean;
  notification_baseline: string;
  public_note: string;
  planned_duration_value: number | null;
  planned_duration_unit: Task['plannedDurationUnit'];
  planned_duration_basis: Task['plannedDurationBasis'];
  planned_start_source: Task['plannedStartSource'];
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  dependency_ids?: string[] | null;
};

export function toTask(row: TaskRow): Task {
  return {
    taskId: row.task_id,
    projectId: row.project_id,
    subprojectId: row.subproject_id,
    parentTaskId: row.parent_task_id,
    taskName: row.task_name,
    description: row.description,
    ownerMemberId: row.owner_member_id,
    ownerName: row.owner_name ?? '',
    status: row.status,
    priority: row.priority,
    plannedStart: row.planned_start,
    dueDate: row.due_date,
    estimatedHours: row.estimated_hours,
    actualHours: row.actual_hours,
    progressPercent: row.progress_percent,
    dependencyIds: row.dependency_ids ?? [],
    acceptanceCriteria: row.acceptance_criteria,
    nextAction: row.next_action,
    requiredSkillId: row.required_skill_id,
    requiredSkillLevel: row.required_skill_level,
    assignmentVersion: row.assignment_version,
    assignmentApprovedAt: row.assignment_approved_at,
    notificationEnabled: row.notification_enabled,
    notificationBaseline: row.notification_baseline,
    publicNote: row.public_note,
    plannedDurationValue: row.planned_duration_value,
    plannedDurationUnit: row.planned_duration_unit,
    plannedDurationBasis: row.planned_duration_basis,
    plannedStartSource: row.planned_start_source,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision
  };
}

export type SubprojectRow = {
  subproject_id: string;
  project_id: string;
  parent_subproject_id: string | null;
  subproject_name: string;
  owner_id: string | null;
  owner_name: string | null;
  status: Subproject['status'];
  planned_start: string | null;
  planned_end: string | null;
  deadline: string | null;
  progress_percent: number | null;
  estimated_hours: number | null;
  next_action: string;
  depth: number;
  revision: number;
  created_at: string;
  updated_at: string;
};

export function toSubproject(row: SubprojectRow): Subproject {
  return {
    subprojectId: row.subproject_id,
    projectId: row.project_id,
    parentSubprojectId: row.parent_subproject_id,
    subprojectName: row.subproject_name,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? '',
    status: row.status,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    deadline: row.deadline,
    progressPercent: row.progress_percent,
    estimatedHours: row.estimated_hours,
    nextAction: row.next_action,
    depth: row.depth,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type RequestRow = {
  request_id: string;
  request_type: TaskRequest['requestType'];
  task_id: string;
  project_id: string | null;
  requester_name: string;
  submitted_at: string;
  original_due_date: string | null;
  requested_due_date: string | null;
  reason: string;
  explanation: string;
  completion_note: string;
  status: TaskRequest['status'];
  reviewer: string;
  decided_at: string | null;
  decision_note: string;
  task_revision_at_submission: string;
  due_date_at_submission: string | null;
  reported_completion_at: string | null;
  accepted_completion_at: string | null;
  inbox_request_id: string | null;
  imported_at: string | null;
  snapshot_version: string;
  stale_reason: string;
  revision: number;
};

export function toRequest(row: RequestRow): TaskRequest {
  return {
    requestId: row.request_id,
    requestType: row.request_type,
    taskId: row.task_id,
    projectId: row.project_id,
    requesterName: row.requester_name,
    submittedAt: row.submitted_at,
    originalDueDate: row.original_due_date,
    requestedDueDate: row.requested_due_date,
    reason: row.reason,
    explanation: row.explanation,
    completionNote: row.completion_note,
    status: row.status,
    reviewer: row.reviewer,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    taskRevisionAtSubmission: row.task_revision_at_submission,
    dueDateAtSubmission: row.due_date_at_submission,
    reportedCompletionAt: row.reported_completion_at,
    acceptedCompletionAt: row.accepted_completion_at,
    inboxRequestId: row.inbox_request_id ?? '',
    importedAt: row.imported_at,
    snapshotVersion: row.snapshot_version,
    staleReason: row.stale_reason,
    revision: row.revision
  };
}

export type SkillRow = { skill_id: string; skill_name: string; category: string; description: string; required_level: number | null };

export function toSkill(row: SkillRow): Skill {
  return {
    skillId: row.skill_id,
    skillName: row.skill_name,
    category: row.category,
    description: row.description,
    requiredLevel: row.required_level
  };
}
