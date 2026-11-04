/**
 * Date-based workload reporting.
 *
 * One SQL scope defines what a report counts, so a figure can never disagree with the manager
 * dashboard: open leaf work (a container task is organisation, not work) in a working project and
 * whole subproject chain, attributed through the effective assignment set (primary owner plus
 * active additional assignees, deduplicated by task and member).
 *
 * Every read is date-filtered inside PostgreSQL before rows leave it, every identifier is a bound
 * parameter, every list is bounded, and the drilldown is paginated. No hour, capacity or
 * utilisation value is computed here, because the report measures tasks, not time.
 */
import type { TaskStatus } from '@eh/contracts';
import type { Queryable } from '../pool';

type Db = Queryable;

export type WorkloadFilters = {
  /** Inclusive report period in Asia/Tokyo calendar dates. */
  start: string;
  end: string;
  /** Business date used for the "already overdue" figures. */
  today: string;
  memberId?: string | null;
  projectId?: string | null;
  responsibilityId?: string | null;
};

const OPEN_STATUSES = "('Not Started','Assigned','In Progress','Blocked','On Hold')";
const WORKING_PROJECT_STATUSES = "('Planned','Active')";

/**
 * Parameters $1 start, $2 end, $3 today, $4 project, $5 responsibility, $6 member are shared by
 * every query in this module; callers must keep that order.
 */
const SCOPE_CTE = `
WITH RECURSIVE sp_chain AS (
  SELECT s.subproject_id AS root_id, s.subproject_id AS node_id, s.parent_subproject_id,
         s.status, s.deleted_at, 1 AS depth
    FROM subprojects s
  UNION ALL
  SELECT c.root_id, p.subproject_id, p.parent_subproject_id, p.status, p.deleted_at, c.depth + 1
    FROM sp_chain c
    JOIN subprojects p ON p.subproject_id = c.parent_subproject_id
   WHERE c.depth < 8
),
sp_state AS (
  SELECT root_id,
         coalesce(bool_and(status IN ${WORKING_PROJECT_STATUSES} AND deleted_at IS NULL), false) AS chain_ok,
         coalesce(bool_or(parent_subproject_id IS NULL), false) AS reaches_root
    FROM sp_chain
   GROUP BY root_id
),
active_subprojects AS (
  SELECT root_id AS subproject_id FROM sp_state WHERE chain_ok AND reaches_root
),
effective AS (
  SELECT t.task_id, t.owner_member_id AS member_id
    FROM tasks t
   WHERE t.owner_member_id IS NOT NULL
  UNION
  SELECT ta.task_id, ta.member_id
    FROM task_assignees ta
   WHERE ta.removed_at IS NULL
),
scope AS (
  SELECT t.task_id, t.project_id, t.status, t.due_date,
         (t.completed_at AT TIME ZONE 'Asia/Tokyo')::date AS completed_date
    FROM tasks t
    JOIN projects p ON p.project_id = t.project_id
   WHERE t.deleted_at IS NULL
     AND p.deleted_at IS NULL
     AND p.status IN ${WORKING_PROJECT_STATUSES}
     AND t.status <> 'Cancelled'
     AND NOT EXISTS (
       SELECT 1 FROM tasks child
        WHERE child.parent_task_id = t.task_id AND child.deleted_at IS NULL)
     AND (t.subproject_id IS NULL OR t.subproject_id IN (SELECT subproject_id FROM active_subprojects))
     AND ($4::text IS NULL OR t.project_id = $4)
     AND ($5::text IS NULL OR p.responsibility_id = $5)
     AND ($6::text IS NULL OR EXISTS (
       SELECT 1 FROM effective e WHERE e.task_id = t.task_id AND e.member_id = $6))
),
/* Types the period parameters for every statement, including one that only buckets by date. */
period AS (
  SELECT $1::date AS report_start, $2::date AS report_end, $3::date AS report_today
)`;

function baseParams(filters: WorkloadFilters): unknown[] {
  return [
    filters.start,
    filters.end,
    filters.today,
    filters.projectId ?? null,
    filters.responsibilityId ?? null,
    filters.memberId ?? null
  ];
}

export type WorkloadSummaryCounts = {
  dueTasks: number;
  completedTasks: number;
  overdueTasks: number;
  undatedTasks: number;
  overdueWithinPeriod: number;
  backlogBeforePeriod: number;
  uniqueTasks: number;
  assignments: number;
};

