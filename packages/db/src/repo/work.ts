/** Project and subproject repositories. */
import type { Project, Subproject } from '@eh/contracts';
import { businessDate } from '@eh/domain';
import type { Queryable } from '../pool';
import { newId } from '../ids';
import { toProject, toSubproject, type ProjectRow, type SubprojectRow } from '../map';
import { updateWithRevision } from './patch';

type Db = Queryable;

const PROJECT_SELECT = `
  SELECT p.project_id, p.project_name, p.description, p.category, p.responsibility_id,
         r.name AS responsibility_name, p.project_owner_id, owner.name AS project_owner_name,
         p.status, p.priority, p.planned_start, p.forecast_end, p.committed_deadline,
         p.original_deadline, p.actual_completion, p.progress_percent, p.health, p.next_milestone,
         p.next_action, p.notification_enabled, p.dashboard_visibility, p.dashboard_summary,
         p.archived_at, p.created_at, p.updated_at, p.revision
    FROM projects p
    LEFT JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
    LEFT JOIN members owner ON owner.member_id = p.project_owner_id`;

/**
 * The one SQL projection of the derived schedule state.
 *
 * `projectScheduleStatus` in `@eh/domain` is the reference implementation; this expression exists
 * only so a filter or a sort can be resolved before pagination instead of in the browser. The
 * equivalence is asserted in `packages/db/test/integration.test.ts` for every status/date
 * combination, so the two cannot drift silently.
 */
export function projectScheduleStateSql(today: string): string {
  return `CASE
      WHEN p.status = 'Archived' OR p.archived_at IS NOT NULL THEN 'ARCHIVED'
      WHEN p.status = 'Cancelled' THEN 'CANCELLED'
      WHEN p.status = 'Completed' THEN 'COMPLETED'
      WHEN p.planned_start IS NOT NULL AND p.committed_deadline IS NOT NULL
           AND p.planned_start > p.committed_deadline THEN 'INVALID_DATES'
      WHEN p.planned_start IS NULL AND p.committed_deadline IS NULL THEN 'DATES_NOT_SET'
      WHEN p.committed_deadline IS NOT NULL AND ${today}::date > p.committed_deadline THEN 'LATE'
      WHEN p.planned_start IS NULL THEN 'START_NOT_SET'
      WHEN ${today}::date < p.planned_start THEN 'PLANNED'
      ELSE 'IN_PROGRESS'
    END`;
}

export type ProjectFilters = {
  responsibilityId?: string;
  unassigned?: boolean;
  status?: string;
  /** Derived schedule state, filtered and sorted before any page is cut. */
  schedule?: string;
  query?: string;
  /** The member explorer searches the project name only, never a private column. */
  queryProjectNameOnly?: boolean;
  sort?: 'deadline' | 'name' | 'responsibility' | 'owner' | 'status' | 'schedule' | 'priority' | 'updated';
  direction?: 'asc' | 'desc';
  /** Visibility policy: only `INTERNAL` projects are employee-visible. */
  internalOnly?: boolean;
  /** Archived projects are an explicit management view. */
  includeArchived?: boolean;
};

const PROJECT_SORTS: Record<NonNullable<ProjectFilters['sort']>, string> = {
  deadline: 'p.committed_deadline',
  name: 'lower(p.project_name)',
  responsibility: "lower(COALESCE(r.name, ''))",
  owner: "lower(COALESCE(owner.name, ''))",
  status: 'p.status',
  // The status column of the manager list shows the derived state, so the sort follows it.
  schedule: '',
  priority: "CASE p.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END",
  updated: 'p.updated_at'
};

