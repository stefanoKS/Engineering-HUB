/**
 * Shared enumerations. These string values are persisted in PostgreSQL and published to the
 * employee dashboard, so they must never be translated or renamed.
 */
import { z } from 'zod';

export const ROLES = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const PROJECT_STATUSES = [
  'Planned',
  'Active',
  'On Hold',
  'Completed',
  'Cancelled',
  'Archived'
] as const;
export const ProjectStatus = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const TASK_STATUSES = [
  'Not Started',
  'Assigned',
  'In Progress',
  'Blocked',
  'On Hold',
  'Done',
  'Cancelled'
] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export const Priority = z.enum(PRIORITIES);
export type Priority = z.infer<typeof Priority>;

export const RESPONSIBILITY_STATUSES = ['Active', 'Retired'] as const;
export const ResponsibilityStatus = z.enum(RESPONSIBILITY_STATUSES);
export type ResponsibilityStatus = z.infer<typeof ResponsibilityStatus>;

export const DASHBOARD_VISIBILITIES = ['INTERNAL', 'RESTRICTED'] as const;
export const DashboardVisibility = z.enum(DASHBOARD_VISIBILITIES);
export type DashboardVisibility = z.infer<typeof DashboardVisibility>;

export const DURATION_UNITS = ['DAY', 'WEEK'] as const;
export const DurationUnit = z.enum(DURATION_UNITS);
export type DurationUnit = z.infer<typeof DurationUnit>;

export const DURATION_BASES = ['WORKING_DAYS', 'CALENDAR_DAYS'] as const;
export const DurationBasis = z.enum(DURATION_BASES);
export type DurationBasis = z.infer<typeof DurationBasis>;

export const PLANNED_START_SOURCES = ['DERIVED', 'LEGACY', 'MANUAL'] as const;
export const PlannedStartSource = z.enum(PLANNED_START_SOURCES);
export type PlannedStartSource = z.infer<typeof PlannedStartSource>;

export const REQUEST_TYPES = ['DEADLINE_CHANGE', 'COMPLETION_REPORT'] as const;
export const RequestType = z.enum(REQUEST_TYPES);
export type RequestType = z.infer<typeof RequestType>;

export const REQUEST_STATUSES = [
  'PENDING',
  'PROCESSING',
  'APPROVED',
  'REJECTED',
  'RETURNED',
  'WITHDRAWN',
  'STALE'
] as const;
export const RequestStatus = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const REQUEST_DECISIONS = ['APPROVE', 'REJECT', 'RETURN'] as const;
export const RequestDecision = z.enum(REQUEST_DECISIONS);
export type RequestDecision = z.infer<typeof RequestDecision>;

export const NOTIFICATION_MODES = ['OFF', 'PREVIEW', 'LIVE'] as const;
export const NotificationMode = z.enum(NOTIFICATION_MODES);
export type NotificationMode = z.infer<typeof NotificationMode>;

export const NOTIFICATION_RESULTS = [
  'PENDING',
  'SENT',
  'PREVIEW',
  'DELIVERY_UNCERTAIN',
  'FAILED',
  'SKIPPED'
] as const;
export const NotificationResult = z.enum(NOTIFICATION_RESULTS);
export type NotificationResult = z.infer<typeof NotificationResult>;

export const ISSUE_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export const IssueSeverity = z.enum(ISSUE_SEVERITIES);
export type IssueSeverity = z.infer<typeof IssueSeverity>;

export const ISSUE_STATUSES = ['Open', 'In Progress', 'Closed'] as const;
export const IssueStatus = z.enum(ISSUE_STATUSES);
export type IssueStatus = z.infer<typeof IssueStatus>;

export const PHASE_STATUSES = ['DRAFT', 'PLANNED'] as const;
export const PhaseStatus = z.enum(PHASE_STATUSES);
export type PhaseStatus = z.infer<typeof PhaseStatus>;

export const AUDIT_RESULTS = ['OK', 'REFUSED', 'FAILED'] as const;
export const AuditResult = z.enum(AUDIT_RESULTS);
export type AuditResult = z.infer<typeof AuditResult>;
