/**
 * Deadline + required duration drive the schedule; the planned start is derived.
 *
 * A duration is a schedule length, never labour hours: `Estimated_Hours` is never derived from
 * it. A legacy row keeps its stored start, because a duration is never inferred from history
 * and a blank duration never invents an estimate.
 */
import type { DurationBasis, DurationUnit } from '@eh/contracts';
import { DomainError } from './errors';
import { addDays, compareDates, createCalendar, isIsoDate, type WorkingCalendar } from './time';

export type PlanWarningCode =
  | 'MISSING_DEADLINE'
  | 'PAST_DEADLINE'
  | 'NON_WORKING_DEADLINE'
  | 'MISSING_DURATION'
  | 'PAST_START'
  | 'MILESTONE_OVERLAP';

export type PlanWarning = {
  code: PlanWarningCode;
  message: string;
  params?: Record<string, string>;
  requiresAcknowledgement: boolean;
};

const WARNING_MESSAGE: Record<PlanWarningCode, string> = {
  MISSING_DEADLINE: 'A deadline is required',
  PAST_DEADLINE: 'The deadline is already in the past',
  NON_WORKING_DEADLINE: 'The deadline is not a working day',
  MISSING_DURATION: 'The required duration is missing',
  PAST_START: 'The derived start date is already in the past',
  MILESTONE_OVERLAP: 'A milestone falls inside the derived schedule'
};

export type DurationInput = {
  deadline: string;
  value: number | null;
  unit: DurationUnit | null;
  basis: DurationBasis | null;
};

export type DerivedPlan = {
  startDate: string;
  endDate: string;
  plannedEnd: string;
  length: number;
  durationValue: number;
  durationUnit: DurationUnit;
  durationBasis: DurationBasis;
  deadlineIsWorkingDay: boolean;
};

const ACKNOWLEDGEMENT_CODES: ReadonlySet<PlanWarningCode> = new Set(['NON_WORKING_DEADLINE']);

export function planFromDuration(input: DurationInput, calendar: WorkingCalendar = createCalendar()): DerivedPlan {
  const end = input.deadline;
  if (!isIsoDate(end)) throw new DomainError('VALIDATION_FAILED', 'A deadline is required (YYYY-MM-DD)');
  const amount = Number(input.value);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    throw new DomainError('VALIDATION_FAILED', 'The required duration must be a positive whole number');
  }
  const unit = (input.unit ?? 'DAY') as DurationUnit;
  if (unit !== 'DAY' && unit !== 'WEEK') {
    throw new DomainError('VALIDATION_FAILED', 'Duration unit must be DAY or WEEK');
  }
  const basis = (input.basis ?? 'WORKING_DAYS') as DurationBasis;
  if (basis !== 'WORKING_DAYS' && basis !== 'CALENDAR_DAYS') {
    throw new DomainError('VALIDATION_FAILED', 'Duration basis must be WORKING_DAYS or CALENDAR_DAYS');
  }
  const length = unit === 'WEEK' ? amount * (basis === 'WORKING_DAYS' ? 5 : 7) : amount;

  let start: string;
  let plannedEnd: string;
  if (basis === 'WORKING_DAYS') {
    plannedEnd = calendar.previousWorkingDay(end, true);
    start = plannedEnd;
    for (let index = 1; index < length; index += 1) {
      start = calendar.previousWorkingDay(start, false);
    }
  } else {
    plannedEnd = end;
    start = addDays(end, -(length - 1));
  }
  return {
    startDate: start,
    endDate: end,
    plannedEnd,
    length,
    durationValue: amount,
    durationUnit: unit,
    durationBasis: basis,
    deadlineIsWorkingDay: calendar.isWorkingDay(end)
  };
}

export function planningWarnings(
  input: {
    deadline: string | null;
    today?: string;
    durationValue: number | null;
    durationUnit: DurationUnit | null;
    durationBasis: DurationBasis | null;
    holidays?: readonly { date: string; name?: string }[];
    milestones?: readonly { name: string; targetDate: string | null }[];
  },
  calendar?: WorkingCalendar
): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const warn = (code: PlanWarningCode, params?: Record<string, string>): void => {
    warnings.push({
      code,
      message: WARNING_MESSAGE[code],
      params,
      requiresAcknowledgement: ACKNOWLEDGEMENT_CODES.has(code)
    });
  };
  const cal = calendar ?? createCalendar(input.holidays ?? []);
  if (!input.deadline || !isIsoDate(input.deadline)) {
    warn('MISSING_DEADLINE');
    return warnings;
  }
  const today = input.today;
  if (today && input.deadline < today) warn('PAST_DEADLINE');
  if (!cal.isWorkingDay(input.deadline)) warn('NON_WORKING_DEADLINE');
  const duration = Number(input.durationValue);
  if (!Number.isFinite(duration) || duration <= 0) {
    warn('MISSING_DURATION');
    return warnings;
  }
  const plan = planFromDuration(
    {
      deadline: input.deadline,
      value: duration,
      unit: input.durationUnit,
      basis: input.durationBasis
    },
    cal
  );
  if (today && plan.startDate < today) warn('PAST_START');
  for (const milestone of input.milestones ?? []) {
    if (!milestone.targetDate) continue;
    if (milestone.targetDate >= plan.startDate && milestone.targetDate <= plan.plannedEnd) {
      warn('MILESTONE_OVERLAP', { name: milestone.name });
    }
  }
  return warnings;
}