export async function listProjects(
  db: Db,
  filters: ProjectFilters,
  page: number,
  pageSize: number,
  today: string = businessDate()
): Promise<{ items: Project[]; total: number; groupTotals: { responsibilityId: string | null; total: number }[] }> {
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  // A single shared parameter keeps the derived expression identical in a filter and a sort.
  let todayIndex: number | null = null;
  const scheduleSql = (): string => {
    if (todayIndex === null) {
      params.push(today);
      todayIndex = params.length;
    }
    return projectScheduleStateSql(`$${todayIndex}`);
  };
  if (filters.responsibilityId) {
    params.push(filters.responsibilityId);
    where.push(`p.responsibility_id = $${params.length}`);
  }
  if (filters.unassigned) where.push('p.responsibility_id IS NULL');
  if (filters.status) {
    params.push(filters.status);
    where.push(`p.status = $${params.length}`);
  }
  if (filters.schedule) {
    params.push(filters.schedule);
    const valueIndex = params.length;
    where.push(`${scheduleSql()} = $${valueIndex}`);
  }
  if (filters.query) {
    params.push(`%${filters.query.toLowerCase()}%`);
    where.push(
      filters.queryProjectNameOnly === true
        ? `lower(p.project_name) LIKE $${params.length}`
        : `(lower(p.project_name) LIKE $${params.length} OR lower(p.next_action) LIKE $${params.length})`
    );
  }
  if (filters.internalOnly === true) {
    where.push("p.dashboard_visibility = 'INTERNAL'");
  }
  // Only an explicit `false` hides archived projects, so the manager list keeps its behaviour and
  // `status=Archived` remains a usable filter.
  if (filters.includeArchived === false && filters.status !== 'Archived') {
    where.push("p.status <> 'Archived' AND p.archived_at IS NULL");
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // A sort-only parameter must not reach the count queries, which share the filter parameters.
  const filterParams = [...params];
  const [total, groupTotals] = await Promise.all([
    db.one<{ count: string }>(`SELECT count(*)::text AS count FROM projects p ${whereSql}`, filterParams),
    db.many<{ responsibility_id: string | null; count: string }>(
      `SELECT p.responsibility_id, count(*)::text AS count FROM projects p ${whereSql}
       GROUP BY p.responsibility_id`,
      filterParams
    )
  ]);
  const sort = filters.sort ?? 'deadline';
  const order = sort === 'schedule' || sort === 'status' ? scheduleSql() : PROJECT_SORTS[sort];
  const direction = filters.direction === 'desc' ? 'DESC' : 'ASC';
  const rows = await db.many<ProjectRow>(
    `${PROJECT_SELECT} ${whereSql} ORDER BY ${order} ${direction} NULLS LAST, p.project_id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    items: rows.map((row) => toProject(row, today)),
    total: Number(total?.count ?? 0),
    groupTotals: groupTotals.map((group) => ({ responsibilityId: group.responsibility_id, total: Number(group.count) }))
  };
}

export async function listAllProjects(db: Db, limit = 500): Promise<Project[]> {
  const rows = await db.many<ProjectRow>(
    `${PROJECT_SELECT} WHERE p.deleted_at IS NULL ORDER BY p.project_name ASC LIMIT $1`,
    [limit]
  );
  return rows.map((row) => toProject(row));
}

export async function getProject(db: Db, projectId: string): Promise<Project | null> {
  const row = await db.one<ProjectRow>(`${PROJECT_SELECT} WHERE p.project_id = $1 AND p.deleted_at IS NULL`, [
    projectId
  ]);
  return row ? toProject(row) : null;
}

export type ProjectInput = {
  projectName: string;
  description?: string;
  category?: string;
  responsibilityId?: string | null;
  projectOwnerId?: string | null;
  status?: string;
  priority?: string;
  plannedStart?: string | null;
  forecastEnd?: string | null;
  committedDeadline?: string | null;
  originalDeadline?: string | null;
  nextMilestone?: string;
  nextAction?: string;
  notificationEnabled?: boolean;
  dashboardVisibility?: string;
  dashboardSummary?: string;
};

export async function insertProject(
  db: Db,
  input: ProjectInput,
  projectId: string = newId('PRJ')
): Promise<Project> {
  await db.query(
    `INSERT INTO projects
       (project_id, project_name, description, category, responsibility_id, project_owner_id, status,
        priority, planned_start, forecast_end, committed_deadline, original_deadline, next_milestone,
        next_action, notification_enabled, dashboard_visibility, dashboard_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      projectId,
      input.projectName,
      input.description ?? '',
      input.category ?? '',
      input.responsibilityId ?? null,
      input.projectOwnerId ?? null,
      input.status ?? 'Planned',
      input.priority ?? 'Medium',
      input.plannedStart ?? null,
      input.forecastEnd ?? null,
      input.committedDeadline ?? null,
      input.originalDeadline ?? null,
      input.nextMilestone ?? '',
      input.nextAction ?? '',
      input.notificationEnabled ?? true,
      input.dashboardVisibility ?? 'RESTRICTED',
      input.dashboardSummary ?? ''
    ]
  );
  const created = await getProject(db, projectId);
  if (!created) throw new Error('Project insert returned no row');
  return created;
}

const PROJECT_COLUMNS: Record<string, string> = {
  projectName: 'project_name',
  description: 'description',
  category: 'category',
  responsibilityId: 'responsibility_id',
  projectOwnerId: 'project_owner_id',
  status: 'status',
  priority: 'priority',
  plannedStart: 'planned_start',
  forecastEnd: 'forecast_end',
  committedDeadline: 'committed_deadline',
  nextMilestone: 'next_milestone',
  nextAction: 'next_action',
  notificationEnabled: 'notification_enabled',
  dashboardVisibility: 'dashboard_visibility',
  dashboardSummary: 'dashboard_summary'
};

export async function updateProject(
  db: Db,
  projectId: string,
  patch: Record<string, unknown>,
  expectedRevision: number
): Promise<Project | null> {
  const columns: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(PROJECT_COLUMNS)) {
    if (key in patch && patch[key] !== undefined) columns[column] = patch[key];
  }
  if (patch.status === 'Archived') {
    columns.archived_at = new Date().toISOString();
  } else if (patch.status && patch.status !== 'Archived') {
    columns.archived_at = null;
  }
  if (patch.status === 'Completed') {
    columns.actual_completion = new Date().toISOString().slice(0, 10);
  }
  const row = await updateWithRevision<ProjectRow>(db, {
    table: 'projects',
    idColumn: 'project_id',
    id: projectId,
    expectedRevision,
    columns,
    returning: 'project_id'
  });
  if (!row) return null;
  return getProject(db, projectId);
}

