/**
 * Division administration and the division scope of one request.
 *
 * The scope is resolved from trusted server data (the member row and the active relationships) and
 * is never accepted from the browser. A refusal is decided from that scope; a division filter a
 * client sends can only narrow it.
 */
import type { z } from 'zod';
import type { Division, DivisionGrant, DivisionReference } from '@eh/contracts';
import type { SaveDivisionBody, TransferProjectDivisionBody } from '@eh/contracts';
import {
  activeAssignmentBlockers,
  getDivision,
  getMember,
  getProject,
  getTask,
  insertDivision,
  listDivisions,
  loadDivisionAccess,
  nextDivisionSortOrder,
  setMemberDivisionGrants,
  updateDivision,
  updateProject
} from '@eh/db';
import type { Database, Queryable, Transaction } from '@eh/db';
import {
  DomainError,
  assertDivisionAcceptsNewWork,
  assertWritableDivision,
  canAdministerDivisions,
  canTransferProjectDivision,
  canWriteDivision,
  divisionScopeOf,
  movedSequence,
  requireRole,
  resequencedSortOrders,
  scopedDivisionIds,
  type DivisionScope,
  type Identity,
  type RoleName
} from '@eh/domain';
import { audit, requireConfirmation, runIdempotent, type ServiceCtx } from './common';

/**
 * One request, one lookup: the stored oversight flag plus every active relationship in a single
 * query. Nothing is cached across users, and a missing member row fails closed.
 */
export async function loadScope(db: Database, identity: Identity): Promise<DivisionScope> {
  const access = await loadDivisionAccess(db, identity.memberId);
  // Retired divisions stay in the known set: their history is readable, they simply accept no new
  // work or assignment. An active-only list would silently hide that history from oversight.
  const divisions = await listDivisions(db, { includeRetired: true });
  return divisionScopeOf(identity, access.grants, {
    allDivisionsRead: access.allDivisionsRead,
    knownDivisionIds: divisions.map((division) => division.divisionId)
  });
}

/**
 * The divisions a screen may offer, resolved in the caller's own scope.
 *
 * Three questions stay separate:
 *
 * - `readable` is the history scope. A retired division the caller may already read stays listed,
 *   so its projects, tasks and reports remain reachable and a filtered view can name it.
 * - `writable` is the *new work* scope. A retired division is never offered, because it accepts no
 *   new project, subproject, task or assignment.
 * - an unmapped record belongs to no division, so it is not offered here at all; only ADMIN
 *   remediation reaches it.
 */
export function divisionReferences(
  scope: DivisionScope,
  divisions: readonly Division[]
): { readable: DivisionReference[]; writable: DivisionReference[] } {
  const reference = (division: Division): DivisionReference => ({
    divisionId: division.divisionId,
    name: division.name,
    status: division.status,
    sortOrder: division.sortOrder
  });
  const readable = divisions
    .filter((division) => scope.manageAll || scope.overseeAll || scope.read.has(division.divisionId))
    .map(reference);
  const writable = divisions
    .filter((division) => division.status === 'Active')
    .filter((division) => canWriteDivision(scope, division.divisionId))
    .map(reference);
  return { readable, writable };
}

/**
 * A requested division filter may narrow the authorized scope; it can never widen it.
 *
 * This is the single narrowing mechanism for every manager read and write. A list, a total, a
 * tree, a search suggestion or a report resolves its filter here before it pages or aggregates.
 */
export function requestedDivision(
  ctx: { divisions: DivisionScope },
  divisionId: string | undefined
): string[] | undefined {
  return scopedDivisionIds(ctx.divisions, divisionId);
}

/**
 * The single advisory lock of the division boundary.
 *
 * Every division-scoped write takes this lock first - assignment commands, membership changes,
 * retirements and transfers - so a check made before the transaction cannot outlive a conflicting
 * change. No other division lock exists, so the protocol has no lock-order cycle.
 */
export const DIVISION_MEMBERSHIP_LOCK = 'member-divisions';

