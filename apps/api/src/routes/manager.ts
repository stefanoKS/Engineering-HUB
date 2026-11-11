/**
 * Manager endpoints.
 *
 * Every read is a bounded projection and every write is a command that re-checks the verified
 * role on the server. Nothing here trusts a role, actor or owner sent by the browser.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ArchiveBody,
  ApproveAssignmentBody,
  AssessSkillBody,
  AutomationSaveBody,
  CompleteTaskBody,
  ConfirmReasonBody,
  ConfirmScheduleBody,
  CreateProjectBody,
  CreateSkillBody,
  CreateSubprojectBody,
  CreateTaskBody,
  DecisionBody,
  DeleteBody,
  DeleteResponsibilityBody,
  EditorQuery,
  MoveResponsibilityBody,
  MoveDivisionBody,
  OverrideCompleteBody,
  PatchProjectBody,
  PatchSubprojectBody,
  PatchTaskBody,
  ProjectListQuery,
  RequestQueueQuery,
  PublishBody,
  ReconcileBody,
  RemoveBody,
  ReopenTaskBody,
  SaveDivisionBody,
  SaveMemberBody,
  SaveResponsibilityBody,
  TaskListQuery,
  TransferProjectDivisionBody,
  MappingApplyBody,
  MappingPreviewBody,
  OverviewQuery,
  WorkloadDrilldownQuery,
  WorkloadQuery
} from '@eh/contracts';
import {
  compactTaskIndex,
  getMember,
  getProject,
  getResponsibility,
  getSubproject,
  getTask,
  listAssessments,
  listDivisions,
  listMembersPaged,
  listMilestones,
  listProjectPhases,
  listProjects,
  listSkills,
  listSubprojects,
  listTaskSummaries,
  listTaskTreeSummaries,
  listTaskSummariesForProject,
  memberDivisionNames,
  memberWorkDivisionIds,
  searchTasks
} from '@eh/db';
import { DomainError, assertReadableDivision, assertWritableDivision, canWriteDivision, readableDivisionIds } from '@eh/domain';
import { managerOf, ok, requireRoleOf, type AppDependencies } from '../http';
import { sendError } from '../errors';
import {
  createDivision,
  memberGrantsForEditor,
  moveDivision,
  requestedDivision,
  saveDivision,
  setDivisionStatus,
  transferProjectDivision
} from '../services/divisions';
import {
  buildBootstrap,
  buildMemberProfile,
  buildOverview,
  buildProjectDetail,
  buildProjectSummary,
  directory,
  readCtx,
  taskScope
} from '../services/views';
import {
  archiveProjectCommand,
  createProject,
  createSubproject,
  patchProject,
  patchSubproject,
  setSubprojectStatus
} from '../services/projects';
import {
  approveAssignmentCommand,
  completeTaskDirectly,
  confirmScheduleCommand,
  createTask,
  overrideComplete,
  parentTaskOptions,
  patchTask,
  reopenEligibility,
  reopenTask,
  taskDetail
} from '../services/tasks';
import {
  assessSkill,
  createSkill,
  moveResponsibility,
  saveMember,
  saveResponsibility,
  setResponsibilityStatus
} from '../services/directory';
import { decideRequest, queue } from '../services/requests';
import { applyMapping, mappingView } from '../services/division-mapping';
import {
  emergencyStop,
  getAutomation,
  planPreview,
  saveAutomation,
  statusView
} from '../services/automation';
import { workloadDrilldown, workloadReport } from '../services/workload';
import { publicationStatus, publishNow } from '../services/publication';
import {
  deleteEntity,
  deleteResponsibility,
  preflight,
  reconcileDeletions,
  removalPreflight,
  removeEntity,
  responsibilityPreflight
} from '../services/deletion';
import type { ServiceCtx } from '../services/common';

function serviceCtx(request: FastifyRequest): ServiceCtx {
  return {
    db: request.state.db,
    identity: managerOf(request),
    correlationId: request.state.correlationId,
    divisions: request.state.divisions
  };
}

/** A bounded, searchable parent selector: search and paging apply before any result is cut. */
const ParentOptionsQuery = z.object({
  projectId: z.string().trim().min(1).max(64),
  subprojectId: z.string().trim().max(64).optional(),
  excludeTaskId: z.string().trim().max(64).optional(),
  query: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  selectedId: z.string().trim().max(64).optional()
});

