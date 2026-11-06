/**
 * What the signed-in role may be offered.
 *
 * These flags decide what the interface renders - never what it is allowed to do. Every command
 * re-checks the verified role on the server, so a hidden button is a usability decision and a
 * forged flag grants nothing. The capabilities are deliberately separate: a MEMBER may create new
 * work but never edit, archive, delete or reopen an existing record, including one they created.
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
};

export function capabilitiesOf(actor: Pick<Actor, 'role'>): Capabilities {
  const manager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  const admin = actor.role === 'ADMIN';
  const member = actor.role === 'MEMBER';
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
    canSubmitExtensionRequest: member
  };
}
