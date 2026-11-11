/**
 * ADMIN division mapping for unmapped legacy work (preview + reviewed apply).
 *
 * Two rules shape this module:
 *
 * 1. **A preview never mutates.** It reads unmapped records and their assignment evidence and
 *    computes a proposal; opening the page changes nothing.
 * 2. **An apply is one authorized, backed-up, all-or-nothing transaction.** The actor's role,
 *    activation and memberships, every record revision, the destination division and every active
 *    assignment are re-read through the transaction handle; a single refusal commits nothing.
 *
 * A proposal is never authority. The client sends the reviewed record IDs, their target division
 * IDs and the revisions it saw; the server recomputes the eligibility of the target itself.
 */
import type { z } from 'zod';
import type {
  MappingApplyBody,
  MappingApplyResult,
  MappingAssignment,
  MappingBackupStatus,
  MappingCandidate,
  MappingDivisionOption,
  MappingEntityType,
  MappingPreviewBody,
  MappingRecord,
  MappingRule,
  MappingState,
  UnmappedMappingView
} from '@eh/contracts';
import {
  countUnmappedProjects,
  countUnmappedResponsibilities,
  getDivision,
  latestVerifiedBackup,
  linkedProjectsOfResponsibilities,
  listDivisions,
  listUnmappedProjects,
  listUnmappedResponsibilities,
  membersForMapping,
  projectMappingEvidence,
  responsibilityMappingEvidence,
  unmappedMappingCounts,
  updateProject,
  updateResponsibility,
  workGrantsForMapping,
  type MappingEvidenceRow
} from '@eh/db';
import type { Transaction } from '@eh/db';
import {
  DomainError,
  assertDivisionAcceptsNewWork,
  canAdministerDivisions,
  requireRole,
  type Identity
} from '@eh/domain';
import { audit, hashRequest, requireTypedConfirmation, runIdempotent, type ServiceCtx } from './common';
import { lockDivisionMutation, reauthorizeInTransaction } from './divisions';

/** One reviewed batch. A larger backlog must be reviewed in several explicit batches. */
export const MAPPING_BATCH_LIMIT = 100;

/** How old a verified backup may be and still gate an operational mapping. */
export const MAPPING_BACKUP_MAX_AGE_MINUTES = 24 * 60;

export type MappingEvidence = {
  memberId: string;
  name: string;
  active: boolean;
  historical: boolean;
  workDivisionIds: string[];
  relations: string[];
};

/** Merges the relationship rows into one entry per member, with their active WORK divisions. */
async function evidenceByRecord(
  db: Transaction | ServiceCtx['db'],
  rows: readonly MappingEvidenceRow[]
): Promise<Map<string, MappingEvidence[]>> {
  const members = await membersForMapping(db, rows.map((row) => row.member_id));
  const grants = await workGrantsForMapping(db, rows.map((row) => row.member_id));
  const byMember = new Map(members.map((member) => [member.member_id, member]));
  const divisionsByMember = new Map<string, string[]>();
  for (const grant of grants) {
    const list = divisionsByMember.get(grant.member_id) ?? [];
    list.push(grant.division_id);
    divisionsByMember.set(grant.member_id, list);
  }
  const result = new Map<string, MappingEvidence[]>();
  for (const row of rows) {
    const member = byMember.get(row.member_id);
    if (!member) continue;
    const list = result.get(row.record_id) ?? [];
    const existing = list.find((entry) => entry.memberId === row.member_id);
    if (existing) {
      if (!existing.relations.includes(row.relation)) existing.relations.push(row.relation);
      continue;
    }
    list.push({
      memberId: row.member_id,
      name: member.name,
      active: member.active,
      historical: !member.active,
      workDivisionIds: [...(divisionsByMember.get(row.member_id) ?? [])].sort(),
      relations: [row.relation]
    });
    result.set(row.record_id, list);
  }
  return result;
}

