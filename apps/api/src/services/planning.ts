/**
 * Planning Board service.
 *
 * A plan is a private draft of its author. Saving is one revision-checked transaction; creating
 * operational records is one *separate* reviewed transaction that either writes every record and
 * its receipt or writes nothing.
 *
 * Two properties are deliberate:
 *
 * - the draft is never an operational record: it is excluded from counts, reports, publication,
 *   notification, assignment approval and completion;
 * - the export never activates mail, Calendar, reminders or publication, never approves an
 *   assignment and never marks work complete.
 */
import type { z } from 'zod';
import type {
  ArchivePlanBody,
  CreatePlanBody,
  ExportPlanBody,
  PlanDraft,
  PlanExportReceipt,
  PlanExportResult,
  PlanItem,
  PlanReview,
  PlanReviewIssue,
  PlanReviewItem,
  PlanReviewWarning,
  PlanScheduleMode,
  SavePlanBody,
  UpdatePlanBody
} from '@eh/contracts';
import { PLAN_CONTRACT_VERSION, PLAN_LIMITS } from '@eh/contracts';
import type { Queryable, Transaction } from '@eh/db';
import {
  countPlansForAuthor,
  findPlanExportByKey,
  getDivision,
  getPlanDraftRow,
  getPlanExportRow,
  getProject,
  getResponsibility,
  insertPlanDraft,
  insertPlanExport,
  insertProject,
  insertSubproject,
  insertTask,
  latestPlanExport,
  listHolidays,
  listPlanItems,
  listPlanSummaries,
  lockPlanDraftRow,
  markRemovedPlanItems,
  setEffectiveAssignees,
  setSubprojectSortOrder,
  setTaskSortOrder,
  upsertPlanItem,
  updatePlanDraft,
  newId,
  type PlanRow
} from '@eh/db';
import {
  DomainError,
  assertDivisionAcceptsNewWork,
  assertWritableDivision,
  businessDate,
  canWriteDivision,
  createCalendar,
  flattenPlan,
  buildPlanIndex,
  nearestSubprojectId,
  normalizePlanOrder,
  planHierarchyIssues,
  planExportOrder,
  planFinishIsWorkingDay,
  resolvePlanItemSchedule,
  requireRole,
  type DivisionScope,
  type Identity,
  type WorkingCalendar
} from '@eh/domain';
import { audit, hashRequest, requireConfirmation, runIdempotent, type ServiceCtx } from './common';
import {
  assertAssignmentEligibility,
  lockDivisionMutation,
  memberCanWorkInDivision,
  reauthorizeInTransaction
} from './divisions';

const WRITE_ROLES = 'MANAGER' as const;

function newPlanExportId(): string {
  return newId('PEX');
}

function newSubprojectId(): string {
  return newId('SUB');
}

function newTaskId(): string {
  return newId('TSK');
}

type PlanHeader = Omit<SavePlanBody, 'items'>;

type MemberFact = { memberId: string; name: string; active: boolean; accessKind: string | null };

export function planDtoOf(row: PlanRow, items: PlanItem[]): PlanDraft {
  return {
    planId: row.plan_id,
    contractVersion: row.contract_version,
    title: row.title,
    status: row.status,
    authorMemberId: row.author_member_id,
    divisionId: row.division_id,
    responsibilityId: row.responsibility_id,
    destinationMode: row.destination_mode,
    destinationProjectId: row.destination_project_id,
    projectOwnerId: row.project_owner_id,
    dashboardVisibility: row.dashboard_visibility as PlanDraft['dashboardVisibility'],
    scheduleMode: row.schedule_mode,
    revision: row.revision,
    exportedAt: row.exported_at,
    exportReceipt: row.export_receipt ?? null,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items
  };
}

/**
 * A plan is readable only by its author. A different account - including an ADMIN - receives the
 * same NOT_FOUND an unknown identifier receives, so a guessed identifier reveals nothing.
 */
async function ownedPlanRow(db: Queryable, ctx: ServiceCtx, planId: string): Promise<PlanRow> {
  const row = await getPlanDraftRow(db, planId);
  if (!row || row.author_member_id !== ctx.identity.memberId) {
    throw new DomainError('NOT_FOUND', `Plan not found: ${planId}`);
  }
  return row;
}

/** Structural validation of the submitted draft, before anything is stored. */
export function normalizedPlanItems(items: readonly PlanItem[]): PlanItem[] {
  const issues = planHierarchyIssues(items);
  if (issues.length) {
    const first = issues[0]!;
    const code =
      first.code === 'CYCLE'
        ? 'HIERARCHY_CYCLE'
        : first.code === 'SUBPROJECT_DEPTH' || first.code === 'TASK_DEPTH'
          ? 'HIERARCHY_DEPTH'
          : first.code === 'TOO_MANY_ITEMS'
            ? 'VALIDATION_FAILED'
            : 'HIERARCHY_INVALID';
    throw new DomainError(code, first.message, { issues });
  }
  return normalizePlanOrder(items);
}

