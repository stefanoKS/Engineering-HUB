/**
 * Read model and evidence for ADMIN division mapping of unmapped legacy work.
 *
 * Everything here is read-only and bounded: one query per record type per page plus one query per
 * evidence source, never a query per record. The apply decision is made by the API service inside
 * its own transaction; this module never mutates a row.
 */
import type { Queryable } from '../pool';

type Db = Queryable;

export type UnmappedResponsibilityRow = {
  responsibility_id: string;
  name: string;
  status: string;
  revision: number;
  retired_at: string | null;
  project_count: number;
  task_count: number;
  subproject_count: number;
};

export type UnmappedProjectRow = {
  project_id: string;
  project_name: string;
  status: string;
  revision: number;
  archived_at: string | null;
  responsibility_id: string | null;
  responsibility_name: string | null;
  responsibility_division_id: string | null;
  task_count: number;
  subproject_count: number;
};

export type MappingCounts = {
  responsibilities: number;
  projects: number;
  archivedResponsibilities: number;
  archivedProjects: number;
  tasks: number;
  subprojects: number;
};

/** One page of unmapped responsibilities. Retired ones are included only when asked for. */
export async function listUnmappedResponsibilities(
  db: Db,
  options: { includeArchived: boolean; ids?: readonly string[]; limit: number; offset: number }
): Promise<UnmappedResponsibilityRow[]> {
  const rows = await db.many<UnmappedResponsibilityRow>(
    `SELECT r.responsibility_id, r.name, r.status, r.revision, r.retired_at,
            (SELECT count(*) FROM projects p
              WHERE p.responsibility_id = r.responsibility_id AND p.deleted_at IS NULL)::int AS project_count,
            (SELECT count(*) FROM projects p JOIN tasks t ON t.project_id = p.project_id
              WHERE p.responsibility_id = r.responsibility_id AND p.deleted_at IS NULL AND t.deleted_at IS NULL)::int AS task_count,
            (SELECT count(*) FROM projects p JOIN subprojects s ON s.project_id = p.project_id
              WHERE p.responsibility_id = r.responsibility_id AND p.deleted_at IS NULL AND s.deleted_at IS NULL)::int AS subproject_count
       FROM responsibilities r
      WHERE r.division_id IS NULL
        AND ($1::boolean OR r.status <> 'Retired')
        AND ($2::text[] IS NULL OR r.responsibility_id = ANY($2::text[]))
      ORDER BY (r.status = 'Retired') ASC, r.name ASC, r.responsibility_id ASC
      LIMIT $3 OFFSET $4`,
    [options.includeArchived, options.ids ? [...options.ids] : null, options.limit, options.offset]
  );
  return rows;
}

/** One page of unmapped projects, with the responsibility a proposal may follow. */
export async function listUnmappedProjects(
  db: Db,
  options: { includeArchived: boolean; ids?: readonly string[]; limit: number; offset: number }
): Promise<UnmappedProjectRow[]> {
  const rows = await db.many<UnmappedProjectRow>(
    `SELECT p.project_id, p.project_name, p.status, p.revision, p.archived_at,
            p.responsibility_id, r.name AS responsibility_name, r.division_id AS responsibility_division_id,
            (SELECT count(*) FROM tasks t WHERE t.project_id = p.project_id AND t.deleted_at IS NULL)::int AS task_count,
            (SELECT count(*) FROM subprojects s WHERE s.project_id = p.project_id AND s.deleted_at IS NULL)::int AS subproject_count
       FROM projects p
       LEFT JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
      WHERE p.division_id IS NULL AND p.deleted_at IS NULL
        AND ($1::boolean OR (p.status <> 'Archived' AND p.archived_at IS NULL))
        AND ($2::text[] IS NULL OR p.project_id = ANY($2::text[]))
      ORDER BY (p.status = 'Archived' OR p.archived_at IS NOT NULL) ASC, p.project_name ASC, p.project_id ASC
      LIMIT $3 OFFSET $4`,
    [options.includeArchived, options.ids ? [...options.ids] : null, options.limit, options.offset]
  );
  return rows;
}

export async function countUnmappedResponsibilities(db: Db, includeArchived: boolean): Promise<number> {
  const row = await db.one<{ total: string }>(
    `SELECT count(*)::text AS total FROM responsibilities
      WHERE division_id IS NULL AND ($1::boolean OR status <> 'Retired')`,
    [includeArchived]
  );
  return Number(row?.total ?? 0);
}

export async function countUnmappedProjects(db: Db, includeArchived: boolean): Promise<number> {
  const row = await db.one<{ total: string }>(
    `SELECT count(*)::text AS total FROM projects
      WHERE division_id IS NULL AND deleted_at IS NULL
        AND ($1::boolean OR (status <> 'Archived' AND archived_at IS NULL))`,
    [includeArchived]
  );
  return Number(row?.total ?? 0);
}

