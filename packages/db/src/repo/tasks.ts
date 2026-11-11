/** Task repository: records, summaries, relationships, approvals and confirmations. */
import type { DisplayTaskStatus, Task, TaskSummary } from '@eh/contracts';
import { businessDate, deadlineState, MAX_TASK_DEPTH, taskScheduleStatus } from '@eh/domain';
import type { Queryable } from '../pool';
import { newId } from '../ids';
import { toTask, type TaskRow } from '../map';
import { updateWithRevision } from './patch';
import { divisionScopeSql, memberDivisionNames } from './divisions';

type Db = Queryable;

const TASK_SELECT = `
  SELECT t.task_id, t.project_id, t.subproject_id, t.parent_task_id, t.task_name, t.description,
         t.owner_member_id, owner.name AS owner_name, t.status, t.priority, t.planned_start,
         t.due_date, t.estimated_hours, t.actual_hours, t.progress_percent, t.acceptance_criteria,
         t.next_action, t.required_skill_id, t.required_skill_level, t.assignment_version,
         t.assignment_approved_at, t.notification_enabled, t.notification_baseline, t.public_note,
         t.planned_duration_value, t.planned_duration_unit, t.planned_duration_basis,
         t.planned_start_source, t.completed_at, t.created_at, t.updated_at, t.revision,
         t.created_by_member_id, t.creation_channel,
         COALESCE((SELECT array_agg(td.depends_on_task_id ORDER BY td.depends_on_task_id)
                     FROM task_dependencies td WHERE td.task_id = t.task_id), '{}') AS dependency_ids
    FROM tasks t
    LEFT JOIN members owner ON owner.member_id = t.owner_member_id`;

const SUMMARY_SELECT = `
  SELECT t.task_id, t.project_id, p.project_name, p.responsibility_id, t.subproject_id,
         t.task_name, t.status, t.priority, t.owner_member_id, owner.name AS owner_name,
         t.due_date, t.planned_start, t.progress_percent, t.parent_task_id, t.completed_at,
         t.revision,
         EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.task_id) AS container,
         eh_task_depth(t.task_id) AS depth,
         EXISTS (SELECT 1 FROM task_requests rp WHERE rp.task_id = t.task_id AND rp.status IN ('PENDING','PROCESSING')) AS pending_request,
         (SELECT rr.status FROM task_requests rr
           WHERE rr.task_id = t.task_id AND rr.request_type = 'COMPLETION_REPORT'
           ORDER BY rr.submitted_at DESC LIMIT 1) AS latest_completion_status,
         (SELECT rr.stale_reason FROM task_requests rr
           WHERE rr.task_id = t.task_id AND rr.status = 'STALE'
           ORDER BY rr.submitted_at DESC LIMIT 1) AS stale_reason,
         COALESCE((SELECT array_agg(am.name ORDER BY am.name)
                     FROM task_assignees ta JOIN members am ON am.member_id = ta.member_id
                    WHERE ta.task_id = t.task_id AND ta.removed_at IS NULL), '{}') AS assignee_names,
         COALESCE((SELECT array_agg(ta.member_id ORDER BY ta.member_id)
                     FROM task_assignees ta
                    WHERE ta.task_id = t.task_id AND ta.removed_at IS NULL), '{}') AS assignee_ids
    FROM tasks t
    JOIN projects p ON p.project_id = t.project_id
    LEFT JOIN members owner ON owner.member_id = t.owner_member_id`;

export type TaskSummaryRow = {
  task_id: string;
  project_id: string;
  project_name: string;
  responsibility_id: string | null;
  subproject_id: string | null;
  task_name: string;
  status: Task['status'];
  priority: Task['priority'];
  owner_member_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  planned_start: string | null;
  progress_percent: number | null;
  parent_task_id: string | null;
  completed_at: string | null;
  revision: number;
  container: boolean;
  depth: number;
  pending_request: boolean;
  latest_completion_status: string | null;
  stale_reason: string | null;
  assignee_names: string[];
  assignee_ids: string[] | null;
};

export function reviewStateOf(row: {
  pending_request: boolean;
  latest_completion_status: string | null;
  stale_reason: string | null;
}): 'NONE' | 'PENDING' | 'APPROVED' | 'STALE' {
  if (row.pending_request) return 'PENDING';
  if (row.stale_reason) return 'STALE';
  if (row.latest_completion_status === 'APPROVED') return 'APPROVED';
  return 'NONE';
}

export function toTaskSummary(row: TaskSummaryRow, today?: string): TaskSummary {
  const schedule = taskScheduleStatus(
    { status: row.status, plannedStart: row.planned_start, dueDate: row.due_date },
    today
  );
  return {
    taskId: row.task_id,
    projectId: row.project_id,
    projectName: row.project_name,
    subprojectId: row.subproject_id,
    responsibilityId: row.responsibility_id,
    parentTaskId: row.parent_task_id,
    taskName: row.task_name,
    status: row.status,
    displayStatus: schedule.state,
    scheduleMissing: schedule.missing,
    priority: row.priority,
    ownerMemberId: row.owner_member_id,
    ownerName: row.owner_name ?? '',
    assigneeNames: row.assignee_names ?? [],
    assigneeIds: row.assignee_ids ?? [],
    dueDate: row.due_date,
    plannedStart: row.planned_start,
    progressPercent: row.progress_percent,
    container: row.container,
    depth: row.depth,
    reviewState: reviewStateOf(row),
    overdue:
      !!row.due_date &&
      row.due_date < (today ?? businessDate()) &&
      row.status !== 'Done' &&
      row.status !== 'Cancelled',
    deadlineState: deadlineState(row.due_date, row.status, today),
    revision: row.revision
  };
}