/**
 * The division of every project the caller may read, from the request-local directory read.
 * One read per request, so a page of tasks costs no extra query per row.
 */
async function projectDivisionLookup(request: FastifyRequest): Promise<(projectId: string) => string | null> {
  const { dir } = await taskScope(readCtx(request));
  const byProject = new Map(dir.projects.map((project) => [project.projectId, project.divisionId ?? null]));
  return (projectId: string) => byProject.get(projectId) ?? null;
}

async function projectPage(request: FastifyRequest, query: ReturnType<typeof ProjectListQuery.parse>) {  const ctx = readCtx(request);
  const { scope, dir } = await taskScope(ctx);
  const page = await listProjects(
    request.state.db,
    {
      responsibilityId: query.responsibilityId,
      unassigned: query.unassigned,
      status: query.status,
      schedule: query.schedule,
      query: query.query,
      divisionIds: requestedDivision(ctx, query.divisionId),
      sort: query.sort,
      direction: query.direction
    },
    query.page,
    query.pageSize,
    ctx.today
  );
  const byId = new Map(dir.projects.map((project) => [project.projectId, project]));
  return {
    items: page.items.map((project) => {
      const source = byId.get(project.projectId) ?? project;
      return {
        ...buildProjectSummary(source, scope.counts((task) => task.projectId === project.projectId, ctx.today), ctx.today),
        // Mixed- and all-division lists resolve the write availability per record, so a manager who
        // may only read one division is never offered an edit there. The shell's selected division
        // is not evidence of a record's permission.
        canWrite: canWriteDivision(request.state.divisions, source.divisionId ?? null),
        _revision: project.revision
      };
    }),
    total: page.total,
    groupTotals: page.groupTotals,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(page.total / query.pageSize)
  };
}

/** The read-only mapping view query: scalar filters, so it stays a plain bounded GET. */
const MappingListQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    includeArchived: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
    entityType: z.enum(['ALL', 'RESPONSIBILITY', 'PROJECT']).default('ALL'),
    divisionId: z.string().trim().max(64).optional(),
    responsibilityId: z.string().trim().max(64).optional(),
    projectId: z.string().trim().max(64).optional()
  })
  .strict();

