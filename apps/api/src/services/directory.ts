/** Member, responsibility and skill commands. */
import type { z } from 'zod';
import type {
  AssessSkillBody,
  CreateSkillBody,
  Member,
  Responsibility,
  SaveMemberBody,
  SaveResponsibilityBody
} from '@eh/contracts';
import {
  activeAdministratorIds,
  getDivision,
  getMember,
  insertMember,
  insertResponsibility,
  insertSkill,
  listResponsibilities,
  setResponsibilityMembers,
  updateMember,
  updateResponsibility,
  upsertAssessment,
  revokeMemberSessions
} from '@eh/db';
import type { Queryable, Transaction } from '@eh/db';
import {
  DomainError,
  assertDivisionAcceptsNewWork,
  assertRoleChangeAllowed,
  assertWritableDivision,
  canManageResponsibility,
  movedSequence,
  requirePrimaryOwnerChange,
  requireRole,
  resequencedSortOrders
} from '@eh/domain';
import { audit, runIdempotent, type ServiceCtx } from './common';
import {
  applyMemberDivisionGrants,
  assertAssignmentEligibility,
  authorizeMutation,
  getDivisionForWrite,
  lockDivisionMutation,
  reauthorizeInTransaction
} from './divisions';

async function activeMember(ctx: ServiceCtx, memberId: string | null | undefined): Promise<void> {
  if (!memberId) return;
  const member = await getMember(ctx.db, memberId);
  if (!member) throw new DomainError('VALIDATION_FAILED', `Unknown member: ${memberId}`);
  if (!member.active) throw new DomainError('VALIDATION_FAILED', 'A new relationship must name an active member');
}

/** The active additional members of one area, read through the caller's connection. */
async function activeResponsibilityMemberIds(db: Queryable, responsibilityId: string): Promise<string[]> {
  const rows = await db.many<{ member_id: string }>(
    `SELECT member_id FROM responsibility_members
      WHERE responsibility_id = $1 AND removed_at IS NULL
      ORDER BY member_id`,
    [responsibilityId]
  );
  return rows.map((row) => row.member_id);
}

/**
 * Validates the *changed* part of an area's assignment set against its division.
 *
 * - the owner is validated when it is new or changed;
 * - an additional member is validated when it is newly added;
 * - when the area itself moves to another division, every retained assignment is validated against
 *   the destination, because retention in a new division is a new assignment;
 * - an unchanged relationship is preserved after a later deactivation, and an ordinary edit never
 *   re-validates or removes it.
 */
async function validateResponsibilityAssignments(
  ctx: ServiceCtx,
  input: {
    divisionId: string | null;
    ownerMemberId: string | null | undefined;
    previousOwnerMemberId: string | null | undefined;
    additionalMemberIds: readonly string[] | undefined;
    previousMemberIds: readonly string[];
    divisionChanged: boolean;
  },
  db: Queryable
): Promise<void> {
  if (!input.divisionId) {
    // The documented unmapped path has no division to belong to, so there is no membership rule to
    // apply; it is restricted to ADMIN by the caller.
    return;
  }
  const previousMembers = new Set(input.previousMemberIds);
  const ownerIsNew =
    input.ownerMemberId !== undefined && (input.ownerMemberId ?? null) !== (input.previousOwnerMemberId ?? null);
  const owners: string[] = [];
  if (input.ownerMemberId && (ownerIsNew || input.divisionChanged)) owners.push(input.ownerMemberId);
  const added = (input.additionalMemberIds ?? []).filter(
    (memberId) => !previousMembers.has(memberId) || input.divisionChanged
  );
  await assertAssignmentEligibility(ctx, input.divisionId, [...owners, ...added], new Set(), db);
}

