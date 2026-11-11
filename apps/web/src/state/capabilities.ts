/**
 * What the signed-in role may be offered.
 *
 * These flags decide what the interface renders - never what it is allowed to do. Every command
 * re-checks the verified role on the server, so a hidden button is a usability decision and a
 * forged flag grants nothing. The capabilities are deliberately separate: a MEMBER may create new
 * work but never edit, archive, delete or reopen an existing record, including one they created.
 *
 * `GENERAL_MANAGER` (次長) is cross-division read-only oversight: it is given no create, edit,
 * archive, delete, reopen or request capability here, and the server refuses those commands even
 * if a browser forges a flag.
 */
import type { Actor } from '@eh/contracts';

export type Capabilities = {
  canCreateProject: boolean;
  canCreateSubproject: boolean;
  canCreateTask: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canReopenTask: boolean;
  canSubmitCompletionRequest: boolean;
  canSubmitExtensionRequest: boolean;
  /** Read-only oversight of every authorized division; never a write capability. */
  canOverseeDivisions: boolean;
};

export function capabilitiesOf(actor: Pick<Actor, 'role'>): Capabilities {
  const manager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  const admin = actor.role === 'ADMIN';
  const member = actor.role === 'MEMBER';
  const generalManager = actor.role === 'GENERAL_MANAGER';
  return {
    canCreateProject: member,
    canCreateSubproject: member,
    canCreateTask: member,
    canEdit: manager,
    canArchive: manager,
    canDelete: admin,
    canReopenTask: admin,
    // A completion report may be filed for accessible work by any non-viewer; an extension
    // request stays limited to the assigned MEMBER, exactly as the server policy states.
    canSubmitCompletionRequest: member || manager,
    canSubmitExtensionRequest: member,
    canOverseeDivisions: generalManager
  };
}

/**
 * Whether this role may act on *this* record.
 *
 * The role answers "may this account manage at all"; the record's server-computed `canWrite`
 * answers "in this division". A manager with read-only access to a division sees the record and
 * not its write actions. `canWrite` is per record, computed before paging - the shell's selected
 * division is never evidence of a record's permission.
 */
export function canEditRecord(capabilities: Capabilities, record: { canWrite?: boolean }): boolean {
  return capabilities.canEdit && record.canWrite !== false;
}

/** Creation needs a concrete writable destination, not only a role. */
export function hasWritableDestination(state: {
  loaded: boolean;
  writable: readonly unknown[];
}): boolean {
  // An unloaded scope is unknown, not empty: a slow reference read must not hide an action the
  // server would accept. Once the scope is known, an empty writable set is a real answer.
  if (!state.loaded) return true;
  return state.writable.length > 0;
}
