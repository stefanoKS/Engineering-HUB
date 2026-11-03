/**
 * Read-only work browsing for every signed-in role.
 *
 * `MEMBER` and `VIEWER` may read permitted active work, but this module never mutates anything:
 * every write lives in the manager or member command services, each of which re-checks the
 * verified role. A manager sees the same projection here as in the manager screen, and the
 * private fields of a task are removed for the other roles rather than filtered in the browser.
 */
import type { TaskDetail } from '@eh/contracts';
import { getTask, listChildSummaries, listTaskAssignees, listTaskSummaries, listTaskTreeSummaries } from '@eh/db';
import { DomainError, requireRole } from '@eh/domain';
import type { TaskListQuery } from '@eh/contracts';
import type { z } from 'zod';
import type { ServiceCtx } from './common';
export type WorkPage = {
  items: Awaited<ReturnType<typeof listTaskSummaries>>['items'];
  matchedTotal?: number;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/**
 * One bounded page of active work.
 *
 * The scope is resolved on the server before paging, archived and cancelled work stays hidden by
 * default, and the browser never filters an already paged list.
 */
export async function listActiveWork(
  ctx: ServiceCtx,
  query: z.infer<typeof TaskListQuery>
): Promise<WorkPage> {
  requireRole(ctx.identity, 'VIEWER');
  const filters = {
    projectId: query.projectId,
    subprojectId: query.subprojectId,
    responsibilityId: query.responsibilityId,
    unassigned: query.unassigned,
    status: query.status,
    displayStatus: query.displayStatus,
    ownerMemberId: query.ownerMemberId,
    query: query.query,
    containerOnly: query.containerOnly,
    overdueOnly: query.overdueOnly,
    includeInactive: query.includeInactive,
    sort: query.sort,
    direction: query.direction
  };
  const result =
    query.tree === 'true'
      ? await listTaskTreeSummaries(ctx.db, filters, query.treeParentId, query.page, query.pageSize)
      : await listTaskSummaries(ctx.db, filters, query.page, query.pageSize);
  const matchedTotal =
    'matchedTotal' in result ? (result as { matchedTotal: number }).matchedTotal : undefined;
  return {
    items: result.items,
    ...(matchedTotal === undefined ? {} : { matchedTotal }),
    total: result.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(result.total / query.pageSize)
  };
}

/**
 * Task detail for a non-manager reader.
 *
 * Workflow history, notifications, acceptance criteria, internal notes and schedule
 * confirmations stay manager-only; the reader still sees the task, its assignees and its
 * children, which is what the permitted detail screen needs.
 */
export async function readOnlyTaskDetail(ctx: ServiceCtx, taskId: string): Promise<TaskDetail> {
  requireRole(ctx.identity, 'VIEWER');
  const task = await getTask(ctx.db, taskId);
  if (!task) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  const [children, assignees] = await Promise.all([listChildSummaries(ctx.db, taskId), listTaskAssignees(ctx.db, taskId)]);
  const effective = [
    ...(task.ownerMemberId
      ? [
          {
            memberId: task.ownerMemberId,
            name: task.ownerName,
            active: true,
            assignedAt: task.createdAt,
            assignedBy: '',
            primary: true
          }
        ]
      : []),
    ...assignees
      .filter((row) => !row.removed_at && row.member_id !== task.ownerMemberId)
      .map((row) => ({
        memberId: row.member_id,
        name: row.name,
        active: row.active,
        assignedAt: row.assigned_at,
        assignedBy: row.assigned_by,
        primary: false
      }))
  ];
  return {
    record: {
      ...task,
      acceptanceCriteria: '',
      nextAction: '',
      publicNote: '',
      notificationBaseline: '',
      notificationEnabled: false
    },
    assignees: effective,
    additionalAssigneeIds: effective.filter((row) => !row.primary).map((row) => row.memberId),
    assigneeIds: effective.map((row) => row.memberId),
    assigneeHistory: [],
    confirmations: [],
    deadlineHistory: [],
    children
  };
}