export async function saveMember(
  ctx: ServiceCtx,
  body: z.infer<typeof SaveMemberBody>
): Promise<{ member: Member; replayed: boolean }> {
  requireRole(ctx.identity, 'MANAGER');
  const touchesRole = body.role !== undefined || body.active !== undefined;
  if (touchesRole) requireRole(ctx.identity, 'ADMIN');

  if (!body.memberId) {
    if (!body.name || !body.email) {
      throw new DomainError('VALIDATION_FAILED', 'A member needs a name and an email address');
    }
    // The access check a replayed create must still pass (role and activation are re-read).
    const authorizeMemberCreate = async (tx: Transaction): Promise<void> => {
      const fresh = await reauthorizeInTransaction(tx, ctx);
      requireRole(fresh.identity, touchesRole ? 'ADMIN' : 'MANAGER');
    };
    const result = await runIdempotent(
      ctx,
      { scope: 'member.create', key: body.idempotencyKey ?? `member:${body.email}`, request: body },
      async (tx) => {
        // A member (and its role, activation and initial membership) is created by an ADMIN only,
        // and the stored role is re-read before the row and its relationships are written.
        await lockDivisionMutation(tx);
        await authorizeMemberCreate(tx);
        const member = await insertMember(tx, {
          name: body.name as string,
          email: body.email as string,
          department: body.department,
          position: body.position,
          active: body.active ?? true,
          managerId: body.managerId ?? null,
          weeklyCapacityHours: body.weeklyCapacityHours ?? null,
          role: body.role ?? null
        });
        await audit(tx, ctx, {
          entityType: 'MEMBERS',
          entityId: member.memberId,
          action: 'MEMBER_CREATED',
          newValue: member
        });
        await applyMemberDivisionGrants(ctx, member.memberId, body.divisionGrants, body.allDivisionsRead, tx);
        return member;
      },
      { authorize: authorizeMemberCreate }
    );
    return { member: result.data, replayed: result.replayed };
  }

  const member = await getMember(ctx.db, body.memberId);
  if (!member) throw new DomainError('NOT_FOUND', `Member not found: ${body.memberId}`);
  if (body.revision === undefined) {
    throw new DomainError('VALIDATION_FAILED', 'A revision is required for this edit');
  }
  const memberRevision = body.revision;
  if (memberRevision !== member.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  if (touchesRole) {
    assertRoleChangeAllowed({
      actor: ctx.identity,
      targetMemberId: member.memberId,
      targetRole: body.role ?? null,
      targetActive: body.active ?? member.active,
      activeAdministratorIds: await activeAdministratorIds(ctx.db)
    });
  }
  if (body.managerId) await activeMember(ctx, body.managerId);

  const updated = await ctx.db.transaction(async (tx) => {
    const touchesDivisionAccess = body.divisionGrants !== undefined || body.allDivisionsRead !== undefined;
    if (touchesRole || touchesDivisionAccess) {
      // One lock order for every access change: the division/membership lock first, then the
      // role-and-activation lock. Two administrators removing each other, and a membership change
      // racing a work mutation, are both serialized by this pair.
      await lockDivisionMutation(tx);
    }
    if (touchesRole) {
      // Serialize the whole administrator set, not only the target row. Two administrators
      // removing each other must not both validate against the same old membership set.
      const acting = await getMember(tx, ctx.identity.memberId);
      if (!acting) throw new DomainError('AUTHORIZATION_DENIED', 'The acting member no longer exists');
      const actor = { ...ctx.identity, role: acting.role ?? 'VIEWER' as const, active: acting.active };
      requireRole(actor, 'ADMIN');
      const current = await getMember(tx, member.memberId);
      if (!current || current.revision !== memberRevision) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
      assertRoleChangeAllowed({ actor, targetMemberId: current.memberId, targetRole: body.role ?? null,
        targetActive: body.active ?? current.active, activeAdministratorIds: await activeAdministratorIds(tx) });
    }
    const next = await updateMember(
      tx,
      member.memberId,
      {
        name: body.name,
        email: body.email,
        department: body.department,
        position: body.position,
        active: body.active,
        managerId: body.managerId,
        weeklyCapacityHours: body.weeklyCapacityHours,
        role: body.role
      },
      memberRevision
    );
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    const action = body.role !== undefined && body.role !== member.role
      ? 'ROLE_CHANGED'
      : body.active === false && member.active
        ? 'MEMBER_DEACTIVATED'
        : 'MEMBER_UPDATED';
    await audit(tx, ctx, {
      entityType: 'MEMBERS',
      entityId: member.memberId,
      action,
      previousValue: member,
      newValue: next
    });
    // Division membership is an ADMIN-only relationship edit, applied in the same transaction so
    // the member row and its access change are one operation.
    await applyMemberDivisionGrants(ctx, member.memberId, body.divisionGrants, body.allDivisionsRead, tx);
    return next;
  });
  if (body.active === false) await revokeMemberSessions(ctx.db, member.memberId);
  return { member: updated, replayed: false };
}

export async function saveResponsibility(
  ctx: ServiceCtx,
  body: z.infer<typeof SaveResponsibilityBody>
): Promise<{ responsibility: Responsibility; replayed: boolean }> {
  requireRole(ctx.identity, 'MANAGER');
  if (body.ownerMemberId) await activeMember(ctx, body.ownerMemberId);
  if (body.additionalMemberIds) {
    for (const memberId of body.additionalMemberIds) await activeMember(ctx, memberId);
  }

  if (!body.responsibilityId) {
    if (!body.name) throw new DomainError('VALIDATION_FAILED', 'A responsibility needs a name');
    // A new area belongs to a division this manager may write in, and its owner and members must
    // already belong there (an active `WORK` membership). An area without a division keeps the
    // documented unassigned path, which is ADMIN remediation only.
    const divisionId = body.divisionId ?? null;
    if (divisionId) {
      await getDivisionForWrite(ctx, divisionId);
      await assertAssignmentEligibility(ctx, divisionId, [
        body.ownerMemberId ?? ctx.identity.memberId,
        ...(body.additionalMemberIds ?? [])
      ]);
    } else {
      assertWritableDivision(ctx.divisions, null);
    }
    if (body.ownerMemberId && ctx.identity.role !== 'ADMIN' && body.ownerMemberId !== ctx.identity.memberId) {
      requirePrimaryOwnerChange(ctx.identity);
    }
    // The access check a replayed create must still pass.
    const authorizeResponsibilityWrite = async (tx: Transaction): Promise<void> => {
      const fresh = await reauthorizeInTransaction(tx, ctx);
      if (!canManageResponsibility(fresh.identity)) {
        throw new DomainError('AUTHORIZATION_DENIED', 'Responsibility administration requires MANAGER or ADMIN');
      }
    };
    const result = await runIdempotent(
      ctx,
      { scope: 'responsibility.create', key: body.idempotencyKey ?? `responsibility:${body.name}`, request: body },
      async (tx) => {
        // Authoritative re-check inside the write: the actor's role, the division lifecycle, the
        // division authority and every assignment are re-read before the row is inserted.
        await lockDivisionMutation(tx);
        await authorizeResponsibilityWrite(tx);
        const fresh = await reauthorizeInTransaction(tx, ctx);
        if (divisionId) {
          const division = await getDivision(tx, divisionId);
          if (!division) throw new DomainError('VALIDATION_FAILED', 'Unknown division');
          assertDivisionAcceptsNewWork(division.status);
          assertWritableDivision(fresh.scope, division.divisionId);
          await assertAssignmentEligibility(
            ctx,
            division.divisionId,
            [body.ownerMemberId ?? ctx.identity.memberId, ...(body.additionalMemberIds ?? [])],
            new Set(),
            tx
          );
        } else {
          assertWritableDivision(fresh.scope, null);
        }
        if (body.ownerMemberId && fresh.identity.role !== 'ADMIN' && body.ownerMemberId !== fresh.identity.memberId) {
          requirePrimaryOwnerChange(fresh.identity);
        }
        const created = await insertResponsibility(tx, {
          name: body.name as string,
          description: body.description,
          divisionId,
          ownerMemberId: body.ownerMemberId ?? ctx.identity.memberId,
          status: body.status ?? 'Active',
          sortOrder: body.sortOrder ?? 0,
          colorHex: body.colorHex ?? null
        });
        if (body.additionalMemberIds?.length) {
          await setResponsibilityMembers(tx, created.responsibilityId, body.additionalMemberIds, ctx.identity.email);
        }
        await audit(tx, ctx, {
          entityType: 'RESPONSIBILITIES',
          entityId: created.responsibilityId,
          action: 'RESPONSIBILITY_CREATED',
          newValue: created
        });
        return created;
      },
      { authorize: authorizeResponsibilityWrite }
    );
    return { responsibility: result.data, replayed: result.replayed };
  }

  const before = (await listResponsibilities(ctx.db)).find(
    (entry) => entry.responsibilityId === body.responsibilityId
  );
  if (!before) throw new DomainError('NOT_FOUND', `Responsibility not found: ${body.responsibilityId}`);
  if (!canManageResponsibility(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Responsibility administration requires MANAGER or ADMIN');
  }
  // The current area and any new division must both be writable for this caller. Unmapped work is
  // ADMIN remediation, and an explicit `null` division is an unmap, so it needs the same right.
  assertWritableDivision(ctx.divisions, before.divisionId);
  if (body.divisionId !== undefined) {
    if (body.divisionId === null) assertWritableDivision(ctx.divisions, null);
    else await getDivisionForWrite(ctx, body.divisionId);
  }
  if (body.revision === undefined) {
    throw new DomainError('VALIDATION_FAILED', 'A revision is required for this edit');
  }
  const responsibilityRevision = body.revision;
  if (responsibilityRevision !== before.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  if (
    body.ownerMemberId !== undefined &&
    (body.ownerMemberId ?? '') !== (before.ownerMemberId ?? '')
  ) {
    requirePrimaryOwnerChange(ctx.identity);
  }
  const previousMembers = await activeResponsibilityMemberIds(ctx.db, before.responsibilityId);
  const divisionWillChange = body.divisionId !== undefined && body.divisionId !== before.divisionId;
  if (divisionWillChange) {
    // A retained assignment is a new assignment in the destination division.
    await validateResponsibilityAssignments(
      ctx,
      {
        divisionId: body.divisionId ?? null,
        ownerMemberId: body.ownerMemberId ?? before.ownerMemberId,
        previousOwnerMemberId: before.ownerMemberId,
        additionalMemberIds: body.additionalMemberIds ?? previousMembers,
        previousMemberIds: previousMembers,
        divisionChanged: true
      },
      ctx.db
    );
  } else {
    await validateResponsibilityAssignments(
      ctx,
      {
        divisionId: before.divisionId,
        ownerMemberId: body.ownerMemberId,
        previousOwnerMemberId: before.ownerMemberId,
        additionalMemberIds: body.additionalMemberIds,
        previousMemberIds: previousMembers,
        divisionChanged: false
      },
      ctx.db
    );
  }

  const updated = await ctx.db.transaction(async (tx) => {
    // One lock order, then the authoritative re-read of the actor, the stored area and its
    // membership set. A role downgrade, a membership removal or a division retirement that landed
    // while this request was waiting is therefore honoured before anything is written.
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    if (!canManageResponsibility(fresh.identity)) {
      throw new DomainError('AUTHORIZATION_DENIED', 'Responsibility administration requires MANAGER or ADMIN');
    }
    const stored = (await listResponsibilities(tx)).find(
      (entry) => entry.responsibilityId === body.responsibilityId
    );
    if (!stored) throw new DomainError('NOT_FOUND', `Responsibility not found: ${body.responsibilityId}`);
    if (stored.revision !== responsibilityRevision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }
    assertWritableDivision(fresh.scope, stored.divisionId);
    const targetDivisionId = body.divisionId !== undefined ? body.divisionId : stored.divisionId;
    if (body.divisionId !== undefined) {
      if (body.divisionId === null) {
        assertWritableDivision(fresh.scope, null);
      } else {
        const division = await getDivision(tx, body.divisionId);
        if (!division) throw new DomainError('VALIDATION_FAILED', 'Unknown division');
        assertDivisionAcceptsNewWork(division.status);
        assertWritableDivision(fresh.scope, division.divisionId);
      }
    }
    if (
      body.ownerMemberId !== undefined &&
      (body.ownerMemberId ?? '') !== (stored.ownerMemberId ?? '')
    ) {
      // The ADMIN-only rule is re-evaluated on the stored owner, not on the draft's view of it.
      requirePrimaryOwnerChange(fresh.identity);
    }
    const storedMembers = await activeResponsibilityMemberIds(tx, stored.responsibilityId);
    await validateResponsibilityAssignments(
      ctx,
      {
        divisionId: targetDivisionId,
        ownerMemberId: body.ownerMemberId ?? (body.divisionId !== undefined ? stored.ownerMemberId : undefined),
        previousOwnerMemberId: stored.ownerMemberId,
        additionalMemberIds:
          targetDivisionId !== stored.divisionId
            ? (body.additionalMemberIds ?? storedMembers)
            : body.additionalMemberIds,
        previousMemberIds: storedMembers,
        divisionChanged: targetDivisionId !== stored.divisionId
      },
      tx
    );
    // A partial patch: a field the manager did not address is never rewritten with a blank, a
    // default or a recomputed value. `updateResponsibility` treats a present `null` as an explicit
    // clear, so only the keys the request actually carried are passed.
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.divisionId !== undefined) patch.divisionId = body.divisionId;
    if (body.ownerMemberId !== undefined) patch.ownerMemberId = body.ownerMemberId;
    if (body.status !== undefined) patch.status = body.status;
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    if (body.colorHex !== undefined) patch.colorHex = body.colorHex;
    const next = await updateResponsibility(
      tx,
      stored.responsibilityId,
      patch,
      responsibilityRevision
    );
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    if (body.additionalMemberIds) {
      await setResponsibilityMembers(tx, stored.responsibilityId, body.additionalMemberIds, ctx.identity.email);
    }
    await audit(tx, ctx, {
      entityType: 'RESPONSIBILITIES',
      entityId: stored.responsibilityId,
      action:
        body.ownerMemberId !== undefined && (body.ownerMemberId ?? null) !== (stored.ownerMemberId ?? null)
          ? 'RESPONSIBILITY_OWNER_CHANGED'
          : 'RESPONSIBILITY_UPDATED',
      previousValue: { ownerMemberId: stored.ownerMemberId, name: stored.name, status: stored.status, divisionId: stored.divisionId },
      newValue: { ownerMemberId: next.ownerMemberId, name: next.name, status: next.status, divisionId: next.divisionId }
    });
    return next;
  });
  return { responsibility: updated, replayed: false };
}

/**
 * Reordering stays inside one division and one status group.
 *
 * The neighbours are exactly the rows a screen shows: the same division, the same status, the same
 * total order (sort order, then name, then identifier). A neighbouring record of another division
 * is never read as a neighbour and never mutated, and only the sort orders that actually change are
 * written. An unmapped area (ADMIN remediation) is ordered only among unmapped areas, so it is
 * never mixed into a mapped division's ordering.
 */
export async function moveResponsibility(
  ctx: ServiceCtx,
  responsibilityId: string,
  input: { revision: number; direction: 'UP' | 'DOWN'; expectedNeighborId: string | null }
): Promise<Responsibility> {
  requireRole(ctx.identity, 'MANAGER');
  const before = (await listResponsibilities(ctx.db)).find(
    (entry) => entry.responsibilityId === responsibilityId
  );
  if (!before) throw new DomainError('NOT_FOUND', `Responsibility not found: ${responsibilityId}`);
  assertWritableDivision(ctx.divisions, before.divisionId);
  if (before.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    if (!canManageResponsibility(fresh.identity)) {
      throw new DomainError('AUTHORIZATION_DENIED', 'Responsibility administration requires MANAGER or ADMIN');
    }
    const all = await listResponsibilities(tx);
    const current = all.find((entry) => entry.responsibilityId === responsibilityId);
    if (!current) throw new DomainError('NOT_FOUND', `Responsibility not found: ${responsibilityId}`);
    assertWritableDivision(fresh.scope, current.divisionId);
    if (current.revision !== input.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Responsibility order changed; reload and review');
    }
    const group = all.filter(
      (entry) => entry.status === current.status && (entry.divisionId ?? null) === (current.divisionId ?? null)
    );
    const index = group.findIndex((entry) => entry.responsibilityId === responsibilityId);
    const neighbor = group[index + (input.direction === 'UP' ? -1 : 1)];
    if (!neighbor) {
      throw new DomainError('VALIDATION_FAILED', 'Responsibility is already at the boundary of its division and status group');
    }
    if (neighbor.responsibilityId !== input.expectedNeighborId) {
      throw new DomainError('EDIT_CONFLICT', 'Responsibility order changed; reload and review');
    }
    const sequence = resequencedSortOrders(
      movedSequence(
        group.map((entry) => ({
          id: entry.responsibilityId,
          sortOrder: entry.sortOrder,
          revision: entry.revision
        })),
        index,
        index + (input.direction === 'UP' ? -1 : 1)
      )
    );
    const revisions = new Map(group.map((entry) => [entry.responsibilityId, entry.revision]));
    for (const write of sequence) {
      const written = await updateResponsibility(
        tx,
        write.id,
        { sortOrder: write.sortOrder },
        revisions.get(write.id) as number
      );
      if (!written) throw new DomainError('EDIT_CONFLICT', 'Responsibility order changed; reload and review');
    }
    const next = (await listResponsibilities(tx)).find((entry) => entry.responsibilityId === responsibilityId);
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'RESPONSIBILITIES',
      entityId: responsibilityId,
      action: 'RESPONSIBILITY_MOVED',
      previousValue: {
        sortOrder: before.sortOrder,
        neighborId: neighbor.responsibilityId,
        divisionId: current.divisionId
      },
      newValue: {
        sortOrder: next.sortOrder,
        neighborId: neighbor.responsibilityId,
        divisionId: next.divisionId,
        direction: input.direction,
        changedRows: sequence.map((write) => write.id)
      }
    });
    return next;
  });
}

