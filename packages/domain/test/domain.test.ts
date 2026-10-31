import { describe, expect, it } from 'vitest';
import {
  MAX_SUBPROJECT_DEPTH,
  MAX_TASK_DEPTH,
  addDays,
  applyTaskPlan,
  assertDeletionAllowed,
  assertLiveAllowed,
  assertNoDependencyCycle,
  assertNotDirectCompletion,
  assertOverrideAllowed,
  assertProjectCompletable,
  businessDate,
  canonicalJson,
  createCalendar,
  createScope,
  deadlineState,
  deletionPreflight,
  effectiveEmailMode,
  evaluateStaleness,
  inactiveSlot,
  LIVE_CONFIRMATION,
  maxEmailsPerRun,
  notificationKey,
  planDecision,
  planFromDuration,
  planningWarnings,
  projectColor,
  projectColorVars,
  PROJECT_COLOR_PALETTE,
  recipientDomainAllowed,
  retryDelaySeconds,
  rollup,
  schedulePhases,
  toPublishedRow,
  validateSubprojectParent,
  validateTaskParent,
  verifyPublication,
  effectiveRole,
  normalizeDate,
  type Identity,
  type ScopeTask,
  requireRole,
  assertRoleChangeAllowed
} from '../src/index';

const admin: Identity = {
  memberId: 'MEM-ADMIN',
  name: 'Admin',
  email: 'admin@example.co.jp',
  role: 'ADMIN',
  active: true,
  verified: true
};

describe('business dates (Asia/Tokyo)', () => {
  it('reads an instant as the Tokyo business date', () => {
    // 2026-01-01T15:30Z is 2026-01-02 00:30 in Tokyo.
    expect(businessDate(new Date('2026-01-01T15:30:00Z'))).toBe('2026-01-02');
    expect(businessDate(new Date('2026-01-01T14:59:00Z'))).toBe('2026-01-01');
  });

  it('normalizes stored date formats without guessing', () => {
    expect(normalizeDate('2026/03/04')).toBe('2026-03-04');
    expect(normalizeDate('2026-3-4')).toBe('2026-03-04');
    expect(normalizeDate('not a date')).toBeNull();
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate('2026-02-31')).toBeNull();
  });

  it('skips weekends and holidays', () => {
    const calendar = createCalendar([{ date: '2026-01-05', name: 'test holiday' }]);
    expect(calendar.isWorkingDay('2026-01-03')).toBe(false); // Saturday
    expect(calendar.isWorkingDay('2026-01-05')).toBe(false); // holiday
    expect(calendar.previousWorkingDay('2026-01-05', true)).toBe('2026-01-02');
    expect(calendar.previousWorkingDay('2026-01-05', false)).toBe('2026-01-02');
    expect(calendar.addWorkingDays('2026-01-02', 1)).toBe('2026-01-06');
  });

  it('derives a deadline state', () => {
    expect(deadlineState(null, 'Not Started', '2026-01-01')).toBe('NONE');
    expect(deadlineState('2025-12-31', 'In Progress', '2026-01-01')).toBe('OVERDUE');
    expect(deadlineState('2026-01-04', 'In Progress', '2026-01-01')).toBe('DUE_SOON');
    expect(deadlineState('2026-03-01', 'In Progress', '2026-01-01')).toBe('OK');
    expect(deadlineState('2025-12-31', 'Done', '2026-01-01')).toBe('COMPLETED');
  });
});

