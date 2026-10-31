/** Automation settings, status, workload and plan preview. */
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { AutomationSaveBody, AutomationSettingsView, PlanPreview, StatusView, WorkloadReport } from '@eh/contracts';
import {
  KNOWN_SETTINGS,
  activeAdministratorIds,
  getSettingRows,
  getSettings,
  lastBackup,
  outboxStats,
  saveSettings,
  schemaVersion,
  tableCounts
} from '@eh/db';
import {
  DomainError,
  LIVE_CONFIRMATION,
  SETTING_KEYS,
  businessDate,
  createCalendar,
  createScope,
  effectiveEmailMode,
  planFromDuration,
  planningWarnings,
  remainingHours,
  requireRole,
  setting,
  settingFlag,
  type SubprojectLike
} from '@eh/domain';
import { listHolidays, listAllProjects, listAllTasksForScope, listSubprojects } from '@eh/db';
import { audit, requireConfirmation, type ServiceCtx } from './common';
import type { AppConfig } from '../config';

export const DASHBOARD_CONFIRMATION = 'ENABLE SHARED DASHBOARD PUBLICATION';

export function settingsRevision(rows: { setting_id: string; value: string }[]): string {
  const canonical = rows
    .map((row) => `${row.setting_id}=${row.value}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
}

export async function getAutomation(ctx: ServiceCtx): Promise<AutomationSettingsView> {
  requireRole(ctx.identity, 'MANAGER');
  const rows = await getSettingRows(ctx.db);
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.setting_id] = row.value;
  const admins = await activeAdministratorIds(ctx.db);
  return {
    settings: rows.map((row) => ({
      key: row.setting_id,
      value: row.value,
      description: row.description || KNOWN_SETTINGS[row.setting_id]?.description || '',
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      adminOnly: KNOWN_SETTINGS[row.setting_id]?.adminOnly ?? true,
      approved: !!row.updated_by
    })),
    revision: settingsRevision(rows),
    effectiveEmailMode: effectiveEmailMode(settings),
    emergencyStop: settingFlag(settings, SETTING_KEYS.EMERGENCY_STOP, true),
    liveRequirements: [
      {
        key: 'ALLOWED_DOMAINS',
        satisfied: !!setting(settings, SETTING_KEYS.ALLOWED_RECIPIENT_DOMAINS),
        detail: 'An allowed recipient domain list is required'
      },
      {
        key: 'EMERGENCY_STOP_CLEARED',
        satisfied: !settingFlag(settings, SETTING_KEYS.EMERGENCY_STOP, true),
        detail: 'The emergency stop must be cleared'
      },
      {
        key: 'ACTIVE_ADMIN',
        satisfied: admins.length > 0,
        detail: 'At least one active administrator must exist'
      }
    ]
  };
}

export async function saveAutomation(
  ctx: ServiceCtx,
  config: AppConfig,
  body: z.infer<typeof AutomationSaveBody>
): Promise<AutomationSettingsView> {
  requireRole(ctx.identity, 'ADMIN');
  requireConfirmation(body.confirmed, 'Changing automation settings requires explicit confirmation');
  const rows = await getSettingRows(ctx.db);
  const current = settingsRevision(rows);
  if (body.revision !== current) {
    throw new DomainError('EDIT_CONFLICT', 'Reload the settings and review your draft');
  }
  for (const key of Object.keys(body.changes)) {
    if (!KNOWN_SETTINGS[key]) throw new DomainError('VALIDATION_FAILED', `Unknown setting: ${key}`);
  }
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.setting_id] = row.value;
  const nextMode = body.changes[SETTING_KEYS.EMAIL_MODE];
  const nextStop = body.changes[SETTING_KEYS.EMERGENCY_STOP];

  if (nextMode === 'LIVE' && effectiveEmailMode({ ...settings, ...body.changes }) !== 'LIVE') {
    throw new DomainError('INVALID_TRANSITION', 'Live email cannot be effective while the emergency stop is on');
  }
  if (nextMode === 'LIVE') {
    const admins = await activeAdministratorIds(ctx.db);
    const domains = body.changes[SETTING_KEYS.ALLOWED_RECIPIENT_DOMAINS] ?? setting(settings, SETTING_KEYS.ALLOWED_RECIPIENT_DOMAINS);
    const preflight = !!domains && admins.length > 0 && nextStop !== 'true' && config.mailConfigured;
    if (!preflight) {
      throw new DomainError('INVALID_TRANSITION', 'Live email requires a configured mailbox, allowed domains, an active administrator and a cleared emergency stop');
    }
    if (String(body.confirmation ?? '').trim() !== LIVE_CONFIRMATION) {
      throw new DomainError('CONFIRMATION_REQUIRED', `Type exactly "${LIVE_CONFIRMATION}" to confirm`, {
        expected: LIVE_CONFIRMATION
      });
    }
  }
  const publish = body.changes[SETTING_KEYS.SHARED_DASHBOARD_PUBLISH_ENABLED];
  if (publish === 'true') {
    if (!config.snapshotDestinationConfigured) {
      throw new DomainError('NOT_CONFIGURED', 'A snapshot destination must be configured before publication is enabled');
    }
    if (String(body.confirmation ?? '').trim() !== DASHBOARD_CONFIRMATION) {
      throw new DomainError('CONFIRMATION_REQUIRED', `Type exactly "${DASHBOARD_CONFIRMATION}" to confirm`, {
        expected: DASHBOARD_CONFIRMATION
      });
    }
  }

  const result = await ctx.db.transaction(async (tx) => {
    const applied = await saveSettings(tx, body.changes, ctx.identity.email);
    await audit(tx, ctx, {
      entityType: 'AUTOMATION_SETTINGS',
      entityId: Object.keys(body.changes).join(','),
      action: 'SETTING_CHANGED',
      previousValue: applied.previous,
      newValue: applied.next
    });
    return applied;
  });
  void result;
  return getAutomation(ctx);
}

export async function emergencyStop(ctx: ServiceCtx): Promise<AutomationSettingsView> {
  requireRole(ctx.identity, 'ADMIN');
  return ctx.db.transaction(async (tx) => {
    const applied = await saveSettings(
      tx,
      { [SETTING_KEYS.EMERGENCY_STOP]: 'true', [SETTING_KEYS.EMAIL_MODE]: 'OFF' },
      ctx.identity.email
    );
    await audit(tx, ctx, {
      entityType: 'AUTOMATION_SETTINGS',
      entityId: 'EMERGENCY_STOP',
      action: 'SETTING_CHANGED',
      previousValue: applied.previous,
      newValue: applied.next
    });
    return getAutomation(ctx);
  });
}

export async function statusView(ctx: ServiceCtx, config: AppConfig): Promise<StatusView> {
  requireRole(ctx.identity, 'MANAGER');
  const [counts, outbox, backup, rows, version] = await Promise.all([
    tableCounts(ctx.db),
    outboxStats(ctx.db),
    lastBackup(ctx.db),
    getSettingRows(ctx.db),
    schemaVersion(ctx.db.pool)
  ]);
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.setting_id] = row.value;
  return {
    status: outbox.failed > 0 ? 'degraded' : 'ok',
    version: config.version,
    schemaVersion: version,
    environment: config.appEnv,
    database: 'ok',
    outbox,
    emailMode: effectiveEmailMode(settings),
    emergencyStop: settingFlag(settings, SETTING_KEYS.EMERGENCY_STOP, true),
    calendarEnabled: settingFlag(settings, SETTING_KEYS.CALENDAR_SYNC_ENABLED, false),
    dashboardPublicationEnabled: settingFlag(settings, SETTING_KEYS.SHARED_DASHBOARD_PUBLISH_ENABLED, false),
    lastBackupAt: backup?.created_at ?? null,
    lastBackupOk: backup?.result === 'OK' || backup?.result === 'SENT',
    valid: true,
    errorCount: 0,
    rowCounts: counts,
    appVersion: config.version,
    migrationVersion: version,
    contractVersion: '1.6'
  };
}

export async function workloadReport(ctx: ServiceCtx): Promise<WorkloadReport> {
  requireRole(ctx.identity, 'MANAGER');
  const today = businessDate();
  const [projects, subprojects, tasks, members, owners] = await Promise.all([
    listAllProjects(ctx.db, 2000),
    listSubprojects(ctx.db),
    listAllTasksForScope(ctx.db),
    ctx.db.many<{ member_id: string; name: string; weekly_capacity_hours: number | null }>(
      'SELECT member_id, name, weekly_capacity_hours FROM members WHERE active ORDER BY name'
    ),
    ctx.db.many<{ task_id: string; member_id: string }>(
      `SELECT t.task_id, t.owner_member_id AS member_id FROM tasks t
        WHERE t.deleted_at IS NULL AND t.owner_member_id IS NOT NULL
       UNION
       SELECT ta.task_id, ta.member_id FROM task_assignees ta WHERE ta.removed_at IS NULL`
    )
  ]);
  const projectMap = new Map(projects.map((project) => [project.projectId, project]));
  const subprojectMap = new Map<string, SubprojectLike>(
    subprojects.map((subproject) => [
      subproject.subprojectId,
      {
        subprojectId: subproject.subprojectId,
        projectId: subproject.projectId,
        parentSubprojectId: subproject.parentSubprojectId,
        status: subproject.status
      }
    ])
  );
  const scope = createScope(tasks, projectMap, subprojectMap, today);
  const activeWork = scope.activeWork();
  const detailById = new Map(tasks.map((task) => [task.taskId, task]));
  const ownersByTask = new Map<string, string[]>();
  for (const row of owners) {
    const list = ownersByTask.get(row.task_id) ?? [];
    list.push(row.member_id);
    ownersByTask.set(row.task_id, list);
  }

  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const mondayOffset = -((weekday + 6) % 7);
  const weeks: string[] = [];
  const rows: WorkloadReport['rows'] = [];
  for (let index = 0; index < 4; index += 1) {
    const weekStart = shift(today, mondayOffset + index * 7);
    weeks.push(weekStart);
    const weekEnd = shift(weekStart, 6);
    for (const member of members) {
      let hours = 0;
      let unknown = 0;
      let overdue = 0;
      for (const scopeTask of activeWork) {
        const ownersForTask = ownersByTask.get(scopeTask.taskId) ?? [];
        if (!ownersForTask.includes(member.member_id)) continue;
        const detail = detailById.get(scopeTask.taskId);
        if (!detail) continue;
        const start = detail.plannedStart ?? detail.dueDate ?? weekStart;
        const end = detail.dueDate ?? start;
        const overlaps = start <= weekEnd && end >= weekStart;
        if (!overlaps) continue;
        const remaining = remainingHours({ estimatedHours: detail.estimatedHours, actualHours: null });
        if (remaining === null) unknown += 1;
        else hours += remaining;
        if (detail.dueDate && detail.dueDate < today) overdue += 1;
      }
      const capacity = Number(member.weekly_capacity_hours ?? 0);
      rows.push({
        memberId: member.member_id,
        memberName: member.name,
        weekStart,
        remainingHours: Math.round(hours * 10) / 10,
        capacityHours: capacity,
        utilization: capacity > 0 ? Math.round((hours / capacity) * 1000) / 1000 : null,
        unknownEstimateTasks: unknown,
        actualHours: 0,
        overdueTasks: overdue,
        overloadWarning: capacity > 0 && hours > capacity
      });
    }
  }
  return { weeks, rows, asOf: today };
}

function shift(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function planPreview(
  ctx: ServiceCtx,
  input: { deadline?: string; durationValue?: number; durationUnit?: string; durationBasis?: string }
): Promise<PlanPreview> {
  requireRole(ctx.identity, 'MANAGER');
  const holidays = await listHolidays(ctx.db);
  const warnings = planningWarnings(
    {
      deadline: input.deadline ?? null,
      today: businessDate(),
      durationValue: input.durationValue ?? null,
      durationUnit: (input.durationUnit as 'DAY' | 'WEEK' | null) ?? null,
      durationBasis: (input.durationBasis as 'WORKING_DAYS' | 'CALENDAR_DAYS' | null) ?? null,
      holidays
    },
    createCalendar(holidays)
  );
  if (!input.deadline || !input.durationValue) {
    return { plannedStart: null, plannedEnd: null, durationWorkingDays: null, warnings };
  }
  const plan = planFromDuration(
    {
      deadline: input.deadline,
      value: input.durationValue,
      unit: (input.durationUnit as 'DAY' | 'WEEK' | null) ?? null,
      basis: (input.durationBasis as 'WORKING_DAYS' | 'CALENDAR_DAYS' | null) ?? null
    },
    createCalendar(holidays)
  );
  return {
    plannedStart: plan.startDate,
    plannedEnd: plan.plannedEnd,
    durationWorkingDays: plan.length,
    warnings
  };
}

export async function settingsSnapshot(ctx: ServiceCtx): Promise<Record<string, string>> {
  return getSettings(ctx.db);
}