export async function setResponsibilityStatus(
  ctx: ServiceCtx,
  responsibilityId: string,
  input: { revision: number; confirmed: true; status: 'Active' | 'Retired'; reason?: string }
): Promise<Responsibility> {
  requireRole(ctx.identity, 'MANAGER');
  if (input.confirmed !== true) {
    throw new DomainError('CONFIRMATION_REQUIRED', 'Changing a responsibility status requires confirmation');
  }
  const before = (await listResponsibilities(ctx.db)).find(
    (entry) => entry.responsibilityId === responsibilityId
  );
  if (!before) throw new DomainError('NOT_FOUND', `Responsibility not found: ${responsibilityId}`);
  assertWritableDivision(ctx.divisions, before.divisionId);
  if (before.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    // Lifecycle is a manager mutation in a division: the actor and the current record are re-read
    // before the status changes.
    await lockDivisionMutation(tx);
    const stored = (await listResponsibilities(tx)).find(
      (entry) => entry.responsibilityId === responsibilityId
    );
    if (!stored) throw new DomainError('NOT_FOUND', `Responsibility not found: ${responsibilityId}`);
    await authorizeMutation(tx, ctx, { role: 'MANAGER', divisionId: stored.divisionId });
    if (stored.revision !== input.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }
    const next = await updateResponsibility(tx, responsibilityId, { status: input.status }, input.revision);
    if (!next || next.revision === stored.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }
    await audit(tx, ctx, {
      entityType: 'RESPONSIBILITIES',
      entityId: responsibilityId,
      action: input.status === 'Retired' ? 'RESPONSIBILITY_RETIRED' : 'RESPONSIBILITY_REACTIVATED',
      previousValue: { status: stored.status },
      newValue: { status: next.status, reason: input.reason ?? '' }
    });
    return next;
  });
}