export function registerManagerRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const read = (path: string, handler: (request: FastifyRequest) => Promise<unknown>): void => {
    app.get(path, async (request, reply) => {
      try {
        managerOf(request);
        return ok(reply, request, await handler(request));
      } catch (error) {
        return sendError(reply, request.state, error);
      }
    });
  };

  read('/api/manager/bootstrap', async (request) =>
    buildBootstrap(readCtx(request), managerOf(request), deps.config.appEnv)
  );

  read('/api/manager/overview', async (request) => {
    const query = OverviewQuery.parse(request.query ?? {});
    return buildOverview(readCtx(request), query);
  });

  app.get('/api/manager/projects', async (request, reply) => {
    try {
      managerOf(request);
      const query = ProjectListQuery.parse(request.query ?? {});
      return ok(reply, request, await projectPage(request, query));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/projects/:id', async (request) => {
    const { id } = request.params as { id: string };
    const project = await getProject(request.state.db, id);
    if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${id}`);
    const detail = await buildProjectDetail(readCtx(request), project);
    return {
      ...detail,
      canWrite: canWriteDivision(request.state.divisions, project.divisionId ?? null),
      milestones: await listMilestones(request.state.db, id),
      phases: await listProjectPhases(request.state.db, id)
    };
  });

  app.post('/api/manager/projects', async (request, reply) => {
    try {
      const body = CreateProjectBody.parse(request.body ?? {});
      return ok(reply, request, await createProject(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/manager/projects/:id', async (request, reply) => {
    try {
      const body = PatchProjectBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { project: await patchProject(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/projects/:id/archive', async (request, reply) => {
    try {
      const body = ArchiveBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { project: await archiveProjectCommand(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.delete('/api/manager/projects/:id', async (request, reply) => {
    try {
      const body = DeleteBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await deleteEntity(serviceCtx(request), 'PROJECTS', id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/subprojects', async (request) => {
    const query = request.query as { projectId?: string };
    if (query.projectId) {
      const project = await getProject(request.state.db, query.projectId);
      if (!project) throw new DomainError('NOT_FOUND', `Project not found: ${query.projectId}`);
      assertReadableDivision(request.state.divisions, project.divisionId);
    }
    return {
      items: await listSubprojects(
        request.state.db,
        query.projectId,
        readableDivisionIds(request.state.divisions)
      )
    };
  });

  app.post('/api/manager/subprojects', async (request, reply) => {
    try {
      const body = CreateSubprojectBody.parse(request.body ?? {});
      return ok(reply, request, await createSubproject(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/manager/subprojects/:id', async (request, reply) => {
    try {
      const body = PatchSubprojectBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { subproject: await patchSubproject(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  for (const action of ['archive', 'reactivate'] as const) {
    app.post(`/api/manager/subprojects/:id/${action}`, async (request, reply) => {
      try {
        const body = ConfirmReasonBody.parse(request.body ?? {});
        const { id } = request.params as { id: string };
        const subproject = await setSubprojectStatus(serviceCtx(request), id, {
          revision: body.revision,
          confirmed: true,
          status: action === 'archive' ? 'Archived' : 'Active',
          reason: body.reason
        });
        return ok(reply, request, { subproject });
      } catch (error) {
        return sendError(reply, request.state, error);
      }
    });
  }

  app.delete('/api/manager/subprojects/:id', async (request, reply) => {
    try {
      const body = DeleteBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await deleteEntity(serviceCtx(request), 'SUBPROJECTS', id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/admin/subprojects/:id/purge', async (request, reply) => {
    try {
      const body = DeleteBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await deleteEntity(serviceCtx(request), 'SUBPROJECTS', id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/admin/subprojects/:id/remove', async (request, reply) => {
    try {
      const body = RemoveBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await removeEntity(serviceCtx(request), 'SUBPROJECTS', id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/manager/tasks', async (request, reply) => {
    try {
      managerOf(request);
      const query = TaskListQuery.parse(request.query ?? {});
      const filters = {
        ...query,
        today: readCtx(request).today,
        // One narrowing rule: a client-supplied division can only narrow the resolved scope and
        // an unauthorized one is refused before paging, totals or the tree are computed.
        divisionIds: requestedDivision(request.state, query.divisionId)
      };
      const result = query.tree === 'true'
        ? await listTaskTreeSummaries(request.state.db, filters, query.treeParentId, query.page, query.pageSize)
        : await listTaskSummaries(request.state.db, filters, query.page, query.pageSize);
      // A task's write availability follows its project's division, resolved per record so a mixed
      // list never offers an action the server would refuse.
      const divisionOf = await projectDivisionLookup(request);
      return ok(reply, request, {
        items: result.items.map((item) => ({
          ...item,
          canWrite: canWriteDivision(request.state.divisions, divisionOf(item.projectId))
        })),
        ...('matchedTotal' in result ? { matchedTotal: result.matchedTotal } : {}),
        total: result.total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(result.total / query.pageSize)
      });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/tasks/parent-options', async (request) => {
    const query = ParentOptionsQuery.parse(request.query ?? {});
    return parentTaskOptions(serviceCtx(request), query);
  });

  read('/api/manager/task-index', async (request) => {
    const index = await compactTaskIndex(
      request.state.db,
      2000,
      readableDivisionIds(request.state.divisions)
    );
    return { entries: index.entries, total: index.total, complete: index.entries.length >= index.total };
  });

  read('/api/manager/search/tasks', async (request) => {
    const query = request.query as { query?: string; limit?: string };
    if (!query.query) throw new DomainError('VALIDATION_FAILED', 'query is required');
    const limit = Math.min(Number(query.limit ?? 20), 50);
    return {
      items: await searchTasks(
        request.state.db,
        query.query,
        limit,
        readableDivisionIds(request.state.divisions)
      )
    };
  });

  app.get('/api/manager/tasks/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const detail = await taskDetail(serviceCtx(request), id);
      const divisionOf = await projectDivisionLookup(request);
      return ok(reply, request, {
        ...detail,
        canWrite: canWriteDivision(request.state.divisions, divisionOf(detail.context.projectId))
      });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/tasks', async (request, reply) => {
    try {
      const body = CreateTaskBody.parse(request.body ?? {});
      return ok(reply, request, await createTask(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/manager/tasks/:id', async (request, reply) => {
    try {
      const body = PatchTaskBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { task: await patchTask(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/tasks/:id/approve', async (request, reply) => {
    try {
      const body = ApproveAssignmentBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { task: await approveAssignmentCommand(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/tasks/:id/confirm-schedule', async (request, reply) => {
    try {
      const body = ConfirmScheduleBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { task: await confirmScheduleCommand(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/tasks/:id/complete', async (request, reply) => {
    try {
      const body = CompleteTaskBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { task: await completeTaskDirectly(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/tasks/:id/override-complete', async (request, reply) => {
    try {
      const body = OverrideCompleteBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { task: await overrideComplete(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  /**
   * Corrective reopening is an ADMIN capability; both routes re-check the verified role, and the
   * command re-reads the task, the project and the revision inside its own transaction.
   */
  read('/api/manager/tasks/:id/reopen-eligibility', async (request) =>
    reopenEligibility(serviceCtx(request), (request.params as { id: string }).id)
  );

  app.post('/api/manager/tasks/:id/reopen', async (request, reply) => {
    try {
      const body = ReopenTaskBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await reopenTask(serviceCtx(request), id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.delete('/api/manager/tasks/:id', async (request, reply) => {
    try {
      const body = DeleteBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await deleteEntity(serviceCtx(request), 'TASKS', id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/admin/tasks/:id/purge', async (request, reply) => {
    try {
      const body = DeleteBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await deleteEntity(serviceCtx(request), 'TASKS', id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/admin/tasks/:id/remove', async (request, reply) => {
    try {
      const body = RemoveBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await removeEntity(serviceCtx(request), 'TASKS', id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  /**
   * The narrow editor read: one entity-specific authorization *before* anything is returned.
   *
   * The generic route type is not an authorization: a task or subproject is authorized through its
   * project division, a project and a responsibility through their own division, and the member
   * editor stays an ADMIN-only directory projection. Read access alone never yields an edit form.
   */
  read('/api/manager/editor', async (request) => {
    const query = EditorQuery.parse(request.query ?? {});
    const id = query.id;
    const db = request.state.db;
    const ctx = serviceCtx(request);
    // A record outside the caller's readable divisions answers like an unknown one; a record inside
    // a read-only division is an authorization refusal. Either way no edit form is built.
    const authorize = (divisionId: string | null): void => {
      assertReadableDivision(ctx.divisions, divisionId);
      assertWritableDivision(ctx.divisions, divisionId);
    };
    const projectDivision = async (projectId: string): Promise<string | null> => {
      const project = await getProject(db, projectId);
      if (!project) throw new DomainError('NOT_FOUND', `Record not found: ${id}`);
      return project.divisionId ?? null;
    };
    switch (query.type) {
      case 'task': {
        const task = await getTask(db, id);
        if (!task) throw new DomainError('NOT_FOUND', `Record not found: ${id}`);
        authorize(await projectDivision(task.projectId));
        return { record: { ...task, _revision: task.revision } };
      }
      case 'subproject': {
        const subproject = await getSubproject(db, id);
        if (!subproject) throw new DomainError('NOT_FOUND', `Record not found: ${id}`);
        authorize(await projectDivision(subproject.projectId));
        return { record: { ...subproject, _revision: subproject.revision } };
      }
      case 'project': {
        const project = await getProject(db, id);
        if (!project) throw new DomainError('NOT_FOUND', `Record not found: ${id}`);
        authorize(project.divisionId ?? null);
        return { record: { ...project, _revision: project.revision } };
      }
      case 'responsibility': {
        const responsibility = await getResponsibility(db, id);
        if (!responsibility) throw new DomainError('NOT_FOUND', `Record not found: ${id}`);
        authorize(responsibility.divisionId);
        return { record: { ...responsibility, _revision: responsibility.revision } };
      }
      case 'member': {
        // Division grants, a role and an e-mail address are administrative data, never a
        // manager's directory read.
        requireRoleOf(request, 'ADMIN');
        const { member } = await memberGrantsForEditor(id, db);
        if (!member) throw new DomainError('NOT_FOUND', `Record not found: ${id}`);
        return { record: { ...member, _revision: member.revision } };
      }
      default:
        throw new DomainError('VALIDATION_FAILED', 'Unknown editor type');
    }
  });

  read('/api/manager/references', async (request) => {
    const dir = await directory(readCtx(request));
    // Two bounded reads supply the membership facts an assignment selector needs; they never
    // carry an access kind, an e-mail address or an identifier the caller may not read.
    const memberIds = dir.members.map((entry) => entry.memberId);
    const [divisionNames, workDivisionIds] = await Promise.all([
      memberDivisionNames(request.state.db, memberIds),
      memberWorkDivisionIds(request.state.db, memberIds)
    ]);
    return {
      responsibilities: dir.responsibilities.map((entry) => ({
        id: entry.responsibilityId,
        name: entry.name,
        status: entry.status,
        divisionId: entry.divisionId ?? null
      })),
      members: dir.members.map((entry) => ({
        memberId: entry.memberId,
        name: entry.name,
        active: entry.active,
        role: entry.role,
        employeeId: entry.employeeId,
        divisionNames: divisionNames.get(entry.memberId) ?? [],
        workDivisionIds: workDivisionIds.get(entry.memberId) ?? []
      })),
      skills: dir.skills,
      subprojects: dir.subprojects.map((entry) => ({
        id: entry.subprojectId,
        name: entry.subprojectName,
        status: entry.status,
        projectId: entry.projectId,
        parentId: entry.parentSubprojectId
      }))
    };
  });

  app.get('/api/manager/members', async (request, reply) => {
    try {
      requireRoleOf(request, 'MANAGER');
      const query = request.query as { query?: string; page?: string; pageSize?: string };
      const page = Math.max(1, Number(query.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 25)));
      const result = await listMembersPaged(request.state.db, { query: query.query, page, pageSize });
      return ok(reply, request, {
        items: result.items.map((member) => ({ ...member, _revision: member.revision })),
        total: result.total,
        page,
        pageSize,
        totalPages: Math.ceil(result.total / pageSize)
      });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/members', async (request, reply) => {
    try {
      const body = SaveMemberBody.parse(request.body ?? {});
      return ok(reply, request, await saveMember(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/manager/members/:id', async (request, reply) => {
    try {
      const body = SaveMemberBody.parse({
        ...(request.body ?? {}),
        memberId: (request.params as { id: string }).id
      });
      return ok(reply, request, await saveMember(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/responsibilities', async (request) => {
    const dir = await directory(readCtx(request));
    return { items: dir.responsibilities.map((entry) => ({ ...entry, _revision: entry.revision })) };
  });

  app.post('/api/manager/responsibilities', async (request, reply) => {
    try {
      const body = SaveResponsibilityBody.parse(request.body ?? {});
      return ok(reply, request, await saveResponsibility(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/manager/responsibilities/:id', async (request, reply) => {
    try {
      const body = SaveResponsibilityBody.parse({
        ...(request.body ?? {}),
        responsibilityId: (request.params as { id: string }).id
      });
      return ok(reply, request, await saveResponsibility(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/manager/responsibilities/:id/order', async (request, reply) => {
    try {
      const body = MoveResponsibilityBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { responsibility: await moveResponsibility(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  for (const action of ['retire', 'reactivate'] as const) {
    app.post(`/api/manager/responsibilities/:id/${action}`, async (request, reply) => {
      try {
        const body = ConfirmReasonBody.parse(request.body ?? {});
        const { id } = request.params as { id: string };
        const responsibility = await setResponsibilityStatus(serviceCtx(request), id, {
          revision: body.revision,
          confirmed: true,
          status: action === 'retire' ? 'Retired' : 'Active',
          reason: body.reason
        });
        return ok(reply, request, { responsibility });
      } catch (error) {
        return sendError(reply, request.state, error);
      }
    });
  }

  app.get('/api/admin/responsibilities/:id/delete-preflight', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(reply, request, await responsibilityPreflight(serviceCtx(request), id));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.delete('/api/admin/responsibilities/:id', async (request, reply) => {
    try {
      const body = DeleteResponsibilityBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await deleteResponsibility(serviceCtx(request), id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/skills', async (request) => {
    const [items, assessments] = await Promise.all([
      listSkills(request.state.db),
      listAssessments(request.state.db)
    ]);
    return { items, assessments };
  });

  app.post('/api/manager/skills', async (request, reply) => {
    try {
      const body = CreateSkillBody.parse(request.body ?? {});
      return ok(reply, request, { skill: await createSkill(serviceCtx(request), body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/skills/assess', async (request, reply) => {
    try {
      const body = AssessSkillBody.parse(request.body ?? {});
      return ok(reply, request, await assessSkill(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/manager/requests', async (request, reply) => {
    try {
      const query = RequestQueueQuery.parse(request.query);
      const data = await queue(serviceCtx(request), deps.inbox, {
        ...query,
        import: false
      });
      return ok(reply, request, data);
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/requests/sync', async (request, reply) => {
    try {
      const body = RequestQueueQuery.parse(request.body ?? {});
      const data = await queue(serviceCtx(request), deps.inbox, {
        ...body,
        import: true
      });
      return ok(reply, request, data);
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/requests/:id/decide', async (request, reply) => {
    try {
      const body = DecisionBody.parse({
        ...(request.body ?? {}),
        requestId: (request.params as { id: string }).id
      });
      return ok(reply, request, await decideRequest(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/automation', async (request) => getAutomation(serviceCtx(request)));

  app.put('/api/manager/automation', async (request, reply) => {
    try {
      const body = AutomationSaveBody.parse(request.body ?? {});
      return ok(reply, request, await saveAutomation(serviceCtx(request), deps.config, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/automation/emergency-stop', async (request, reply) => {
    try {
      return ok(reply, request, await emergencyStop(serviceCtx(request)));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/publication', async (request) => publicationStatus(serviceCtx(request), deps.config));

  app.post('/api/manager/publication/publish', async (request, reply) => {
    try {
      const body = PublishBody.parse(request.body ?? {});
      return ok(reply, request, await publishNow(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/status', async (request) => statusView(serviceCtx(request), deps.config));

  app.post('/api/manager/reports/refresh', async (request, reply) => {
    try {
      const query = WorkloadQuery.parse(request.query ?? {});
      const workload = await workloadReport(serviceCtx(request), query);
      return ok(reply, request, { refreshedAt: new Date().toISOString(), workload });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/reports/workload', async (request) => {
    const query = WorkloadQuery.parse(request.query ?? {});
    return workloadReport(serviceCtx(request), query);
  });

  read('/api/manager/reports/workload/tasks', async (request) => {
    const query = WorkloadDrilldownQuery.parse(request.query ?? {});
    return workloadDrilldown(serviceCtx(request), query);
  });

  read('/api/manager/plan/preview', async (request) => {
    const query = request.query as {
      deadline?: string;
      durationValue?: string;
      durationUnit?: string;
      durationBasis?: string;
    };
    return planPreview(serviceCtx(request), {
      deadline: query.deadline,
      durationValue: query.durationValue ? Number(query.durationValue) : undefined,
      durationUnit: query.durationUnit,
      durationBasis: query.durationBasis
    });
  });

  read('/api/manager/members/:id/profile', async (request) => {
    const { id } = request.params as { id: string };
    const member = await getMember(request.state.db, id);
    if (!member) throw new DomainError('NOT_FOUND', `Member not found: ${id}`);
    return buildMemberProfile(readCtx(request), member);
  });

  read('/api/manager/deletion/preflight', async (request) => {
    const query = request.query as { entityType?: string; entityId?: string };
    const type = query.entityType as 'PROJECTS' | 'SUBPROJECTS' | 'TASKS';
    if (!query.entityId || !['PROJECTS', 'SUBPROJECTS', 'TASKS'].includes(String(type))) {
      throw new DomainError('VALIDATION_FAILED', 'entityType and entityId are required');
    }
    return preflight(serviceCtx(request), type, query.entityId);
  });

  read('/api/manager/removal/preflight', async (request) => {
    const query = request.query as { entityType?: string; entityId?: string };
    if (query.entityType !== 'TASKS' && query.entityType !== 'SUBPROJECTS') {
      throw new DomainError('VALIDATION_FAILED', 'entityType must be TASKS or SUBPROJECTS');
    }
    if (!query.entityId) throw new DomainError('VALIDATION_FAILED', 'entityId is required');
    return removalPreflight(serviceCtx(request), query.entityType, query.entityId);
  });

  app.post('/api/manager/deletion/reconcile', async (request, reply) => {
    try {
      const body = ReconcileBody.parse(request.body ?? {});
      return ok(reply, request, await reconcileDeletions(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  /* ------------------------------ divisions ------------------------------ */

  /** The division administration screen: ADMIN sees every division, retired included. */
  read('/api/manager/divisions', async (request) => {
    requireRoleOf(request, 'ADMIN');
    const items = await listDivisions(request.state.db, { includeRetired: true });
    return { items: items.map((division) => ({ ...division, _revision: division.revision })) };
  });

  app.post('/api/admin/divisions', async (request, reply) => {
    try {
      const body = SaveDivisionBody.parse(request.body ?? {});
      return ok(reply, request, await createDivision(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/admin/divisions/:id', async (request, reply) => {
    try {
      const body = SaveDivisionBody.parse({
        ...(request.body ?? {}),
        divisionId: (request.params as { id: string }).id
      });
      return ok(reply, request, await saveDivision(serviceCtx(request), (request.params as { id: string }).id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/admin/divisions/:id/order', async (request, reply) => {
    try {
      const body = MoveDivisionBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { division: await moveDivision(serviceCtx(request), id, body) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  for (const action of ['retire', 'reactivate'] as const) {
    app.post(`/api/admin/divisions/:id/${action}`, async (request, reply) => {
      try {
        const body = ConfirmReasonBody.parse(request.body ?? {});
        const { id } = request.params as { id: string };
        const division = await setDivisionStatus(serviceCtx(request), id, {
          revision: body.revision,
          confirmed: true,
          status: action === 'retire' ? 'Retired' : 'Active',
          reason: body.reason
        });
        return ok(reply, request, { division });
      } catch (error) {
        return sendError(reply, request.state, error);
      }
    });
  }

  /**
   * An explicit ADMIN transfer. Ordinary project editing never exposes a persisted project's
   * division, and the transfer refuses the whole move when an owner or assignee would become
   * ineligible.
   */
  /* --------------------- unmapped-work division mapping -------------------- */

  /**
   * The read-only mapping view: unmapped counts, paginated records and a proposal per record.
   * Opening it mutates nothing. A single record identifier narrows the explanation to that record;
   * the multi-record preview uses the POST form.
   */
  read('/api/admin/divisions/unmapped', async (request) => {
    requireRoleOf(request, 'ADMIN');
    const query = MappingListQuery.parse(request.query ?? {});
    return mappingView(serviceCtx(request), {
      ...(query.divisionId ? { divisionId: query.divisionId } : {}),
      ...(query.responsibilityId ? { responsibilityIds: [query.responsibilityId] } : {}),
      ...(query.projectId ? { projectIds: [query.projectId] } : {}),
      includeArchived: query.includeArchived,
      page: query.page,
      pageSize: query.pageSize,
      entityType: query.entityType
    });
  });

  /** The same preview for an explicit multi-record selection. Read-only. */
  app.post('/api/admin/divisions/mapping/preview', async (request, reply) => {
    try {
      requireRoleOf(request, 'ADMIN');
      const body = MappingPreviewBody.parse(request.body ?? {});
      return ok(reply, request, await mappingView(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  /**
   * The reviewed apply. Bound to the record IDs, target IDs and revisions the administrator saw,
   * gated by a verified backup and applied as one all-or-nothing transaction.
   */
  app.post('/api/admin/divisions/mapping/apply', async (request, reply) => {
    try {
      requireRoleOf(request, 'ADMIN');
      const body = MappingApplyBody.parse(request.body ?? {});
      return ok(reply, request, await applyMapping(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/admin/projects/:id/transfer-division', async (request, reply) => {
    try {
      const body = TransferProjectDivisionBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, await transferProjectDivision(serviceCtx(request), id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}

void listTaskSummariesForProject;