export type PhaseInput = {
  phaseId: string;
  phaseName: string;
  durationDays: number | null;
  bufferDays: number | null;
  dependencyIds: string[];
};

export type PhaseSchedule = {
  startDate: string;
  plannedEnd: string;
  endDate: string;
  status: 'PLANNED' | 'DRAFT';
};

/**
 * Back-plans phases from a committed deadline. A phase ends before the earliest start of the
 * phases that depend on it. An unknown duration, a missing dependency or a dependency that is
 * itself DRAFT makes the phase DRAFT; nothing is guessed. Cycles are refused, not recursed.
 */
export function schedulePhases(
  deadline: string,
  phases: readonly PhaseInput[],
  calendar: WorkingCalendar = createCalendar()
): Map<string, PhaseSchedule> {
  if (!isIsoDate(deadline)) throw new DomainError('VALIDATION_FAILED', 'A committed deadline is required');
  const byId = new Map(phases.map((phase) => [phase.phaseId, phase]));
  const successors = new Map<string, string[]>();
  for (const phase of phases) {
    for (const dependencyId of phase.dependencyIds) {
      if (dependencyId === phase.phaseId) {
        throw new DomainError('DEPENDENCY_CYCLE', `Phase ${phase.phaseId} depends on itself`);
      }
      if (!byId.has(dependencyId)) {
        throw new DomainError('DEPENDENCY_INVALID', `Unknown phase dependency ${dependencyId}`);
      }
      const list = successors.get(dependencyId) ?? [];
      list.push(phase.phaseId);
      successors.set(dependencyId, list);
    }
  }
  const memo = new Map<string, PhaseSchedule>();
  const visiting = new Set<string>();

  const schedule = (phaseId: string): PhaseSchedule => {
    const cached = memo.get(phaseId);
    if (cached) return cached;
    if (visiting.has(phaseId)) throw new DomainError('DEPENDENCY_CYCLE', 'Phase dependencies form a cycle');
    visiting.add(phaseId);
    const phase = byId.get(phaseId);
    if (!phase) throw new DomainError('DEPENDENCY_INVALID', `Unknown phase ${phaseId}`);
    const downstream = successors.get(phaseId) ?? [];
    const downstreamSchedules = downstream.map(schedule);
    const draft = downstreamSchedules.some((entry) => entry.status === 'DRAFT');
    const duration = phase.durationDays;
    const unknown = duration === null || duration === undefined || !Number.isFinite(duration) || duration <= 0;

    let end = calendar.previousWorkingDay(deadline, true);
    for (const next of downstreamSchedules) {
      const candidate = calendar.previousWorkingDay(next.startDate, false);
      if (compareDates(candidate, end) < 0) end = candidate;
    }
    const days = unknown ? 1 : Math.max(1, Math.floor(duration)) + Math.max(0, Math.floor(phase.bufferDays ?? 0));
    let start = end;
    for (let index = 1; index < days; index += 1) start = calendar.previousWorkingDay(start, false);
    const result: PhaseSchedule = {
      startDate: start,
      plannedEnd: end,
      endDate: deadline,
      status: unknown || draft ? 'DRAFT' : 'PLANNED'
    };
    memo.set(phaseId, result);
    visiting.delete(phaseId);
    return result;
  };

  for (const phase of phases) schedule(phase.phaseId);
  return memo;
}

export type TaskPlanFields = {
  dueDate: string | null;
  plannedDurationValue: number | null;
  plannedDurationUnit: DurationUnit | null;
  plannedDurationBasis: DurationBasis | null;
  plannedStart: string | null;
  plannedStartSource: 'DERIVED' | 'LEGACY' | 'MANUAL' | null;
};

/** Applies a derived start only when both a deadline and a manager-entered duration exist. */
export function applyTaskPlan(
  task: TaskPlanFields,
  calendar: WorkingCalendar = createCalendar()
): { plannedStart: string | null; plannedStartSource: 'DERIVED' | 'LEGACY' | 'MANUAL' | null; plan: DerivedPlan | null } {
  const duration = task.plannedDurationValue;
  const known = duration !== null && duration !== undefined && Number.isFinite(duration) && duration > 0;
  if (known && task.dueDate) {
    const plan = planFromDuration(
      {
        deadline: task.dueDate,
        value: duration,
        unit: task.plannedDurationUnit,
        basis: task.plannedDurationBasis
      },
      calendar
    );
    return { plannedStart: plan.startDate, plannedStartSource: 'DERIVED', plan };
  }
  if (!known) {
    return { plannedStart: task.plannedStart, plannedStartSource: task.plannedStart ? 'LEGACY' : null, plan: null };
  }
  return { plannedStart: task.plannedStart, plannedStartSource: task.plannedStartSource, plan: null };
}