export async function createSkill(ctx: ServiceCtx, body: z.infer<typeof CreateSkillBody>) {
  requireRole(ctx.identity, 'MANAGER');
  return ctx.db.transaction(async (tx) => {
    const skill = await insertSkill(tx, {
      skillName: body.skillName,
      category: body.category,
      description: body.description,
      requiredLevel: body.requiredLevel
    });
    await audit(tx, ctx, {
      entityType: 'SKILLS',
      entityId: skill.skillId,
      action: 'SKILL_CREATED',
      newValue: skill
    });
    return skill;
  });
}

export async function assessSkill(ctx: ServiceCtx, body: z.infer<typeof AssessSkillBody>) {
  requireRole(ctx.identity, 'MANAGER');
  const member = await getMember(ctx.db, body.memberId);
  if (!member) throw new DomainError('VALIDATION_FAILED', `Unknown member: ${body.memberId}`);
  return ctx.db.transaction(async (tx) => {
    await upsertAssessment(tx, {
      memberId: body.memberId,
      skillId: body.skillId,
      currentLevel: body.currentLevel,
      assessmentDate: body.assessmentDate ?? null,
      assessedBy: ctx.identity.memberId,
      evidence: body.evidence,
      trainingAction: body.trainingAction,
      nextReviewDate: body.nextReviewDate ?? null
    });
    await audit(tx, ctx, {
      entityType: 'MEMBER_SKILLS',
      entityId: `${body.memberId}:${body.skillId}`,
      action: 'SKILL_ASSESSED',
      newValue: { memberId: body.memberId, skillId: body.skillId, currentLevel: body.currentLevel }
    });
    return { memberId: body.memberId, skillId: body.skillId, currentLevel: body.currentLevel };
  });
}