export type TaskFilters = {
  projectId?: string;
  subprojectId?: string;
  responsibilityId?: string;
  unassigned?: boolean;
  status?: string;
  workState?: 'OPEN';
  /** Derived display state; resolved on the server with an explicit Asia/Tokyo business date. */
  displayStatus?: DisplayTaskStatus;
  today?: string;
  ownerMemberId?: string;
  assigneeMemberId?: string;
  query?: string;
  containerOnly?: boolean;
  overdueOnly?: boolean;
  /** Archived projects, archived subprojects and Cancelled work stay hidden by default. */
  includeInactive?: boolean;
  /** Completed work is an explicit history filter, never part of the default active list. */
  includeCompleted?: boolean;
  includeCancelled?: boolean;
  /** Visibility policy: only `INTERNAL` projects are employee-visible. */
  internalOnly?: boolean;
  /**
   * The caller's authorized divisions, resolved before paging. `undefined` is unrestricted (the
   * ADMIN remediation view), an empty list matches nothing, and a project with a blank division is
   * never matched by a restricted list.
   */
  divisionIds?: readonly string[];
  sort?: 'dueDate' | 'priority' | 'name' | 'project' | 'owner' | 'status' | 'updated';
  direction?: 'asc' | 'desc';
  dueFrom?: string;
  dueTo?: string;
};

const SUMMARY_SORTS: Record<NonNullable<TaskFilters['sort']>, string> = {
  dueDate: 't.due_date',
  priority: "CASE t.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END",
  name: 'lower(t.task_name)',
  project: 'lower(p.project_name)',
  owner: "lower(COALESCE(owner.name, ''))",
  status: `CASE
    WHEN t.status = 'Done' THEN 0
    WHEN t.status <> 'Cancelled' AND t.due_date IS NOT NULL
      AND t.due_date < (now() AT TIME ZONE 'Asia/Tokyo')::date THEN 1
    WHEN t.status = 'Cancelled' THEN 3
    ELSE 2
  END`,
  updated: 't.updated_at'
};

function taskWhere(filters: TaskFilters): { where: string; params: unknown[] } {
  const where: string[] = ['t.deleted_at IS NULL', 'p.deleted_at IS NULL'];
  const params: unknown[] = [];
  const leafWork = `NOT EXISTS (
    SELECT 1 FROM tasks child
     WHERE child.parent_task_id = t.task_id AND child.deleted_at IS NULL
  )`;
  const activeSubprojectChain = `(t.subproject_id IS NULL OR NOT EXISTS (
    WITH RECURSIVE chain AS (
      SELECT s.subproject_id, s.parent_subproject_id, s.status, s.deleted_at, 1 AS depth
        FROM subprojects s WHERE s.subproject_id = t.subproject_id
      UNION ALL
      SELECT parent.subproject_id, parent.parent_subproject_id, parent.status, parent.deleted_at, chain.depth + 1
        FROM chain
        JOIN subprojects parent ON parent.subproject_id = chain.parent_subproject_id
       WHERE chain.depth < 8
    )
    SELECT 1 FROM chain
     WHERE status = 'Archived' OR deleted_at IS NOT NULL
  ))`;
  const activeWork = (): void => {
    where.push("t.status IN ('Not Started','Assigned','In Progress','Blocked','On Hold')");
    where.push(leafWork);
    where.push("p.status IN ('Planned','Active') AND p.archived_at IS NULL");
    where.push(activeSubprojectChain);
  };
  // An explicit terminal filter (完了 / 取消) is the authorized history view; otherwise the default
  // active list never contains completed work.
  const terminalRequested =
    filters.displayStatus === 'DONE' ||
    filters.displayStatus === 'CANCELLED' ||
    filters.status === 'Done' ||
    filters.status === 'Cancelled';
  const cancelledRequested = filters.displayStatus === 'CANCELLED' || filters.status === 'Cancelled';
  if (filters.includeCompleted !== true && !terminalRequested) {
    where.push("t.status <> 'Done'");
  }
  if (filters.projectId) {
    params.push(filters.projectId);
    where.push(`t.project_id = $${params.length}`);
  }
  if (filters.subprojectId) {
    params.push(filters.subprojectId);
    where.push(`t.subproject_id = $${params.length}`);
  }
  if (filters.responsibilityId) {
    params.push(filters.responsibilityId);
    where.push(`p.responsibility_id = $${params.length}`);
  }
  if (filters.unassigned) where.push('p.responsibility_id IS NULL');
  if (filters.status) {
    params.push(filters.status);
    where.push(`t.status = $${params.length}`);
  }
  if (filters.workState === 'OPEN') activeWork();
  if (filters.displayStatus) {
    // The derived state is resolved here, with the Asia/Tokyo date supplied by the caller, so a
    // page is never filtered in the browser after it was cut. Each branch mirrors the precedence
    // in `taskScheduleStatus`, so a filter and the badge on the row cannot disagree. The one
    // deliberate overlap is a reversed interval whose Finish has passed: it is listed as
    // INVALID_DATES and also stays in the canonical overdue accounting.
    const today = filters.today ?? businessDate();
    const usableInterval = '(t.planned_start IS NULL OR t.due_date IS NULL OR t.planned_start <= t.due_date)';
    const day = (): string => {
      params.push(today);
      return `$${params.length}`;
    };
    switch (filters.displayStatus) {
      case 'DONE':
        where.push("t.status = 'Done'");
        where.push(leafWork);
        break;
      case 'CANCELLED':
        where.push("t.status = 'Cancelled'");
        where.push(leafWork);
        break;
      case 'INVALID_DATES':
        activeWork();
        where.push('t.planned_start IS NOT NULL AND t.due_date IS NOT NULL AND t.planned_start > t.due_date');
        break;
      case 'OVERDUE':
        // The canonical overdue predicate, unchanged: a Finish before today. A reversed interval is
        // warned about as INVALID_DATES but stays in the deadline accounting instead of vanishing.
        activeWork();
        where.push(`t.due_date IS NOT NULL AND t.due_date < ${day()}`);
        break;
      case 'PLANNED':
        activeWork();
        where.push(usableInterval);
        where.push(`t.planned_start IS NOT NULL AND t.planned_start > ${day()}`);
        break;
      case 'IN_PROGRESS':
        activeWork();
        where.push(usableInterval);
        where.push(`t.planned_start IS NOT NULL AND t.planned_start <= ${day()}`);
        where.push(`(t.due_date IS NULL OR t.due_date >= $${params.length})`);
        break;
      case 'START_NOT_SET':
        activeWork();
        where.push('t.planned_start IS NULL');
        where.push(`t.due_date IS NOT NULL AND t.due_date >= ${day()}`);
        break;
      default:
        activeWork();
        where.push('t.planned_start IS NULL AND t.due_date IS NULL');
        break;
    }
  }
  if (filters.ownerMemberId) {
    params.push(filters.ownerMemberId);
    where.push(`t.owner_member_id = $${params.length}`);
  }
  if (filters.assigneeMemberId) {
    params.push(filters.assigneeMemberId);
    where.push(`(t.owner_member_id = $${params.length} OR EXISTS (
      SELECT 1 FROM task_assignees assignment
       WHERE assignment.task_id = t.task_id AND assignment.member_id = $${params.length}
         AND assignment.removed_at IS NULL
    ))`);
  }
  if (filters.query) {
    params.push(`%${filters.query.toLowerCase()}%`);
    where.push(`lower(t.task_name) LIKE $${params.length}`);
  }
  if (filters.containerOnly) {
    where.push('EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.task_id)');
  }
  if (filters.overdueOnly) {
    where.push(
      "t.due_date < current_date AND t.status IN ('Not Started','Assigned','In Progress','Blocked','On Hold')"
    );
  }
  if (filters.includeInactive !== true) {
    if (!cancelledRequested && !filters.includeCancelled) where.push("t.status <> 'Cancelled'");
    where.push("p.status <> 'Archived' AND p.archived_at IS NULL");
    where.push(activeSubprojectChain);
  }
  if (filters.dueFrom) {
    params.push(filters.dueFrom);
    where.push(`t.due_date >= $${params.length}`);
  }
  if (filters.dueTo) {
    params.push(filters.dueTo);
    where.push(`t.due_date <= $${params.length}`);
  }
  if (filters.internalOnly === true) {
    where.push("p.dashboard_visibility = 'INTERNAL'");
  }
  divisionScopeSql('p.division_id', filters.divisionIds, params, where);
  return { where: `WHERE ${where.join(' AND ')}`, params };
}