export async function archiveProject(
  db: Db,
  projectId: string,
  expectedRevision: number
): Promise<Project | null> {
  const result = await db.query(
    `UPDATE projects SET status = 'Archived', archived_at = now(), revision = revision + 1
      WHERE project_id = $1 AND revision = $2 AND deleted_at IS NULL`,
    [projectId, expectedRevision]
  );
  if (result.rowCount === 0) return null;
  return getProject(db, projectId);
}

/* ------------------------------------------------------------------------- */

const SUBPROJECT_SELECT = `
  SELECT s.subproject_id, s.project_id, s.parent_subproject_id, s.subproject_name, s.description,
         s.owner_id,
         owner.name AS owner_name, s.status, s.planned_start, s.planned_end, s.deadline,
         s.progress_percent, s.estimated_hours, s.next_action,
         eh_subproject_depth(s.subproject_id) AS depth,
         s.revision, s.created_at, s.updated_at
    FROM subprojects s
    LEFT JOIN members owner ON owner.member_id = s.owner_id`;

export async function listSubprojects(db: Db, projectId?: string): Promise<Subproject[]> {
  const rows = await db.many<SubprojectRow>(
    `${SUBPROJECT_SELECT}
      WHERE s.deleted_at IS NULL AND ($1::text IS NULL OR s.project_id = $1)
      ORDER BY s.project_id, eh_subproject_depth(s.subproject_id), s.subproject_name`,
    [projectId ?? null]
  );
  return rows.map((row) => toSubproject(row));
}

export async function getSubproject(db: Db, subprojectId: string): Promise<Subproject | null> {
  const row = await db.one<SubprojectRow>(
    `${SUBPROJECT_SELECT} WHERE s.subproject_id = $1 AND s.deleted_at IS NULL`,
    [subprojectId]
  );
  return row ? toSubproject(row) : null;
}

