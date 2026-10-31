/**
 * Outbound notification policy.
 *
 * Mail and Calendar are OFF by default, an emergency stop is on, and an unconfigured
 * application fails closed. The save path only enqueues an outbox job; it never waits for
 * Gmail, Calendar, Drive or Sheets. A LIVE transition requires an ADMIN, the exact
 * confirmation and a passing preflight, and an ambiguous delivery is never retried
 * automatically.
 */
import type { NotificationMode, NotificationResult } from '@eh/contracts';
import { DomainError } from './errors';

export const SETTING_KEYS = {
  EMAIL_MODE: 'EMAIL_MODE',
  EMERGENCY_STOP: 'EMERGENCY_STOP',
  ASSIGNMENT_EMAIL_ENABLED: 'ASSIGNMENT_EMAIL_ENABLED',
  REASSIGNMENT_EMAIL_ENABLED: 'REASSIGNMENT_EMAIL_ENABLED',
  DEADLINE_CHANGE_EMAIL_ENABLED: 'DEADLINE_CHANGE_EMAIL_ENABLED',
  DEADLINE_REMINDER_ENABLED: 'DEADLINE_REMINDER_ENABLED',
  OVERDUE_REMINDER_ENABLED: 'OVERDUE_REMINDER_ENABLED',
  WEEKLY_MANAGER_REPORT_ENABLED: 'WEEKLY_MANAGER_REPORT_ENABLED',
  REMINDER_OFFSETS: 'REMINDER_OFFSETS',
  REMINDER_CATCHUP_DAYS: 'REMINDER_CATCHUP_DAYS',
  OVERDUE_FREQUENCY_DAYS: 'OVERDUE_FREQUENCY_DAYS',
  WEEKDAY_ONLY_SENDING: 'WEEKDAY_ONLY_SENDING',
  EXECUTION_WINDOW_START: 'EXECUTION_WINDOW_START',
  EXECUTION_WINDOW_END: 'EXECUTION_WINDOW_END',
  MANAGEMENT_REPORT_RECIPIENTS: 'MANAGEMENT_REPORT_RECIPIENTS',
  WEEKLY_REPORT_DAY: 'WEEKLY_REPORT_DAY',
  WEEKLY_REPORT_TIME: 'WEEKLY_REPORT_TIME',
  CALENDAR_SYNC_ENABLED: 'CALENDAR_SYNC_ENABLED',
  DAILY_BACKUP_ENABLED: 'DAILY_BACKUP_ENABLED',
  AUTO_DASHBOARD_REFRESH_ENABLED: 'AUTO_DASHBOARD_REFRESH_ENABLED',
  AUTO_WORKLOAD_REFRESH_ENABLED: 'AUTO_WORKLOAD_REFRESH_ENABLED',
  PROJECT_STALE_ALERT_ENABLED: 'PROJECT_STALE_ALERT_ENABLED',
  PROJECT_STALE_DAYS: 'PROJECT_STALE_DAYS',
  HEALTH_MILESTONE_APPROACH_DAYS: 'HEALTH_MILESTONE_APPROACH_DAYS',
  HEALTH_DELAY_TOLERANCE_DAYS: 'HEALTH_DELAY_TOLERANCE_DAYS',
  SHARED_DASHBOARD_PUBLISH_ENABLED: 'SHARED_DASHBOARD_PUBLISH_ENABLED',
  SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES: 'SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES',
  DEADLINE_REQUEST_EMAIL_ENABLED: 'DEADLINE_REQUEST_EMAIL_ENABLED',
  COMPLETION_REPORT_EMAIL_ENABLED: 'COMPLETION_REPORT_EMAIL_ENABLED',
  PENDING_REQUEST_REMINDER_ENABLED: 'PENDING_REQUEST_REMINDER_ENABLED',
  /** V2 additions that replace V1 deployment-only configuration. */
  ALLOWED_RECIPIENT_DOMAINS: 'ALLOWED_RECIPIENT_DOMAINS',
  MAX_EMAILS_PER_RUN: 'MAX_EMAILS_PER_RUN',
  REQUEST_SUBMISSION_ENABLED: 'REQUEST_SUBMISSION_ENABLED'
} as const;

export type SettingsMap = Readonly<Record<string, string | undefined>>;

export function setting(settings: SettingsMap, key: string, fallback = ''): string {
  const raw = settings[key];
  return raw === undefined || raw === null ? fallback : String(raw).trim();
}

export function settingFlag(settings: SettingsMap, key: string, fallback = false): boolean {
  const raw = setting(settings, key, fallback ? 'true' : 'false').toLowerCase();
  return raw === 'true';
}

function declaredMode(settings: SettingsMap): NotificationMode {
  const value = setting(settings, SETTING_KEYS.EMAIL_MODE, 'OFF').toUpperCase();
  return value === 'LIVE' || value === 'PREVIEW' ? value : 'OFF';
}

/**
 * Effective mode: the emergency stop and an unconfigured mode both collapse to OFF. A stored
 * LIVE value is not enough on its own; the activation gates are checked when it is enabled.
 */
