/** Status vocabularies shared by every rule. Stored values are never translated. */
export const OPEN_TASK_STATUSES = [
  'Not Started',
  'Assigned',
  'In Progress',
  'Blocked',
  'On Hold'
] as const;

export const ACTIVE_REMINDER_STATUSES = [
  'Not Started',
  'Assigned',
  'In Progress',
  'Blocked'
] as const;

export const WORKLOAD_PROJECT_STATUSES = ['Active', 'Planned'] as const;

export const TERMINAL_TASK_STATUSES = ['Done', 'Cancelled'] as const;

export function isOpenTaskStatus(status: string): boolean {
  return (OPEN_TASK_STATUSES as readonly string[]).includes(status);
}

export function isReminderEligibleStatus(status: string): boolean {
  return (ACTIVE_REMINDER_STATUSES as readonly string[]).includes(status);
}

export function isWorkloadProjectStatus(status: string): boolean {
  return (WORKLOAD_PROJECT_STATUSES as readonly string[]).includes(status);
}

export function isTerminalTaskStatus(status: string): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}

/** Blank member roles keep the least privilege instead of being promoted. */
export function effectiveRole(stored: string | null | undefined): 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER' {
  const role = String(stored ?? '').trim().toUpperCase();
  return role === 'ADMIN' || role === 'MANAGER' || role === 'MEMBER' || role === 'VIEWER'
    ? role
    : 'VIEWER';
}