describe('hierarchy', () => {
  const tasks = [
    { id: 'T1', parentId: null, projectId: 'P1', subprojectId: 'S1' },
    { id: 'T2', parentId: 'T1', projectId: 'P1', subprojectId: 'S1' },
    { id: 'T3', parentId: 'T2', projectId: 'P1', subprojectId: 'S1' }
  ];

  it('accepts three task levels and refuses a fourth', () => {
    expect(MAX_TASK_DEPTH).toBe(3);
    expect(
      validateTaskParent({ id: 'T3', projectId: 'P1', subprojectId: 'S1', parentTaskId: 'T2' }, tasks).level
    ).toBe(3);
    // T3 is already level 3, so a child would be level 4 and is refused.
    const deep = [...tasks, { id: 'T4', parentId: 'T3', projectId: 'P1', subprojectId: 'S1' }];
    expect(() =>
      validateTaskParent({ id: 'T5', projectId: 'P1', subprojectId: 'S1', parentTaskId: 'T4' }, deep)
    ).toThrow(/limited to 3 levels/);
  });

  it('refuses a cycle, a self parent and a cross-project parent', () => {
    expect(() =>
      validateTaskParent({ id: 'T1', projectId: 'P1', subprojectId: 'S1', parentTaskId: 'T3' }, tasks)
    ).toThrow(/cycle|limited/i);
    expect(() =>
      validateTaskParent({ id: 'T1', projectId: 'P1', subprojectId: 'S1', parentTaskId: 'T1' }, tasks)
    ).toThrow(/own parent/);
    expect(() =>
      validateTaskParent(
        { id: null, projectId: 'P2', subprojectId: null, parentTaskId: 'T1' },
        tasks
      )
    ).toThrow(/same project/);
    expect(() =>
      validateTaskParent(
        { id: null, projectId: 'P1', subprojectId: 'S2', parentTaskId: 'T2' },
        tasks
      )
    ).toThrow(/same subproject/);
  });

  it('limits subprojects to four levels and validates the whole subtree', () => {
    const nodes = [
      { id: 'S1', parentId: null, projectId: 'P1' },
      { id: 'S2', parentId: 'S1', projectId: 'P1' },
      { id: 'S3', parentId: 'S2', projectId: 'P1' },
      { id: 'S4', parentId: 'S3', projectId: 'P1' }
    ];
    expect(MAX_SUBPROJECT_DEPTH).toBe(4);
    expect(validateSubprojectParent({ id: 'S4', projectId: 'P1', parentId: 'S3' }, nodes).level).toBe(4);
    // A fifth level would be refused by the guard.
    expect(() => validateSubprojectParent({ id: null, projectId: 'P1', parentId: 'S4' }, nodes)).toThrow(
      /limited to 4 levels/
    );
  });

  it('refuses a dependency cycle', () => {
    expect(() =>
      assertNoDependencyCycle([
        { taskId: 'A', dependsOnId: 'B' },
        { taskId: 'B', dependsOnId: 'C' },
        { taskId: 'C', dependsOnId: 'A' }
      ])
    ).toThrow(/cycle/i);
    expect(() =>
      assertNoDependencyCycle([{ taskId: 'A', dependsOnId: 'A' }])
    ).toThrow(/itself/);
    expect(() =>
      assertNoDependencyCycle([
        { taskId: 'A', dependsOnId: 'B' },
        { taskId: 'B', dependsOnId: 'C' }
      ])
    ).not.toThrow();
  });
});

describe('task scope counting', () => {
  const projects = { P1: { status: 'Active' }, P2: { status: 'Archived' } };
  const subprojects = {
    S1: { subprojectId: 'S1', projectId: 'P1', parentSubprojectId: null, status: 'Active' },
    S2: { subprojectId: 'S2', projectId: 'P1', parentSubprojectId: 'S1', status: 'Archived' }
  };
  const today = '2026-01-15';
  const tasks: ScopeTask[] = [
    { taskId: 'A', projectId: 'P1', subprojectId: null, parentTaskId: null, status: 'In Progress', dueDate: '2026-01-10' },
    { taskId: 'B', projectId: 'P1', subprojectId: null, parentTaskId: 'A', status: 'Not Started', dueDate: '2026-02-01' },
    { taskId: 'C', projectId: 'P1', subprojectId: null, parentTaskId: 'A', status: 'Done', dueDate: '2026-01-01' },
    { taskId: 'D', projectId: 'P1', subprojectId: null, parentTaskId: null, status: 'Cancelled', dueDate: null },
    { taskId: 'E', projectId: 'P1', subprojectId: 'S1', parentTaskId: null, status: 'In Progress', dueDate: '2026-01-20' },
    { taskId: 'F', projectId: 'P1', subprojectId: 'S2', parentTaskId: null, status: 'In Progress', dueDate: '2026-01-20' },
    { taskId: 'G', projectId: 'P2', subprojectId: null, parentTaskId: null, status: 'In Progress', dueDate: '2026-01-20' }
  ];

  it('counts leaf work once and never counts a container', () => {
    const scope = createScope(tasks, projects, subprojects, today);
    const counts = scope.counts();
    expect(counts.containers).toBe(1);
    expect(counts.workItems).toBe(6);
    // B is open leaf work, C done, D cancelled, E active, F archived chain, G archived project.
    expect(counts.openWork).toBe(2);
    expect(counts.activeWork).toBe(2);
    expect(counts.completedWork).toBe(1);
    expect(counts.cancelledWork).toBe(1);
    // Overdue counts open leaf work only; the overdue container A is organisation, not work.
    expect(counts.overdueWork).toBe(0);
    expect(scope.isContainer('A')).toBe(true);
    expect(scope.isContainer('B')).toBe(false);
  });

  it('groups with the same policy and lists upcoming work', () => {
    const scope = createScope(tasks, projects, subprojects, today);
    const grouped = scope.countsBy((task) => task.projectId);
    expect(grouped.get('P1')?.openWork).toBe(2);
    expect(grouped.get('P2')?.openWork).toBe(0);
    const upcoming = scope.upcoming('2026-01-15', '2026-01-31').map((task) => task.taskId);
    expect(upcoming).toEqual(['E']);
  });

  it('excludes archived subproject ancestors from active work', () => {
    const scope = createScope(tasks, projects, subprojects, today);
    expect(scope.inActiveWork(tasks[5] as ScopeTask)).toBe(false);
    expect(scope.inActiveWork(tasks[4] as ScopeTask)).toBe(true);
  });
});