/**
 * The mapping view's headline figures.
 *
 * Active and archived unmapped records are counted separately so the screen can never present a
 * partial total as if it were the whole backlog. Tasks and subprojects are derived through their
 * project, exactly like their effective division.
 */
export async function unmappedMappingCounts(db: Db): Promise<MappingCounts> {
  const row = await db.one<{
    responsibilities: number;
    archived_responsibilities: number;
    projects: number;
    archived_projects: number;
    tasks: number;
    subprojects: number;
  }>(
    `SELECT
       (SELECT count(*) FROM responsibilities WHERE division_id IS NULL AND status <> 'Retired')::int AS responsibilities,
       (SELECT count(*) FROM responsibilities WHERE division_id IS NULL AND status = 'Retired')::int AS archived_responsibilities,
       (SELECT count(*) FROM projects WHERE division_id IS NULL AND deleted_at IS NULL
          AND status <> 'Archived' AND archived_at IS NULL)::int AS projects,
       (SELECT count(*) FROM projects WHERE division_id IS NULL AND deleted_at IS NULL
          AND (status = 'Archived' OR archived_at IS NOT NULL))::int AS archived_projects,
       (SELECT count(*) FROM tasks t JOIN projects p ON p.project_id = t.project_id
          WHERE p.division_id IS NULL AND p.deleted_at IS NULL AND t.deleted_at IS NULL)::int AS tasks,
       (SELECT count(*) FROM subprojects s JOIN projects p ON p.project_id = s.project_id
          WHERE p.division_id IS NULL AND p.deleted_at IS NULL AND s.deleted_at IS NULL)::int AS subprojects`
  );
  return {
    responsibilities: Number(row?.responsibilities ?? 0),
    archivedResponsibilities: Number(row?.archived_responsibilities ?? 0),
    projects: Number(row?.projects ?? 0),
    archivedProjects: Number(row?.archived_projects ?? 0),
    tasks: Number(row?.tasks ?? 0),
    subprojects: Number(row?.subprojects ?? 0)
  };
}

export type MappingEvidenceRow = { record_id: string; member_id: string; relation: string };

/**
 * Assignment evidence for a page of projects, in one query.
 *
 * Only relationships the application itself uses count: a project owner, a task owner, an active
 * additional task assignee, a subproject owner, and the area's owner and active members. A `READ`
 * grant, a role, oversight, a name or free text is never evidence.
 */
export async function projectMappingEvidence(db: Db, projectIds: readonly string[]): Promise<MappingEvidenceRow[]> {
  if (!projectIds.length) return [];
  return db.many<MappingEvidenceRow>(
    `SELECT t.project_id AS record_id, t.owner_member_id AS member_id, 'TASK_OWNER' AS relation
       FROM tasks t
      WHERE t.project_id = ANY($1::text[]) AND t.deleted_at IS NULL AND t.owner_member_id IS NOT NULL
     UNION
     SELECT t.project_id, a.member_id, 'TASK_ASSIGNEE'
       FROM task_assignees a JOIN tasks t ON t.task_id = a.task_id
      WHERE t.project_id = ANY($1::text[]) AND t.deleted_at IS NULL AND a.removed_at IS NULL
     UNION
     SELECT p.project_id, p.project_owner_id, 'PROJECT_OWNER'
       FROM projects p
      WHERE p.project_id = ANY($1::text[]) AND p.project_owner_id IS NOT NULL
     UNION
     SELECT s.project_id, s.owner_id, 'SUBPROJECT_OWNER'
       FROM subprojects s
      WHERE s.project_id = ANY($1::text[]) AND s.deleted_at IS NULL AND s.owner_id IS NOT NULL
     UNION
     SELECT p.project_id, r.owner_member_id, 'RESPONSIBILITY_OWNER'
       FROM projects p JOIN responsibilities r ON r.responsibility_id = p.responsibility_id
      WHERE p.project_id = ANY($1::text[]) AND r.owner_member_id IS NOT NULL
     UNION
     SELECT p.project_id, rm.member_id, 'RESPONSIBILITY_MEMBER'
       FROM projects p JOIN responsibility_members rm ON rm.responsibility_id = p.responsibility_id
      WHERE p.project_id = ANY($1::text[]) AND rm.removed_at IS NULL`,
    [[...new Set(projectIds)]]
  );
}