export async function listTaskSummaries(
  db: Db,
  filters: TaskFilters,
  page: number,
  pageSize: number
): Promise<{ items: TaskSummary[]; total: number }> {
  const { where, params } = taskWhere(filters);
  const total = await db.one<{ count: string }>(
    `SELECT count(*)::text AS count FROM tasks t JOIN projects p ON p.project_id = t.project_id ${where}`,
    params
  );
  const order = SUMMARY_SORTS[filters.sort ?? 'dueDate'];
  const direction = filters.direction === 'desc' ? 'DESC' : 'ASC';
  const rows = await db.many<TaskSummaryRow>(
    `${SUMMARY_SELECT} ${where} ORDER BY ${order} ${direction} NULLS LAST, t.task_id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { items: rows.map((row) => toTaskSummary(row, filters.today)), total: Number(total?.count ?? 0) };
}

/** Pages siblings, retaining ancestors of filter matches so a matching child stays reachable. */
export async function listTaskTreeSummaries(
  db: Db, filters: TaskFilters, parentTaskId: string | undefined, page: number, pageSize: number
): Promise<{ items: TaskSummary[]; total: number; matchedTotal: number }> {
  const { where, params } = taskWhere(filters);
  const cte = `WITH RECURSIVE matching AS (
    SELECT t.task_id, t.parent_task_id, t.project_id, t.subproject_id FROM tasks t JOIN projects p ON p.project_id=t.project_id ${where}
  ), ancestors AS (
    SELECT task_id, parent_task_id, project_id, subproject_id, 1 AS levels FROM matching
    UNION ALL
    SELECT p.task_id, p.parent_task_id, p.project_id, p.subproject_id, a.levels+1 FROM ancestors a
      JOIN tasks p ON p.task_id=a.parent_task_id
      WHERE p.deleted_at IS NULL AND p.project_id = a.project_id
        AND p.subproject_id IS NOT DISTINCT FROM a.subproject_id AND a.levels < ${MAX_TASK_DEPTH}
  )`;
  const branch = `WHERE t.deleted_at IS NULL AND t.parent_task_id IS NOT DISTINCT FROM $${params.length+1}::text
    AND EXISTS (SELECT 1 FROM ancestors a WHERE a.task_id=t.task_id)`;
  const values = [...params, parentTaskId ?? null];
  const total = await db.one<{count:string; matched:string}>(
    `${cte} SELECT count(*)::text AS count, (SELECT count(*)::text FROM matching) AS matched FROM tasks t ${branch}`, values
  );
  const order = SUMMARY_SORTS[filters.sort ?? 'dueDate'];
  const direction = filters.direction === 'desc' ? 'DESC' : 'ASC';
  const rows = await db.many<TaskSummaryRow & { context_only: boolean }>(
    `${cte} ${SUMMARY_SELECT.replace('SELECT t.task_id', 'SELECT NOT EXISTS (SELECT 1 FROM matching m WHERE m.task_id = t.task_id) AS context_only, t.task_id')}
      ${branch} ORDER BY ${order} ${direction} NULLS LAST, t.task_id
      LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values,pageSize,(page-1)*pageSize]
  );
  return {items:rows.map(row=>({ ...toTaskSummary(row, filters.today), contextOnly: row.context_only })),total:Number(total?.count??0),matchedTotal:Number(total?.matched??0)};
}

