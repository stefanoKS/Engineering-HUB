/**
 * Division authorization policy (課).
 *
 * Three concepts stay separate, and every rule below keeps them separate:
 *
 * - ROLE says *what* an account may do (see `roles.ts`).
 * - Division MEMBERSHIP (`WORK`) says *where* the role may create, manage, approve and be
 *   assigned. Membership implies read access.
 * - ADDITIONAL READ ACCESS (`READ`) says where the account may only observe. It never grants an
 *   assignment, a creation, an edit or an approval.
 *
 * A scope is resolved from trusted server data for one request. An empty authorized set is never
 * global access: an account with no grant reads nothing except the documented ADMIN remediation
 * view. Unmapped work (a project whose division is blank) is visible to ADMIN only, so it can be
 * mapped deliberately instead of guessed.
 */
import { DomainError } from './errors';
import { isAdmin, isGeneralManager, type Identity } from './roles';

export type DivisionAccessKind = 'WORK' | 'READ';

export type MemberDivisionGrant = {
  divisionId: string;
  accessKind: DivisionAccessKind;
};

export type DivisionScope = {
  /** ADMIN may manage every division, including one created later. Never an assignment right. */
  manageAll: boolean;
  /** GENERAL_MANAGER with the all-division oversight setting. Includes future divisions. */
  overseeAll: boolean;
  /** Divisions where this account's role may write. Empty for read-only oversight. */
  work: ReadonlySet<string>;
  /** Divisions this account may read (membership plus additional read access). */
  read: ReadonlySet<string>;
};

export const EMPTY_DIVISION_SCOPE: DivisionScope = {
  manageAll: false,
  overseeAll: false,
  work: new Set<string>(),
  read: new Set<string>()
};

/**
 * Resolves the scope for one verified identity.
 *
 * `allDivisionsRead` is the stored GENERAL_MANAGER oversight setting; it is ignored for every
 * other role, so a stale flag can never widen a member's access.
 */
export function divisionScopeOf(
  identity: Identity | null,
  grants: readonly MemberDivisionGrant[],
  options: { allDivisionsRead?: boolean; knownDivisionIds?: readonly string[] } = {}
): DivisionScope {
  if (!identity || !identity.verified || !identity.active) return EMPTY_DIVISION_SCOPE;
  const known = options.knownDivisionIds ?? [];
  if (isAdmin(identity)) {
    // ADMIN reads and manages every division, including unmapped legacy work, so remediation is
    // possible. Eligibility to be *assigned* is a membership question and is not answered here.
    return {
      manageAll: true,
      overseeAll: false,
      work: new Set<string>(known),
      read: new Set<string>(known)
    };
  }
  if (isGeneralManager(identity)) {
    const overseeAll = options.allDivisionsRead === true;
    const read = new Set<string>(grants.map((grant) => grant.divisionId));
    if (overseeAll) for (const divisionId of known) read.add(divisionId);
    return { manageAll: false, overseeAll, work: new Set<string>(), read };
  }
  const work = new Set(grants.filter((grant) => grant.accessKind === 'WORK').map((grant) => grant.divisionId));
  const read = new Set(grants.map((grant) => grant.divisionId));
  return { manageAll: false, overseeAll: false, work, read };
}

/**
 * The SQL filter: `undefined` means unrestricted (ADMIN), `[]` means nothing is readable.
 *
 * Only `ADMIN` is unrestricted, because only `ADMIN` may read unmapped work. A GENERAL_MANAGER
 * with all-division oversight reads the divisions that exist - including one created later, since
 * the scope was resolved from the stored list - but never a project whose division is blank.
 */
export function readableDivisionIds(scope: DivisionScope): string[] | undefined {
  if (scope.manageAll) return undefined;
  return [...scope.read].sort();
}

/**
 * Narrows the resolved scope by a requested division.
 *
 * One rule for every list, total, aggregate and tree: a client-supplied identifier can only
 * narrow what the server already authorized, an unauthorized identifier is refused like an
 * unknown one, and an empty authorization matches nothing.
 */