function toAssignments(evidence: readonly MappingEvidence[], targetDivisionId: string | null): MappingAssignment[] {
  return [...evidence]
    .sort((left, right) => left.name.localeCompare(right.name, 'ja') || left.memberId.localeCompare(right.memberId))
    .map((entry) => ({
      memberId: entry.memberId,
      name: entry.name,
      active: entry.active,
      historical: entry.historical,
      workDivisionIds: entry.workDivisionIds,
      eligible: !targetDivisionId ? false : entry.workDivisionIds.includes(targetDivisionId),
      relations: [...entry.relations].sort()
    }));
}

type Proposal = {
  state: MappingState;
  rule: MappingRule;
  proposedDivisionId: string | null;
  candidates: MappingCandidate[];
  blockers: string[];
  unresolved: string[];
};

/**
 * Applies the documented proposal rules in priority order.
 *
 * A: an explicit ADMIN target wins, but never bypasses eligibility.
 * B: a mapped responsibility fixes the project's division; a contradiction is a conflict.
 * C: otherwise only the active assignment relationships may propose a target, and they must agree
 *    on exactly one active `WORK` division. `READ` grants, roles, oversight and free text are never
 *    evidence.
 */
export function proposeMapping(input: {
  explicitDivisionId: string | null;
  responsibilityDivisionId: string | null;
  activeDivisions: ReadonlyMap<string, string>;
  evidence: readonly MappingEvidence[];
}): Proposal {
  const active = input.evidence.filter((entry) => entry.active);
  const blockers: string[] = [];
  const unresolved: string[] = [];

  const eligibleFor = (divisionId: string): string[] =>
    active.filter((entry) => !entry.workDivisionIds.includes(divisionId)).map((entry) => entry.memberId);

  const explicit = input.explicitDivisionId;
  if (explicit) {
    if (!input.activeDivisions.has(explicit)) {
      throw new DomainError('VALIDATION_FAILED', 'The selected target division is not an active division', {
        divisionId: explicit
      });
    }
    const ineligible = eligibleFor(explicit);
    if (ineligible.length) blockers.push(...ineligible.map((memberId) => `INELIGIBLE_ACTIVE_ASSIGNEE:${memberId}`));
    return {
      state: blockers.length ? 'CONFLICT' : 'SUGGESTED',
      rule: 'EXPLICIT',
      proposedDivisionId: explicit,
      candidates: [{ divisionId: explicit, name: input.activeDivisions.get(explicit) as string }],
      blockers,
      unresolved
    };
  }

  const fromResponsibility = input.responsibilityDivisionId;
  if (fromResponsibility) {
    if (!input.activeDivisions.has(fromResponsibility)) {
      return {
        state: 'CONFLICT',
        rule: 'RESPONSIBILITY',
        proposedDivisionId: null,
        candidates: [],
        blockers: ['RESPONSIBILITY_DIVISION_RETIRED'],
        unresolved
      };
    }
    const ineligible = eligibleFor(fromResponsibility);
    if (ineligible.length) blockers.push(...ineligible.map((memberId) => `INELIGIBLE_ACTIVE_ASSIGNEE:${memberId}`));
    return {
      state: blockers.length ? 'CONFLICT' : 'SUGGESTED',
      rule: 'RESPONSIBILITY',
      proposedDivisionId: fromResponsibility,
      candidates: [{ divisionId: fromResponsibility, name: input.activeDivisions.get(fromResponsibility) as string }],
      blockers,
      unresolved
    };
  }

  if (!active.length) {
    unresolved.push('NO_ACTIVE_ASSIGNMENT_EVIDENCE');
    return {
      state: 'UNRESOLVED',
      rule: 'NONE',
      proposedDivisionId: null,
      candidates: [],
      blockers,
      unresolved
    };
  }

  // Only active WORK memberships of active assignees are evidence. The intersection is computed
  // over them, so one account holding every division can never decide a target on its own.
  let common: string[] | null = null;
  for (const entry of active) {
    const divisions = entry.workDivisionIds.filter((divisionId) => input.activeDivisions.has(divisionId));
    common = common === null ? divisions : common.filter((divisionId) => divisions.includes(divisionId));
  }
  const candidates = (common ?? [])
    .sort()
    .map((divisionId) => ({ divisionId, name: input.activeDivisions.get(divisionId) as string }));

  if (candidates.length === 1) {
    return {
      state: 'SUGGESTED',
      rule: 'COMMON_MEMBERSHIP',
      proposedDivisionId: candidates[0]!.divisionId,
      candidates,
      blockers,
      unresolved
    };
  }
  if (candidates.length > 1) {
    unresolved.push('MULTIPLE_COMMON_DIVISIONS');
    return { state: 'AMBIGUOUS', rule: 'COMMON_MEMBERSHIP', proposedDivisionId: null, candidates, blockers, unresolved };
  }
  const withoutMembership = active
    .filter((entry) => entry.workDivisionIds.filter((divisionId) => input.activeDivisions.has(divisionId)).length === 0)
    .map((entry) => entry.memberId);
  blockers.push(...withoutMembership.map((memberId) => `NO_WORK_MEMBERSHIP:${memberId}`));
  if (!withoutMembership.length) blockers.push('NO_COMMON_DIVISION');
  return { state: 'CONFLICT', rule: 'COMMON_MEMBERSHIP', proposedDivisionId: null, candidates: [], blockers, unresolved };
}