function uniqueMemberIds(items: readonly PlanItem[], extra: (string | null | undefined)[] = []): string[] {
  const ids = new Set<string>();
  for (const value of extra) if (value) ids.add(value);
  for (const item of items) {
    if (item.ownerMemberId) ids.add(item.ownerMemberId);
    for (const assignee of item.assigneeIds) if (assignee) ids.add(assignee);
  }
  return [...ids].sort();
}

/**
 * The authoritative destination check, run once as a fast pre-check and again through the
 * transaction handle. Returns the division the work will belong to.
 */
export async function assertPlanDestination(
  db: Queryable,
  divisions: DivisionScope,
  body: PlanHeader
): Promise<string | null> {
  if (body.destinationMode === 'NEW_PROJECT') {
    if (!body.divisionId) {
      throw new DomainError('DIVISION_REQUIRED', 'A new project needs a division');
    }
    const division = await getDivision(db, body.divisionId);
    if (!division) throw new DomainError('VALIDATION_FAILED', 'Unknown division');
    assertDivisionAcceptsNewWork(division.status);
    assertWritableDivision(divisions, division.divisionId);
    if (!body.responsibilityId) {
      throw new DomainError('RESPONSIBILITY_REQUIRED', 'A new project needs an active responsibility');
    }
    const responsibility = await getResponsibility(db, body.responsibilityId);
    if (!responsibility || responsibility.status !== 'Active') {
      throw new DomainError('RESPONSIBILITY_REQUIRED', 'A new project needs an active responsibility');
    }
    if (responsibility.divisionId && responsibility.divisionId !== division.divisionId) {
      throw new DomainError('VALIDATION_FAILED', 'The selected responsibility belongs to another division', {
        responsibilityDivisionId: responsibility.divisionId
      });
    }
    return division.divisionId;
  }

  if (!body.destinationProjectId) {
    throw new DomainError('VALIDATION_FAILED', 'Choose an existing project');
  }
  const project = await getProject(db, body.destinationProjectId);
  if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${body.destinationProjectId}`);
  assertWritableDivision(divisions, project.divisionId);
  if (body.divisionId && body.divisionId !== project.divisionId) {
    throw new DomainError('VALIDATION_FAILED', 'The selected project belongs to another division');
  }
  if (project.status === 'Archived' || project.status === 'Cancelled' || project.status === 'Completed') {
    throw new DomainError('INVALID_TRANSITION', 'This project cannot receive new work');
  }
  return project.divisionId;
}

async function assertPlanAssignments(
  ctx: ServiceCtx,
  db: Queryable,
  divisionId: string | null,
  items: readonly PlanItem[],
  projectOwnerId: string | null
): Promise<void> {
  const memberIds = uniqueMemberIds(items, [projectOwnerId]);
  if (!memberIds.length) return;
  await assertAssignmentEligibility(ctx, divisionId, memberIds, new Set(), db);
}

export async function listPlans(
  ctx: ServiceCtx,
  query: { status: 'ALL' | 'DRAFT' | 'EXPORTED' | 'ARCHIVED'; query?: string; page: number; pageSize: number }
) {
  requireRole(ctx.identity, WRITE_ROLES);
  const page = await listPlanSummaries(
    ctx.db,
    ctx.identity.memberId,
    { status: query.status, query: query.query },
    query.page,
    query.pageSize
  );
  return {
    items: page.items,
    total: page.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(page.total / query.pageSize)
  };
}

export async function getPlan(ctx: ServiceCtx, planId: string): Promise<PlanDraft> {
  requireRole(ctx.identity, WRITE_ROLES);
  const row = await ownedPlanRow(ctx.db, ctx, planId);
  const items = await listPlanItems(ctx.db, planId);
  return planDtoOf(row, items);
}

export async function createPlan(
  ctx: ServiceCtx,
  body: z.infer<typeof CreatePlanBody>
): Promise<{ plan: PlanDraft; replayed: boolean }> {
  requireRole(ctx.identity, WRITE_ROLES);
  const items = normalizedPlanItems(body.items);
  const divisionId = await assertPlanDestination(ctx.db, ctx.divisions, body);
  await assertPlanAssignments(ctx, ctx.db, divisionId, items, body.projectOwnerId);
  if ((await countPlansForAuthor(ctx.db, ctx.identity.memberId)) >= PLAN_LIMITS.maxPlansPerAuthor) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `A person can keep at most ${PLAN_LIMITS.maxPlansPerAuthor} active plans; archive one first`
    );
  }

  const authorize = async (tx: Transaction): Promise<void> => {
    const fresh = await reauthorizeInTransaction(tx, ctx);
    requireRole(fresh.identity, WRITE_ROLES);
    await assertPlanDestination(tx, fresh.scope, body);
  };

  const result = await runIdempotent(
    ctx,
    { scope: 'plan.create', key: body.idempotencyKey, request: body },
    async (tx) => {
      await lockDivisionMutation(tx);
      await authorize(tx);
      const fresh = await reauthorizeInTransaction(tx, ctx);
      const effectiveDivision = await assertPlanDestination(tx, fresh.scope, body);
      await assertPlanAssignments({ ...ctx, divisions: fresh.scope }, tx, effectiveDivision, items, body.projectOwnerId);
      if ((await countPlansForAuthor(tx, ctx.identity.memberId)) >= PLAN_LIMITS.maxPlansPerAuthor) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `A person can keep at most ${PLAN_LIMITS.maxPlansPerAuthor} active plans; archive one first`
        );
      }
      const row = await insertPlanDraft(tx, {
        title: body.title,
        authorMemberId: ctx.identity.memberId,
        divisionId: body.destinationMode === 'NEW_PROJECT' ? body.divisionId : effectiveDivision,
        responsibilityId: body.destinationMode === 'NEW_PROJECT' ? body.responsibilityId : null,
        destinationMode: body.destinationMode,
        destinationProjectId: body.destinationMode === 'EXISTING_PROJECT' ? body.destinationProjectId : null,
        projectOwnerId: body.projectOwnerId,
        dashboardVisibility: body.dashboardVisibility,
        scheduleMode: body.scheduleMode
      });
      for (const item of items) await upsertPlanItem(tx, row.plan_id, item);
      await audit(tx, ctx, {
        entityType: 'PLAN_DRAFTS',
        entityId: row.plan_id,
        action: 'PLAN_CREATED',
        newValue: { title: row.title, destinationMode: row.destination_mode, itemCount: items.length }
      });
      return row;
    },
    { authorize }
  );
  const stored = await listPlanItems(ctx.db, result.data.plan_id);
  return { plan: planDtoOf(result.data, stored), replayed: result.replayed };
}

export async function savePlan(
  ctx: ServiceCtx,
  planId: string,
  body: z.infer<typeof UpdatePlanBody>
): Promise<{ plan: PlanDraft }> {
  requireRole(ctx.identity, WRITE_ROLES);
  const items = normalizedPlanItems(body.items);
  const row = await ownedPlanRow(ctx.db, ctx, planId);
  if (row.revision !== body.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved', {
      expected: body.revision,
      stored: row.revision
    });
  }
  if (row.status !== 'DRAFT') {
    throw new DomainError('INVALID_TRANSITION', 'An exported or archived plan is a historical reference');
  }
  const divisionId = await assertPlanDestination(ctx.db, ctx.divisions, body);
  await assertPlanAssignments(ctx, ctx.db, divisionId, items, body.projectOwnerId);

  const updated = await ctx.db.transaction(async (tx) => {
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    requireRole(fresh.identity, WRITE_ROLES);
    const locked = await lockPlanDraftRow(tx, planId);
    if (!locked || locked.author_member_id !== ctx.identity.memberId) {
      throw new DomainError('NOT_FOUND', `Plan not found: ${planId}`);
    }
    if (locked.revision !== body.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved', {
        expected: body.revision,
        stored: locked.revision
      });
    }
    if (locked.status !== 'DRAFT') {
      throw new DomainError('INVALID_TRANSITION', 'An exported or archived plan is a historical reference');
    }
    const effectiveDivision = await assertPlanDestination(tx, fresh.scope, body);
    await assertPlanAssignments({ ...ctx, divisions: fresh.scope }, tx, effectiveDivision, items, body.projectOwnerId);
    const next = await updatePlanDraft(
      tx,
      planId,
      {
        title: body.title,
        divisionId: body.destinationMode === 'NEW_PROJECT' ? body.divisionId : effectiveDivision,
        responsibilityId: body.destinationMode === 'NEW_PROJECT' ? body.responsibilityId : null,
        destinationMode: body.destinationMode,
        destinationProjectId: body.destinationMode === 'EXISTING_PROJECT' ? body.destinationProjectId : null,
        projectOwnerId: body.projectOwnerId,
        dashboardVisibility: body.dashboardVisibility,
        scheduleMode: body.scheduleMode
      },
      body.revision
    );
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    for (const item of items) await upsertPlanItem(tx, planId, item);
    const removed = await markRemovedPlanItems(tx, planId, items.map((item) => item.itemId));
    await audit(tx, ctx, {
      entityType: 'PLAN_DRAFTS',
      entityId: planId,
      action: 'PLAN_SAVED',
      previousValue: { revision: locked.revision, title: locked.title },
      newValue: { revision: next.revision, title: next.title, itemCount: items.length, removedItems: removed }
    });
    return next;
  });
  const stored = await listPlanItems(ctx.db, planId);
  return { plan: planDtoOf(updated, stored) };
}

export async function archivePlan(
  ctx: ServiceCtx,
  planId: string,
  body: z.infer<typeof ArchivePlanBody>
): Promise<{ plan: PlanDraft }> {
  requireRole(ctx.identity, WRITE_ROLES);
  requireConfirmation(body.confirmed, 'Archiving a plan requires explicit confirmation');
  const row = await ownedPlanRow(ctx.db, ctx, planId);
  if (row.revision !== body.revision) {
    throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
  }
  if (row.status === 'ARCHIVED') {
    const items = await listPlanItems(ctx.db, planId);
    return { plan: planDtoOf(row, items) };
  }
  return ctx.db.transaction(async (tx) => {
    await lockDivisionMutation(tx);
    const fresh = await reauthorizeInTransaction(tx, ctx);
    requireRole(fresh.identity, WRITE_ROLES);
    const locked = await lockPlanDraftRow(tx, planId);
    if (!locked || locked.author_member_id !== ctx.identity.memberId) {
      throw new DomainError('NOT_FOUND', `Plan not found: ${planId}`);
    }
    if (locked.revision !== body.revision) {
      throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    }
    const next = await updatePlanDraft(
      tx,
      planId,
      { status: 'ARCHIVED', archivedAt: new Date().toISOString() },
      body.revision
    );
    if (!next) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
    await audit(tx, ctx, {
      entityType: 'PLAN_DRAFTS',
      entityId: planId,
      action: 'PLAN_ARCHIVED',
      previousValue: { status: locked.status, revision: locked.revision },
      newValue: { status: next.status, exportId: locked.export_receipt?.exportId ?? null }
    });
    const items = await listPlanItems(tx, planId);
    return { plan: planDtoOf(next, items) };
  });
}

/* -------------------------------- review --------------------------------- */

async function memberFacts(
  db: Queryable,
  memberIds: readonly string[],
  divisionId: string | null
): Promise<Map<string, MemberFact>> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.many<{ member_id: string; name: string; active: boolean; access_kind: string | null }>(
    `SELECT m.member_id, m.name, m.active,
            (SELECT md.access_kind FROM member_divisions md
              WHERE md.member_id = m.member_id AND md.division_id = $2 AND md.removed_at IS NULL
              LIMIT 1) AS access_kind
       FROM members m WHERE m.member_id = ANY($1::text[])`,
    [ids, divisionId]
  );
  return new Map(
    rows.map((row) => [
      row.member_id,
      { memberId: row.member_id, name: row.name, active: row.active, accessKind: row.access_kind }
    ])
  );
}

/**
 * The reviewed content of one plan.
 *
 * The returned token identifies the exact reviewed state: destination, schedule mode, manual
 * order and every item field the export will write. A material edit changes it, so an export can
 * never apply an older review to a newer draft.
 */
export async function buildPlanReview(
  ctx: ServiceCtx,
  db: Queryable,
  row: PlanRow,
  items: readonly PlanItem[],
  divisions: DivisionScope
): Promise<PlanReview> {
  const calendar = createCalendar(await listHolidays(db));
  const today = businessDate();
  const mode: PlanScheduleMode = row.schedule_mode;
  const errors: PlanReviewIssue[] = [];
  const warnings: PlanReviewWarning[] = [];
  const error = (itemId: string | null, field: string, code: PlanReviewIssue['code'], message: string): void => {
    errors.push({ itemId, field, code, message });
  };
  const warn = (itemId: string | null, field: string, code: PlanReviewWarning['code'], message: string): void => {
    warnings.push({ itemId, field, code, message });
  };

  let divisionId: string | null = row.division_id;
  let divisionName = '';
  const responsibilityId: string | null = row.responsibility_id;
  let responsibilityName = '';
  let projectId: string | null = null;
  let projectName = row.title;
  let projectOwnerId = row.project_owner_id;
  let projectOwnerName = '';

  if (!row.title.trim()) error(null, 'title', 'MISSING_TITLE', 'The plan needs a title');

  if (row.destination_mode === 'NEW_PROJECT') {
    if (!row.division_id) {
      error(null, 'divisionId', 'MISSING_DIVISION', 'A new project needs a division');
    } else {
      const division = await getDivision(db, row.division_id);
      if (!division) {
        error(null, 'divisionId', 'DESTINATION_UNAVAILABLE', 'The division no longer exists');
      } else {
        divisionName = division.name;
        if (division.status !== 'Active') {
          error(null, 'divisionId', 'DESTINATION_UNAVAILABLE', 'A retired division cannot receive new work');
        }
        if (!canWriteDivision(divisions, division.divisionId)) {
          error(null, 'divisionId', 'DESTINATION_UNAVAILABLE', 'Your role cannot create work in this division');
        }
      }
    }
    if (!row.responsibility_id) {
      error(null, 'responsibilityId', 'MISSING_RESPONSIBILITY', 'A new project needs a responsibility');
    } else {
      const responsibility = await getResponsibility(db, row.responsibility_id);
      if (!responsibility || responsibility.status !== 'Active') {
        error(null, 'responsibilityId', 'DESTINATION_UNAVAILABLE', 'The responsibility is no longer active');
      } else {
        responsibilityName = responsibility.name;
        if (responsibility.divisionId && responsibility.divisionId !== row.division_id) {
          error(
            null,
            'responsibilityId',
            'DESTINATION_UNAVAILABLE',
            'The responsibility belongs to another division'
          );
        }
      }
    }
    if (!projectOwnerId && divisionId) {
      if (await memberCanWorkInDivision(ctx, ctx.identity.memberId, divisionId)) {
        projectOwnerId = ctx.identity.memberId;
        projectOwnerName = ctx.identity.name;
      }
    }
  } else {
    const project = row.destination_project_id ? await getProject(db, row.destination_project_id) : null;
    if (!row.destination_project_id) {
      error(null, 'destinationProjectId', 'MISSING_DESTINATION', 'Choose an existing project');
    } else if (!project) {
      error(null, 'destinationProjectId', 'DESTINATION_UNAVAILABLE', 'The project no longer exists');
    } else {
      projectId = project.projectId;
      projectName = project.projectName;
      divisionId = project.divisionId;
      divisionName = project.divisionName;
      responsibilityName = project.responsibilityName;
      projectOwnerId = project.projectOwnerId;
      projectOwnerName = project.projectOwnerName;
      if (!canWriteDivision(divisions, project.divisionId)) {
        error(null, 'destinationProjectId', 'DESTINATION_UNAVAILABLE', 'Your role cannot add work to this project');
      }
      if (project.status === 'Archived' || project.status === 'Cancelled' || project.status === 'Completed') {
        error(null, 'destinationProjectId', 'DESTINATION_UNAVAILABLE', 'This project cannot receive new work');
      }
    }
  }

  if (!items.length) error(null, 'items', 'EMPTY_PLAN', 'A plan needs at least one subproject or task');

  for (const issue of planHierarchyIssues(items)) {
    error(issue.itemId, 'parentItemId', 'HIERARCHY', issue.message);
  }

  const facts = await memberFacts(
    db,
    uniqueMemberIds(items, [projectOwnerId]),
    divisionId
  );

  const rows = flattenPlan(items);
  const reviewItems: PlanReviewItem[] = [];
  let dated = 0;
  let unassigned = 0;
  let subprojects = 0;
  let tasks = 0;
  for (const row of rows) {
    const item = row.item;
    const schedule = resolvePlanItemSchedule(item, mode, calendar);
    if (item.type === 'SUBPROJECT') subprojects += 1;
    else tasks += 1;
    if (schedule.start && schedule.finish) dated += 1;
    if (item.type === 'TASK' && !item.ownerMemberId) unassigned += 1;

    if (!item.name.trim()) {
      error(item.itemId, 'name', 'MISSING_NAME', 'Every item needs a name');
    }
    if (schedule.problems.includes('INVALID_START') || schedule.problems.includes('INVALID_FINISH')) {
      error(item.itemId, 'date', 'INVALID_DATE', 'The entered date is not a valid calendar date');
    }
    if (schedule.problems.includes('INVALID_RANGE')) {
      error(item.itemId, 'startDate', 'INVALID_RANGE', 'The start is after the finish');
    }
    if (schedule.problems.includes('MISSING_FINISH')) {
      error(
        item.itemId,
        'finishDate',
        'MISSING_FINISH',
        item.type === 'TASK' ? 'A task needs a finish date' : 'A duration needs a finish date'
      );
    }
    if (schedule.problems.includes('MISSING_DURATION') || schedule.problems.includes('INVALID_DURATION')) {
      error(item.itemId, 'durationValue', 'MISSING_DURATION', 'Duration mode needs a required duration');
    }

    if (item.ownerMemberId) {
      const owner = facts.get(item.ownerMemberId);
      if (!owner) {
        error(item.itemId, 'ownerMemberId', 'INELIGIBLE_OWNER', 'The selected owner is unknown');
      } else if (!owner.active) {
        error(item.itemId, 'ownerMemberId', 'INELIGIBLE_OWNER', 'The selected owner is inactive');
      } else if (owner.accessKind !== 'WORK') {
        error(
          item.itemId,
          'ownerMemberId',
          'INELIGIBLE_OWNER',
          'The selected owner does not belong to the division of the work'
        );
      }
    }
    for (const assigneeId of item.assigneeIds) {
      const assignee = facts.get(assigneeId);
      if (!assignee) {
        error(item.itemId, 'assigneeIds', 'INELIGIBLE_ASSIGNEE', 'A selected assignee is unknown');
      } else if (!assignee.active) {
        error(item.itemId, 'assigneeIds', 'INELIGIBLE_ASSIGNEE', 'A selected assignee is inactive');
      } else if (assignee.accessKind !== 'WORK') {
        error(
          item.itemId,
          'assigneeIds',
          'INELIGIBLE_ASSIGNEE',
          'A selected assignee does not belong to the division of the work'
        );
      }
    }

    if (!schedule.start && !schedule.finish) {
      warn(item.itemId, 'date', 'UNDATED', 'This item has no dates yet');
    } else if (schedule.start && !schedule.finish) {
      warn(item.itemId, 'finishDate', 'START_WITHOUT_FINISH', 'A start without a finish is incomplete');
    } else if (!schedule.start && schedule.finish && mode === 'MANUAL') {
      warn(item.itemId, 'startDate', 'FINISH_WITHOUT_START', 'A finish without a start is incomplete');
    }
    if (schedule.finish && !planFinishIsWorkingDay(schedule.finish, calendar)) {
      warn(item.itemId, 'finishDate', 'NON_WORKING_FINISH', 'The finish is not a working day');
    }
    if (schedule.finish && schedule.finish < today) {
      warn(item.itemId, 'finishDate', 'PAST_FINISH', 'The finish date is already in the past');
    }

    reviewItems.push({
      itemId: item.itemId,
      type: item.type,
      depth: row.depth,
      path: row.path,
      name: item.name,
      startDate: schedule.start,
      finishDate: schedule.finish,
      startDerived: schedule.startDerived,
      ownerMemberId: item.ownerMemberId,
      ownerName: item.ownerMemberId ? facts.get(item.ownerMemberId)?.name ?? '' : '',
      assigneeNames: item.assigneeIds.map((id) => facts.get(id)?.name ?? ''),
      exportTarget: item.type
    });
  }

  const tokenItems = planExportOrder(items).map((item) => {
    const schedule = resolvePlanItemSchedule(item, mode, calendar);
    return [
      item.itemId,
      item.type,
      item.parentItemId,
      item.order,
      item.name.trim(),
      schedule.start,
      schedule.finish,
      item.durationValue,
      item.durationUnit,
      item.durationBasis,
      item.ownerMemberId,
      [...item.assigneeIds].sort()
    ];
  });
  const reviewToken = hashRequest({
    contract: PLAN_CONTRACT_VERSION,
    planId: row.plan_id,
    revision: row.revision,
    mode,
    destination: {
      mode: row.destination_mode,
      divisionId,
      responsibilityId,
      projectId,
      projectOwnerId,
      visibility: row.dashboard_visibility
    },
    items: tokenItems
  });

  return {
    planId: row.plan_id,
    planRevision: row.revision,
    contractVersion: row.contract_version,
    scheduleMode: mode,
    reviewToken,
    destination: {
      mode: row.destination_mode,
      divisionId,
      divisionName,
      responsibilityId,
      responsibilityName,
      projectId,
      projectName,
      projectOwnerId,
      projectOwnerName,
      visibility: row.dashboard_visibility as PlanReview['destination']['visibility']
    },
    counts: { subprojects, tasks, dated, undated: reviewItems.length - dated, unassigned },
    items: reviewItems,
    errors,
    warnings
  };
}

export async function reviewPlan(
  ctx: ServiceCtx,
  planId: string,
  revision: number
): Promise<PlanReview> {
  requireRole(ctx.identity, WRITE_ROLES);
  const row = await ownedPlanRow(ctx.db, ctx, planId);
  if (row.status === 'ARCHIVED') {
    throw new DomainError('INVALID_TRANSITION', 'An archived plan cannot be reviewed for creation');
  }
  if (row.revision !== revision) {
    throw new DomainError('EDIT_CONFLICT', 'The plan changed; review the latest version', {
      expected: revision,
      stored: row.revision
    });
  }
  const items = await listPlanItems(ctx.db, planId);
  return buildPlanReview(ctx, ctx.db, row, items, ctx.divisions);
}

/* -------------------------------- export --------------------------------- */

/**
 * Creates the reviewed operational records.
 *
 * Parents are created before children, every draft identifier is mapped to its permanent record,
 * the manual order is stored per parent, and no calendar job, notification job, publication,
 * approval or completion is produced.
 */
async function createRecordsFromPlan(
  tx: Transaction,
  ctx: ServiceCtx,
  identity: Identity,
  row: PlanRow,
  items: readonly PlanItem[],
  review: PlanReview,
  calendar: WorkingCalendar
): Promise<PlanExportReceipt> {
  const exportId = newPlanExportId();
  const exportedAt = new Date().toISOString();
  const index = buildPlanIndex(items);
  const ordered = planExportOrder(items);
  const starts = review.items.map((entry) => entry.startDate).filter((value): value is string => !!value).sort();
  const finishes = review.items.map((entry) => entry.finishDate).filter((value): value is string => !!value).sort();

  let projectId: string;
  let projectName = review.destination.projectName;
  let createdProjectId: string | null = null;
  if (row.destination_mode === 'NEW_PROJECT') {
    const project = await insertProject(tx, {
      projectName: row.title.trim(),
      description: '',
      category: '',
      divisionId: row.division_id,
      responsibilityId: row.responsibility_id,
      projectOwnerId: review.destination.projectOwnerId,
      status: 'Active',
      priority: 'Medium',
      plannedStart: starts[0] ?? null,
      forecastEnd: finishes[finishes.length - 1] ?? null,
      committedDeadline: null,
      originalDeadline: null,
      nextMilestone: '',
      nextAction: '',
      notificationEnabled: false,
      dashboardVisibility: row.dashboard_visibility,
      dashboardSummary: ''
    });
    projectId = project.projectId;
    projectName = project.projectName;
    createdProjectId = project.projectId;
    await audit(tx, ctx, {
      entityType: 'PROJECTS',
      entityId: project.projectId,
      action: 'PROJECT_CREATED',
      newValue: {
        projectId: project.projectId,
        projectName: project.projectName,
        divisionId: project.divisionId,
        responsibilityId: project.responsibilityId,
        source: 'PLANNING_BOARD',
        exportId
      }
    });
  } else {
    const destinationId = row.destination_project_id as string;
    const project = await getProject(tx, destinationId);
    if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${destinationId}`);
    if (project.status === 'Archived' || project.status === 'Cancelled' || project.status === 'Completed') {
      throw new DomainError('INVALID_TRANSITION', 'This project cannot receive new work');
    }
    projectId = project.projectId;
    projectName = project.projectName;
  }

  const mapping: PlanExportReceipt['mapping'] = [];
  const subprojectIds: string[] = [];
  const taskIds: string[] = [];

  for (const item of ordered) {
    const schedule = resolvePlanItemSchedule(item, row.schedule_mode, calendar);
    if (item.type === 'SUBPROJECT') {
      const parentDraftId = nearestSubprojectId(item.itemId, index);
      const parentSubprojectId = parentDraftId ? mapping.find((entry) => entry.itemId === parentDraftId)?.recordId ?? null : null;
      const subprojectId = newSubprojectId();
      await insertSubproject(
        tx,
        {
          projectId,
          parentSubprojectId,
          subprojectName: item.name.trim(),
          description: '',
          ownerId: item.ownerMemberId,
          status: 'Active',
          plannedStart: schedule.start,
          plannedEnd: schedule.finish,
          deadline: null,
          estimatedHours: null,
          nextAction: ''
        },
        subprojectId
      );
      await setSubprojectSortOrder(tx, subprojectId, item.order);
      mapping.push({ itemId: item.itemId, recordType: 'SUBPROJECT', recordId: subprojectId });
      subprojectIds.push(subprojectId);
      await audit(tx, ctx, {
        entityType: 'SUBPROJECTS',
        entityId: subprojectId,
        action: 'SUBPROJECT_CREATED',
        newValue: {
          subprojectId,
          projectId,
          subprojectName: item.name.trim(),
          source: 'PLANNING_BOARD',
          exportId
        }
      });
      continue;
    }

    const parentItem = item.parentItemId ? index.byId.get(item.parentItemId) : null;
    const parentTaskId =
      parentItem?.type === 'TASK'
        ? mapping.find((entry) => entry.itemId === parentItem.itemId)?.recordId ?? null
        : null;
    const subprojectDraftId = nearestSubprojectId(item.itemId, index);
    const subprojectId = subprojectDraftId
      ? mapping.find((entry) => entry.itemId === subprojectDraftId)?.recordId ?? null
      : null;
    if (!schedule.finish) {
      throw new DomainError('VALIDATION_FAILED', 'Every task needs a finish date');
    }
    const taskId = newTaskId();
    await insertTask(
      tx,
      {
        projectId,
        subprojectId,
        parentTaskId,
        taskName: item.name.trim(),
        description: '',
        ownerMemberId: item.ownerMemberId,
        status: item.ownerMemberId ? 'Assigned' : 'Not Started',
        priority: 'Medium',
        plannedStart: schedule.start,
        dueDate: schedule.finish,
        estimatedHours: null,
        actualHours: null,
        progressPercent: 0,
        acceptanceCriteria: '',
        nextAction: '',
        notificationEnabled: false,
        publicNote: '',
        plannedDurationValue: row.schedule_mode === 'DURATION' ? item.durationValue : null,
        plannedDurationUnit: row.schedule_mode === 'DURATION' ? item.durationUnit ?? 'DAY' : null,
        plannedDurationBasis: row.schedule_mode === 'DURATION' ? item.durationBasis ?? 'WORKING_DAYS' : null,
        plannedStartSource: schedule.startDerived ? 'DERIVED' : schedule.start ? 'MANUAL' : null,
        createdByMemberId: identity.memberId,
        creationChannel: 'MANAGER'
      },
      taskId
    );
    const assignmentIds = [item.ownerMemberId, ...item.assigneeIds].filter(
      (memberId): memberId is string => !!memberId
    );
    if (assignmentIds.length) {
      await setEffectiveAssignees(tx, taskId, assignmentIds, item.ownerMemberId, ctx.identity.email);
    }
    await setTaskSortOrder(tx, taskId, item.order);
    mapping.push({ itemId: item.itemId, recordType: 'TASK', recordId: taskId });
    taskIds.push(taskId);
    await audit(tx, ctx, {
      entityType: 'TASKS',
      entityId: taskId,
      action: 'TASK_CREATED',
      newValue: {
        taskId,
        projectId,
        subprojectId,
        taskName: item.name.trim(),
        source: 'PLANNING_BOARD',
        exportId
      }
    });
  }

  return {
    exportId,
    planId: row.plan_id,
    planRevision: row.revision,
    exportedAt,
    contractVersion: PLAN_CONTRACT_VERSION,
    destination: {
      mode: row.destination_mode,
      projectId,
      projectName,
      divisionId: review.destination.divisionId,
      responsibilityId: row.destination_mode === 'NEW_PROJECT' ? row.responsibility_id : null
    },
    counts: { subprojects: subprojectIds.length, tasks: taskIds.length },
    created: { projectId: createdProjectId, subprojectIds, taskIds },
    mapping
  };
}