describe('progress rollup', () => {
  it('weights known estimates and reports unknown effort separately', () => {
    const result = rollup([
      { taskId: 'A', status: 'In Progress', progressPercent: 50, estimatedHours: 10, parentTaskId: null },
      { taskId: 'B', status: 'Not Started', progressPercent: 0, estimatedHours: null, parentTaskId: null },
      { taskId: 'C', status: 'Cancelled', progressPercent: 90, estimatedHours: 5, parentTaskId: null }
    ]);
    // 10 weight at 50% + 1 fallback weight at 0% => 5 / 11
    expect(result.percent).toBeCloseTo(45.45, 1);
    expect(result.unknown).toBe(1);
    expect(result.cancelledLeaves).toBe(1);
  });

  it('never double counts a container and its children', () => {
    const result = rollup([
      { taskId: 'P', status: 'Done', progressPercent: 100, estimatedHours: 100, parentTaskId: null },
      { taskId: 'C1', status: 'In Progress', progressPercent: 50, estimatedHours: 10, parentTaskId: 'P' },
      { taskId: 'C2', status: 'Not Started', progressPercent: 0, estimatedHours: 10, parentTaskId: 'P' }
    ]);
    expect(result.containers).toBe(1);
    expect(result.leaves).toBe(2);
    expect(result.percent).toBeCloseTo(25, 5);
  });

  it('treats zero estimates as weightless but counted', () => {
    const result = rollup([
      { taskId: 'A', status: 'Done', progressPercent: 100, estimatedHours: 0, parentTaskId: null },
      { taskId: 'B', status: 'In Progress', progressPercent: 50, estimatedHours: 0, parentTaskId: null }
    ]);
    expect(result.zeroEstimate).toBe(2);
    expect(result.percent).toBeCloseTo(75, 5);
  });
});

describe('planning', () => {
  const calendar = createCalendar([{ date: '2026-01-05' }]);

  it('back-plans working days from a deadline', () => {
    const plan = planFromDuration(
      { deadline: '2026-01-09', value: 5, unit: 'DAY', basis: 'WORKING_DAYS' },
      calendar
    );
    expect(plan.startDate).toBe('2026-01-02');
    expect(plan.plannedEnd).toBe('2026-01-09');
    expect(plan.deadlineIsWorkingDay).toBe(true);
  });

  it('back-plans calendar days and weeks', () => {
    const plan = planFromDuration(
      { deadline: '2026-01-09', value: 3, unit: 'DAY', basis: 'CALENDAR_DAYS' },
      calendar
    );
    expect(plan.startDate).toBe('2026-01-07');
    const weeks = planFromDuration(
      { deadline: '2026-01-09', value: 1, unit: 'WEEK', basis: 'WORKING_DAYS' },
      calendar
    );
    expect(weeks.length).toBe(5);
  });

  it('warns about a non-working deadline and requires acknowledgement', () => {
    const warnings = planningWarnings(
      {
        deadline: '2026-01-03',
        today: '2026-01-01',
        durationValue: 2,
        durationUnit: 'DAY',
        durationBasis: 'WORKING_DAYS',
        holidays: [{ date: '2026-01-05' }]
      },
      createCalendar([{ date: '2026-01-05' }])
    );
    expect(warnings.map((warning) => warning.code)).toContain('NON_WORKING_DEADLINE');
    expect(warnings.find((warning) => warning.code === 'NON_WORKING_DEADLINE')?.requiresAcknowledgement).toBe(true);
    expect(warnings.find((warning) => warning.code === 'NON_WORKING_DEADLINE')?.message).toContain('working day');
  });

  it('keeps a legacy planned start when no duration exists', () => {
    const applied = applyTaskPlan(
      {
        dueDate: '2026-01-09',
        plannedDurationValue: null,
        plannedDurationUnit: null,
        plannedDurationBasis: null,
        plannedStart: '2025-12-01',
        plannedStartSource: 'LEGACY'
      },
      calendar
    );
    expect(applied.plannedStart).toBe('2025-12-01');
    expect(applied.plan).toBeNull();
  });

  it('back-plans phases and marks an unknown duration as DRAFT', () => {
    const schedule = schedulePhases(
      '2026-02-27',
      [
        { phaseId: 'A', phaseName: '設計', durationDays: 10, bufferDays: 0, dependencyIds: [] },
        { phaseId: 'B', phaseName: '試作', durationDays: null, bufferDays: 0, dependencyIds: ['A'] }
      ],
      calendar
    );
    expect(schedule.get('B')?.status).toBe('DRAFT');
    expect(schedule.get('A')?.status).toBe('DRAFT');
  });
});

