/**
 * Date-based workload report.
 *
 * The server resolves the period once and every figure is a task count over those dates. There is
 * no hour, capacity or utilisation value: the task system no longer requires an estimate, and a
 * missing estimate is never treated as zero workload. Assignment tables record who is assigned
 * now, so the answer states that basis instead of pretending to be a historical snapshot.
 */
import type { WorkloadReport, WorkloadTaskPage } from '@eh/contracts';
import { businessDate, requireRole, resolveWorkloadPeriod } from '@eh/domain';
import {
  workloadBucketCounts,
  workloadEmployeeCounts,
  workloadSummary,
  workloadTaskPage,
  type WorkloadEmployeeSort,
  type WorkloadFilters,
  type WorkloadTaskKind
} from '@eh/db';
import type { ServiceCtx } from './common';

export type WorkloadReportInput = {
  mode?: string;
  anchor?: string;
  start?: string;
  end?: string;
  granularity?: string;
  memberId?: string;
  projectId?: string;
  responsibilityId?: string;
  memberQuery?: string;
  sort?: WorkloadEmployeeSort;
  direction?: 'asc' | 'desc';
};

export type WorkloadDrilldownInput = WorkloadReportInput & {
  kind?: WorkloadTaskKind;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

function filtersFor(period: { start: string; end: string }, today: string, input: WorkloadReportInput): WorkloadFilters {
  return {
    start: period.start,
    end: period.end,
    today,
    memberId: input.memberId ?? null,
    projectId: input.projectId ?? null,
    responsibilityId: input.responsibilityId ?? null
  };
}

export async function workloadReport(ctx: ServiceCtx, input: WorkloadReportInput = {}): Promise<WorkloadReport> {
  requireRole(ctx.identity, 'MANAGER');
  const today = businessDate();
  const period = resolveWorkloadPeriod({ ...input, today });
  const filters = filtersFor(period, today, input);
  const sort: WorkloadEmployeeSort = input.sort ?? 'overdue';
  const direction = input.direction ?? (sort === 'name' ? 'asc' : 'desc');
  const [summary, buckets, employees] = await Promise.all([
    workloadSummary(ctx.db, filters),
    workloadBucketCounts(ctx.db, filters, period.buckets),
    workloadEmployeeCounts(ctx.db, filters, { sort, direction, memberQuery: input.memberQuery ?? null })
  ]);
  return {
    mode: period.mode,
    start: period.start,
    end: period.end,
    today,
    granularity: period.granularity,
    summary,
    buckets,
    employees,
    assignmentBasis: 'CURRENT_ASSIGNMENTS',
    generatedAt: new Date().toISOString()
  };
}

export async function workloadDrilldown(
  ctx: ServiceCtx,
  input: WorkloadDrilldownInput = {}
): Promise<WorkloadTaskPage> {
  requireRole(ctx.identity, 'MANAGER');
  const today = businessDate();
  const period = resolveWorkloadPeriod({ ...input, today });
  const filters = filtersFor(period, today, input);
  const kind: WorkloadTaskKind = input.kind ?? 'DUE';
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const result = await workloadTaskPage(ctx.db, filters, {
    kind,
    from: input.from ?? period.start,
    to: input.to ?? period.end,
    page,
    pageSize
  });
  return {
    ...result,
    kind,
    from: input.from ?? period.start,
    to: input.to ?? period.end
  };
}