export function effectiveEmailMode(settings: SettingsMap): NotificationMode {
  if (settingFlag(settings, SETTING_KEYS.EMERGENCY_STOP, true)) return 'OFF';
  return declaredMode(settings);
}

export function parseDomains(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export function recipientDomainAllowed(email: string, settings: SettingsMap): boolean {
  const address = String(email ?? '').trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return false;
  const domains = parseDomains(setting(settings, SETTING_KEYS.ALLOWED_RECIPIENT_DOMAINS));
  // No allowlist configured fails closed: a notification never guesses a destination.
  if (!domains.length) return false;
  const domain = address.slice(at + 1);
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

export type LiveGateInput = {
  actorRole: string;
  confirmation: string;
  preflightPassed: boolean;
  settings: SettingsMap;
};

export const LIVE_CONFIRMATION = 'ENABLE LIVE EMAIL';

/** Any transition to an effective LIVE state requires ADMIN, the exact phrase and a preflight. */
export function assertLiveAllowed(input: LiveGateInput): void {
  if (input.actorRole !== 'ADMIN') {
    throw new DomainError('AUTHORIZATION_DENIED', 'Only an ADMIN may activate live email');
  }
  if (String(input.confirmation ?? '').trim() !== LIVE_CONFIRMATION) {
    throw new DomainError('CONFIRMATION_REQUIRED', `Type exactly "${LIVE_CONFIRMATION}" to confirm`, {
      expected: LIVE_CONFIRMATION
    });
  }
  if (!input.preflightPassed) {
    throw new DomainError('INVALID_TRANSITION', 'Live email requires a passing preflight');
  }
  if (settingFlag(input.settings, SETTING_KEYS.EMERGENCY_STOP, true)) {
    throw new DomainError('INVALID_TRANSITION', 'The emergency stop must be cleared before live email');
  }
}

export type NotificationKind =
  | 'ASSIGNMENT'
  | 'DEADLINE_REMINDER'
  | 'OVERDUE_REMINDER'
  | 'COMPLETION'
  | 'REQUEST_DECISION'
  | 'REPORT';

export type NotificationIdentity = {
  kind: NotificationKind;
  taskId: string;
  recipient: string;
  dueDate?: string | null;
  assignmentVersion?: number | null;
  bucket?: string | null;
};

/**
 * A logical notification is identified by what it announces, never by when it ran, so a retry
 * of the same job cannot send a second mail for the same event.
 */
export function notificationKey(identity: NotificationIdentity): string {
  const parts = [
    identity.kind,
    identity.taskId || '-',
    (identity.recipient || '-').trim().toLowerCase(),
    identity.dueDate || identity.bucket || '-',
    identity.assignmentVersion === null || identity.assignmentVersion === undefined
      ? '-'
      : String(identity.assignmentVersion)
  ];
  return parts.join('|');
}

/** An assignment approval is invalidated by any material assignment change. */
export function assignmentApprovalValid(
  storedApprovedAt: string | null,
  storedVersion: number,
  currentVersion: number
): boolean {
  return !!storedApprovedAt && storedVersion === currentVersion;
}

export type LedgerState = NotificationResult;

const LEDGER_TRANSITIONS: Readonly<Record<LedgerState, readonly LedgerState[]>> = {
  PENDING: ['SENT', 'PREVIEW', 'DELIVERY_UNCERTAIN', 'FAILED', 'SKIPPED'],
  PREVIEW: [],
  SENT: [],
  DELIVERY_UNCERTAIN: [],
  FAILED: ['PENDING'],
  SKIPPED: []
};

export function canMoveLedger(from: LedgerState, to: LedgerState): boolean {
  return (LEDGER_TRANSITIONS[from] ?? []).includes(to);
}

export function assertLedgerMove(from: LedgerState, to: LedgerState): void {
  if (!canMoveLedger(from, to)) {
    throw new DomainError('INVALID_TRANSITION', `Notification cannot move from ${from} to ${to}`);
  }
}

/**
 * An error that may have reached the provider is uncertain, not failed. It is never retried
 * automatically, because a retry could send a duplicate.
 */
export function classifyDeliveryFailure(error: { ambiguous?: boolean; code?: string }): LedgerState {
  if (error.ambiguous) return 'DELIVERY_UNCERTAIN';
  if (error.code === 'AUTH' || error.code === 'INVALID_RECIPIENT' || error.code === 'POLICY') {
    return 'FAILED';
  }
  return error.code === 'TRANSIENT' ? 'PENDING' : 'DELIVERY_UNCERTAIN';
}

export function maxEmailsPerRun(settings: SettingsMap): number {
  const value = Number(setting(settings, SETTING_KEYS.MAX_EMAILS_PER_RUN, '50'));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(500, Math.floor(value));
}

export function calendarEnabled(settings: SettingsMap): boolean {
  return settingFlag(settings, SETTING_KEYS.CALENDAR_SYNC_ENABLED, false);
}

/** Backoff for a retryable outbox job: bounded, jitter-free, never unbounded. */
export function retryDelaySeconds(attempt: number): number {
  const bounded = Math.max(0, Math.min(attempt, 12));
  return Math.min(3600, 30 * 2 ** bounded);
}

export const MAX_OUTBOX_ATTEMPTS = 6;