export async function workloadSummary(db: Db, filters: WorkloadFilters): Promise<WorkloadSummaryCounts> {
  const row = await db.one<{
    due_tasks: number;
    completed_tasks: number;
    overdue_tasks: number;
    undated_tasks: number;
    overdue_within_period: number;
    backlog_before_period: number;
    unique_tasks: number;
    assignments: number;
  }>(
    `${SCOPE_CTE}
     SELECT
       count(*) FILTER (WHERE due_date BETWEEN $1::date AND $2::date)::int AS due_tasks,
       count(*) FILTER (WHERE completed_date BETWEEN $1::date AND $2::date)::int AS completed_tasks,
       count(*) FILTER (WHERE status IN ${OPEN_STATUSES} AND due_date < $3::date)::int AS overdue_tasks,
       count(*) FILTER (WHERE status IN ${OPEN_STATUSES} AND due_date IS NULL)::int AS undated_tasks,
       count(*) FILTER (WHERE status IN ${OPEN_STATUSES}
                          AND due_date BETWEEN $1::date AND $2::date
                          AND due_date < $3::date)::int AS overdue_within_period,
       count(*) FILTER (WHERE status IN ${OPEN_STATUSES} AND due_date < $1::date)::int AS backlog_before_period,
       count(*) FILTER (WHERE due_date BETWEEN $1::date AND $2::date
                          OR completed_date BETWEEN $1::date AND $2::date
                          OR (status IN ${OPEN_STATUSES} AND (due_date IS NULL OR due_date < $1::date)))::int
         AS unique_tasks,
       (SELECT count(*) FROM effective e
          JOIN scope s ON s.task_id = e.task_id
         WHERE ($6::text IS NULL OR e.member_id = $6)
           AND (s.due_date BETWEEN $1::date AND $2::date
             OR s.completed_date BETWEEN $1::date AND $2::date
             OR (s.status IN ${OPEN_STATUSES} AND (s.due_date IS NULL OR s.due_date < $1::date))))::int
         AS assignments
       FROM scope`,
    baseParams(filters)
  );
  return {
    dueTasks: row?.due_tasks ?? 0,
    completedTasks: row?.completed_tasks ?? 0,
    overdueTasks: row?.overdue_tasks ?? 0,
    undatedTasks: row?.undated_tasks ?? 0,
    overdueWithinPeriod: row?.overdue_within_period ?? 0,
    backlogBeforePeriod: row?.backlog_before_period ?? 0,
    uniqueTasks: row?.unique_tasks ?? 0,
    assignments: row?.assignments ?? 0
  };
}

export type WorkloadBucketInput = { key: string; start: string; end: string };

export type WorkloadBucketRow = WorkloadBucketInput & {
  dueTasks: number;
  completedTasks: number;
  overdueTasks: number;
};

export async function workloadBucketCounts(
  db: Db,
  filters: WorkloadFilters,
  buckets: readonly WorkloadBucketInput[]
): Promise<WorkloadBucketRow[]> {
  if (buckets.length === 0) return [];
  const values = buckets.map((_, index) => `($${index * 3 + 7}::text, $${index * 3 + 8}::date, $${index * 3 + 9}::date)`);
  const params = [
    ...baseParams(filters),
    ...buckets.flatMap((bucket) => [bucket.key, bucket.start, bucket.end])
  ];
  const rows = await db.many<{
    key: string;
    bstart: string;
    bend: string;
    due_tasks: number;
    completed_tasks: number;
    overdue_tasks: number;
  }>(
    `${SCOPE_CTE},
     buckets(key, bstart, bend) AS (VALUES ${values.join(', ')}),
     due AS (
       SELECT b.key, count(*)::int AS n FROM buckets b
         JOIN scope s ON s.due_date BETWEEN b.bstart AND b.bend
        GROUP BY b.key),
     completed AS (
       SELECT b.key, count(*)::int AS n FROM buckets b
         JOIN scope s ON s.completed_date BETWEEN b.bstart AND b.bend
        GROUP BY b.key),
     overdue AS (
       SELECT b.key, count(*)::int AS n FROM buckets b
         JOIN scope s ON s.status IN ${OPEN_STATUSES}
                     AND s.due_date BETWEEN b.bstart AND b.bend
                     AND s.due_date < $3::date
        GROUP BY b.key)
     SELECT b.key, b.bstart::text AS bstart, b.bend::text AS bend,
            coalesce(due.n, 0)::int AS due_tasks,
            coalesce(completed.n, 0)::int AS completed_tasks,
            coalesce(overdue.n, 0)::int AS overdue_tasks
       FROM buckets b
       LEFT JOIN due ON due.key = b.key
       LEFT JOIN completed ON completed.key = b.key
       LEFT JOIN overdue ON overdue.key = b.key
      ORDER BY b.bstart`,
    params
  );
  return rows.map((row) => ({
    key: row.key,
    start: row.bstart,
    end: row.bend,
    dueTasks: row.due_tasks,
    completedTasks: row.completed_tasks,
    overdueTasks: row.overdue_tasks
  }));
}