export type SubprojectInput = {
  projectId: string;
  parentSubprojectId?: string | null;
  subprojectName: string;
  description?: string;
  ownerId?: string | null;
  status?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  deadline?: string | null;
  estimatedHours?: number | null;
  nextAction?: string;
};

export async function insertSubproject(
  db: Db,
  input: SubprojectInput,
  subprojectId: string = newId('SUB')
): Promise<Subproject> {
  await db.query(
    `INSERT INTO subprojects
       (subproject_id, project_id, parent_subproject_id, subproject_name, description, owner_id,
        status, planned_start, planned_end, deadline, estimated_hours, next_action)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      subprojectId,
      input.projectId,
      input.parentSubprojectId ?? null,
      input.subprojectName,
      input.description ?? '',
      input.ownerId ?? null,
      input.status ?? 'Planned',
      input.plannedStart ?? null,
      input.plannedEnd ?? null,
      input.deadline ?? null,
      input.estimatedHours ?? null,
      input.nextAction ?? ''
    ]
  );
  const created = await getSubproject(db, subprojectId);
  if (!created) throw new Error('Subproject insert returned no row');
  return created;
}

const SUBPROJECT_COLUMNS: Record<string, string> = {
  projectId: 'project_id',
  parentSubprojectId: 'parent_subproject_id',
  subprojectName: 'subproject_name',
  description: 'description',
  ownerId: 'owner_id',
  status: 'status',
  plannedStart: 'planned_start',
  plannedEnd: 'planned_end',
  deadline: 'deadline',
  estimatedHours: 'estimated_hours',
  nextAction: 'next_action'
};

export async function updateSubproject(
  db: Db,
  subprojectId: string,
  patch: Record<string, unknown>,
  expectedRevision: number
): Promise<Subproject | null> {
  const columns: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(SUBPROJECT_COLUMNS)) {
    if (key in patch && patch[key] !== undefined) columns[column] = patch[key];
  }
  const row = await updateWithRevision<{ subproject_id: string }>(db, {
    table: 'subprojects',
    idColumn: 'subproject_id',
    id: subprojectId,
    expectedRevision,
    columns,
    returning: 'subproject_id'
  });
  if (!row) return null;
  return getSubproject(db, subprojectId);
}

/**
 * The responsibilities that currently group at least one readable project.
 *
 * Only an identifier and a display name leave the server, and only for a project the reader may
 * already see, so the member filter never reveals an area that has no visible work.
 */
export async function listWorkResponsibilityOptions(
  db: Db,
  internalOnly: boolean
): Promise<{ responsibilityId: string; name: string }[]> {
  const where = ['p.deleted_at IS NULL', "p.status <> 'Archived'", 'p.archived_at IS NULL'];
  if (internalOnly) where.push("p.dashboard_visibility = 'INTERNAL'");
  return db.many<{ responsibilityId: string; name: string }>(
    `SELECT DISTINCT r.responsibility_id AS "responsibilityId", r.name
       FROM projects p
       JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
      WHERE ${where.join(' AND ')}
      ORDER BY r.name`,
    []
  );
}

export type TaskContext = {
  projectId: string;
  projectName: string;
  subprojects: { subprojectId: string; subprojectName: string }[];
};

/**
 * Display context for one task: its project name and its subproject chain, root first.
 *
 * The chain is walked in one bounded recursive query (depth < 8 covers the four permitted levels
 * with headroom) and carries names only - no owner, deadline or private column.
 */
export async function getTaskContext(
  db: Db,
  projectId: string,
  subprojectId: string | null
): Promise<TaskContext | null> {
  const project = await db.one<{ projectId: string; projectName: string }>(
    'SELECT project_id AS "projectId", project_name AS "projectName" FROM projects WHERE project_id = $1 AND deleted_at IS NULL',
    [projectId]
  );
  if (!project) return null;
  if (!subprojectId) return { ...project, subprojects: [] };
  const rows = await db.many<{ subprojectId: string; subprojectName: string }>(
    `WITH RECURSIVE chain AS (
       SELECT s.subproject_id, s.parent_subproject_id, s.subproject_name, 0 AS depth
         FROM subprojects s
        WHERE s.subproject_id = $1 AND s.deleted_at IS NULL
       UNION ALL
       SELECT s.subproject_id, s.parent_subproject_id, s.subproject_name, chain.depth + 1
         FROM subprojects s
         JOIN chain ON s.subproject_id = chain.parent_subproject_id
        WHERE s.deleted_at IS NULL AND chain.depth < 8
     )
     SELECT subproject_id AS "subprojectId", subproject_name AS "subprojectName"
       FROM chain ORDER BY depth DESC`,
    [subprojectId]
  );
  return { ...project, subprojects: rows };
}

export async function listMilestones(db: Db, projectId: string) {  return db.many<{
    milestone_id: string;
    project_id: string;
    subproject_id: string | null;
    milestone_name: string;
    target_date: string | null;
    actual_date: string | null;
    status: string;
    gate_type: string;
  }>(
    `SELECT milestone_id, project_id, subproject_id, milestone_name, target_date, actual_date, status, gate_type
       FROM milestones WHERE project_id = $1 ORDER BY target_date NULLS LAST`,
    [projectId]
  );
}

export async function listHolidays(db: Db): Promise<{ date: string; name: string }[]> {
  return db.many<{ date: string; name: string }>('SELECT date, name FROM holidays ORDER BY date');
}

/** Source rows for the allowlisted employee projection (one query, no private columns). */
export async function collectPublishedSourceRows(db: Db) {
  return db.many<{
    task_id: string;
    task_name: string;
    project_id: string;
    project_name: string;
    responsibility_id: string | null;
    responsibility_name: string | null;
    responsibility_color: string | null;
    status: string;
    due_date: string | null;
    planned_start: string | null;
    owner_name: string | null;
    assignee_names: string[] | null;
    container: boolean;
    parent_task_id: string | null;
    review_state: string;
    completed_at: string | null;
    progress_percent: number | null;
    pending_request: boolean;
    dashboard_visibility: string;
  }>(
    `SELECT t.task_id, t.task_name, t.project_id, p.project_name,
            p.responsibility_id, r.name AS responsibility_name, r.color_hex AS responsibility_color,
            t.status, t.due_date, t.planned_start, owner.name AS owner_name,
            COALESCE((SELECT array_agg(am.name ORDER BY am.name)
                        FROM task_assignees ta JOIN members am ON am.member_id = ta.member_id
                       WHERE ta.task_id = t.task_id AND ta.removed_at IS NULL), '{}') AS assignee_names,
            EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.task_id) AS container,
            t.parent_task_id,
            COALESCE((SELECT rr.status FROM task_requests rr
                       WHERE rr.task_id = t.task_id AND rr.request_type = 'COMPLETION_REPORT'
                       ORDER BY rr.submitted_at DESC LIMIT 1), '') AS review_state,
            t.completed_at, t.progress_percent,
            EXISTS (SELECT 1 FROM task_requests rp WHERE rp.task_id = t.task_id AND rp.status IN ('PENDING','PROCESSING')) AS pending_request,
            p.dashboard_visibility
       FROM tasks t
       JOIN projects p ON p.project_id = t.project_id
       LEFT JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
       LEFT JOIN members owner ON owner.member_id = t.owner_member_id
      WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status <> 'Archived'
      ORDER BY p.project_name, t.task_id`
  );
}

export async function listProjectPhases(db: Db, projectId: string) {
  return db.many<{
    project_phase_id: string;
    project_id: string;
    phase_name: string;
    phase_order: number;
    duration_days: number | null;
    buffer_days: number | null;
    dependency_ids: string[];
    planned_start: string | null;
    planned_end: string | null;
    status: 'DRAFT' | 'PLANNED';
    committed_deadline: string | null;
    plan_version: number;
    active: boolean;
  }>(
    `SELECT project_phase_id, project_id, phase_name, phase_order, duration_days, buffer_days,
            dependency_ids, planned_start, planned_end, status, committed_deadline, plan_version, active
       FROM project_phases WHERE project_id = $1 AND active ORDER BY phase_order`,
    [projectId]
  );
}