/**
 * The role and activation lock, which serializes the whole administrator set and every role or
 * activation change. It is always acquired **after** `DIVISION_MEMBERSHIP_LOCK`; no path in this
 * application acquires the two in the other order, so the protocol cannot deadlock.
 */
export const ROLE_ACTIVATION_LOCK = 'members:role-and-activation';

/**
 * The one lock order of a division-scoped write.
 *
 * 1. `member-divisions` (division membership, assignment and lifecycle changes).
 * 2. `members:role-and-activation` (role and activation changes).
 *
 * Both are transaction-scoped, so they are released by commit or rollback and a nested call in the
 * same transaction simply re-acquires them.
 */
export async function lockDivisionMutation(tx: Transaction): Promise<void> {
  await tx.advisoryLock(DIVISION_MEMBERSHIP_LOCK);
  await tx.advisoryLock(ROLE_ACTIVATION_LOCK);
}

/**
 * Re-resolves the acting account's authority inside a write transaction.
 *
 * Every command that changes a division-scoped record re-reads the stored role, activation flag
 * and division relationships through the transaction handle, so an access change committed after
 * the request started is honoured before the mutation. The outer request scope is only a quick
 * pre-check, never the authorization for the write.
 */
export async function reauthorizeInTransaction(
  tx: Transaction,
  ctx: { identity: Identity }
): Promise<{ identity: Identity; scope: DivisionScope }> {
  const actor = await tx.one<{ role: string | null; active: boolean }>(
    'SELECT role, active FROM members WHERE member_id = $1',
    [ctx.identity.memberId]
  );
  if (!actor || !actor.active) {
    throw new DomainError('AUTHORIZATION_DENIED', 'The acting account is no longer active');
  }
  const access = await loadDivisionAccess(tx, ctx.identity.memberId);
  const divisions = await listDivisions(tx, { includeRetired: true });
  const identity: Identity = {
    ...ctx.identity,
    role: actor.role as Identity['role'],
    active: actor.active
  };
  return {
    identity,
    scope: divisionScopeOf(identity, access.grants, {
      allDivisionsRead: access.allDivisionsRead,
      knownDivisionIds: divisions.map((row) => row.divisionId)
    })
  };
}

/**
 * The authoritative authorization of one mutation, evaluated through the transaction handle.
 *
 * Three independent questions are asked, in this order:
 *
 * 1. the *role* capability (re-read from the stored row), so a MEMBER or VIEWER that still holds a
 *    `WORK` membership never passes a manager mutation after a downgrade;
 * 2. the *where* question (`DivisionScope`) for the record's current division;
 * 3. optionally, whether that division still accepts new work.
 *
 * A division membership is never an action capability on its own.
 */
export async function authorizeMutation(
  tx: Transaction,
  ctx: ServiceCtx,
  input: { role: RoleName; divisionId: string | null | undefined; acceptsNewWork?: boolean }
): Promise<{ identity: Identity; scope: DivisionScope }> {
  const fresh = await reauthorizeInTransaction(tx, ctx);
  requireRole(fresh.identity, input.role);
  assertWritableDivision(fresh.scope, input.divisionId);
  if (input.acceptsNewWork && input.divisionId) {
    const division = await getDivision(tx, input.divisionId);
    if (!division) throw new DomainError('VALIDATION_FAILED', 'Unknown division');
    assertDivisionAcceptsNewWork(division.status);
  }
  return fresh;
}

/**
 * The canonical division of a project, read through the caller's transaction handle.
 *
 * Inside a write transaction a project can be re-scoped by an ADMIN transfer, so the division and
 * its status are re-read - never reused from an earlier request-level read.
 */