describe('request lifecycle', () => {
  const request = {
    requestId: 'REQ-1',
    requestType: 'DEADLINE_CHANGE' as const,
    status: 'PENDING' as const,
    taskId: 'T1',
    requestedDueDate: '2026-02-10',
    taskRevisionAtSubmission: '3',
    dueDateAtSubmission: '2026-02-01'
  };
  const task = { taskId: 'T1', revision: 3, dueDate: '2026-02-01', status: 'In Progress', container: false };

  it('approves a deadline change once', () => {
    const outcome = planDecision(request, 'APPROVE', task);
    expect(outcome.taskEffect).toBe('DEADLINE_CHANGED');
    expect(outcome.dueDate).toBe('2026-02-10');
    expect(outcome.historyRequired).toBe(true);
  });

  it('refuses a repeated decision and a stale request', () => {
    expect(() => planDecision({ ...request, status: 'APPROVED' }, 'APPROVE', task)).toThrow(/already been decided/);
    expect(() => planDecision(request, 'APPROVE', { ...task, revision: 4 })).toThrow(/changed after/);
    expect(() => planDecision(request, 'APPROVE', { ...task, dueDate: '2026-02-02' })).toThrow(/changed after/);
  });

  it('never applies a task effect for reject or return', () => {
    expect(planDecision(request, 'REJECT', task).taskEffect).toBe('NONE');
    expect(planDecision(request, 'RETURN', task).taskEffect).toBe('NONE');
  });

  it('refuses a completion report for a container', () => {
    expect(() =>
      planDecision({ ...request, requestType: 'COMPLETION_REPORT', requestedDueDate: null }, 'APPROVE', {
        ...task,
        container: true
      })
    ).toThrow(/organisation only/);
  });

  it('detects staleness from the normalized snapshot text', () => {
    expect(
      evaluateStaleness(
        { status: 'PENDING', requestType: 'DEADLINE_CHANGE', taskRevisionAtSubmission: ' 3 ', dueDateAtSubmission: '2026-02-01' },
        task
      ).stale
    ).toBe(false);
    expect(
      evaluateStaleness(
        { status: 'PENDING', requestType: 'DEADLINE_CHANGE', taskRevisionAtSubmission: '3', dueDateAtSubmission: '2026-01-31' },
        task
      )
    ).toEqual({ stale: true, reason: 'DEADLINE_CHANGED' });
  });
});