/**
 * The verified-backup gate.
 *
 * The worker writes `result = 'OK'` only after the encrypted artefact exists locally and was
 * decrypted and checksum-verified, so this reads real evidence, never a client claim. A stale or
 * missing backup refuses the apply with the exact operator command.
 */
export async function mappingBackupStatus(db: Transaction | ServiceCtx['db']): Promise<MappingBackupStatus> {
  const row = await latestVerifiedBackup(db);
  if (!row) {
    return {
      required: true,
      verified: false,
      backupId: null,
      createdAt: null,
      message:
        'No verified backup exists. Run `node --env-file=data/lan/worker.env apps/worker/dist/cli.js backup-now` and verify it before mapping.'
    };
  }
  const ageMinutes = (Date.now() - new Date(row.created_at).getTime()) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes > MAPPING_BACKUP_MAX_AGE_MINUTES) {
    return {
      required: true,
      verified: false,
      backupId: row.backup_id,
      createdAt: row.created_at,
      message: `The newest verified backup (${row.backup_id}) is older than ${Math.round(
        MAPPING_BACKUP_MAX_AGE_MINUTES / 60
      )} hours. Run the backup again before mapping.`
    };
  }
  return {
    required: true,
    verified: true,
    backupId: row.backup_id,
    createdAt: row.created_at,
    message: `Verified backup ${row.backup_id} is available for this mapping.`
  };
}

function requireVerifiedBackup(status: MappingBackupStatus): void {
  if (!status.verified) {
    throw new DomainError('MAPPING_BACKUP_REQUIRED', status.message, { backupId: status.backupId }, false);
  }
}

async function activeDivisionOptions(ctx: ServiceCtx): Promise<{ options: MappingDivisionOption[]; byId: Map<string, string> }> {
  const divisions = await listDivisions(ctx.db);
  const options = divisions
    .filter((division) => division.status === 'Active')
    .map((division) => ({ divisionId: division.divisionId, name: division.name }));
  return { options, byId: new Map(options.map((option) => [option.divisionId, option.name])) };
}

/**
 * Read-only mapping view.
 *
 * Counts always describe both record types; `page`/`pageSize` page each listed type independently so
 * a page is bounded by `2 × pageSize` records. The selection is an ADMIN proposal, never a fact.
 */
