/** Directory repositories: members, responsibilities and skills. */
import type { Member, Responsibility, Skill } from '@eh/contracts';
import type { Queryable } from '../pool';
import { newId } from '../ids';
import {
  toMember,
  toResponsibility,
  toSkill,
  type MemberRow,
  type ResponsibilityRow,
  type SkillRow
} from '../map';

const MEMBER_COLUMNS = `m.member_id, m.name, m.email, m.department, m.position, m.active,
  m.manager_id, m.weekly_capacity_hours, m.role, m.created_at, m.updated_at, m.revision`;

export async function listMembers(
  db: Queryable,
  options: { includeInactive?: boolean; limit?: number } = {}
): Promise<Member[]> {
  const rows = await db.many<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM members m
      WHERE ($1::boolean OR m.active)
      ORDER BY m.active DESC, m.name ASC
      LIMIT $2`,
    [options.includeInactive === true, Math.min(options.limit ?? 500, 1000)]
  );
  return rows.map(toMember);
}

export async function listMembersPaged(
  db: Queryable,
  input: { query?: string; page: number; pageSize: number }
): Promise<{ items: Member[]; total: number }> {
  const filter = `%${(input.query ?? '').toLowerCase()}%`;
  const total = await db.one<{ count: string }>(
    `SELECT count(*)::text AS count FROM members
      WHERE ($1 = '%%' OR lower(name || ' ' || department || ' ' || position) LIKE $1)`,
    [filter]
  );
  const rows = await db.many<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM members m
      WHERE ($1 = '%%' OR lower(m.name || ' ' || m.department || ' ' || m.position) LIKE $1)
      ORDER BY m.active DESC, m.name ASC
      LIMIT $2 OFFSET $3`,
    [filter, input.pageSize, (input.page - 1) * input.pageSize]
  );
  return { items: rows.map(toMember), total: Number(total?.count ?? 0) };
}

export async function getMember(db: Queryable, memberId: string): Promise<Member | null> {
  const row = await db.one<MemberRow>(`SELECT ${MEMBER_COLUMNS} FROM members m WHERE m.member_id = $1`, [
    memberId
  ]);
  return row ? toMember(row) : null;
}