describe('completion and lifecycle', () => {
  it('refuses a direct Done transition', () => {
    expect(() => assertNotDirectCompletion('In Progress', 'Done')).toThrow(/reviewed completion workflow/);
    expect(() => assertNotDirectCompletion('Done', 'Done')).not.toThrow();
  });

  it('requires an ADMIN, a reason and the typed confirmation for an override', () => {
    const base = { task: { taskId: 'T1', status: 'In Progress', container: false, assignmentApprovedAt: null }, reason: 'fix', confirmation: 'COMPLETE T1' };
    expect(() => assertOverrideAllowed({ ...base, actorRole: 'MANAGER' })).toThrow(/ADMIN/);
    expect(() => assertOverrideAllowed({ ...base, actorRole: 'ADMIN', reason: ' ' })).toThrow(/reason/);
    expect(() => assertOverrideAllowed({ ...base, actorRole: 'ADMIN', confirmation: 'DELETE T1' })).toThrow(/exactly/);
    expect(() => assertOverrideAllowed({ ...base, actorRole: 'ADMIN' })).not.toThrow();
  });

  it('requires every task to be done before a project is completed', () => {
    expect(() =>
      assertProjectCompletable([
        { taskId: 'A', status: 'Done' },
        { taskId: 'B', status: 'Cancelled' }
      ])
    ).not.toThrow();
    expect(() => assertProjectCompletable([{ taskId: 'A', status: 'In Progress' }])).toThrow(/all its tasks are done/);
  });

  it('blocks deletion of a record with operational evidence and requires the typed phrase', () => {
    const clean = deletionPreflight({ entityType: 'TASKS', entityId: 'T1' });
    expect(clean.deletable).toBe(true);
    expect(() => assertDeletionAllowed(clean, 'DELETE T2')).toThrow(/exactly/);
    expect(() => assertDeletionAllowed(clean, 'DELETE T1')).not.toThrow();

    const busy = deletionPreflight({
      entityType: 'TASKS',
      entityId: 'T1',
      descendants: undefined,
      dependencyCount: 1,
      recordedEffort: true,
      requests: true
    } as never);
    expect(busy.deletable).toBe(false);
    expect(busy.blockers.map((blocker) => blocker.code)).toContain('DEPENDENCY_REFERENCED');

    const historical = deletionPreflight({
      entityType: 'TASKS',
      entityId: 'T1',
      deadlineHistory: true,
      scheduleConfirmations: true
    });
    expect(historical.deletable).toBe(false);
    expect(historical.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(['DEADLINE_HISTORY', 'SCHEDULE_CONFIRMATIONS'])
    );
  });
});

describe('notification policy', () => {
  const settings = {
    EMAIL_MODE: 'LIVE',
    EMERGENCY_STOP: 'false',
    ALLOWED_RECIPIENT_DOMAINS: 'example.co.jp',
    MAX_EMAILS_PER_RUN: '2'
  };

  it('fails closed for mode, emergency stop and domains', () => {
    expect(effectiveEmailMode({})).toBe('OFF');
    expect(effectiveEmailMode({ EMAIL_MODE: 'LIVE', EMERGENCY_STOP: 'true' })).toBe('OFF');
    expect(effectiveEmailMode({ EMAIL_MODE: 'live', EMERGENCY_STOP: 'false' })).toBe('LIVE');
    expect(recipientDomainAllowed('a@example.co.jp', settings)).toBe(true);
    expect(recipientDomainAllowed('a@outside.example', settings)).toBe(false);
    expect(recipientDomainAllowed('a@example.co.jp', {})).toBe(false);
    expect(maxEmailsPerRun(settings)).toBe(2);
    expect(maxEmailsPerRun({ MAX_EMAILS_PER_RUN: '0' })).toBe(0);
  });

  it('requires ADMIN, the exact phrase and a preflight for LIVE', () => {
    expect(() =>
      assertLiveAllowed({ actorRole: 'MANAGER', confirmation: LIVE_CONFIRMATION, preflightPassed: true, settings })
    ).toThrow(/ADMIN/);
    expect(() =>
      assertLiveAllowed({ actorRole: 'ADMIN', confirmation: 'live', preflightPassed: true, settings })
    ).toThrow(/exactly/);
    expect(() =>
      assertLiveAllowed({ actorRole: 'ADMIN', confirmation: LIVE_CONFIRMATION, preflightPassed: false, settings })
    ).toThrow(/preflight/);
    expect(() =>
      assertLiveAllowed({ actorRole: 'ADMIN', confirmation: LIVE_CONFIRMATION, preflightPassed: true, settings })
    ).not.toThrow();
  });

  it('keys a notification by what it announces', () => {
    const key = notificationKey({ kind: 'ASSIGNMENT', taskId: 'T1', recipient: 'A@Example.co.jp', dueDate: '2026-02-01', assignmentVersion: 2 });
    expect(key).toBe('ASSIGNMENT|T1|a@example.co.jp|2026-02-01|2');
    expect(
      notificationKey({ kind: 'ASSIGNMENT', taskId: 'T1', recipient: 'a@example.co.jp', dueDate: '2026-03-01', assignmentVersion: 2 })
    ).not.toBe(key);
  });

  it('backs off with a bounded delay', () => {
    expect(retryDelaySeconds(0)).toBe(30);
    expect(retryDelaySeconds(100)).toBeLessThanOrEqual(3600);
  });
});

