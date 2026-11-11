/**
 * Authorization policy.
 *
 * Identity is created from a verified sign-in only. A role, actor, owner or confirmation value
 * that arrives from the browser is data, never authority. Ownership is accountability: it never
 * gates a manager write, and additional membership never grants a manager capability.
 *
 * `GENERAL_MANAGER` (次長) is deliberately NOT ordered above `MANAGER`: it sits below `MEMBER` in
 * the numeric order, because a cross-division read-only oversight role must never inherit a write
 * capability by comparison. Functions that need the oversight behaviour test the role explicitly.
 */
import { DomainError, fail } from './errors';
import { effectiveRole } from './taxonomy';

export const ROLE_ORDER = { VIEWER: 0, GENERAL_MANAGER: 1, MEMBER: 2, MANAGER: 3, ADMIN: 4 } as const;
export type RoleName = keyof typeof ROLE_ORDER;

export type Role = 'ADMIN' | 'MANAGER' | 'GENERAL_MANAGER' | 'MEMBER' | 'VIEWER';

export type Identity = {
  memberId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  verified: boolean;
};

/** An unknown role value ranks below every known role, so an unexpected value fails closed. */
function rankOf(role: string | null | undefined): number {
  const rank = ROLE_ORDER[role as RoleName];
  return typeof rank === 'number' ? rank : -1;
}

export function atLeast(identity: Identity | null, minimum: RoleName): boolean {
  if (!identity || !identity.verified || !identity.active) return false;
  return rankOf(identity.role) >= ROLE_ORDER[minimum];
}