export async function getMemberByEmail(db: Queryable, email: string): Promise<Member | null> {
  const row = await db.one<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM members m WHERE lower(m.email) = lower($1)`,
    [email]
  );
  return row ? toMember(row) : null;
}

export type MemberInput = {
  name: string;
  email: string;
  department?: string;
  position?: string;
  active?: boolean;
  managerId?: string | null;
  weeklyCapacityHours?: number | null;
  role?: 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER' | null;
};

export async function insertMember(db: Queryable, input: MemberInput, memberId = newId('MEM')): Promise<Member> {
  const row = await db.one<MemberRow>(
    `INSERT INTO members (member_id, name, email, department, position, active, manager_id, weekly_capacity_hours, role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING member_id, name, email, department, position, active, manager_id,
               weekly_capacity_hours, role, created_at, updated_at, revision`,
    [
      memberId,
      input.name,
      input.email,
      input.department ?? '',
      input.position ?? '',
      input.active ?? true,
      input.managerId ?? null,
      input.weeklyCapacityHours ?? null,
      input.role ?? null
    ]
  );
  if (!row) throw new Error('Member insert returned no row');
  return toMember(row);
}

export async function updateMember(
  db: Queryable,
  memberId: string,
  patch: Partial<MemberInput>,
  expectedRevision: number
): Promise<Member | null> {
  const row = await db.one<MemberRow>(
    `UPDATE members SET
       name = COALESCE($3, name),
       email = COALESCE($4, email),
       department = COALESCE($5, department),
       position = COALESCE($6, position),
       active = COALESCE($7, active),
       manager_id = CASE WHEN $8::boolean THEN $9 ELSE manager_id END,
       weekly_capacity_hours = CASE WHEN $10::boolean THEN $11 ELSE weekly_capacity_hours END,
       role = CASE WHEN $12::boolean THEN $13 ELSE role END,
       revision = revision + 1
     WHERE member_id = $1 AND revision = $2
     RETURNING member_id, name, email, department, position, active, manager_id,
               weekly_capacity_hours, role, created_at, updated_at, revision`,
    [
      memberId,
      expectedRevision,
      patch.name ?? null,
      patch.email ?? null,
      patch.department ?? null,
      patch.position ?? null,
      patch.active ?? null,
      'managerId' in patch,
      patch.managerId ?? null,
      'weeklyCapacityHours' in patch,
      patch.weeklyCapacityHours ?? null,
      'role' in patch,
      patch.role ?? null
    ]
  );
  return row ? toMember(row) : null;
}

export async function activeAdministratorIds(db: Queryable): Promise<string[]> {
  const rows = await db.many<{ member_id: string }>(
    "SELECT member_id FROM members WHERE active AND role = 'ADMIN' ORDER BY member_id"
  );
  return rows.map((row) => row.member_id);
}

const RESPONSIBILITY_COLUMNS = `r.responsibility_id, r.name, r.description, r.owner_member_id,
  owner.name AS owner_name, r.status, r.sort_order, r.color_hex, r.retired_at, r.revision,
  r.created_at, r.updated_at`;

export async function listResponsibilities(db: Queryable): Promise<Responsibility[]> {
  const rows = await db.many<ResponsibilityRow>(
    `SELECT ${RESPONSIBILITY_COLUMNS}
       FROM responsibilities r LEFT JOIN members owner ON owner.member_id = r.owner_member_id
      ORDER BY r.status ASC, r.sort_order ASC, r.name ASC`
  );
  const members = await db.many<{
    responsibility_id: string;
    member_id: string;
    name: string;
    active: boolean;
    assigned_at: string;
    assigned_by: string;
    is_primary: boolean;
  }>(
    `SELECT rm.responsibility_id, rm.member_id, m.name, m.active, rm.assigned_at, rm.assigned_by,
            (rm.member_id = r.owner_member_id) AS is_primary
       FROM responsibility_members rm
       JOIN members m ON m.member_id = rm.member_id
       JOIN responsibilities r ON r.responsibility_id = rm.responsibility_id
      WHERE rm.removed_at IS NULL
      ORDER BY is_primary DESC, m.name ASC`
  );
  return rows.map((row) =>
    toResponsibility(
      row,
      members
        .filter((member) => member.responsibility_id === row.responsibility_id)
        .map((member) => ({
          memberId: member.member_id,
          name: member.name,
          active: member.active,
          assignedAt: member.assigned_at,
          assignedBy: member.assigned_by,
          primary: member.is_primary
        }))
    )
  );
}

export async function getResponsibility(db: Queryable, id: string): Promise<Responsibility | null> {
  const all = await listResponsibilities(db);
  return all.find((item) => item.responsibilityId === id) ?? null;
}

export type ResponsibilityInput = {
  name: string;
  description?: string;
  ownerMemberId?: string | null;
  status?: 'Active' | 'Retired';
  sortOrder?: number;
  colorHex?: string | null;
};

export async function insertResponsibility(
  db: Queryable,
  input: ResponsibilityInput,
  responsibilityId = newId('RSP')
): Promise<Responsibility> {
  await db.query(
    `INSERT INTO responsibilities (responsibility_id, name, description, owner_member_id, status, sort_order, color_hex)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      responsibilityId,
      input.name,
      input.description ?? '',
      input.ownerMemberId ?? null,
      input.status ?? 'Active',
      input.sortOrder ?? 0,
      input.colorHex ?? null
    ]
  );
  const created = await getResponsibility(db, responsibilityId);
  if (!created) throw new Error('Responsibility insert returned no row');
  return created;
}

export async function updateResponsibility(
  db: Queryable,
  id: string,
  patch: Partial<ResponsibilityInput>,
  expectedRevision: number
): Promise<Responsibility | null> {
  await db.query(
    `UPDATE responsibilities SET
       name = COALESCE($3, name),
       description = COALESCE($4, description),
       owner_member_id = CASE WHEN $5::boolean THEN $6 ELSE owner_member_id END,
       status = COALESCE($7, status),
       sort_order = COALESCE($8, sort_order),
       color_hex = CASE WHEN $9::boolean THEN $10 ELSE color_hex END,
       retired_at = CASE WHEN $7 = 'Retired' THEN COALESCE(retired_at, now())
                         WHEN $7 = 'Active' THEN NULL ELSE retired_at END,
       revision = revision + 1
     WHERE responsibility_id = $1 AND revision = $2`,
    [
      id,
      expectedRevision,
      patch.name ?? null,
      patch.description ?? null,
      'ownerMemberId' in patch,
      patch.ownerMemberId ?? null,
      patch.status ?? null,
      patch.sortOrder ?? null,
      'colorHex' in patch,
      patch.colorHex ?? null
    ]
  );
  return getResponsibility(db, id);
}

/**
 * Relationship writes are soft: a removal stamps removed_at, and re-adding a former member
 * reactivates the existing row instead of inserting a duplicate.
 */
