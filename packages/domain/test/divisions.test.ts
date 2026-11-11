/**
 * Division policy unit tests.
 *
 * The important property is that a numeric role order can never grant a write: `GENERAL_MANAGER`
 * sits below `MEMBER` in `ROLE_ORDER`, and every write decision comes from an explicit capability
 * plus the resolved division scope.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DIVISION_SCOPE,
  ROLE_ORDER,
  canAdministerDivisions,
  canBeAssignedInDivision,
  canCreateOwnTask,
  canEditRecords,
  canManageWorkRecords,
  canReadDivision,
  canReopenTask,
  canSeeRestrictedWork,
  canTransferProjectDivision,
  canWriteDivision,
  divisionScopeOf,
  effectiveRole,
  isManager,
  readableDivisionIds,
  requireRole,
  scopedDivisionIds,
  writableDivisionIds,
  type Identity
} from '@eh/domain';

const identity = (role: Identity['role'], overrides: Partial<Identity> = {}): Identity => ({
  memberId: 'MEM-X',
  name: 'X',
  email: 'x@example.invalid',
  role,
  active: true,
  verified: true,
  ...overrides
});

const grants = [
  { divisionId: 'DIV-A', accessKind: 'WORK' as const },
  { divisionId: 'DIV-B', accessKind: 'READ' as const }
];
const known = ['DIV-A', 'DIV-B', 'DIV-C'];

describe('role ordering', () => {
  it('never orders the oversight role above a manager or a member', () => {
    expect(ROLE_ORDER.GENERAL_MANAGER).toBeLessThan(ROLE_ORDER.MEMBER);
    expect(ROLE_ORDER.GENERAL_MANAGER).toBeLessThan(ROLE_ORDER.MANAGER);
    const gm = identity('GENERAL_MANAGER');
    expect(canEditRecords(gm)).toBe(false);
    expect(canManageWorkRecords(gm)).toBe(false);
    expect(canCreateOwnTask(gm)).toBe(false);
    expect(canReopenTask(gm)).toBe(false);
    expect(canAdministerDivisions(gm)).toBe(false);
    expect(canTransferProjectDivision(gm)).toBe(false);
    expect(isManager(gm)).toBe(false);
    // Reading the managerial picture is allowed; a write gate is not.
    expect(canSeeRestrictedWork(gm)).toBe(true);
    expect(() => requireRole(gm, 'MANAGER')).toThrow();
    expect(() => requireRole(gm, 'MEMBER')).toThrow();
    expect(() => requireRole(gm, 'VIEWER')).not.toThrow();
  });

  it('fails closed for an unknown stored role', () => {
    expect(effectiveRole('SUPERUSER')).toBe('VIEWER');
    const forged = identity('SUPERUSER' as Identity['role']);
    expect(() => requireRole(forged, 'VIEWER')).toThrow();
  });
});

describe('division scope', () => {
  it('resolves membership, additional read access and the oversight flag separately', () => {
    const member = divisionScopeOf(identity('MEMBER'), grants, { knownDivisionIds: known });
    expect([...member.work]).toEqual(['DIV-A']);
    expect([...member.read].sort()).toEqual(['DIV-A', 'DIV-B']);
    expect(readableDivisionIds(member)).toEqual(['DIV-A', 'DIV-B']);
    // Additional read access is never a write scope.
    expect(canWriteDivision(member, 'DIV-B')).toBe(false);
    expect(canWriteDivision(member, 'DIV-A')).toBe(true);
    expect(canWriteDivision(member, 'DIV-C')).toBe(false);
  });

  it('gives ADMIN every division but keeps assignment eligibility a membership question', () => {
    const admin = divisionScopeOf(identity('ADMIN'), [], { knownDivisionIds: known });
    expect(readableDivisionIds(admin)).toBeUndefined();
    expect(writableDivisionIds(admin)).toBeUndefined();
    expect(canWriteDivision(admin, 'DIV-C')).toBe(true);
    // ADMIN status alone never makes somebody assignable.
    expect(canBeAssignedInDivision([], 'DIV-A')).toBe(false);
    expect(canBeAssignedInDivision([{ divisionId: 'DIV-A', accessKind: 'READ' }], 'DIV-A')).toBe(false);
    expect(canBeAssignedInDivision([{ divisionId: 'DIV-A', accessKind: 'WORK' }], 'DIV-A')).toBe(true);
  });

  it('gives the oversight role read access only, mapped divisions included but never unmapped work', () => {
    const all = divisionScopeOf(identity('GENERAL_MANAGER'), [], {
      allDivisionsRead: true,
      knownDivisionIds: known
    });
    expect(all.overseeAll).toBe(true);
    // Every mapped division, including one created later, but never the unrestricted ADMIN filter:
    // a project with no division stays an ADMIN remediation view.
    expect(readableDivisionIds(all)).toEqual(['DIV-A', 'DIV-B', 'DIV-C']);
    expect(canReadDivision(all, null)).toBe(false);
    expect([...all.work]).toEqual([]);
    expect(canWriteDivision(all, 'DIV-A')).toBe(false);

    const selected = divisionScopeOf(identity('GENERAL_MANAGER'), grants, {
      allDivisionsRead: false,
      knownDivisionIds: known
    });
    expect(readableDivisionIds(selected)).toEqual(['DIV-A', 'DIV-B']);
    expect(canWriteDivision(selected, 'DIV-A')).toBe(false);
  });

  it('ignores the oversight flag for every other role', () => {
    const member = divisionScopeOf(identity('MEMBER'), grants, {
      allDivisionsRead: true,
      knownDivisionIds: known
    });
    expect(member.overseeAll).toBe(false);
    expect(member.manageAll).toBe(false);
    expect(readableDivisionIds(member)).toEqual(['DIV-A', 'DIV-B']);
  });

  it('treats an empty authorized set as nothing rather than everything', () => {
    const empty = divisionScopeOf(identity('MEMBER'), [], { knownDivisionIds: known });
    expect(readableDivisionIds(empty)).toEqual([]);
    expect(readableDivisionIds(EMPTY_DIVISION_SCOPE)).toEqual([]);
    // Unmapped work (a blank division) is the ADMIN remediation view: ADMIN may read and change it
    // so it can be mapped deliberately; nobody else may.
    const admin = divisionScopeOf(identity('ADMIN'), [], { knownDivisionIds: known });
    expect(canWriteDivision(admin, null)).toBe(true);
    expect(canReadDivision(admin, null)).toBe(true);
    expect(canWriteDivision(empty, null)).toBe(false);
    const overseer = divisionScopeOf(identity('GENERAL_MANAGER'), [], {
      allDivisionsRead: true,
      knownDivisionIds: known
    });
    expect(canWriteDivision(overseer, null)).toBe(false);
  });

  it('narrows a requested division without ever widening the scope', () => {
    const manager = divisionScopeOf(identity('MANAGER'), grants, { knownDivisionIds: known });
    expect(scopedDivisionIds(manager)).toEqual(['DIV-A', 'DIV-B']);
    expect(scopedDivisionIds(manager, 'DIV-A')).toEqual(['DIV-A']);
    // An unauthorized identifier is refused like an unknown one, never silently applied.
    expect(() => scopedDivisionIds(manager, 'DIV-C')).toThrow(/not available/);
    expect(() => scopedDivisionIds(manager, 'DIV-UNKNOWN')).toThrow(/not available/);
    // An empty authorization matches nothing: an explicit division is refused like any other
    // unauthorized one instead of silently returning an empty page.
    expect(scopedDivisionIds(EMPTY_DIVISION_SCOPE)).toEqual([]);
    expect(() => scopedDivisionIds(EMPTY_DIVISION_SCOPE, 'DIV-A')).toThrow(/not available/);
    // ADMIN keeps the unrestricted administrative filter.
    const admin = divisionScopeOf(identity('ADMIN'), [], { knownDivisionIds: known });
    expect(scopedDivisionIds(admin)).toBeUndefined();
    expect(scopedDivisionIds(admin, 'DIV-C')).toEqual(['DIV-C']);
  });

  it('fails closed for an inactive or unverified identity', () => {
    for (const identityValue of [identity('MEMBER', { active: false }), identity('MEMBER', { verified: false })]) {
      const scope = divisionScopeOf(identityValue, grants, { knownDivisionIds: known });
      expect(scope.manageAll).toBe(false);
      expect(readableDivisionIds(scope)).toEqual([]);
    }
  });
});