export function requireRole(identity: Identity | null, minimum: RoleName): Identity {
  if (!identity || !identity.verified) {
    throw new DomainError('AUTHORIZATION_DENIED', 'A verified account is required');
  }
  if (!identity.active) {
    throw new DomainError('AUTHORIZATION_DENIED', 'A verified active member account is required');
  }
  if (rankOf(identity.role) < rankOf(minimum)) {
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

/** Cross-division read-only oversight (次長). Never a manager capability. */
export function isGeneralManager(identity: Identity | null): boolean {
  return !!identity && identity.verified && identity.active && identity.role === 'GENERAL_MANAGER';
}

/**
 * ADMIN and MANAGER manage every project, subproject, task and responsibility.
 * MEMBER keeps the own-task boundary and never edits an existing task, even one it created.
 * VIEWER stays read-only. Visibility and editability are independent: being able to read
 * another employee's task never grants authority to change it.
 */
export function canEditTask(identity: Identity | null, task: { ownerMemberId: string | null } | null): boolean {
  if (!identity || !identity.active || !task) return false;
  return identity.role === 'ADMIN' || identity.role === 'MANAGER';
}

/** Creating a task under an existing active project belongs to MEMBER; managers use the manager form. */
export function canCreateOwnTask(identity: Identity | null): boolean {
  return !!identity && identity.verified && identity.active && identity.role === 'MEMBER';
}

/**
 * Creating a project, a subproject or a task from the member project screens.
 *
 * A MEMBER files new work immediately; the server still decides the owner, the status, the
 * visibility and the hierarchy. Editing, archiving, deleting and reopening an existing record
 * stays a manager or ADMIN capability, including for a record the member created.
 */
export function canCreateOwnProject(identity: Identity | null): boolean {
  return !!identity && identity.verified && identity.active && identity.role === 'MEMBER';
}

/** Editing and archiving an existing record is a management capability. */
export function canEditRecords(identity: Identity | null): boolean {
  return isManager(identity);
}

/** Only an ADMIN holds the administrative removal capability. */
export function canDeleteRecords(identity: Identity | null): boolean {
  return isAdmin(identity);
}

/**
 * Corrective reopening of an accidentally completed task is an administrative act.
 *
 * It is deliberately narrower than completion: a MANAGER decides completion through the reviewed
 * workflow, while reversing a stored completion is an explicit ADMIN correction with its own
 * reason, confirmation and audit evidence.
 */
export function canReopenTask(identity: Identity | null): boolean {
  return isAdmin(identity);
}

/**
 * A completion report may be filed by any verified, active MEMBER, MANAGER or ADMIN who can reach
 * the task - assignment is not required, because a person who observed the work may report it.
 * VIEWER stays read-only. This is the approved exception for COMPLETION_REPORT only: it never
 * grants visibility, editing, reassignment, direct completion, approval or a deadline change, and
 * the reporter is recorded from the verified session rather than becoming the task owner.
 */
export function canReportCompletion(identity: Identity | null): boolean {
  return (
    !!identity &&
    identity.verified &&
    identity.active &&
    (identity.role === 'MEMBER' || identity.role === 'MANAGER' || identity.role === 'ADMIN')
  );
}

/** A deadline-change request stays limited to the MEMBER whose work it is. */
export function canRequestDeadlineChange(identity: Identity | null): boolean {
  return !!identity && identity.verified && identity.active && identity.role === 'MEMBER';
}

/** `Done` outside the request workflow is a manager decision; VIEWER never mutates. */
export function canCompleteTaskDirectly(identity: Identity | null): boolean {
  return !!identity && identity.verified && identity.active && (identity.role === 'ADMIN' || identity.role === 'MANAGER');
}

/** Every verified active account may read permitted active work, whatever the role. */
export function canViewWork(identity: Identity | null): boolean {
  return !!identity && identity.verified && identity.active;
}

/** Only an ADMIN maintains divisions, memberships and additional visibility. */
export function canAdministerDivisions(identity: Identity | null): boolean {
  return isAdmin(identity);
}

/** Moving existing work between divisions is one explicit ADMIN act, never ordinary editing. */
export function canTransferProjectDivision(identity: Identity | null): boolean {
  return isAdmin(identity);
}

/**
 * The role capability behind a division-scoped write. The division membership check is a second,
 * independent gate: this function says *what* the role may do, `DivisionScope` says *where*.
 *
 * A GENERAL_MANAGER is excluded here by design, because read-only oversight must never inherit a
 * manager write through role comparison.
 */
export function canManageWorkRecords(identity: Identity | null): boolean {
  return isManager(identity);
}

/**
 * The documented visibility policy for the shared work lists.
 *
 * Only a project marked `INTERNAL` is employee-visible; `RESTRICTED` and archived work stays
 * manager-visible. A blank or unknown value is RESTRICTED. Reading is still separate from
 * editing: a manager capability is never implied by being able to see a task.
 *
 * `GENERAL_MANAGER` oversees the managerial work picture read-only within its authorized
 * divisions, so it may read restricted work there. It never receives a write capability and the
 * publication of a RESTRICTED project stays exactly as restricted as before.
 */
export function canSeeRestrictedWork(identity: Identity | null): boolean {
  return (
    !!identity &&
    identity.verified &&
    identity.active &&
    (identity.role === 'ADMIN' || identity.role === 'MANAGER' || identity.role === 'GENERAL_MANAGER')
  );
}

export function canReadProjectVisibility(identity: Identity | null, visibility: string | null | undefined): boolean {
  if (!canViewWork(identity)) return false;
  if (canSeeRestrictedWork(identity)) return true;
  return String(visibility ?? '').toUpperCase() === 'INTERNAL';
}

/** Archived and cancelled history is an explicit management view, never a default employee list. */
export function canIncludeArchivedWork(identity: Identity | null): boolean {
  return canSeeRestrictedWork(identity);
}

/** Assignments are accountability, never permission: any active member may be assigned. */
export function isEffectiveAssignee(
  identity: Identity | null,
  assignment: { ownerMemberId: string | null; assigneeIds: readonly string[] }
): boolean {
  if (!identity) return false;
  return (
    assignment.ownerMemberId === identity.memberId || assignment.assigneeIds.includes(identity.memberId)
  );
}


export function canManageResponsibility(identity: Identity | null): boolean {
  return !!identity && identity.verified && identity.active && (identity.role === 'ADMIN' || identity.role === 'MANAGER');
}

/** Changing the primary owner of a responsibility is an administrative act. */
export function requirePrimaryOwnerChange(identity: Identity | null): Identity {
  if (!isAdmin(identity)) fail.denied('Only an ADMIN may change the primary responsibility owner');
  return identity as Identity;
}

/**
 * Reading scope. A manager reads every authorized task; a member and a viewer read permitted
 * active work (read-only for the viewer and for the member's non-assigned tasks) plus their own
 * assignments. Nothing returns `NONE` for a verified active account, because the policy separates
 * visibility from editability.
 */
export function visibleTaskScope(identity: Identity): 'ALL' | 'OWN' | 'NONE' {
  if (!identity.active || !identity.verified) return 'NONE';
  if (identity.role === 'ADMIN' || identity.role === 'MANAGER' || identity.role === 'GENERAL_MANAGER') {
    return 'ALL';
  }
  return 'OWN';
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
  role: Role;
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
  const self = member.memberId === identity.memberId;  if (manager) {
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