export async function divisionForWriteOfProject(
  db: Queryable,
  projectId: string
): Promise<{ divisionId: string | null; status: string | null }> {
  const row = await db.one<{ division_id: string | null; status: string | null }>(
    `SELECT p.division_id, d.status FROM projects p
       LEFT JOIN divisions d ON d.division_id = p.division_id
      WHERE p.project_id = $1 AND p.deleted_at IS NULL`,
    [projectId]
  );
  if (!row) throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  return { divisionId: row.division_id, status: row.status };
}

/**
 * Creates one division. The position is allocated inside the same transaction as the insert, so
 * two creates cannot both claim the same initial order, and a retried idempotency key returns the
 * division it already created instead of a second row.
 */
export async function createDivision(
  ctx: ServiceCtx,
  body: z.infer<typeof SaveDivisionBody>
): Promise<{ division: Division }> {
  requireRole(ctx.identity, 'ADMIN');
  if (!canAdministerDivisions(ctx.identity)) throw new DomainError('AUTHORIZATION_DENIED', 'ADMIN required');
  if (!body.name) throw new DomainError('VALIDATION_FAILED', 'A division needs a name');
  const name = body.name;
  // The access check a replayed create must still pass.
  const authorizeDivisionWrite = async (tx: Transaction): Promise<void> => {
    const fresh = await reauthorizeInTransaction(tx, ctx);
    if (!canAdministerDivisions(fresh.identity)) throw new DomainError('AUTHORIZATION_DENIED', 'ADMIN required');
  };
  const result = await runIdempotent(
    ctx,
    { scope: 'division.create', key: body.idempotencyKey ?? `division:${name}`, request: body },
    async (tx) => {
      await lockDivisionMutation(tx);
      await authorizeDivisionWrite(tx);
      const sortOrder = body.sortOrder ?? (await nextDivisionSortOrder(tx, 'Active'));
      const created = await insertDivision(tx, { name, sortOrder });
      await audit(tx, ctx, {
        entityType: 'DIVISIONS',
        entityId: created.divisionId,
        action: 'DIVISION_CREATED',
        newValue: created
      });
      return created;
    },
    { authorize: authorizeDivisionWrite }
  );
  return { division: result.data };
}

export async function saveDivision(
  ctx: ServiceCtx,
  divisionId: string,
  body: z.infer<typeof SaveDivisionBody>
): Promise<{ division: Division }> {
  requireRole(ctx.identity, 'ADMIN');
  const current = await getDivision(ctx.db, divisionId);
  if (!current) throw new DomainError('NOT_FOUND', `Division not found: ${divisionId}`);
  if (body.revision === undefined) {
    throw new DomainError('VALIDATION_FAILED', 'A revision is required for this edit');
  }
  if (body.revision !== current.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  const changes: Record<string, unknown> = {};
  if (body.name !== undefined) changes.name = body.name;
  if (body.sortOrder !== undefined) changes.sortOrder = body.sortOrder;
  if (!Object.keys(changes).length) return { division: current };
  const next = await ctx.db.transaction(async (tx) => {
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    if (!canAdministerDivisions(fresh.identity)) throw new DomainError('AUTHORIZATION_DENIED', 'ADMIN required');
    // The revision and the record are re-read through the transaction handle: a rename committed
    // after the request started is a conflict, never an overwrite.
    const stored = await getDivision(tx, divisionId);
    if (!stored) throw new DomainError('NOT_FOUND', `Division not found: ${divisionId}`);
    const updated = await updateDivision(tx, divisionId, changes, body.revision as number);
    if (!updated) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'DIVISIONS',
      entityId: divisionId,
      action: 'DIVISION_UPDATED',
      previousValue: stored,
      newValue: updated
    });
    return updated;
  });
  return { division: next };
}