export async function setResponsibilityMembers(
  db: Queryable,
  responsibilityId: string,
  memberIds: string[],
  actor: string
): Promise<void> {
  const desired = [...new Set(memberIds.filter(Boolean))];
  const active = await db.many<{ assignment_id: string; member_id: string }>(
    `SELECT assignment_id, member_id FROM responsibility_members
      WHERE responsibility_id = $1 AND removed_at IS NULL`,
    [responsibilityId]
  );
  const keep = new Set(desired);
  for (const row of active) {
    if (!keep.has(row.member_id)) {
      await db.query(
        'UPDATE responsibility_members SET removed_at = now(), removed_by = $2 WHERE assignment_id = $1',
        [row.assignment_id, actor]
      );
    }
  }
  for (const memberId of desired) {
    if (active.some((row) => row.member_id === memberId)) continue;
    const existing = await db.one<{ assignment_id: string }>(
      `SELECT assignment_id FROM responsibility_members
        WHERE responsibility_id = $1 AND member_id = $2 ORDER BY assigned_at DESC LIMIT 1`,
      [responsibilityId, memberId]
    );
    if (existing) {
      await db.query(
        `UPDATE responsibility_members
            SET removed_at = NULL, removed_by = '', assigned_at = now(), assigned_by = $2
          WHERE assignment_id = $1`,
        [existing.assignment_id, actor]
      );
    } else {
      await db.query(
        `INSERT INTO responsibility_members (assignment_id, responsibility_id, member_id, assigned_by)
         VALUES ($1,$2,$3,$4)`,
        [newId('RMA'), responsibilityId, memberId, actor]
      );
    }
  }
}

export async function listSkills(db: Queryable): Promise<Skill[]> {
  const rows = await db.many<SkillRow>(
    'SELECT skill_id, skill_name, category, description, required_level FROM skills ORDER BY category, skill_name'
  );
  return rows.map(toSkill);
}

export async function insertSkill(
  db: Queryable,
  input: { skillName: string; category?: string; description?: string; requiredLevel?: number | null },
  skillId = newId('SKL')
): Promise<Skill> {
  const row = await db.one<SkillRow>(
    `INSERT INTO skills (skill_id, skill_name, category, description, required_level)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING skill_id, skill_name, category, description, required_level`,
    [skillId, input.skillName, input.category ?? '', input.description ?? '', input.requiredLevel ?? null]
  );
  if (!row) throw new Error('Skill insert returned no row');
  return toSkill(row);
}

export async function listAssessments(db: Queryable, memberId?: string) {
  const rows = await db.many<{
    member_skill_id: string;
    member_id: string;
    member_name: string;
    skill_id: string;
    skill_name: string;
    current_level: number;
    assessment_date: string | null;
    assessed_by: string | null;
    evidence: string;
    training_action: string;
    next_review_date: string | null;
  }>(
    `SELECT ms.member_skill_id, ms.member_id, m.name AS member_name, ms.skill_id, s.skill_name,
            ms.current_level, ms.assessment_date, ms.assessed_by, ms.evidence, ms.training_action,
            ms.next_review_date
       FROM member_skills ms
       JOIN members m ON m.member_id = ms.member_id
       JOIN skills s ON s.skill_id = ms.skill_id
      WHERE ($1::text IS NULL OR ms.member_id = $1)
      ORDER BY m.name, s.skill_name`,
    [memberId ?? null]
  );
  return rows.map((row) => ({
    memberSkillId: row.member_skill_id,
    memberId: row.member_id,
    memberName: row.member_name,
    skillId: row.skill_id,
    skillName: row.skill_name,
    currentLevel: row.current_level,
    assessmentDate: row.assessment_date,
    assessedBy: row.assessed_by,
    evidence: row.evidence,
    trainingAction: row.training_action,
    nextReviewDate: row.next_review_date
  }));
}

export async function upsertAssessment(
  db: Queryable,
  input: {
    memberId: string;
    skillId: string;
    currentLevel: number;
    assessmentDate?: string | null;
    assessedBy: string;
    evidence?: string;
    trainingAction?: string;
    nextReviewDate?: string | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO member_skills
       (member_skill_id, member_id, skill_id, current_level, assessment_date, assessed_by, evidence, training_action, next_review_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (member_id, skill_id) DO UPDATE SET
       current_level = EXCLUDED.current_level,
       assessment_date = EXCLUDED.assessment_date,
       assessed_by = EXCLUDED.assessed_by,
       evidence = EXCLUDED.evidence,
       training_action = EXCLUDED.training_action,
       next_review_date = EXCLUDED.next_review_date`,
    [
      newId('MSK'),
      input.memberId,
      input.skillId,
      input.currentLevel,
      input.assessmentDate ?? null,
      input.assessedBy,
      input.evidence ?? '',
      input.trainingAction ?? '',
      input.nextReviewDate ?? null
    ]
  );
}
