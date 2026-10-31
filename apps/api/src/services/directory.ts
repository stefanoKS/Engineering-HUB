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
import {
  DomainError,
  assertRoleChangeAllowed,
  canManageResponsibility,
  requirePrimaryOwnerChange,
  requireRole
} from '@eh/domain';
import { audit, runIdempotent, type ServiceCtx } from './common';

async function activeMember(ctx: ServiceCtx, memberId: string | null | undefined): Promise<void> {
  if (!memberId) return;
  const member = await getMember(ctx.db, memberId);
  if (!member) throw new DomainError('VALIDATION_FAILED', `Unknown member: ${memberId}`);
  if (!member.active) throw new DomainError('VALIDATION_FAILED', 'A new relationship must name an active member');
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
    const result = await runIdempotent(
      ctx,
      { scope: 'member.create', key: body.idempotencyKey ?? `member:${body.email}`, request: body },
      async (tx) => {
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
        return member;
      }
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
    if (body.ownerMemberId && ctx.identity.role !== 'ADMIN' && body.ownerMemberId !== ctx.identity.memberId) {
      requirePrimaryOwnerChange(ctx.identity);
    }
    const result = await runIdempotent(
      ctx,
      { scope: 'responsibility.create', key: body.idempotencyKey ?? `responsibility:${body.name}`, request: body },
      async (tx) => {
        const created = await insertResponsibility(tx, {
          name: body.name as string,
          description: body.description,
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
      }
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

  const updated = await ctx.db.transaction(async (tx) => {
    const next = await updateResponsibility(
      tx,
      before.responsibilityId,
      {
        name: body.name,
        description: body.description,
        ownerMemberId: body.ownerMemberId,
        status: body.status,
        sortOrder: body.sortOrder,
        colorHex: body.colorHex
      },
      responsibilityRevision
    );
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    if (body.additionalMemberIds) {
      await setResponsibilityMembers(tx, before.responsibilityId, body.additionalMemberIds, ctx.identity.email);
    }
    await audit(tx, ctx, {
      entityType: 'RESPONSIBILITIES',
      entityId: before.responsibilityId,
      action:
        body.ownerMemberId !== undefined && body.ownerMemberId !== before.ownerMemberId
          ? 'RESPONSIBILITY_OWNER_CHANGED'
          : 'RESPONSIBILITY_UPDATED',
      previousValue: { ownerMemberId: before.ownerMemberId, name: before.name, status: before.status },
      newValue: { ownerMemberId: next.ownerMemberId, name: next.name, status: next.status }
    });
    return next;
  });
  return { responsibility: updated, replayed: false };
}

export async function moveResponsibility(
  ctx: ServiceCtx,
  responsibilityId: string,
  input: { revision: number; sortOrder: number }
): Promise<Responsibility> {
  requireRole(ctx.identity, 'MANAGER');
  const before = (await listResponsibilities(ctx.db)).find(
    (entry) => entry.responsibilityId === responsibilityId
  );
  if (!before) throw new DomainError('NOT_FOUND', `Responsibility not found: ${responsibilityId}`);
  if (before.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    const next = await updateResponsibility(tx, responsibilityId, { sortOrder: input.sortOrder }, input.revision);
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'RESPONSIBILITIES',
      entityId: responsibilityId,
      action: 'RESPONSIBILITY_MOVED',
      previousValue: { sortOrder: before.sortOrder },
      newValue: { sortOrder: next.sortOrder }
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
  if (before.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    const next = await updateResponsibility(tx, responsibilityId, { status: input.status }, input.revision);
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'RESPONSIBILITIES',
      entityId: responsibilityId,
      action: input.status === 'Retired' ? 'RESPONSIBILITY_RETIRED' : 'RESPONSIBILITY_REACTIVATED',
      previousValue: { status: before.status },
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