/** Retirement is 廃止 and reactivation 再有効化; the record is never deleted. */
export async function setDivisionStatus(
  ctx: ServiceCtx,
  divisionId: string,
  input: { revision: number; confirmed: true; status: 'Active' | 'Retired'; reason?: string }
): Promise<Division> {
  requireRole(ctx.identity, 'ADMIN');
  requireConfirmation(input.confirmed, 'Changing a division lifecycle requires explicit confirmation');
  const current = await getDivision(ctx.db, divisionId);
  if (!current) throw new DomainError('NOT_FOUND', `Division not found: ${divisionId}`);
  if (current.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  if (current.status === input.status) return current;
  return ctx.db.transaction(async (tx) => {
    // Retirement serializes against every assignment writer: a new assignment either commits
    // before the status change (and is then an existing relationship) or is refused by it.
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    if (!fresh.scope.manageAll) throw new DomainError('AUTHORIZATION_DENIED', 'ADMIN required');
    const next = await updateDivision(
      tx,
      divisionId,
      {
        status: input.status,
        retiredAt: input.status === 'Retired' ? new Date().toISOString() : null
      },
      input.revision
    );
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'DIVISIONS',
      entityId: divisionId,
      action: input.status === 'Retired' ? 'DIVISION_RETIRED' : 'DIVISION_REACTIVATED',
      previousValue: current,
      newValue: { ...next, reason: input.reason ?? '' }
    });
    return next;
  });
}

/**
 * Reorder: only the two `Sort_Order` values that change are written, identity stays untouched.
 *
 * The neighbours are the ones the screen renders - the same total order, the same status group -
 * and both affected rows carry their revision into the update, so a concurrent reorder is
 * `EDIT_CONFLICT` instead of an interleaved half-swap.
 */