describe('roles', () => {
  it('keeps a blank role at least privilege', () => {
    expect(effectiveRole(null)).toBe('VIEWER');
    expect(effectiveRole('')).toBe('VIEWER');
    expect(effectiveRole('manager')).toBe('MANAGER');
  });

  it('refuses an inactive or unverified identity', () => {
    expect(() => requireRole({ ...admin, active: false }, 'MANAGER')).toThrow(/active/i);
    expect(() => requireRole({ ...admin, verified: false }, 'MANAGER')).toThrow(/verified/i);
    expect(() => requireRole({ ...admin, role: 'MEMBER' }, 'MANAGER')).toThrow(/Insufficient/);
  });

  it('protects the last active administrator and self-changes', () => {
    expect(() =>
      assertRoleChangeAllowed({
        actor: admin,
        targetMemberId: 'MEM-ADMIN',
        targetRole: 'MEMBER',
        targetActive: true,
        activeAdministratorIds: ['MEM-ADMIN']
      })
    ).toThrow(/own role/);
    expect(() =>
      assertRoleChangeAllowed({
        actor: { ...admin, memberId: 'MEM-ADMIN2' },
        targetMemberId: 'MEM-ADMIN',
        targetRole: null,
        targetActive: false,
        activeAdministratorIds: ['MEM-ADMIN']
      })
    ).toThrow(/last active administrator/);
    expect(() =>
      assertRoleChangeAllowed({
        actor: admin,
        targetMemberId: 'MEM-X',
        targetRole: 'MANAGER',
        targetActive: true,
        activeAdministratorIds: ['MEM-ADMIN']
      })
    ).not.toThrow();
  });
});

describe('publication allowlist', () => {
  const base = {
    taskId: 'T1',
    taskName: 'Task',
    projectId: 'P1',
    projectName: 'Project',
    responsibilityId: 'R1',
    responsibilityName: 'Area',
    responsibilityColor: '#123456',
    status: 'In Progress',
    dueDate: '2026-02-01',
    plannedStart: '2026-01-10',
    ownerName: 'Owner',
    assigneeNames: ['Owner', 'Second'],
    container: false,
    parentTaskId: null,
    reviewState: 'NONE',
    completedAt: null,
    progressPercent: 40,
    pendingRequest: true,
    projectVisibility: 'INTERNAL'
  };

  it('publishes only allowlisted fields and only an INTERNAL project', () => {
    const row = toPublishedRow(base);
    expect(row).not.toBeNull();
    expect(Object.keys(row as object).sort()).toEqual(
      [
        'taskId',
        'taskName',
        'projectId',
        'projectName',
        'responsibilityId',
        'responsibilityName',
        'responsibilityColor',
        'status',
        'dueDate',
        'plannedStart',
        'ownerName',
        'assigneeNames',
        'container',
        'parentTaskId',
        'reviewState',
        'completedAt',
        'progressPercent',
        'pendingRequest'
      ].sort()
    );
    expect(toPublishedRow({ ...base, projectVisibility: 'RESTRICTED' })).toBeNull();
    expect(toPublishedRow({ ...base, projectVisibility: '' })).toBeNull();
  });

  it('verifies headers, row count and hash before commit', () => {
    expect(() =>
      verifyPublication({ headersMatch: true, rowCount: 1, expectedRows: 2, hash: 'a', expectedHash: 'a' })
    ).toThrow(/expected 2/);
    expect(() =>
      verifyPublication({ headersMatch: false, rowCount: 1, expectedRows: 1, hash: 'a', expectedHash: 'a' })
    ).toThrow(/headers/);
    expect(() =>
      verifyPublication({ headersMatch: true, rowCount: 1, expectedRows: 1, hash: 'b', expectedHash: 'a' })
    ).toThrow(/hash/);
    expect(inactiveSlot('A')).toBe('B');
    expect(inactiveSlot('B')).toBe('A');
    expect(inactiveSlot('NONE')).toBe('A');
    expect(canonicalJson({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}');
  });
});

describe('project colours', () => {
  it('derives a palette colour from the stable identifier only', () => {
    expect(projectColor('PRJ-1')).toBe(projectColor('PRJ-1'));
    expect(PROJECT_COLOR_PALETTE).toContain(projectColor('PRJ-1'));
    expect(projectColor('')).toBe('');
    expect(projectColor(null)).toBe('');
    expect(projectColor('PRJ-1')).not.toBe(projectColor('PRJ-2'));
    const vars = projectColorVars('PRJ-1');
    expect(vars['--project-accent']).toBe(projectColor('PRJ-1'));
    expect(vars['--project-outline']).toContain('rgba(');
  });
});

describe('date helpers', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