/** Only members assigned within the caller's readable task scope, in bounded pages. */
export async function listTaskAssigneeOptions(
  db: Db,
  internalOnly: boolean,
  query: string,
  page: number,
  pageSize: number,
  memberId?: string,
  options: { divisionIds?: readonly string[]; includeEmployeeId?: boolean } = {}
): Promise<{
  items: { memberId: string; name: string; active: boolean; divisionNames: string[]; employeeId?: string }[];
  total: number;
}> {
  const { where, params } = taskWhere({
    internalOnly,
    includeCompleted: true,
    includeCancelled: true,
    includeInactive: !internalOnly,
    divisionIds: options.divisionIds
  });
  params.push(`%${query.toLowerCase()}%`);
  const searchParam = params.length;
  if (memberId) params.push(memberId);
  const cte = `WITH eligible AS (
    SELECT t.task_id, t.owner_member_id FROM tasks t JOIN projects p ON p.project_id = t.project_id ${where}
  ), assigned AS (
    SELECT owner_member_id AS member_id FROM eligible WHERE owner_member_id IS NOT NULL
    UNION
    SELECT a.member_id FROM task_assignees a JOIN eligible e ON e.task_id = a.task_id WHERE a.removed_at IS NULL
  ), options AS (
    SELECT m.member_id, m.name, m.active,
           ${options.includeEmployeeId ? '(SELECT a.employee_id FROM local_accounts a WHERE a.member_id = m.member_id)' : 'NULL::text'} AS employee_id
      FROM assigned a JOIN members m ON m.member_id = a.member_id
     WHERE (lower(m.name) LIKE $${searchParam} OR lower(m.member_id) LIKE $${searchParam})
       ${memberId ? `AND m.member_id = $${params.length}` : ''}
  )`;
  const total = await db.one<{ count: string }>(`${cte} SELECT count(*)::text AS count FROM options`, params);
  const rows = await db.many<{
    member_id: string;
    name: string;
    active: boolean;
    employee_id: string | null;
  }>(
    `${cte} SELECT member_id, name, active, employee_id FROM options ORDER BY lower(name), member_id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  // Division display names disambiguate two people who share a display name. One bounded read.
  const names = await memberDivisionNames(
    db,
    rows.map((row) => row.member_id)
  );
  return {
    items: rows.map((row) => ({
      memberId: row.member_id,
      name: row.name,
      active: row.active,
      divisionNames: names.get(row.member_id) ?? [],
      ...(row.employee_id ? { employeeId: row.employee_id } : {})
    })),
    total: Number(total?.count ?? 0)
  };
}

/** Bounded root-task search, used where a full task table must never reach the browser. */
export async function searchTasks(
  db: Db,
  query: string,
  limit = 20,
  divisionIds?: readonly string[]
): Promise<TaskSummary[]> {
  const where: string[] = ['t.deleted_at IS NULL'];
  const params: unknown[] = [`%${query.toLowerCase()}%`];
  where.push('lower(t.task_name) LIKE $1');
  divisionScopeSql('p.division_id', divisionIds, params, where);
  params.push(limit);
  const rows = await db.many<TaskSummaryRow>(
    `${SUMMARY_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY lower(t.task_name) ASC, t.task_id ASC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((row) => toTaskSummary(row));
}

export async function listTaskSummariesForProject(db: Db, projectId: string): Promise<TaskSummary[]> {
  const rows = await db.many<TaskSummaryRow>(
    `${SUMMARY_SELECT} WHERE t.deleted_at IS NULL AND t.project_id = $1 ORDER BY t.due_date NULLS LAST, t.task_id`,
    [projectId]
  );
  return rows.map((row) => toTaskSummary(row));
}

export async function listTaskSummariesForSubproject(db: Db, subprojectId: string): Promise<TaskSummary[]> {
  const rows = await db.many<TaskSummaryRow>(
    `${SUMMARY_SELECT} WHERE t.deleted_at IS NULL AND t.subproject_id = $1 ORDER BY t.due_date NULLS LAST, t.task_id`,
    [subprojectId]
  );
  return rows.map((row) => toTaskSummary(row));
}

/** Tasks due inside a window, already joined for a summary projection (bounded). */
export async function listDueWindowSummaries(
  db: Db,
  from: string,
  to: string,
  limit = 200
): Promise<TaskSummary[]> {
  const rows = await db.many<TaskSummaryRow>(
    `${SUMMARY_SELECT}
      WHERE t.deleted_at IS NULL AND t.due_date BETWEEN $1 AND $2
        AND t.status IN ('Not Started','Assigned','In Progress','Blocked','On Hold')
      ORDER BY t.due_date ASC, t.task_id ASC
      LIMIT $3`,
    [from, to, limit]
  );
  return rows.map((row) => toTaskSummary(row));
}

export async function listAllTasksForScope(
  db: Db,
  limit = 20000,
  divisionIds?: readonly string[]
): Promise<
  {
    taskId: string;
    projectId: string;
    subprojectId: string | null;
    parentTaskId: string | null;
    status: string;
    dueDate: string | null;
    plannedStart: string | null;
    estimatedHours: number | null;
    actualHours: number | null;
    progressPercent: number | null;
  }[]
> {
  // The scope aggregate must never see a division the caller may not read, so the project join
  // carries the same resolved filter the lists use.
  const where: string[] = ['t.deleted_at IS NULL'];
  const params: unknown[] = [];
  divisionScopeSql('p.division_id', divisionIds, params, where);
  params.push(limit);
  const rows = await db.many<{
    task_id: string;
    project_id: string;
    subproject_id: string | null;
    parent_task_id: string | null;
    status: string;
    due_date: string | null;
    planned_start: string | null;
    estimated_hours: number | null;
    actual_hours: number | null;
    progress_percent: number | null;
  }>(
    `SELECT t.task_id, t.project_id, t.subproject_id, t.parent_task_id, t.status, t.due_date,
            t.planned_start, t.estimated_hours, t.actual_hours, t.progress_percent
       FROM tasks t JOIN projects p ON p.project_id = t.project_id
      WHERE ${where.join(' AND ')} ORDER BY t.task_id LIMIT $${params.length}`,
    params
  );
  return rows.map((row) => ({
    taskId: row.task_id,
    projectId: row.project_id,
    subprojectId: row.subproject_id,
    parentTaskId: row.parent_task_id,
    status: row.status,
    dueDate: row.due_date,
    plannedStart: row.planned_start,
    estimatedHours: row.estimated_hours,
    actualHours: row.actual_hours,
    progressPercent: row.progress_percent
  }));
}

export async function listTaskGeometries(db: Db) {
  const rows = await db.many<{
    task_id: string;
    project_id: string;
    subproject_id: string | null;
    status: string;
  }>('SELECT task_id, project_id, subproject_id, status FROM tasks WHERE deleted_at IS NULL');
  return rows;
}

export async function listTaskNodes(db: Db) {
  return db.many<{
    task_id: string;
    parent_task_id: string | null;
    project_id: string;
    subproject_id: string | null;
  }>('SELECT task_id, parent_task_id, project_id, subproject_id FROM tasks WHERE deleted_at IS NULL');
}

export async function listChildSummaries(db: Db, taskId: string): Promise<TaskSummary[]> {
  const rows = await db.many<TaskSummaryRow>(
    `${SUMMARY_SELECT} WHERE t.deleted_at IS NULL AND t.parent_task_id = $1 ORDER BY t.task_id`,
    [taskId]
  );
  return rows.map((row) => toTaskSummary(row));
}

/**
 * Current work (owner or active additional assignee) and former assignments, attributed by ID.
 *
 * Both lists are authorized by the caller's division scope. Former assignments stay visible as
 * history, but a relationship in a division the caller may not read is withheld and only counted,
 * so a member profile never becomes a way to read another division's current task detail.
 */
export async function listTaskSummariesForMember(
  db: Db,
  memberId: string,
  options: { currentDivisionIds?: readonly string[] } = {}
): Promise<{ current: TaskSummary[]; previous: TaskSummary[]; previousHidden: number }> {
  const where: string[] = [
    't.deleted_at IS NULL',
    `(t.owner_member_id = $1 OR EXISTS (
          SELECT 1 FROM task_assignees ta
           WHERE ta.task_id = t.task_id AND ta.member_id = $1 AND ta.removed_at IS NULL))`
  ];
  const params: unknown[] = [memberId];
  divisionScopeSql('p.division_id', options.currentDivisionIds, params, where);
  const currentRows = await db.many<TaskSummaryRow>(
    `${SUMMARY_SELECT}
      WHERE ${where.join(' AND ')}
      ORDER BY t.due_date NULLS LAST, t.task_id
      LIMIT 200`,
    params
  );
  const previousWhere: string[] = [
    't.deleted_at IS NULL',
    `EXISTS (
        SELECT 1 FROM task_assignees ta
         WHERE ta.task_id = t.task_id AND ta.member_id = $1 AND ta.removed_at IS NOT NULL)`
  ];
  const previousParams: unknown[] = [memberId];
  divisionScopeSql('p.division_id', options.currentDivisionIds, previousParams, previousWhere);
  const previousRows = await db.many<TaskSummaryRow>(
    `${SUMMARY_SELECT}
      WHERE ${previousWhere.join(' AND ')}
      ORDER BY t.due_date NULLS LAST, t.task_id
      LIMIT 200`,
    previousParams
  );
  let previousHidden = 0;
  if (options.currentDivisionIds !== undefined) {
    const scope = [...new Set(options.currentDivisionIds)];
    const hidden = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM tasks t JOIN projects p ON p.project_id = t.project_id
        WHERE t.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM task_assignees ta
                       WHERE ta.task_id = t.task_id AND ta.member_id = $1 AND ta.removed_at IS NOT NULL)
          AND ${scope.length ? '(p.division_id IS NULL OR NOT (p.division_id = ANY($2::text[])))' : 'true'}`,
      scope.length ? [memberId, scope] : [memberId]
    );
    previousHidden = Number(hidden?.count ?? 0);
  }
  return {
    current: currentRows.map((row) => toTaskSummary(row)),
    previous: previousRows.map((row) => toTaskSummary(row)),
    previousHidden
  };
}

export async function getTask(db: Db, taskId: string): Promise<Task | null> {
  const row = await db.one<TaskRow>(`${TASK_SELECT} WHERE t.task_id = $1 AND t.deleted_at IS NULL`, [taskId]);
  return row ? toTask(row) : null;
}

/** Includes a task that was already removed, for a deletion tombstone. */
export async function getTaskIncludingDeleted(db: Db, taskId: string): Promise<Task | null> {
  const row = await db.one<TaskRow>(`${TASK_SELECT} WHERE t.task_id = $1`, [taskId]);
  return row ? toTask(row) : null;
}

export async function compactTaskIndex(
  db: Db,
  limit = 2000,
  divisionIds?: readonly string[]
): Promise<{ entries: { taskId: string; taskName: string; projectId: string; status: string; parentTaskId: string | null; dueDate: string | null; revision: number }[]; total: number }> {
  const where: string[] = ['t.deleted_at IS NULL'];
  const params: unknown[] = [];
  divisionScopeSql('p.division_id', divisionIds, params, where);
  params.push(limit);
  const total = await db.one<{ count: string }>(
    `SELECT count(*)::text AS count FROM tasks t JOIN projects p ON p.project_id = t.project_id
      WHERE ${where.join(' AND ')}`,
    params.slice(0, -1)
  );
  const rows = await db.many<{
    task_id: string;
    task_name: string;
    project_id: string;
    status: string;
    parent_task_id: string | null;
    due_date: string | null;
    revision: number;
  }>(
    `SELECT t.task_id, t.task_name, t.project_id, t.status, t.parent_task_id, t.due_date, t.revision
       FROM tasks t JOIN projects p ON p.project_id = t.project_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.project_id, lower(t.task_name) LIMIT $${params.length}`,
    params
  );
  return {
    entries: rows.map((row) => ({
      taskId: row.task_id,
      taskName: row.task_name,
      projectId: row.project_id,
      status: row.status,
      parentTaskId: row.parent_task_id,
      dueDate: row.due_date,
      revision: row.revision
    })),
    total: Number(total?.count ?? 0)
  };
}

export type TaskInput = {
  projectId: string;
  subprojectId?: string | null;
  parentTaskId?: string | null;
  taskName: string;
  description?: string;
  ownerMemberId?: string | null;
  status?: string;
  priority?: string;
  plannedStart?: string | null;
  dueDate: string;
  estimatedHours?: number | null;
  actualHours?: number | null;
  progressPercent?: number | null;
  acceptanceCriteria?: string;
  nextAction?: string;
  requiredSkillId?: string | null;
  requiredSkillLevel?: number | null;
  notificationEnabled?: boolean;
  publicNote?: string;
  plannedDurationValue?: number | null;
  plannedDurationUnit?: string | null;
  plannedDurationBasis?: string | null;
  plannedStartSource?: string | null;
  createdByMemberId?: string | null;
  creationChannel?: 'LEGACY' | 'MANAGER' | 'MEMBER';
};

export async function insertTask(db: Db, input: TaskInput, taskId: string = newId('TSK')): Promise<Task> {
  await db.query(
    `INSERT INTO tasks
       (task_id, project_id, subproject_id, parent_task_id, task_name, description, owner_member_id,
        status, priority, planned_start, due_date, estimated_hours, actual_hours, progress_percent,
        acceptance_criteria, next_action, required_skill_id, required_skill_level,
        notification_enabled, public_note, planned_duration_value, planned_duration_unit,
        planned_duration_basis, planned_start_source, created_by_member_id, creation_channel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [
      taskId,
      input.projectId,
      input.subprojectId ?? null,
      input.parentTaskId ?? null,
      input.taskName,
      input.description ?? '',
      input.ownerMemberId ?? null,
      input.status ?? (input.ownerMemberId ? 'Assigned' : 'Not Started'),
      input.priority ?? 'Medium',
      input.plannedStart ?? null,
      input.dueDate,
      input.estimatedHours ?? null,
      input.actualHours ?? null,
      input.progressPercent ?? 0,
      input.acceptanceCriteria ?? '',
      input.nextAction ?? '',
      input.requiredSkillId ?? null,
      input.requiredSkillLevel ?? null,
      input.notificationEnabled ?? false,
      input.publicNote ?? '',
      input.plannedDurationValue ?? null,
      input.plannedDurationUnit ?? null,
      input.plannedDurationBasis ?? null,
      input.plannedStartSource ?? null,
      input.createdByMemberId ?? null,
      input.creationChannel ?? 'LEGACY'
    ]
  );
  const created = await getTask(db, taskId);
  if (!created) throw new Error('Task insert returned no row');
  return created;
}

const TASK_COLUMNS: Record<string, string> = {
  projectId: 'project_id',
  subprojectId: 'subproject_id',
  parentTaskId: 'parent_task_id',
  taskName: 'task_name',
  description: 'description',
  ownerMemberId: 'owner_member_id',
  status: 'status',
  priority: 'priority',
  plannedStart: 'planned_start',
  dueDate: 'due_date',
  estimatedHours: 'estimated_hours',
  actualHours: 'actual_hours',
  progressPercent: 'progress_percent',
  acceptanceCriteria: 'acceptance_criteria',
  nextAction: 'next_action',
  requiredSkillId: 'required_skill_id',
  requiredSkillLevel: 'required_skill_level',
  notificationEnabled: 'notification_enabled',
  publicNote: 'public_note',
  plannedDurationValue: 'planned_duration_value',
  plannedDurationUnit: 'planned_duration_unit',
  plannedDurationBasis: 'planned_duration_basis',
  plannedStartSource: 'planned_start_source',
  assignmentVersion: 'assignment_version',
  assignmentApprovedAt: 'assignment_approved_at',
  completedAt: 'completed_at'
};

export async function updateTask(
  db: Db,
  taskId: string,
  patch: Record<string, unknown>,
  expectedRevision: number
): Promise<Task | null> {
  const columns: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(TASK_COLUMNS)) {
    if (key in patch && patch[key] !== undefined) columns[column] = patch[key];
  }
  const row = await updateWithRevision<{ task_id: string }>(db, {
    table: 'tasks',
    idColumn: 'task_id',
    id: taskId,
    expectedRevision,
    columns,
    returning: 'task_id'
  });
  if (!row) return null;
  return getTask(db, taskId);
}

export async function setDependencies(db: Db, taskId: string, dependsOnIds: string[]): Promise<void> {
  const desired = [...new Set(dependsOnIds.filter((id) => id && id !== taskId))];
  await db.query('DELETE FROM task_dependencies WHERE task_id = $1', [taskId]);
  for (const dependsOnId of desired) {
    await db.query(
      'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [taskId, dependsOnId]
    );
  }
}

export async function listDependencyEdges(db: Db) {
  return db.many<{ task_id: string; depends_on_task_id: string }>(
    'SELECT task_id, depends_on_task_id FROM task_dependencies'
  );
}

export async function taskRecordsForDependencyCheck(db: Db, taskIds: string[]) {
  if (!taskIds.length) return [];
  return db.many<{ task_id: string; project_id: string; status: string }>(
    'SELECT task_id, project_id, status FROM tasks WHERE task_id = ANY($1::text[]) AND deleted_at IS NULL',
    [taskIds]
  );
}

/* ------------------------------ assignees -------------------------------- */

export type AssigneeRow = {
  assignment_id: string;
  task_id: string;
  member_id: string;
  name: string;
  active: boolean;
  assigned_at: string;
  assigned_by: string;
  removed_at: string | null;
  removed_by: string;
  is_primary: boolean;
};

export async function listTaskAssignees(db: Db, taskId: string): Promise<AssigneeRow[]> {
  return db.many<AssigneeRow>(
    `SELECT ta.assignment_id, ta.task_id, ta.member_id, m.name, m.active, ta.assigned_at,
            ta.assigned_by, ta.removed_at, ta.removed_by,
            (ta.member_id = t.owner_member_id) AS is_primary
       FROM task_assignees ta
       JOIN tasks t ON t.task_id = ta.task_id
       JOIN members m ON m.member_id = ta.member_id
      WHERE ta.task_id = $1
      ORDER BY ta.removed_at NULLS FIRST, m.name`,
    [taskId]
  );
}

/**
 * Adds and removes additional assignees as a soft relationship change: a removal stamps
 * removed_at, and re-adding a former assignee reactivates the existing row.
 */
export async function setTaskAssignees(
  db: Db,
  taskId: string,
  memberIds: string[],
  actor: string
): Promise<boolean> {
  const desired = [...new Set(memberIds.filter(Boolean))];
  const active = await db.many<{ assignment_id: string; member_id: string }>(
    'SELECT assignment_id, member_id FROM task_assignees WHERE task_id = $1 AND removed_at IS NULL',
    [taskId]
  );
  let changed = false;
  for (const row of active) {
    if (!desired.includes(row.member_id)) {
      await db.query(
        'UPDATE task_assignees SET removed_at = now(), removed_by = $2 WHERE assignment_id = $1',
        [row.assignment_id, actor]
      );
      changed = true;
    }
  }
  for (const memberId of desired) {
    if (active.some((row) => row.member_id === memberId)) continue;
    const existing = await db.one<{ assignment_id: string }>(
      `SELECT assignment_id FROM task_assignees WHERE task_id = $1 AND member_id = $2
        ORDER BY assigned_at DESC LIMIT 1`,
      [taskId, memberId]
    );
    if (existing) {
      await db.query(
        `UPDATE task_assignees SET removed_at = NULL, removed_by = '', assigned_at = now(), assigned_by = $2
          WHERE assignment_id = $1`,
        [existing.assignment_id, actor]
      );
    } else {
      await db.query(
        `INSERT INTO task_assignees (assignment_id, task_id, member_id, assigned_by)
         VALUES ($1,$2,$3,$4)`,
        [newId('TAS'), taskId, memberId, actor]
      );
    }
    changed = true;
  }
  return changed;
}

export async function bumpAssignmentVersion(db: Db, taskId: string, expectedRevision: number): Promise<boolean> {
  const result = await db.query(
    `UPDATE tasks
        SET assignment_version = assignment_version + 1,
            assignment_approved_at = NULL,
            revision = revision + 1
      WHERE task_id = $1 AND revision = $2`,
    [taskId, expectedRevision]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function approveAssignment(db: Db, taskId: string, expectedRevision: number): Promise<Task | null> {
  const result = await db.query(
    `UPDATE tasks SET assignment_approved_at = now(), revision = revision + 1
      WHERE task_id = $1 AND revision = $2`,
    [taskId, expectedRevision]
  );
  if ((result.rowCount ?? 0) === 0) return null;
  return getTask(db, taskId);
}

export async function confirmSchedule(
  db: Db,
  taskId: string,
  input: { plannedStart: string | null; dueDate: string | null; estimatedHours: number | null; confirmedBy: string; notes: string }
): Promise<void> {
  const next = await db.one<{ version: number }>(
    'SELECT COALESCE(max(version), 0) + 1 AS version FROM schedule_confirmations WHERE task_id = $1',
    [taskId]
  );
  await db.query('UPDATE schedule_confirmations SET active = false WHERE task_id = $1 AND active', [taskId]);
  await db.query(
    `INSERT INTO schedule_confirmations
       (schedule_confirmation_id, task_id, active, version, planned_start, due_date, estimated_hours,
        confirmed_by, notes)
     VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8)`,
    [
      newId('SCF'),
      taskId,
      Number(next?.version ?? 1),
      input.plannedStart,
      input.dueDate,
      input.estimatedHours,
      input.confirmedBy,
      input.notes
    ]
  );
}

export async function listScheduleConfirmations(db: Db, taskId: string) {
  const rows = await db.many<{
    schedule_confirmation_id: string;
    task_id: string;
    active: boolean;
    version: number;
    planned_start: string | null;
    due_date: string | null;
    estimated_hours: number | null;
    confirmed_at: string;
    confirmed_by: string;
    notes: string;
  }>(
    `SELECT schedule_confirmation_id, task_id, active, version, planned_start, due_date,
            estimated_hours, confirmed_at, confirmed_by, notes
       FROM schedule_confirmations WHERE task_id = $1 ORDER BY version DESC`,
    [taskId]
  );
  return rows.map((row) => ({
    scheduleConfirmationId: row.schedule_confirmation_id,
    taskId: row.task_id,
    active: row.active,
    version: row.version,
    plannedStart: row.planned_start,
    dueDate: row.due_date,
    estimatedHours: row.estimated_hours,
    confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmed_by,
    notes: row.notes
  }));
}

export async function insertDeadlineHistory(
  db: Db,
  input: {
    taskId: string;
    requestId?: string | null;
    previousDueDate: string | null;
    newDueDate: string | null;
    previousPlannedStart: string | null;
    newPlannedStart: string | null;
    reason: string;
    changedBy: string;
    source: string;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO task_deadline_history
       (history_id, task_id, request_id, previous_due_date, new_due_date, previous_planned_start,
        new_planned_start, reason, changed_by, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      newId('TDH'),
      input.taskId,
      input.requestId ?? null,
      input.previousDueDate,
      input.newDueDate,
      input.previousPlannedStart,
      input.newPlannedStart,
      input.reason,
      input.changedBy,
      input.source
    ]
  );
}

export async function listDeadlineHistory(db: Db, taskId: string) {
  const rows = await db.many<{
    history_id: string;
    previous_due_date: string | null;
    new_due_date: string | null;
    previous_planned_start: string | null;
    new_planned_start: string | null;
    reason: string;
    changed_at: string;
    changed_by: string;
    source: string;
  }>(
    `SELECT history_id, previous_due_date, new_due_date, previous_planned_start, new_planned_start,
            reason, changed_at, changed_by, source
       FROM task_deadline_history WHERE task_id = $1 ORDER BY changed_at DESC`,
    [taskId]
  );
  return rows.map((row) => ({
    historyId: row.history_id,
    previousDueDate: row.previous_due_date,
    newDueDate: row.new_due_date,
    previousPlannedStart: row.previous_planned_start,
    newPlannedStart: row.new_planned_start,
    reason: row.reason,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    source: row.source
  }));
}

export async function countTaskChildren(db: Db, taskId: string): Promise<number> {
  const row = await db.one<{ count: string }>(
    'SELECT count(*)::text AS count FROM tasks WHERE parent_task_id = $1 AND deleted_at IS NULL',
    [taskId]
  );
  return Number(row?.count ?? 0);
}

/**
 * Writes one unified effective assignment.
 *
 * The primary owner column stays authoritative and is never duplicated as an additional
 * assignee row. Every other selected member is stored as an additional assignee, so a removed
 * owner leaves no ghost assignment and a re-added former assignee reactivates its row.
 */
export async function setEffectiveAssignees(
  db: Db,
  taskId: string,
  memberIds: readonly string[],
  ownerMemberId: string | null,
  actor: string
): Promise<boolean> {
  const desired = [...new Set(memberIds.filter(Boolean))];
  const additional = desired.filter((memberId) => memberId !== ownerMemberId);
  return setTaskAssignees(db, taskId, additional, actor);
}

/**
 * Reconciles the pending completion reports of a task that was completed directly.
 *
 * A member's request can no longer be decided once the task is Done, so it is withdrawn with a
 * recorded reason instead of being left pending or approved a second time. Returns the withdrawn
 * request IDs for the caller's audit row.
 */
export async function withdrawPendingCompletionRequests(
  db: Db,
  taskId: string,
  reviewer: string,
  note: string
): Promise<string[]> {
  const rows = await db.many<{ request_id: string }>(
    `UPDATE task_requests
        SET status = 'WITHDRAWN', reviewer = $2, decided_at = now(), decision_note = $3,
            revision = revision + 1
      WHERE task_id = $1 AND request_type = 'COMPLETION_REPORT'
        AND status IN ('PENDING','PROCESSING')
      RETURNING request_id`,
    [taskId, reviewer, note]
  );
  return rows.map((row) => row.request_id);
}
