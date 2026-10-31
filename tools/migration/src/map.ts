/**
 * V1 sheet -> V2 table mapping.
 *
 * Every mapping is explicit: a column that is not listed is inventoried as a custom column and
 * never silently dropped. Identifiers are preserved verbatim. A formula is never treated as
 * data or as executable SQL; only its presence is reported.
 */
export type ValueType = 'text' | 'date' | 'timestamp' | 'number' | 'boolean' | 'enum';

export type ColumnSpec = {
  source: string;
  target: string;
  type: ValueType;
  values?: readonly string[];
  /** Deferred foreign-key columns are imported in a second pass. */
  deferred?: boolean;
};

export type TableSpec = {
  source: string;
  target: string;
  idSource: string;
  idTarget: string;
  columns: ColumnSpec[];
  /** Every mapped column can be compared during reconciliation. */
  compare?: boolean;
};

const PROJECT_STATES = ['Planned', 'Active', 'On Hold', 'Completed', 'Cancelled', 'Archived'] as const;
const TASK_STATES = ['Not Started', 'Assigned', 'In Progress', 'Blocked', 'On Hold', 'Done', 'Cancelled'] as const;
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const ROLES = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'] as const;

export const TABLE_SPECS: TableSpec[] = [
  {
    source: 'MEMBERS',
    target: 'members',
    idSource: 'Member_ID',
    idTarget: 'member_id',
    compare: true,
    columns: [
      { source: 'Name', target: 'name', type: 'text' },
      { source: 'Email', target: 'email', type: 'text' },
      { source: 'Department', target: 'department', type: 'text' },
      { source: 'Position', target: 'position', type: 'text' },
      { source: 'Active', target: 'active', type: 'boolean' },
      { source: 'Manager_ID', target: 'manager_id', type: 'text', deferred: true },
      { source: 'Weekly_Capacity_Hours', target: 'weekly_capacity_hours', type: 'number' },
      { source: 'Role', target: 'role', type: 'enum', values: ROLES }
    ]
  },
  {
    source: 'RESPONSIBILITIES',
    target: 'responsibilities',
    idSource: 'Responsibility_ID',
    idTarget: 'responsibility_id',
    compare: true,
    columns: [
      { source: 'Name', target: 'name', type: 'text' },
      { source: 'Description', target: 'description', type: 'text' },
      { source: 'Owner_Member_ID', target: 'owner_member_id', type: 'text' },
      { source: 'Status', target: 'status', type: 'enum', values: ['Active', 'Retired'] },
      { source: 'Sort_Order', target: 'sort_order', type: 'number' },
      { source: 'Color_Hex', target: 'color_hex', type: 'text' },
      { source: 'Created_At', target: 'created_at', type: 'timestamp' },
      { source: 'Updated_At', target: 'updated_at', type: 'timestamp' },
      { source: 'Retired_At', target: 'retired_at', type: 'timestamp' }
    ]
  },
  {
    source: 'PROJECTS',
    target: 'projects',
    idSource: 'Project_ID',
    idTarget: 'project_id',
    compare: true,
    columns: [
      { source: 'Project_Name', target: 'project_name', type: 'text' },
      { source: 'Description', target: 'description', type: 'text' },
      { source: 'Category', target: 'category', type: 'text' },
      { source: 'Responsibility_ID', target: 'responsibility_id', type: 'text' },
      { source: 'Project_Owner_ID', target: 'project_owner_id', type: 'text' },
      { source: 'Status', target: 'status', type: 'enum', values: PROJECT_STATES },
      { source: 'Priority', target: 'priority', type: 'enum', values: PRIORITIES },
      { source: 'Planned_Start', target: 'planned_start', type: 'date' },
      { source: 'Forecast_End', target: 'forecast_end', type: 'date' },
      { source: 'Committed_Deadline', target: 'committed_deadline', type: 'date' },
      { source: 'Original_Deadline', target: 'original_deadline', type: 'date' },
      { source: 'Actual_Completion', target: 'actual_completion', type: 'date' },
      { source: 'Progress_Percent', target: 'progress_percent', type: 'number' },
      { source: 'Health', target: 'health', type: 'text' },
      { source: 'Next_Milestone', target: 'next_milestone', type: 'text' },
      { source: 'Next_Action', target: 'next_action', type: 'text' },
      { source: 'Notification_Enabled', target: 'notification_enabled', type: 'boolean' },
      { source: 'Dashboard_Visibility', target: 'dashboard_visibility', type: 'enum', values: ['INTERNAL', 'RESTRICTED'] },
      { source: 'Dashboard_Summary', target: 'dashboard_summary', type: 'text' },
      { source: 'Archived_At', target: 'archived_at', type: 'timestamp' },
      { source: 'Created_At', target: 'created_at', type: 'timestamp' },
      { source: 'Last_Updated', target: 'updated_at', type: 'timestamp' }
    ]
  },
  {
    source: 'SUBPROJECTS',
    target: 'subprojects',
    idSource: 'Subproject_ID',
    idTarget: 'subproject_id',
    compare: true,
    columns: [
      { source: 'Project_ID', target: 'project_id', type: 'text' },
      { source: 'Parent_Subproject_ID', target: 'parent_subproject_id', type: 'text', deferred: true },
      { source: 'Subproject_Name', target: 'subproject_name', type: 'text' },
      { source: 'Owner_ID', target: 'owner_id', type: 'text' },
      { source: 'Status', target: 'status', type: 'enum', values: PROJECT_STATES },
      { source: 'Planned_Start', target: 'planned_start', type: 'date' },
      { source: 'Planned_End', target: 'planned_end', type: 'date' },
      { source: 'Deadline', target: 'deadline', type: 'date' },
      { source: 'Progress_Percent', target: 'progress_percent', type: 'number' },
      { source: 'Estimated_Hours', target: 'estimated_hours', type: 'number' },
      { source: 'Next_Action', target: 'next_action', type: 'text' },
      { source: 'Last_Updated', target: 'updated_at', type: 'timestamp' }
    ]
  },
  {
    source: 'SKILLS',
    target: 'skills',
    idSource: 'Skill_ID',
    idTarget: 'skill_id',
    compare: true,
    columns: [
      { source: 'Skill_Name', target: 'skill_name', type: 'text' },
      { source: 'Category', target: 'category', type: 'text' },
      { source: 'Description', target: 'description', type: 'text' },
      { source: 'Required_Level', target: 'required_level', type: 'number' }
    ]
  },
  {
    source: 'TASKS',
    target: 'tasks',
    idSource: 'Task_ID',
    idTarget: 'task_id',
    compare: true,
    columns: [
      { source: 'Project_ID', target: 'project_id', type: 'text' },
      { source: 'Subproject_ID', target: 'subproject_id', type: 'text' },
      { source: 'Parent_Task_ID', target: 'parent_task_id', type: 'text', deferred: true },
      { source: 'Task_Name', target: 'task_name', type: 'text' },
      { source: 'Description', target: 'description', type: 'text' },
      { source: 'Owner_Member_ID', target: 'owner_member_id', type: 'text' },
      { source: 'Status', target: 'status', type: 'enum', values: TASK_STATES },
      { source: 'Priority', target: 'priority', type: 'enum', values: PRIORITIES },
      { source: 'Planned_Start', target: 'planned_start', type: 'date' },
      { source: 'Due_Date', target: 'due_date', type: 'date' },
      { source: 'Estimated_Hours', target: 'estimated_hours', type: 'number' },
      { source: 'Actual_Hours', target: 'actual_hours', type: 'number' },
      { source: 'Progress_Percent', target: 'progress_percent', type: 'number' },
      { source: 'Acceptance_Criteria', target: 'acceptance_criteria', type: 'text' },
      { source: 'Next_Action', target: 'next_action', type: 'text' },
      { source: 'Required_Skill_ID', target: 'required_skill_id', type: 'text' },
      { source: 'Required_Skill_Level', target: 'required_skill_level', type: 'number' },
      { source: 'Assignment_Version', target: 'assignment_version', type: 'number' },
      { source: 'Assignment_Approved_At', target: 'assignment_approved_at', type: 'timestamp' },
      { source: 'Notification_Enabled', target: 'notification_enabled', type: 'boolean' },
      { source: 'Notification_Baseline', target: 'notification_baseline', type: 'text' },
      { source: 'Public_Note', target: 'public_note', type: 'text' },
      { source: 'Planned_Duration_Value', target: 'planned_duration_value', type: 'number' },
      { source: 'Planned_Duration_Unit', target: 'planned_duration_unit', type: 'enum', values: ['DAY', 'WEEK'] },
      { source: 'Planned_Duration_Basis', target: 'planned_duration_basis', type: 'enum', values: ['WORKING_DAYS', 'CALENDAR_DAYS'] },
      { source: 'Planned_Start_Source', target: 'planned_start_source', type: 'enum', values: ['DERIVED', 'LEGACY', 'MANUAL'] },
      { source: 'Completed_At', target: 'completed_at', type: 'timestamp' },
      { source: 'Created_At', target: 'created_at', type: 'timestamp' },
      { source: 'Last_Updated', target: 'updated_at', type: 'timestamp' }
    ]
  },
  {
    source: 'MEMBER_SKILLS',
    target: 'member_skills',
    idSource: 'Member_Skill_ID',
    idTarget: 'member_skill_id',
    columns: [
      { source: 'Member_ID', target: 'member_id', type: 'text' },
      { source: 'Skill_ID', target: 'skill_id', type: 'text' },
      { source: 'Current_Level', target: 'current_level', type: 'number' },
      { source: 'Assessment_Date', target: 'assessment_date', type: 'date' },
      { source: 'Assessed_By', target: 'assessed_by', type: 'text' },
      { source: 'Evidence', target: 'evidence', type: 'text' },
      { source: 'Training_Action', target: 'training_action', type: 'text' },
      { source: 'Next_Review_Date', target: 'next_review_date', type: 'date' }
    ]
  },
  {
    source: 'MILESTONES',
    target: 'milestones',
    idSource: 'Milestone_ID',
    idTarget: 'milestone_id',
    columns: [
      { source: 'Project_ID', target: 'project_id', type: 'text' },
      { source: 'Subproject_ID', target: 'subproject_id', type: 'text' },
      { source: 'Milestone_Name', target: 'milestone_name', type: 'text' },
      { source: 'Owner_ID', target: 'owner_id', type: 'text' },
      { source: 'Target_Date', target: 'target_date', type: 'date' },
      { source: 'Actual_Date', target: 'actual_date', type: 'date' },
      { source: 'Gate_Type', target: 'gate_type', type: 'text' },
      { source: 'Status', target: 'status', type: 'text' },
      { source: 'Acceptance_Criteria', target: 'acceptance_criteria', type: 'text' },
      { source: 'Verification_Result', target: 'verification_result', type: 'text' },
      { source: 'Calendar_Event_ID', target: 'calendar_event_id', type: 'text' },
      { source: 'Calendar_Sync_Hash', target: 'calendar_sync_hash', type: 'text' }
    ]
  },
  {
    source: 'ISSUES',
    target: 'issues',
    idSource: 'Issue_ID',
    idTarget: 'issue_id',
    columns: [
      { source: 'Project_ID', target: 'project_id', type: 'text' },
      { source: 'Subproject_ID', target: 'subproject_id', type: 'text' },
      { source: 'Task_ID', target: 'task_id', type: 'text' },
      { source: 'Description', target: 'description', type: 'text' },
      { source: 'Severity', target: 'severity', type: 'enum', values: PRIORITIES },
      { source: 'Status', target: 'status', type: 'enum', values: ['Open', 'In Progress', 'Closed'] },
      { source: 'Owner_ID', target: 'owner_id', type: 'text' },
      { source: 'Raised_Date', target: 'raised_date', type: 'date' },
      { source: 'Target_Close_Date', target: 'target_close_date', type: 'date' },
      { source: 'Corrective_Action', target: 'corrective_action', type: 'text' }
    ]
  },
  {
    source: 'HOLIDAYS',
    target: 'holidays',
    idSource: 'Holiday_ID',
    idTarget: 'holiday_id',
    columns: [
      { source: 'Date', target: 'date', type: 'date' },
      { source: 'Name', target: 'name', type: 'text' }
    ]
  },
  {
    source: 'PHASE_TEMPLATES',
    target: 'phase_templates',
    idSource: 'Phase_ID',
    idTarget: 'phase_id',
    columns: [
      { source: 'Phase_Name', target: 'phase_name', type: 'text' },
      { source: 'Duration_Days', target: 'duration_days', type: 'number' },
      { source: 'Buffer_Days', target: 'buffer_days', type: 'number' },
      { source: 'Dependency_IDs', target: 'dependency_ids', type: 'text' }
    ]
  },
  {
    source: 'PROJECT_PHASES',
    target: 'project_phases',
    idSource: 'Project_Phase_ID',
    idTarget: 'project_phase_id',
    columns: [
      { source: 'Project_ID', target: 'project_id', type: 'text' },
      { source: 'Phase_ID', target: 'phase_id', type: 'text' },
      { source: 'Phase_Name', target: 'phase_name', type: 'text' },
      { source: 'Phase_Order', target: 'phase_order', type: 'number' },
      { source: 'Duration_Days', target: 'duration_days', type: 'number' },
      { source: 'Buffer_Days', target: 'buffer_days', type: 'number' },
      { source: 'Dependency_IDs', target: 'dependency_ids', type: 'text' },
      { source: 'Planned_Start', target: 'planned_start', type: 'date' },
      { source: 'Planned_End', target: 'planned_end', type: 'date' },
      { source: 'Status', target: 'status', type: 'enum', values: ['DRAFT', 'PLANNED'] },
      { source: 'Committed_Deadline', target: 'committed_deadline', type: 'date' },
      { source: 'Plan_Version', target: 'plan_version', type: 'number' },
      { source: 'Active', target: 'active', type: 'boolean' }
    ]
  },
  {
    source: 'SCHEDULE_CONFIRMATIONS',
    target: 'schedule_confirmations',
    idSource: 'Schedule_Confirmation_ID',
    idTarget: 'schedule_confirmation_id',
    columns: [
      { source: 'Task_ID', target: 'task_id', type: 'text' },
      { source: 'Active', target: 'active', type: 'boolean' },
      { source: 'Version', target: 'version', type: 'number' },
      { source: 'Planned_Start', target: 'planned_start', type: 'date' },
      { source: 'Due_Date', target: 'due_date', type: 'date' },
      { source: 'Estimated_Hours', target: 'estimated_hours', type: 'number' },
      { source: 'Confirmed_At', target: 'confirmed_at', type: 'timestamp' },
      { source: 'Confirmed_By', target: 'confirmed_by', type: 'text' },
      { source: 'Notes', target: 'notes', type: 'text' }
    ]
  },
  {
    source: 'TASK_REQUESTS',
    target: 'task_requests',
    idSource: 'Request_ID',
    idTarget: 'request_id',
    compare: true,
    columns: [
      { source: 'Request_Type', target: 'request_type', type: 'enum', values: ['DEADLINE_CHANGE', 'COMPLETION_REPORT'] },
      { source: 'Task_ID', target: 'task_id', type: 'text' },
      { source: 'Project_ID', target: 'project_id', type: 'text' },
      { source: 'Requester_Name', target: 'requester_name', type: 'text' },
      { source: 'Submitted_At', target: 'submitted_at', type: 'timestamp' },
      { source: 'Original_Due_Date', target: 'original_due_date', type: 'date' },
      { source: 'Requested_Due_Date', target: 'requested_due_date', type: 'date' },
      { source: 'Reason', target: 'reason', type: 'text' },
      { source: 'Explanation', target: 'explanation', type: 'text' },
      { source: 'Completion_Note', target: 'completion_note', type: 'text' },
      {
        source: 'Status',
        target: 'status',
        type: 'enum',
        values: ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'RETURNED', 'WITHDRAWN', 'STALE']
      },
      { source: 'Reviewer', target: 'reviewer', type: 'text' },
      { source: 'Decided_At', target: 'decided_at', type: 'timestamp' },
      { source: 'Decision_Note', target: 'decision_note', type: 'text' },
      { source: 'Task_Revision_At_Submission', target: 'task_revision_at_submission', type: 'text' },
      { source: 'Due_Date_At_Submission', target: 'due_date_at_submission', type: 'date' },
      { source: 'Reported_Completion_At', target: 'reported_completion_at', type: 'timestamp' },
      { source: 'Accepted_Completion_At', target: 'accepted_completion_at', type: 'timestamp' },
      { source: 'Inbox_Request_ID', target: 'inbox_request_id', type: 'text' },
      { source: 'Imported_At', target: 'imported_at', type: 'timestamp' },
      { source: 'Snapshot_Version', target: 'snapshot_version', type: 'text' }
    ]
  },
  {
    source: 'TASK_DEADLINE_HISTORY',
    target: 'task_deadline_history',
    idSource: 'History_ID',
    idTarget: 'history_id',
    columns: [
      { source: 'Task_ID', target: 'task_id', type: 'text' },
      { source: 'Request_ID', target: 'request_id', type: 'text' },
      { source: 'Previous_Due_Date', target: 'previous_due_date', type: 'date' },
      { source: 'New_Due_Date', target: 'new_due_date', type: 'date' },
      { source: 'Previous_Planned_Start', target: 'previous_planned_start', type: 'date' },
      { source: 'New_Planned_Start', target: 'new_planned_start', type: 'date' },
      { source: 'Reason', target: 'reason', type: 'text' },
      { source: 'Changed_At', target: 'changed_at', type: 'timestamp' },
      { source: 'Changed_By', target: 'changed_by', type: 'text' },
      { source: 'Source', target: 'source', type: 'text' }
    ]
  },
  {
    source: 'NOTIFICATION_LOG',
    target: 'notification_ledger',
    idSource: 'Notification_ID',
    idTarget: 'notification_id',
    columns: [
      { source: 'Notification_Key', target: 'notification_key', type: 'text' },
      { source: 'Task_ID', target: 'task_id', type: 'text' },
      { source: 'Recipient', target: 'recipient', type: 'text' },
      { source: 'Notification_Type', target: 'notification_type', type: 'text' },
      { source: 'Assignment_Version', target: 'assignment_version', type: 'number' },
      { source: 'Created_At', target: 'created_at', type: 'timestamp' },
      { source: 'Sent_At', target: 'sent_at', type: 'timestamp' },
      { source: 'Result', target: 'result', type: 'text' },
      { source: 'Error_Details', target: 'error_details', type: 'text' },
      { source: 'Reconciled_At', target: 'reconciled_at', type: 'timestamp' },
      { source: 'Reconciled_By', target: 'reconciled_by', type: 'text' }
    ]
  }
];

/** Tables imported by a dedicated pass rather than the generic mapper. */
export const SPECIAL_TABLES = ['TASK_ASSIGNEES', 'RESPONSIBILITY_MEMBERS', 'AUTOMATION_SETTINGS', 'AUDIT_LOG'] as const;

export function specFor(source: string): TableSpec | undefined {
  return TABLE_SPECS.find((spec) => spec.source === source);
}

export function normalizeBoolean(value: string): boolean {
  return ['true', '1', 'yes', 'y', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

export function normalizeNumber(value: string): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

export function splitIds(value: string): string[] {
  return String(value ?? '')
    .split(/[,、;|\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