export async function mappingView(ctx: ServiceCtx, input: MappingPreviewBody): Promise<UnmappedMappingView> {
  requireRole(ctx.identity, 'ADMIN');
  if (!canAdministerDivisions(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'ADMIN required');
  }
  const backup = await mappingBackupStatus(ctx.db);
  const counts = await unmappedMappingCounts(ctx.db);
  const { options, byId } = await activeDivisionOptions(ctx);

  const explicitDivisionId = input.divisionId ?? null;
  if (explicitDivisionId && !byId.has(explicitDivisionId)) {
    throw new DomainError('VALIDATION_FAILED', 'The selected target division is not an active division', {
      divisionId: explicitDivisionId
    });
  }

  const offset = (input.page - 1) * input.pageSize;
  const responsibilityIds = input.responsibilityIds ?? null;
  const projectIds = input.projectIds ?? null;

  const responsibilities =
    input.entityType === 'PROJECT'
      ? []
      : await listUnmappedResponsibilities(ctx.db, {
          includeArchived: input.includeArchived,
          ...(responsibilityIds ? { ids: responsibilityIds } : {}),
          limit: input.pageSize,
          offset
        });
  const projects =
    input.entityType === 'RESPONSIBILITY'
      ? []
      : await listUnmappedProjects(ctx.db, {
          includeArchived: input.includeArchived,
          ...(projectIds ? { ids: projectIds } : {}),
          limit: input.pageSize,
          offset
        });

  const projectIdsForEvidence = [...projects.map((project) => project.project_id)];
  const responsibilityIdsForEvidence = responsibilities.map((row) => row.responsibility_id);

  // One query per evidence source for the whole page, never one per record.
  const projectEvidence = await evidenceByRecord(
    ctx.db,
    await projectMappingEvidence(ctx.db, projectIdsForEvidence)
  );
  const responsibilityEvidence = await evidenceByRecord(
    ctx.db,
    await responsibilityMappingEvidence(ctx.db, responsibilityIdsForEvidence)
  );
  const linkedProjects = await linkedProjectsOfResponsibilities(ctx.db, responsibilityIdsForEvidence);
  const linkedByResponsibility = new Map<string, typeof linkedProjects>();
  for (const link of linkedProjects) {
    const list = linkedByResponsibility.get(link.responsibility_id) ?? [];
    list.push(link);
    linkedByResponsibility.set(link.responsibility_id, list);
  }

  const items: MappingRecord[] = [];

  for (const row of responsibilities) {
    const linked = linkedByResponsibility.get(row.responsibility_id) ?? [];
    const proposal = proposeMapping({
      explicitDivisionId,
      responsibilityDivisionId: null,
      activeDivisions: byId,
      evidence: responsibilityEvidence.get(row.responsibility_id) ?? []
    });
    const blockedProjects = linked
      .filter((link) => link.division_id !== null && link.division_id !== proposal.proposedDivisionId)
      .map((link) => `LINKED_PROJECT_ALREADY_MAPPED:${link.project_id}`);
    items.push({
      entityType: 'RESPONSIBILITY',
      entityId: row.responsibility_id,
      name: row.name,
      status: row.status,
      archived: row.status === 'Retired',
      revision: Number(row.revision),
      currentDivisionId: null,
      taskCount: Number(row.task_count ?? 0),
      subprojectCount: Number(row.subproject_count ?? 0),
      linkedProjects: linked.map((link) => ({
        projectId: link.project_id,
        projectName: link.project_name,
        divisionId: link.division_id,
        status: link.status,
        archived: link.status === 'Archived' || !!link.archived_at
      })),
      state: blockedProjects.length && proposal.state === 'SUGGESTED' ? 'CONFLICT' : proposal.state,
      rule: proposal.rule,
      proposedDivisionId: proposal.proposedDivisionId,
      proposedDivisionName: proposal.proposedDivisionId ? (byId.get(proposal.proposedDivisionId) ?? null) : null,
      candidates: proposal.candidates,
      assignments: toAssignments(responsibilityEvidence.get(row.responsibility_id) ?? [], proposal.proposedDivisionId),
      blockers: [...proposal.blockers, ...blockedProjects],
      unresolved: proposal.unresolved
    });
  }

  for (const row of projects) {
    const proposal = proposeMapping({
      explicitDivisionId,
      responsibilityDivisionId: row.responsibility_division_id,
      activeDivisions: byId,
      evidence: projectEvidence.get(row.project_id) ?? []
    });
    const blockers = [...proposal.blockers];
    if (row.responsibility_division_id && explicitDivisionId && explicitDivisionId !== row.responsibility_division_id) {
      blockers.push('RESPONSIBILITY_DIVISION_CONFLICT');
    }
    items.push({
      entityType: 'PROJECT',
      entityId: row.project_id,
      name: row.project_name,
      status: row.status,
      archived: row.status === 'Archived' || !!row.archived_at,
      revision: Number(row.revision),
      currentDivisionId: null,
      taskCount: Number(row.task_count ?? 0),
      subprojectCount: Number(row.subproject_count ?? 0),
      linkedProjects: [],
      state: blockers.length && proposal.state === 'SUGGESTED' ? 'CONFLICT' : proposal.state,
      rule: proposal.rule,
      proposedDivisionId: proposal.proposedDivisionId,
      proposedDivisionName: proposal.proposedDivisionId ? (byId.get(proposal.proposedDivisionId) ?? null) : null,
      candidates: proposal.candidates,
      assignments: toAssignments(projectEvidence.get(row.project_id) ?? [], proposal.proposedDivisionId),
      blockers,
      unresolved: proposal.unresolved
    });
  }

  const responsibilityTotal = await countUnmappedResponsibilities(ctx.db, input.includeArchived);
  const projectTotal = await countUnmappedProjects(ctx.db, input.includeArchived);
  const total =
    (input.entityType === 'PROJECT' ? 0 : responsibilityTotal) +
    (input.entityType === 'RESPONSIBILITY' ? 0 : projectTotal);
  const pages = [
    input.entityType === 'PROJECT' ? 0 : Math.ceil(responsibilityTotal / input.pageSize),
    input.entityType === 'RESPONSIBILITY' ? 0 : Math.ceil(projectTotal / input.pageSize)
  ];

  return {
    counts,
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, ...pages),
    selection: {
      divisionId: explicitDivisionId,
      responsibilityIds: responsibilityIds ?? [],
      projectIds: projectIds ?? []
    },
    divisions: options,
    backup,
    batchLimit: MAPPING_BATCH_LIMIT,
    generatedAt: new Date().toISOString()
  };
}