export async function moveDivision(
  ctx: ServiceCtx,
  divisionId: string,
  input: { revision: number; direction: 'UP' | 'DOWN'; expectedNeighborId: string | null }
): Promise<Division> {
  requireRole(ctx.identity, 'ADMIN');
  const current = await getDivision(ctx.db, divisionId);
  if (!current) throw new DomainError('NOT_FOUND', `Division not found: ${divisionId}`);
  if (current.revision !== input.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  return ctx.db.transaction(async (tx) => {
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    if (!canAdministerDivisions(fresh.identity)) throw new DomainError('AUTHORIZATION_DENIED', 'ADMIN required');
    // The list is already in the one canonical order (the `ORDER BY` of `listDivisions`), which is
    // the order the screen renders; no second sort is computed here.
    const ordered = await listDivisions(tx, { includeRetired: true });
    const moving = ordered.find((entry) => entry.divisionId === divisionId);
    if (!moving) throw new DomainError('NOT_FOUND', `Division not found: ${divisionId}`);
    if (moving.revision !== input.revision) {
      throw new DomainError('EDIT_CONFLICT', 'The order changed; reload and review');
    }
    // The neighbours are the ones the screen renders: the same group (active or retired) in the
    // one canonical order (`listDivisions`), so equal sort orders are still deterministic.
    const group = ordered.filter((entry) => entry.status === moving.status);
    const index = group.findIndex((entry) => entry.divisionId === divisionId);
    const neighbor = group[index + (input.direction === 'UP' ? -1 : 1)];
    if (!neighbor) {
      throw new DomainError('INVALID_TRANSITION', 'This division is already at the edge of its status group');
    }
    if (input.expectedNeighborId !== null && input.expectedNeighborId !== neighbor.divisionId) {
      throw new DomainError('EDIT_CONFLICT', 'The order changed; reload and review');
    }
    const sequence = movedSequence(
      group.map((entry) => ({ id: entry.divisionId, sortOrder: entry.sortOrder, revision: entry.revision })),
      index,
      index + (input.direction === 'UP' ? -1 : 1)
    );
    const writes = resequencedSortOrders(sequence);
    const revisions = new Map(sequence.map((entry) => [entry.id, entry.revision]));
    for (const write of writes) {
      const written = await updateDivision(tx, write.id, { sortOrder: write.sortOrder }, revisions.get(write.id) as number);
      if (!written) throw new DomainError('EDIT_CONFLICT', 'The order changed; reload and review');
    }
    const moved = await getDivision(tx, divisionId);
    if (!moved) throw new DomainError('EDIT_CONFLICT', 'The order changed; reload and review');
    await audit(tx, ctx, {
      entityType: 'DIVISIONS',
      entityId: divisionId,
      action: 'DIVISION_REORDERED',
      previousValue: { sortOrder: current.sortOrder, neighborId: neighbor.divisionId },
      newValue: {
        sortOrder: moved.sortOrder,
        neighborId: neighbor.divisionId,
        direction: input.direction,
        changedRows: writes.map((write) => write.id)
      }
    });
    return moved;
  });
}

/**
 * Resolves and validates the complete membership set of one member.
 *
 * Removal of a membership that still carries active owned or assigned work in that division is
 * refused with a summary, so a manager can resolve it deliberately. Nothing is silently unassigned.
 */
export async function applyMemberDivisionGrants(
  ctx: ServiceCtx,
  memberId: string,
  grants: readonly DivisionGrant[] | undefined,
  allDivisionsRead: boolean | undefined,
  existingTransaction?: Transaction
): Promise<void> {
  if (grants === undefined && allDivisionsRead === undefined) return;
  if (!canAdministerDivisions(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Only an ADMIN may change division access');
  }
  // Retired divisions are included so a retained grant is not refused as "unknown" merely because
  // an active-only picker omitted it. A *new* grant is validated against the lifecycle separately.
  const known = await listDivisions(ctx.db, { includeRetired: true });
  const knownIds = new Set(known.map((division) => division.divisionId));
  for (const grant of grants ?? []) {
    if (!knownIds.has(grant.divisionId)) {
      throw new DomainError('VALIDATION_FAILED', `Unknown division: ${grant.divisionId}`);
    }
  }
  const apply = async (tx: Transaction): Promise<void> => {
    await lockDivisionMutation(tx);
    // The membership change is authorized by the stored role inside the transaction, so a role
    // revocation committed after the request started is honoured.
    const fresh = await reauthorizeInTransaction(tx, ctx);
    requireRole(fresh.identity, 'ADMIN');
    if (!canAdministerDivisions(fresh.identity)) {
      throw new DomainError('AUTHORIZATION_DENIED', 'Only an ADMIN may change division access');
    }
    if (grants !== undefined) {
      const current = await tx.many<{ division_id: string; access_kind: 'WORK' | 'READ' }>(
        `SELECT division_id, access_kind FROM member_divisions
          WHERE member_id = $1 AND removed_at IS NULL`,
        [memberId]
      );
      // A retained relationship is preserved even when its division is retired; only a grant the
      // member does not hold yet needs an active division.
      const heldIds = new Set(current.map((row) => row.division_id));
      const statuses = new Map(
        (await listDivisions(tx, { includeRetired: true })).map((division) => [
          division.divisionId,
          division.status
        ])
      );
      for (const grant of grants) {
        const status = statuses.get(grant.divisionId);
        if (status === undefined) {
          throw new DomainError('VALIDATION_FAILED', `Unknown division: ${grant.divisionId}`);
        }
        if (!heldIds.has(grant.divisionId) && status !== 'Active') {
          throw new DomainError(
            'INVALID_TRANSITION',
            'A retired division cannot receive a new access grant',
            { divisionId: grant.divisionId }
          );
        }
      }
      // Compare the access kind, not only the division: `WORK -> READ` removes a membership just
      // as `WORK -> absent` does, while `READ -> WORK` adds one and `READ -> absent` only revokes
      // read access (which never needs a work blocker).
      const desired = new Map<string, 'WORK' | 'READ'>();
      for (const grant of grants) desired.set(grant.divisionId, grant.accessKind);
      const blocked: { divisionId: string; reason: string; tasks: number; projects: number; subprojects: number; responsibilities: number }[] = [];
      for (const row of current) {
        const losesWorkMembership = row.access_kind === 'WORK' && desired.get(row.division_id) !== 'WORK';
        if (!losesWorkMembership) continue;
        const blockers = await activeAssignmentBlockers(tx, memberId, row.division_id);
        const total =
          blockers.taskIds.length +
          blockers.projectIds.length +
          blockers.subprojectIds.length +
          blockers.responsibilityIds.length;
        if (total > 0) {
          blocked.push({
            divisionId: row.division_id,
            reason: desired.has(row.division_id) ? 'DOWNGRADE' : 'REMOVAL',
            tasks: blockers.taskIds.length,
            projects: blockers.projectIds.length,
            subprojects: blockers.subprojectIds.length,
            responsibilities: blockers.responsibilityIds.length
          });
        }
      }
      if (blocked.length) {
        throw new DomainError(
          'DIVISION_MEMBERSHIP_BLOCKED',
          'Reassign or complete this work before removing the membership',
          { blocked }
        );
      }
      await setMemberDivisionGrants(tx, memberId, {
        grants,
        // A member created without an e-mail address still needs an attributable actor value.
        actor: ctx.identity.email || ctx.identity.memberId
      });
      await audit(tx, ctx, {
        entityType: 'MEMBERS',
        entityId: memberId,
        action: 'DIVISION_MEMBERSHIP_CHANGED',
        previousValue: current,
        newValue: grants
      });
    }
    if (allDivisionsRead !== undefined) {
      await tx.query('UPDATE members SET all_divisions_read = $2, updated_at = now() WHERE member_id = $1', [
        memberId,
        allDivisionsRead
      ]);
      await audit(tx, ctx, {
        entityType: 'MEMBERS',
        entityId: memberId,
        action: 'DIVISION_OVERSIGHT_CHANGED',
        newValue: { allDivisionsRead }
      });
    }
  };
  if (existingTransaction) {
    await apply(existingTransaction);
    return;
  }
  await ctx.db.transaction(apply);
}

/**
 * A new or changed assignment must name an active member who holds WORK membership in the work's
 * division. ADMIN status, general-manager oversight and additional read access never qualify.
 *
 * Pass the transaction handle when the check has to be authoritative inside a write: the outer
 * connection only gives a fast pre-check, because a membership can change between the two.
 */
export async function assertAssignmentEligibility(
  ctx: ServiceCtx,
  divisionId: string | null | undefined,
  memberIds: readonly string[],
  alreadyAssigned: ReadonlySet<string> = new Set(),
  db: Queryable = ctx.db
): Promise<void> {
  const candidates = [...new Set(memberIds.filter((id): id is string => !!id && !alreadyAssigned.has(id)))];
  if (!candidates.length) return;
  if (!divisionId) {
    throw new DomainError('DIVISION_REQUIRED', 'Work without a division cannot receive a new assignment');
  }
  const division = await getDivision(db, divisionId);
  if (!division) throw new DomainError('VALIDATION_FAILED', 'Unknown division');
  assertDivisionAcceptsNewWork(division.status);
  const rows = await db.many<{ member_id: string; active: boolean; access_kind: string | null }>(
    `SELECT m.member_id, m.active,
            (SELECT md.access_kind FROM member_divisions md
              WHERE md.member_id = m.member_id AND md.division_id = $2 AND md.removed_at IS NULL
              LIMIT 1) AS access_kind
       FROM members m WHERE m.member_id = ANY($1::text[])`,
    [candidates, divisionId]
  );
  const byId = new Map(rows.map((row) => [row.member_id, row]));
  const ineligible: string[] = [];
  for (const memberId of candidates) {
    const row = byId.get(memberId);
    if (!row) throw new DomainError('VALIDATION_FAILED', `Unknown member: ${memberId}`);
    if (!row.active) throw new DomainError('VALIDATION_FAILED', 'A new assignment must name an active member');
    if (row.access_kind !== 'WORK') ineligible.push(memberId);
  }
  // A mixed selection is one failed operation: nothing is partially saved.
  if (ineligible.length) {
    throw new DomainError(
      'DIVISION_MEMBERSHIP_REQUIRED',
      'Every selected person must belong to the division of the work',
      { members: ineligible, divisionId }
    );
  }
}

/**
 * ADMIN-only transfer of a project between divisions.
 *
 * The whole move is refused when any owner or assignee would become ineligible; nothing is
 * silently cleared and the previous division stays in the audit history.
 *
 * The request-level read is only a pre-check for a fast refusal. The authoritative work happens
 * inside one transaction: the shared division lock is taken first, the actor is re-authorized, the
 * project's revision and division are re-read, and the **complete** assignment set is queried again
 * through the transaction handle. An assignment created while the transfer was waiting for the lock
 * is therefore part of the set that is validated, never an array loaded before it.
 */
export async function transferProjectDivision(
  ctx: ServiceCtx,
  projectId: string,
  body: z.infer<typeof TransferProjectDivisionBody>
): Promise<{ project: { projectId: string; divisionId: string | null } }> {
  requireRole(ctx.identity, 'ADMIN');
  if (!canTransferProjectDivision(ctx.identity)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Only an ADMIN may transfer work between divisions');
  }
  requireConfirmation(body.confirmed, 'Transferring a project requires explicit confirmation');
  const project = await getProject(ctx.db, projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  if (project.revision !== body.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }

  return ctx.db.transaction(async (tx) => {
    // The move shares the membership lock, so a concurrent assignment or membership change is
    // serialized with it and the whole set is re-validated against the current rows.
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    requireRole(fresh.identity, 'ADMIN');
    if (!canTransferProjectDivision(fresh.identity)) {
      throw new DomainError('AUTHORIZATION_DENIED', 'Only an ADMIN may transfer work between divisions');
    }
    const current = await divisionForWriteOfProject(tx, projectId);
    if (current.divisionId !== project.divisionId) {
      throw new DomainError('EDIT_CONFLICT', 'The project division changed; reload and review');
    }
    const stored = await getProject(tx, projectId);
    if (!stored) throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
    if (stored.revision !== body.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }
    const targetNow = await getDivision(tx, body.divisionId);
    if (!targetNow) throw new DomainError('VALIDATION_FAILED', 'Unknown division');
    assertDivisionAcceptsNewWork(targetNow.status);
    if (stored.responsibilityId) {
      const responsibility = await tx.one<{ division_id: string | null }>(
        'SELECT division_id FROM responsibilities WHERE responsibility_id = $1',
        [stored.responsibilityId]
      );
      if (responsibility?.division_id && responsibility.division_id !== body.divisionId) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'The project responsibility belongs to another division',
          { responsibilityDivisionId: responsibility.division_id }
        );
      }
    }
    // Every relationship the transfer policy covers, read again inside the transaction.
    const members = await currentAssignmentSet(tx, projectId);
    await assertAssignmentEligibility(ctx, body.divisionId, members, new Set(), tx);
    const updated = await updateProject(tx, projectId, { divisionId: body.divisionId }, body.revision);
    if (!updated) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'PROJECTS',
      entityId: projectId,
      action: 'PROJECT_DIVISION_TRANSFERRED',
      previousValue: { divisionId: project.divisionId },
      newValue: { divisionId: body.divisionId, reason: body.reason ?? '', validatedMembers: members.length }
    });
    return { project: { projectId: updated.projectId, divisionId: updated.divisionId } };
  });
}