export type WorkloadEmployeeSort = 'overdue' | 'due' | 'name';

export type WorkloadEmployeeCount = {
  memberId: string;
  memberName: string;
  active: boolean;
  dueTasks: number;
  completedTasks: number;
  overdueTasks: number;
  undatedTasks: number;
};

const EMPLOYEE_SORTS: Record<WorkloadEmployeeSort, string> = {
  overdue: 'coalesce(agg.overdue_tasks, 0)',
  due: 'coalesce(agg.due_tasks, 0)',
  name: 'lower(m.name)'
};

export async function workloadEmployeeCounts(
  db: Db,
  filters: WorkloadFilters,
  options: { sort: WorkloadEmployeeSort; direction: 'asc' | 'desc'; memberQuery?: string | null }
): Promise<WorkloadEmployeeCount[]> {
  const direction = options.direction === 'asc' ? 'ASC' : 'DESC';
  const order =
    options.sort === 'name'
      ? `${EMPLOYEE_SORTS.name} ${direction}, m.member_id ASC`
      : `${EMPLOYEE_SORTS[options.sort]} ${direction}, coalesce(agg.due_tasks, 0) DESC, lower(m.name) ASC`;
  const rows = await db.many<{
    member_id: string;
    name: string;
    active: boolean;
    due_tasks: number;
    completed_tasks: number;
    overdue_tasks: number;
    undated_tasks: number;
  }>(
    `${SCOPE_CTE},
     pairs AS (
       SELECT e.member_id, s.task_id, s.status, s.due_date, s.completed_date
         FROM effective e
         JOIN scope s ON s.task_id = e.task_id
        WHERE ($6::text IS NULL OR e.member_id = $6)),
     agg AS (
       SELECT member_id,
              count(DISTINCT task_id) FILTER (WHERE due_date BETWEEN $1::date AND $2::date)::int AS due_tasks,
              count(DISTINCT task_id) FILTER (WHERE completed_date BETWEEN $1::date AND $2::date)::int
                AS completed_tasks,
              count(DISTINCT task_id) FILTER (WHERE status IN ${OPEN_STATUSES} AND due_date < $3::date)::int
                AS overdue_tasks,
              count(DISTINCT task_id) FILTER (WHERE status IN ${OPEN_STATUSES} AND due_date IS NULL)::int
                AS undated_tasks
         FROM pairs
        GROUP BY member_id)
     SELECT m.member_id, m.name, m.active,
            coalesce(agg.due_tasks, 0)::int AS due_tasks,
            coalesce(agg.completed_tasks, 0)::int AS completed_tasks,
            coalesce(agg.overdue_tasks, 0)::int AS overdue_tasks,
            coalesce(agg.undated_tasks, 0)::int AS undated_tasks
       FROM members m
       LEFT JOIN agg ON agg.member_id = m.member_id
      WHERE m.active
        AND ($6::text IS NULL OR m.member_id = $6)
        AND ($7::text IS NULL OR lower(m.name) LIKE $7)
      ORDER BY ${order}
      LIMIT 500`,
    [...baseParams(filters), options.memberQuery ? `%${options.memberQuery.toLowerCase()}%` : null]
  );
  return rows.map((row) => ({
    memberId: row.member_id,
    memberName: row.name,
    active: row.active,
    dueTasks: row.due_tasks,
    completedTasks: row.completed_tasks,
    overdueTasks: row.overdue_tasks,
    undatedTasks: row.undated_tasks
  }));
}

export type WorkloadTaskKind = 'DUE' | 'COMPLETED' | 'OVERDUE' | 'OVERDUE_IN_PERIOD' | 'UNDATED' | 'BACKLOG';

