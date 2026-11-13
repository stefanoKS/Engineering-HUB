/** Narrow member edit authorization. Ownership never grants or limits this capability. */
import type { Queryable } from '@eh/db';
import { DomainError, assertReadableDivision, assertWritableDivision, requireRole } from '@eh/domain';
import type { ServiceCtx } from './common';

export async function authorizeWorkEdit(ctx: ServiceCtx, projectId: string, db: Queryable = ctx.db): Promise<void> {
  requireRole(ctx.identity, 'MEMBER');
  const project = await db.one<{ division_id: string | null; dashboard_visibility: string; status: string; archived_at: string | null }>(
    'SELECT division_id, dashboard_visibility, status, archived_at FROM projects WHERE project_id = $1 AND deleted_at IS NULL', [projectId]
  );
  if (!project) throw new DomainError('NOT_FOUND', 'Project not found');
  assertReadableDivision(ctx.divisions, project.division_id);
  assertWritableDivision(ctx.divisions, project.division_id);
  if (ctx.identity.role === 'MEMBER' && (project.dashboard_visibility !== 'INTERNAL' || project.status === 'Archived' || project.archived_at)) {
    throw new DomainError('NOT_FOUND', 'Project not found');
  }
}

/** Members edit ordinary fields, never manager-only workflow or notification settings. */
export function assertMemberEditFields(ctx: ServiceCtx, kind: 'task' | 'subproject', patch: object): void {
  if (ctx.identity.role !== 'MEMBER') return;
  const allowed = new Set(kind === 'task'
    ? ['revision', 'taskName', 'description', 'priority', 'plannedStart', 'deadline', 'confirmDeadlineChange', 'acknowledgeWarnings', 'ownerMemberId', 'assigneeIds', 'subprojectId', 'parentTaskId', 'requiredSkillId', 'requiredSkillLevel']
    : ['revision', 'subprojectName', 'description', 'ownerId', 'status', 'estimatedHours', 'nextAction', 'deadline', 'confirmDeadlineChange', 'acknowledgeWarnings']);
  if (Object.keys(patch).some(key => !allowed.has(key)) || (kind === 'subproject' && (patch as { status?: string }).status === 'Archived')) {
    throw new DomainError('AUTHORIZATION_DENIED', 'This field requires a manager');
  }
}