/**
 * Every active assignment of one project, in one read.
 *
 * The project owner, each task's primary owner, every retained additional task assignee and every
 * subproject owner are the set a division transfer must validate. Responsibility owners and members
 * are assigned to the *area*, and the area's division agreement is validated separately, so they
 * are deliberately not part of this project assignment set.
 *
 * The read must go through the caller's transaction handle when it decides an authorization.
 */
export async function currentAssignmentSet(db: Queryable, projectId: string): Promise<string[]> {
  const rows = await db.many<{ member_id: string }>(
    `SELECT owner_member_id AS member_id FROM tasks
       WHERE project_id = $1 AND owner_member_id IS NOT NULL AND deleted_at IS NULL
     UNION SELECT a.member_id FROM task_assignees a JOIN tasks t ON t.task_id = a.task_id
            WHERE t.project_id = $1 AND a.removed_at IS NULL AND t.deleted_at IS NULL
     UNION SELECT project_owner_id FROM projects
            WHERE project_id = $1 AND project_owner_id IS NOT NULL AND deleted_at IS NULL
     UNION SELECT s.owner_id FROM subprojects s
            WHERE s.project_id = $1 AND s.owner_id IS NOT NULL AND s.deleted_at IS NULL`,
    [projectId]
  );
  return rows.map((row) => row.member_id);
}