export function scopedDivisionIds(
  scope: DivisionScope,
  requestedDivisionId?: string | null
): string[] | undefined {
  const authorized = readableDivisionIds(scope);
  if (!requestedDivisionId) return authorized;
  if (authorized === undefined) return [requestedDivisionId];
  if (!authorized.includes(requestedDivisionId)) {
    throw new DomainError('NOT_FOUND', 'The requested division is not available');
  }
  return [requestedDivisionId];
}

export function writableDivisionIds(scope: DivisionScope): string[] | undefined {
  if (scope.manageAll) return undefined;
  return [...scope.work].sort();
}

/**
 * Unmapped work (a blank division) is not assigned to anybody's authority explicitly, so only the
 * administrative remediation view may read it.
 */
export function canReadDivision(scope: DivisionScope, divisionId: string | null | undefined): boolean {
  if (!divisionId) return scope.manageAll;
  if (scope.manageAll || scope.overseeAll) return true;
  return scope.read.has(divisionId);
}

/** Read-only oversight and additional read access never authorize a write. */
export function canWriteDivision(scope: DivisionScope, divisionId: string | null | undefined): boolean {
  // Unmapped work has no division to be a member of; only the administrative remediation view may
  // change it, so it can be mapped deliberately.
  if (!divisionId) return scope.manageAll;
  if (scope.manageAll) return true;
  return scope.work.has(divisionId);
}

/**
 * A refused read is `NOT_FOUND`, so a guessed identifier cannot confirm that work exists in a
 * division the caller may not see.
 */
export function assertReadableDivision(scope: DivisionScope, divisionId: string | null | undefined): void {
  if (!canReadDivision(scope, divisionId)) {
    throw new DomainError('NOT_FOUND', 'The requested record is not available');
  }
}

export function assertWritableDivision(scope: DivisionScope, divisionId: string | null | undefined): void {
  if (!divisionId) {
    if (scope.manageAll) return;
    throw new DomainError(
      'DIVISION_REQUIRED',
      'This work has no division; an administrator must map it before it can be changed'
    );
  }
  if (!canWriteDivision(scope, divisionId)) {
    throw new DomainError('AUTHORIZATION_DENIED', 'Your role has no management access to this division');
  }
}

/**
 * Assignment eligibility. A person may be newly assigned only where they hold a `WORK` membership.
 *
 * ADMIN status, general-manager oversight and additional read access are deliberately irrelevant
 * here: only membership answers "may this person be given this work?".
 */
export function canBeAssignedInDivision(
  grants: readonly MemberDivisionGrant[],
  divisionId: string | null | undefined
): boolean {
  if (!divisionId) return false;
  return grants.some((grant) => grant.divisionId === divisionId && grant.accessKind === 'WORK');
}

/** New work and new assignments are refused in a retired division; history stays readable. */
export function assertDivisionAcceptsNewWork(status: string): void {
  if (status !== 'Active') {
    throw new DomainError('INVALID_TRANSITION', 'A retired division cannot receive new work or assignments');
  }
}

/**
 * The `Sort_Order` writes a new sequence needs, and only those.
 *
 * The sequence is walked in display order and every entry keeps its stored value when it is still
 * strictly greater than the previous one; otherwise it receives the next value. Two records that
 * share a sort order are therefore separated deterministically instead of being silently
 * un-movable, and a record whose position did not change is not rewritten.
 */
export function resequencedSortOrders(
  sequence: readonly { id: string; sortOrder: number }[]
): { id: string; sortOrder: number }[] {
  const writes: { id: string; sortOrder: number }[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const entry of sequence) {
    const value = entry.sortOrder > previous ? entry.sortOrder : previous + 1;
    previous = value;
    if (value !== entry.sortOrder) writes.push({ id: entry.id, sortOrder: value });
  }
  return writes;
}

/**
 * One entry moved by one position in its own group; an out-of-range move returns a copy.
 */
export function movedSequence<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