type BatchRecord = { entityType: MappingEntityType; entityId: string; divisionId: string; revision: number };

/** The exact phrase the reviewed batch requires; derived from the batch, never from free text. */
export function mappingConfirmationText(count: number): string {
  return `MAP ${count} RECORD${count === 1 ? '' : 'S'}`;
}

/** Active assignees must hold a `WORK` membership in the destination; inactive ones are history. */
function assertMappingEligibility(
  recordId: string,
  evidence: readonly MappingEvidence[],
  divisionId: string
): void {
  const ineligible = evidence.filter((entry) => entry.active && !entry.workDivisionIds.includes(divisionId));
  if (ineligible.length) {
    throw new DomainError(
      'DIVISION_MEMBERSHIP_REQUIRED',
      'Every active assignee must belong to the destination division',
      { recordId, divisionId, members: ineligible.map((entry) => entry.memberId) }
    );
  }
}

/**
 * Applies the reviewed batch, exactly once.
 *
 * One transaction: the division/role locks, the actor re-read, the verified backup, each record and
 * its revision, the destination lifecycle, the whole affected responsibility scope, every active
 * assignment, the row updates (projects before responsibilities, so the area trigger accepts them),
 * the per-record audit and the batch audit. A refusal at any point commits nothing.
 */
export async function applyMapping(ctx: ServiceCtx, body: z.infer<typeof MappingApplyBody>): Promise<MappingApplyResult> {
  requireRole(ctx.identity, 'ADMIN');
  if (!canAdministerDivisions(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'ADMIN required');
  }
  if (body.batch.length > MAPPING_BATCH_LIMIT) {
    throw new DomainError('VALIDATION_FAILED', `A batch accepts at most ${MAPPING_BATCH_LIMIT} records`, {
      batchLimit: MAPPING_BATCH_LIMIT
    });
  }
  const seen = new Set<string>();
  for (const item of body.batch) {
    const key = `${item.entityType}:${item.entityId}`;
    if (seen.has(key)) {
      throw new DomainError('VALIDATION_FAILED', 'The batch contains the same record twice', { record: key });
    }
    seen.add(key);
  }
  requireTypedConfirmation(body.confirmation, mappingConfirmationText(body.batch.length));

  /** The authorization a replay must still pass. */
  const authorize = async (tx: Transaction): Promise<void> => {
    const fresh = await reauthorizeInTransaction(tx, ctx);
    requireRole(fresh.identity, 'ADMIN');
    if (!canAdministerDivisions(fresh.identity)) {
      throw new DomainError('AUTHORIZATION_DENIED', 'ADMIN required');
    }
    requireVerifiedBackup(await mappingBackupStatus(tx));
  };

  const result = await runIdempotent(
    ctx,
    { scope: 'division.mapping', key: body.idempotencyKey, request: body },
    async (tx) => {
      await lockDivisionMutation(tx);
      // Re-authorize and re-check the backup inside the transaction: neither the request-level
      // role nor a client claim about a backup is authority here.
      await authorize(tx);

      // Deterministic from the reviewed batch, so a replay and its original share one identifier.
      const batchId = `MAP-${hashRequest({ key: body.idempotencyKey, batch: body.batch }).slice(0, 24)}`;
      const batch = body.batch as BatchRecord[];
      const projectItems = batch.filter((item) => item.entityType === 'PROJECT');
      const responsibilityItems = batch.filter((item) => item.entityType === 'RESPONSIBILITY');

      // Destinations once, then records with their current state.
      const destinations = new Map<string, string>();
      for (const item of batch) {
        if (destinations.has(item.divisionId)) continue;
        const division = await getDivision(tx, item.divisionId);
        if (!division) {
          throw new DomainError('VALIDATION_FAILED', 'Unknown target division', { divisionId: item.divisionId });
        }
        assertDivisionAcceptsNewWork(division.status);
        destinations.set(item.divisionId, division.name);
      }

      const projects = await tx.many<{
        project_id: string;
        revision: number;
        division_id: string | null;
        responsibility_id: string | null;
        deleted_at: string | null;
      }>(
        `SELECT project_id, revision, division_id, responsibility_id, deleted_at
           FROM projects WHERE project_id = ANY($1::text[])`,
        [projectItems.map((item) => item.entityId)]
      );
      const projectById = new Map(projects.map((row) => [row.project_id, row]));

      const responsibilities = await tx.many<{ responsibility_id: string; revision: number; division_id: string | null }>(
        `SELECT responsibility_id, revision, division_id
           FROM responsibilities WHERE responsibility_id = ANY($1::text[])`,
        [responsibilityItems.map((item) => item.entityId)]
      );
      const responsibilityById = new Map(responsibilities.map((row) => [row.responsibility_id, row]));

      for (const item of projectItems) {
        const row = projectById.get(item.entityId);
        if (!row || row.deleted_at) throw new DomainError('NOT_FOUND', `Project not found: ${item.entityId}`);
        if (row.division_id !== null) {
          throw new DomainError('INVALID_TRANSITION', 'This project is already mapped to a division', {
            projectId: item.entityId,
            divisionId: row.division_id
          });
        }
        if (Number(row.revision) !== item.revision) {
          throw new DomainError('EDIT_CONFLICT', 'The project changed since you reviewed the mapping', {
            projectId: item.entityId
          });
        }
        if (row.responsibility_id) {
          const responsibility = responsibilityById.get(row.responsibility_id);
          const mapped = responsibility?.division_id ?? null;
          if (mapped !== null && mapped !== item.divisionId) {
            throw new DomainError(
              'VALIDATION_FAILED',
              'The project responsibility belongs to another division',
              { projectId: item.entityId, responsibilityDivisionId: mapped }
            );
          }
        }
      }

      // The whole affected responsibility scope is validated before anything is written.
      const links = await linkedProjectsOfResponsibilities(
        tx,
        responsibilityItems.map((item) => item.entityId)
      );
      const batchProjectTarget = new Map(projectItems.map((item) => [item.entityId, item.divisionId]));
      for (const item of responsibilityItems) {
        const row = responsibilityById.get(item.entityId);
        if (!row) throw new DomainError('NOT_FOUND', `Responsibility not found: ${item.entityId}`);
        if (row.division_id !== null) {
          throw new DomainError('INVALID_TRANSITION', 'This responsibility is already mapped to a division', {
            responsibilityId: item.entityId,
            divisionId: row.division_id
          });
        }
        if (Number(row.revision) !== item.revision) {
          throw new DomainError('EDIT_CONFLICT', 'The responsibility changed since you reviewed the mapping', {
            responsibilityId: item.entityId
          });
        }
        for (const link of links.filter((entry) => entry.responsibility_id === item.entityId)) {
          const inBatch = batchProjectTarget.get(link.project_id);
          const target = inBatch ?? link.division_id;
          if (target !== item.divisionId) {
            throw new DomainError(
              'INVALID_TRANSITION',
              'Every linked project must be mapped to the same division in this batch',
              { responsibilityId: item.entityId, projectId: link.project_id }
            );
          }
        }
      }

      // One evidence query for the whole batch plus the responsibility scope.
      const evidenceProjectIds = [
        ...projectItems.map((item) => item.entityId),
        ...links.map((link) => link.project_id)
      ];
      const projectEvidence = await evidenceByRecord(tx, await projectMappingEvidence(tx, evidenceProjectIds));
      const responsibilityEvidence = await evidenceByRecord(
        tx,
        await responsibilityMappingEvidence(tx, responsibilityItems.map((item) => item.entityId))
      );

      for (const item of projectItems) {
        assertMappingEligibility(item.entityId, projectEvidence.get(item.entityId) ?? [], item.divisionId);
      }
      for (const item of responsibilityItems) {
        assertMappingEligibility(item.entityId, responsibilityEvidence.get(item.entityId) ?? [], item.divisionId);
      }

      // Projects first: the responsibility trigger requires every linked project to agree already.
      for (const item of projectItems) {
        const updated = await updateProject(tx, item.entityId, { divisionId: item.divisionId }, item.revision);
        if (!updated) {
          throw new DomainError('EDIT_CONFLICT', 'The project changed since you reviewed the mapping', {
            projectId: item.entityId
          });
        }
        await audit(tx, ctx, {
          entityType: 'PROJECTS',
          entityId: item.entityId,
          action: 'PROJECT_DIVISION_MAPPED',
          previousValue: { divisionId: null },
          newValue: {
            divisionId: item.divisionId,
            batchId,
            reason: body.reason ?? '',
            previousRevision: item.revision,
            revision: updated.revision
          }
        });
      }
      for (const item of responsibilityItems) {
        const updated = await updateResponsibility(tx, item.entityId, { divisionId: item.divisionId }, item.revision);
        if (!updated) {
          throw new DomainError('EDIT_CONFLICT', 'The responsibility changed since you reviewed the mapping', {
            responsibilityId: item.entityId
          });
        }
        await audit(tx, ctx, {
          entityType: 'RESPONSIBILITIES',
          entityId: item.entityId,
          action: 'RESPONSIBILITY_DIVISION_MAPPED',
          previousValue: { divisionId: null },
          newValue: {
            divisionId: item.divisionId,
            batchId,
            reason: body.reason ?? '',
            previousRevision: item.revision,
            revision: updated.revision
          }
        });
      }

      await audit(tx, ctx, {
        entityType: 'DIVISION_MAPPING',
        entityId: batchId,
        action: 'DIVISION_MAPPING_APPLIED',
        newValue: {
          batchId,
          reason: body.reason ?? '',
          projects: projectItems.map((item) => ({ projectId: item.entityId, divisionId: item.divisionId })),
          responsibilities: responsibilityItems.map((item) => ({
            responsibilityId: item.entityId,
            divisionId: item.divisionId
          }))
        }
      });

      return {
        batchId,
        responsibilities: responsibilityItems.length,
        projects: projectItems.length,
        divisions: [...destinations].map(([divisionId, name]) => ({ divisionId, name })),
        backupId: (await mappingBackupStatus(tx)).backupId
      };
    },
    { authorize }
  );

  return { ...result.data, replayed: result.replayed };
}

/** The identity the apply was authorized for; exported for the route's ADMIN pre-check parity. */
export type MappingActor = Identity;