function kindPredicate(kind: WorkloadTaskKind): string {
  switch (kind) {
    case 'COMPLETED':
      return 's.completed_date BETWEEN $7::date AND $8::date';
    case 'OVERDUE':
      return `s.status IN ${OPEN_STATUSES} AND s.due_date < $3::date`;
    case 'OVERDUE_IN_PERIOD':
      return `s.status IN ${OPEN_STATUSES} AND s.due_date BETWEEN $7::date AND $8::date AND s.due_date < $3::date`;
    case 'UNDATED':
      return `s.status IN ${OPEN_STATUSES} AND s.due_date IS NULL`;
    case 'BACKLOG':
      return `s.status IN ${OPEN_STATUSES} AND s.due_date < $7::date`;
    default:
      return 's.due_date BETWEEN $7::date AND $8::date';
  }
}

export type WorkloadTaskRecord = {
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  subprojectName: string | null;
  /** The `tasks.status` CHECK constraint is the source of truth for this stored vocabulary. */
  status: TaskStatus;
  dueDate: string | null;
  completedDate: string | null;
  assigneeNames: string[];
  revision: number;
};

export async function workloadTaskPage(
  db: Db,
  filters: WorkloadFilters,
  input: {
    kind: WorkloadTaskKind;
    /** Bucket bounds; both default to the report period. */
    from?: string | null;
    to?: string | null;
    page: number;
    pageSize: number;
  }
): Promise<{ items: WorkloadTaskRecord[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const from = input.from ?? filters.start;
  const to = input.to ?? filters.end;
  const params = [
    ...baseParams(filters),
    from,
    to,
    input.pageSize,
    (input.page - 1) * input.pageSize
  ];
  const where = kindPredicate(input.kind);
  const rows = await db.many<{
    task_id: string;
    task_name: string;
    status: string;
    due_date: string | null;
    completed_date: string | null;
    revision: number;
    project_id: string;
    project_name: string;
    subproject_name: string | null;
    assignee_names: string[];
    total: number;
  }>(
    `${SCOPE_CTE},
     /* Types both drilldown bounds even when a kind only uses one of them. */
     drill_window AS (SELECT $7::date AS report_from, $8::date AS report_to),
     filtered AS (
       SELECT s.task_id, s.due_date, s.completed_date
         FROM scope s
        WHERE ${where})
     SELECT t.task_id, t.task_name, t.status, t.due_date::text AS due_date,
            f.completed_date::text AS completed_date, t.revision,
            p.project_id, p.project_name, sp.subproject_name,
            (SELECT coalesce(array_agg(m.name ORDER BY m.name), ARRAY[]::text[])
               FROM effective e
               JOIN members m ON m.member_id = e.member_id
              WHERE e.task_id = t.task_id) AS assignee_names,
            count(*) OVER ()::int AS total
       FROM filtered f
       JOIN tasks t ON t.task_id = f.task_id
       JOIN projects p ON p.project_id = t.project_id
       LEFT JOIN subprojects sp ON sp.subproject_id = t.subproject_id
      ORDER BY t.due_date ASC NULLS LAST, t.task_id ASC
      LIMIT $9 OFFSET $10`,
    params
  );
  const total = rows[0]?.total ?? (input.page > 1 ? await workloadTaskTotal(db, filters, input) : 0);
  return {
    items: rows.map((row) => ({
      taskId: row.task_id,
      taskName: row.task_name,
      projectId: row.project_id,
      projectName: row.project_name,
      subprojectName: row.subproject_name,
      status: row.status as TaskStatus,
      dueDate: row.due_date,
      completedDate: row.completed_date,
      assigneeNames: row.assignee_names ?? [],
      revision: row.revision
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize)
  };
}

/** Only reached for a page past the end, where the window count is unavailable. */
async function workloadTaskTotal(
  db: Db,
  filters: WorkloadFilters,
  input: { kind: WorkloadTaskKind; from?: string | null; to?: string | null }
): Promise<number> {
  const row = await db.one<{ total: number }>(
    `${SCOPE_CTE},
     drill_window AS (SELECT $7::date AS report_from, $8::date AS report_to),
     filtered AS (
       SELECT s.task_id FROM scope s WHERE ${kindPredicate(input.kind)})
     SELECT count(*)::int AS total FROM filtered`,
    [...baseParams(filters), input.from ?? filters.start, input.to ?? filters.end]
  );
  return row?.total ?? 0;
}