export async function exportPlan(
  ctx: ServiceCtx,
  planId: string,
  body: z.infer<typeof ExportPlanBody>
): Promise<PlanExportResult> {
  requireRole(ctx.identity, WRITE_ROLES);
  requireConfirmation(body.confirmed, 'Creating records from a plan requires explicit confirmation');
  const requestHash = hashRequest({ planId, revision: body.revision, reviewToken: body.reviewToken });
  const calendar = createCalendar(await listHolidays(ctx.db));

  const authorize = async (tx: Transaction): Promise<void> => {
    const fresh = await reauthorizeInTransaction(tx, ctx);
    requireRole(fresh.identity, WRITE_ROLES);
    const row = await getPlanDraftRow(tx, planId);
    if (!row || row.author_member_id !== ctx.identity.memberId) {
      throw new DomainError('NOT_FOUND', `Plan not found: ${planId}`);
    }
  };

  const result = await runIdempotent(
    ctx,
    { scope: 'plan.export', key: body.idempotencyKey, request: { planId, revision: body.revision, reviewToken: body.reviewToken } },
    async (tx) => {
      await lockDivisionMutation(tx);
      const fresh = await reauthorizeInTransaction(tx, ctx);
      requireRole(fresh.identity, WRITE_ROLES);
      const row = await lockPlanDraftRow(tx, planId);
      if (!row || row.author_member_id !== ctx.identity.memberId) {
        throw new DomainError('NOT_FOUND', `Plan not found: ${planId}`);
      }
      const prior = await findPlanExportByKey(tx, planId, body.idempotencyKey);
      if (prior) {
        if (prior.request_hash !== requestHash) {
          throw new DomainError(
            'IDEMPOTENCY_REPLAY',
            'This idempotency key was already used for a different request'
          );
        }
        return prior.receipt;
      }
      if (row.status === 'ARCHIVED') {
        throw new DomainError('INVALID_TRANSITION', 'An archived plan cannot create records');
      }
      if (row.status === 'EXPORTED') {
        // A *different* attempt never inherits another attempt's receipt: only the identical
        // idempotency key may replay (handled above and by the idempotency store).
        const existing = await latestPlanExport(tx, planId);
        throw new DomainError('EDIT_CONFLICT', 'This plan has already been created', {
          exportId: existing?.export_id ?? null
        });
      }
      if (row.revision !== body.revision) {
        throw new DomainError('EDIT_CONFLICT', 'The plan changed; review the latest version', {
          expected: body.revision,
          stored: row.revision
        });
      }
      const items = await listPlanItems(tx, planId);
      const review = await buildPlanReview({ ...ctx, divisions: fresh.scope }, tx, row, items, fresh.scope);
      if (review.reviewToken !== body.reviewToken) {
        throw new DomainError(
          'STALE_REQUEST',
          'The plan changed after it was reviewed; review the latest version again'
        );
      }
      if (review.errors.length) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'The plan is not ready to create records',
          { errors: review.errors.slice(0, 20), totalErrors: review.errors.length }
        );
      }
      const divisionId =
        row.destination_mode === 'NEW_PROJECT'
          ? row.division_id
          : (await getProject(tx, row.destination_project_id as string))?.divisionId ?? null;
      if (divisionId) assertWritableDivision(fresh.scope, divisionId);
      await assertPlanAssignments(
        { ...ctx, divisions: fresh.scope },
        tx,
        divisionId,
        items,
        review.destination.projectOwnerId
      );
      const receipt = await createRecordsFromPlan(tx, ctx, fresh.identity, row, items, review, calendar);
      await insertPlanExport(tx, {
        planId,
        planRevision: row.revision,
        idempotencyKey: body.idempotencyKey,
        requestHash,
        receipt
      });
      const updated = await updatePlanDraft(
        tx,
        planId,
        { status: 'EXPORTED', exportedAt: receipt.exportedAt, exportReceipt: receipt },
        row.revision
      );
      if (!updated) throw new DomainError('EDIT_CONFLICT', 'Reload and review; your draft is preserved');
      await audit(tx, ctx, {
        entityType: 'PLAN_DRAFTS',
        entityId: planId,
        action: 'PLAN_EXPORTED',
        previousValue: { status: row.status, revision: row.revision },
        newValue: {
          exportId: receipt.exportId,
          projectId: receipt.destination.projectId,
          subprojects: receipt.counts.subprojects,
          tasks: receipt.counts.tasks
        }
      });
      return receipt;
    },
    { authorize }
  );

  return { receipt: result.data, replayed: result.replayed };
}

/** Retrieves the durable receipt of one export attempt, or the latest one. */
export async function planExportReceipt(
  ctx: ServiceCtx,
  planId: string,
  exportId?: string
): Promise<PlanExportResult> {
  requireRole(ctx.identity, WRITE_ROLES);
  await ownedPlanRow(ctx.db, ctx, planId);
  const row = exportId
    ? await getPlanExportRow(ctx.db, planId, exportId)
    : await latestPlanExport(ctx.db, planId);
  if (!row) throw new DomainError('NOT_FOUND', 'No export receipt exists for this plan');
  return { receipt: row.receipt, replayed: true };
}