/**
 * Loads a division that must accept new work and must be writable for this caller.
 *
 * The one gate for "may this request create or re-scope work here?".
 */
export async function getDivisionForWrite(ctx: ServiceCtx, divisionId: string) {
  const division = await getDivision(ctx.db, divisionId);
  if (!division) throw new DomainError('VALIDATION_FAILED', 'Unknown division');
  assertDivisionAcceptsNewWork(division.status);
  assertWritableDivision(ctx.divisions, division.divisionId);
  return division;
}

/** Whether a member holds WORK membership in a division (assignment eligibility, nothing more). */
export async function memberCanWorkInDivision(
  ctx: ServiceCtx,
  memberId: string,
  divisionId: string | null | undefined
): Promise<boolean> {
  if (!divisionId) return false;
  const row = await ctx.db.one<{ kind: string | null }>(
    `SELECT access_kind AS kind FROM member_divisions
      WHERE member_id = $1 AND division_id = $2 AND removed_at IS NULL AND access_kind = 'WORK'
      LIMIT 1`,
    [memberId, divisionId]
  );
  return row?.kind === 'WORK';
}

/**
 * Loads a project and refuses it unless the caller's role may write in its division.
 *
 * One helper for every work command, so a new endpoint cannot forget the division check.
 */
export async function writableProject(ctx: ServiceCtx, projectId: string) {
  const project = await getProject(ctx.db, projectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${projectId}`);
  assertWritableDivision(ctx.divisions, project.divisionId);
  return project;
}

/**
 * A project that may receive *new* work: writable for this caller and in an active division.
 *
 * Creation paths must call this even when no assignee is selected, because assignment validation
 * alone would let an empty assignee list slip into a retired division.
 */
export async function creatableProject(ctx: ServiceCtx, projectId: string) {
  const project = await writableProject(ctx, projectId);
  if (project.divisionId) {
    const division = await getDivision(ctx.db, project.divisionId);
    if (!division) throw new DomainError('VALIDATION_FAILED', 'Unknown division');
    assertDivisionAcceptsNewWork(division.status);
  }
  return project;
}

/** The same check for any record that belongs to a project (task, subproject, issue). */
export async function writableProjectOf(ctx: ServiceCtx, projectId: string) {
  return writableProject(ctx, projectId);
}

/** The canonical division of a task is its project's division; a child never stores one. */
export async function divisionOfTask(
  ctx: ServiceCtx,
  taskId: string
): Promise<string | null> {
  const row = await ctx.db.one<{ division_id: string | null }>(
    `SELECT p.division_id FROM tasks t JOIN projects p ON p.project_id = t.project_id
      WHERE t.task_id = $1 AND t.deleted_at IS NULL`,
    [taskId]
  );
  return row?.division_id ?? null;
}

/** Loads a task and its project, refusing the write unless the division is writable. */
export async function writableTask(ctx: ServiceCtx, taskId: string) {
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  const project = await writableProject(ctx, task.projectId);
  return { task, project };
}

/** The member editor reads the stored grants; this is the one projection that may show them. */
export async function memberGrantsForEditor(memberId: string, db: Database) {
  const [member, grants] = await Promise.all([getMember(db, memberId), loadDivisionAccess(db, memberId)]);
  return { member, grants };
}