/** The same evidence aggregated to the responsibility a mapping would move. */
export async function responsibilityMappingEvidence(
  db: Db,
  responsibilityIds: readonly string[]
): Promise<MappingEvidenceRow[]> {
  if (!responsibilityIds.length) return [];
  const ids = [...new Set(responsibilityIds)];
  return db.many<MappingEvidenceRow>(
    `WITH project_of AS (
       SELECT p.project_id, p.responsibility_id FROM projects p
        WHERE p.responsibility_id = ANY($1::text[]) AND p.deleted_at IS NULL
     )
     SELECT po.responsibility_id AS record_id, t.owner_member_id AS member_id, 'TASK_OWNER' AS relation
       FROM project_of po JOIN tasks t ON t.project_id = po.project_id
      WHERE t.deleted_at IS NULL AND t.owner_member_id IS NOT NULL
     UNION
     SELECT po.responsibility_id, a.member_id, 'TASK_ASSIGNEE'
       FROM project_of po JOIN tasks t ON t.project_id = po.project_id
       JOIN task_assignees a ON a.task_id = t.task_id
      WHERE t.deleted_at IS NULL AND a.removed_at IS NULL
     UNION
     SELECT po.responsibility_id, p.project_owner_id, 'PROJECT_OWNER'
       FROM project_of po JOIN projects p ON p.project_id = po.project_id
      WHERE p.project_owner_id IS NOT NULL
     UNION
     SELECT po.responsibility_id, s.owner_id, 'SUBPROJECT_OWNER'
       FROM project_of po JOIN subprojects s ON s.project_id = po.project_id
      WHERE s.deleted_at IS NULL AND s.owner_id IS NOT NULL
     UNION
     SELECT r.responsibility_id, r.owner_member_id, 'RESPONSIBILITY_OWNER'
       FROM responsibilities r
      WHERE r.responsibility_id = ANY($1::text[]) AND r.owner_member_id IS NOT NULL
     UNION
     SELECT rm.responsibility_id, rm.member_id, 'RESPONSIBILITY_MEMBER'
       FROM responsibility_members rm
      WHERE rm.responsibility_id = ANY($1::text[]) AND rm.removed_at IS NULL`,
    [ids]
  );
}

/** Display name and activation for the members a proposal names. */
export async function membersForMapping(
  db: Db,
  memberIds: readonly string[]
): Promise<{ member_id: string; name: string; active: boolean }[]> {
  if (!memberIds.length) return [];
  return db.many<{ member_id: string; name: string; active: boolean }>(
    `SELECT member_id, name, active FROM members WHERE member_id = ANY($1::text[]) ORDER BY name, member_id`,
    [[...new Set(memberIds)]]
  );
}

/** Active `WORK` memberships only: a `READ` grant is never assignment evidence. */
export async function workGrantsForMapping(
  db: Db,
  memberIds: readonly string[]
): Promise<{ member_id: string; division_id: string }[]> {
  if (!memberIds.length) return [];
  return db.many<{ member_id: string; division_id: string }>(
    `SELECT member_id, division_id FROM member_divisions
      WHERE member_id = ANY($1::text[]) AND removed_at IS NULL AND access_kind = 'WORK'
      ORDER BY member_id, division_id`,
    [[...new Set(memberIds)]]
  );
}

export type VerifiedBackupRow = { backup_id: string; created_at: string; checksum: string; schema_version: number };

/**
 * The newest backup row that proves a usable artefact exists.
 *
 * `result = 'OK'` is written only after the encrypted artefact was written locally, decrypted and
 * checksum-verified by the worker's persistent backup job. A `FAILED` or `PENDING` row is not a
 * backup, and a client claim is never consulted.
 */
export async function latestVerifiedBackup(db: Db): Promise<VerifiedBackupRow | null> {
  const row = await db.one<VerifiedBackupRow>(
    `SELECT backup_id, created_at, checksum, schema_version
       FROM backup_log
      WHERE result = 'OK' AND checksum <> ''
      ORDER BY created_at DESC
      LIMIT 1`
  );
  return row ?? null;
}

/** A project's linked projects for a responsibility mapping (bounded by the responsibility). */
export async function linkedProjectsOfResponsibilities(
  db: Db,
  responsibilityIds: readonly string[]
): Promise<{ responsibility_id: string; project_id: string; project_name: string; division_id: string | null; status: string; archived_at: string | null }[]> {
  if (!responsibilityIds.length) return [];
  return db.many<{
    responsibility_id: string;
    project_id: string;
    project_name: string;
    division_id: string | null;
    status: string;
    archived_at: string | null;
  }>(
    `SELECT responsibility_id, project_id, project_name, division_id, status, archived_at
       FROM projects
      WHERE responsibility_id = ANY($1::text[]) AND deleted_at IS NULL
      ORDER BY project_name, project_id`,
    [[...new Set(responsibilityIds)]]
  );
}
