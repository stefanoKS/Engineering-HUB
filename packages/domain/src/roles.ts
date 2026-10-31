/**
 * Authorization policy.
 *
 * Identity is created from a verified sign-in only. A role, actor, owner or confirmation value
 * that arrives from the browser is data, never authority. Ownership is accountability: it never
 * gates a manager write, and additional membership never grants a manager capability.
 */
import { DomainError, fail } from './errors';
import { effectiveRole } from './taxonomy';

export const ROLE_ORDER = { VIEWER: 0, MEMBER: 1, MANAGER: 2, ADMIN: 3 } as const;
export type RoleName = keyof typeof ROLE_ORDER;

export type Identity = {
  memberId: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER';
  active: boolean;
  verified: boolean;
};

export function atLeast(identity: Identity | null, minimum: RoleName): boolean {
  if (!identity || !identity.verified || !identity.active) return false;
  return ROLE_ORDER[identity.role] >= ROLE_ORDER[minimum];
}

export function requireRole(identity: Identity | null, minimum: RoleName): Identity {
  if (!identity || !identity.verified) {
    throw new DomainError('AUTHORIZATION_DENIED', 'A verified account is required');
  }
  if (!identity.active) {
    throw new DomainError('AUTHORIZATION_DENIED', 'A verified active member account is required');
  }
  if (ROLE_ORDER[identity.role] < ROLE_ORDER[minimum]) {
    throw new DomainError('AUTHORIZATION_DENIED', `Insufficient role: ${minimum} required`);
  }
  return identity;
}

export function isAdmin(identity: Identity | null): boolean {
  return !!identity && identity.active && identity.role === 'ADMIN';
}

export function isManager(identity: Identity | null): boolean {
  return !!identity && identity.active && (identity.role === 'ADMIN' || identity.role === 'MANAGER');
}

/**
 * ADMIN and MANAGER manage every project, subproject, task and responsibility.
 * MEMBER keeps the own-task boundary and VIEWER stays read-only.
 */
export function canEditTask(identity: Identity | null, task: { ownerMemberId: string | null } | null): boolean {
  if (!identity || !identity.active || !task) return false;
  if (identity.role === 'ADMIN' || identity.role === 'MANAGER') return true;
  return identity.role === 'MEMBER' && !!task.ownerMemberId && task.ownerMemberId === identity.memberId;
}

export function canManageResponsibility(identity: Identity | null): boolean {
  return !!identity && identity.verified && identity.active && (identity.role === 'ADMIN' || identity.role === 'MANAGER');
}

/** Changing the primary owner of a responsibility is an administrative act. */
export function requirePrimaryOwnerChange(identity: Identity | null): Identity {
  if (!isAdmin(identity)) fail.denied('Only an ADMIN may change the primary responsibility owner');
  return identity as Identity;
}

export function visibleTaskScope(identity: Identity): 'ALL' | 'OWN' | 'NONE' {
  if (identity.role === 'ADMIN' || identity.role === 'MANAGER') return 'ALL';
  if (identity.role === 'MEMBER') return 'OWN';
  return 'NONE';
}

export type RoleChangeRequest = {
  actor: Identity;
  targetMemberId: string;
  targetRole: RoleName | null;
  targetActive: boolean;
  activeAdministratorIds: readonly string[];
};

/**
 * Role and activation changes:
 * - only an ADMIN may grant or revoke ADMIN/MANAGER;
 * - nobody may change their own role or activation;
 * - the last active administrator can never be demoted or deactivated.
 */
export function assertRoleChangeAllowed(request: RoleChangeRequest): void {
  if (!isAdmin(request.actor)) fail.denied('Only an ADMIN may change a role or activation');
  if (request.actor.memberId === request.targetMemberId) {
    throw new DomainError('AUTHORIZATION_DENIED', 'You cannot change your own role or activation');
  }
  const removesAdmin =
    request.targetActive === false ||
    (request.targetRole !== null && request.targetRole !== 'ADMIN');
  const targetWasAdmin = request.activeAdministratorIds.includes(request.targetMemberId);
  if (targetWasAdmin && removesAdmin) {
    const remaining = request.activeAdministratorIds.filter((id) => id !== request.targetMemberId);
    if (remaining.length === 0) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'The last active administrator can never be demoted or deactivated'
      );
    }
  }
}

/** Directory projection: assessments, evidence and a manager chain stay manager-visible. */
export type MemberRecord = {
  memberId: string;
  name: string;
  email: string;
  department: string;
  position: string;
  role: string | null;
  active: boolean;
  weeklyCapacityHours: number | null;
  managerId: string | null;
};

export type DirectoryEntry = {
  memberId: string;
  name: string;
  active: boolean;
  role: 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER';
  email?: string;
  department?: string;
  position?: string;
  weeklyCapacityHours?: number | null;
  managerId?: string | null;
};

export function projectMemberDirectory(identity: Identity, member: MemberRecord): DirectoryEntry {
  const base: DirectoryEntry = {
    memberId: member.memberId,
    name: member.name,
    active: member.active,
    role: effectiveRole(member.role)
  };
  const manager = identity.role === 'ADMIN' || identity.role === 'MANAGER';
  const self = member.memberId === identity.memberId;
  if (manager) {
    base.email = member.email;
    base.department = member.department;
    base.position = member.position;
    base.weeklyCapacityHours = member.weeklyCapacityHours;
    base.managerId = member.managerId;
  } else if (self) {
    base.email = member.email;
    base.department = member.department;
    base.position = member.position;
    base.weeklyCapacityHours = member.weeklyCapacityHours;
  }
  return base;
}
