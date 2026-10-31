/**
 * Manager endpoints.
 *
 * Every read is a bounded projection and every write is a command that re-checks the verified
 * role on the server. Nothing here trusts a role, actor or owner sent by the browser.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ArchiveBody,
  ApproveAssignmentBody,
  AssessSkillBody,
  AutomationSaveBody,
  ConfirmReasonBody,
  ConfirmScheduleBody,
  CreateProjectBody,
  CreateSkillBody,
  CreateSubprojectBody,
  CreateTaskBody,
  DecisionBody,
  DeleteBody,
  MoveResponsibilityBody,
  OverrideCompleteBody,
  PatchProjectBody,
  PatchSubprojectBody,
  PatchTaskBody,
  ProjectListQuery,
  PublishBody,
  ReconcileBody,
  SaveMemberBody,
  SaveResponsibilityBody,
  TaskListQuery
} from '@eh/contracts';
import {
  compactTaskIndex,
  getMember,
  getProject,
  getResponsibility,
  getSubproject,
  getTask,
  listAssessments,
  listMembersPaged,
  listMilestones,
  listProjectPhases,
  listProjects,
  listSkills,
  listSubprojects,
  listTaskSummaries,
  listTaskSummariesForProject,
  searchTasks
} from '@eh/db';
import { DomainError } from '@eh/domain';
import { managerOf, ok, requireRoleOf, type AppDependencies } from '../http';
import { sendError } from '../errors';
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
  confirmScheduleCommand,
  createTask,
  overrideComplete,
  patchTask,
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
import {
  emergencyStop,
  getAutomation,
  planPreview,
  saveAutomation,
  statusView,
  workloadReport
} from '../services/automation';
import { publicationStatus, publishNow } from '../services/publication';
import { deleteEntity, preflight, reconcileDeletions } from '../services/deletion';
import type { ServiceCtx } from '../services/common';

function serviceCtx(request: FastifyRequest): ServiceCtx {
  return {
    db: request.state.db,
    identity: managerOf(request),
    correlationId: request.state.correlationId
  };
}

async function projectPage(request: FastifyRequest, query: ReturnType<typeof ProjectListQuery.parse>) {
  const ctx = readCtx(request);
  const { scope, dir } = await taskScope(ctx);
  const page = await listProjects(
    request.state.db,
    {
      responsibilityId: query.responsibilityId,
      unassigned: query.unassigned,
      status: query.status,
      query: query.query,
      sort: query.sort,
      direction: query.direction
    },
    query.page,
    query.pageSize
  );
  const byId = new Map(dir.projects.map((project) => [project.projectId, project]));
  return {
    items: page.items.map((project) => {
      const source = byId.get(project.projectId) ?? project;
      return {
        ...buildProjectSummary(source, scope.counts((task) => task.projectId === project.projectId, ctx.today), ctx.today),
        _revision: project.revision
      };
    }),
    total: page.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(page.total / query.pageSize)
  };
}

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
    const query = request.query as { responsibilityId?: string; unassigned?: string };
    return buildOverview(readCtx(request), {
      responsibilityId: query.responsibilityId,
      unassigned: query.unassigned === 'true'
    });
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
    return { items: await listSubprojects(request.state.db, query.projectId) };
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

  app.get('/api/manager/tasks', async (request, reply) => {
    try {
      managerOf(request);
      const query = TaskListQuery.parse(request.query ?? {});
      const result = await listTaskSummaries(request.state.db, query, query.page, query.pageSize);
      return ok(reply, request, {
        items: result.items,
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
    const query = request.query as { projectId?: string; subprojectId?: string; excludeTaskId?: string };
    if (!query.projectId) throw new DomainError('VALIDATION_FAILED', 'projectId is required');
    const summaries = await listTaskSummariesForProject(request.state.db, query.projectId);
    const excluded = new Set<string>(query.excludeTaskId ? [query.excludeTaskId] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const summary of summaries) {
        if (summary.parentTaskId && excluded.has(summary.parentTaskId) && !excluded.has(summary.taskId)) {
          excluded.add(summary.taskId);
          changed = true;
        }
      }
    }
    const items = summaries
      .filter((summary) => !excluded.has(summary.taskId))
      .filter((summary) => !query.subprojectId || summary.subprojectId === query.subprojectId)
      .map((summary) => ({
        id: summary.taskId,
        name: summary.taskName,
        depth: summary.depth,
        container: summary.container,
        status: summary.status
      }));
    return { items };
  });

  read('/api/manager/task-index', async (request) => {
    const index = await compactTaskIndex(request.state.db, 2000);
    return { entries: index.entries, total: index.total, complete: index.entries.length >= index.total };
  });

  read('/api/manager/search/tasks', async (request) => {
    const query = request.query as { query?: string; limit?: string };
    if (!query.query) throw new DomainError('VALIDATION_FAILED', 'query is required');
    const limit = Math.min(Number(query.limit ?? 20), 50);
    return { items: await searchTasks(request.state.db, query.query, limit) };
  });

  app.get('/api/manager/tasks/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(reply, request, await taskDetail(serviceCtx(request), id));
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

  app.post('/api/manager/tasks/:id/override-complete', async (request, reply) => {
    try {
      const body = OverrideCompleteBody.parse(request.body ?? {});
      const { id } = request.params as { id: string };
      return ok(reply, request, { task: await overrideComplete(serviceCtx(request), id, body) });
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

  read('/api/manager/editor', async (request) => {
    const query = request.query as { type?: string; id?: string };
    const id = String(query.id ?? '');
    if (!id) throw new DomainError('VALIDATION_FAILED', 'id is required');
    const db = request.state.db;
    const record =
      query.type === 'task'
        ? await getTask(db, id)
        : query.type === 'project'
          ? await getProject(db, id)
          : query.type === 'member'
            ? await getMember(db, id)
            : query.type === 'responsibility'
              ? await getResponsibility(db, id)
              : query.type === 'subproject'
                ? await getSubproject(db, id)
                : null;
    if (!record) throw new DomainError('NOT_FOUND', `Record not found: ${id}`);
    return { record: { ...record, _revision: record.revision } };
  });

  read('/api/manager/references', async (request) => {
    const dir = await directory(readCtx(request));
    return {
      responsibilities: dir.responsibilities.map((entry) => ({
        id: entry.responsibilityId,
        name: entry.name,
        status: entry.status
      })),
      members: dir.members.map((entry) => ({
        memberId: entry.memberId,
        name: entry.name,
        active: entry.active,
        role: entry.role
      })),
      skills: dir.skills,
      subprojects: dir.subprojects.map((entry) => ({
        id: entry.subprojectId,
        name: entry.subprojectName,
        status: entry.status,
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
      const query = request.query as { includeDecided?: string };
      const data = await queue(serviceCtx(request), deps.inbox, {
        includeDecided: query.includeDecided === 'true',
        import: false
      });
      return ok(reply, request, data);
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/requests/sync', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { includeDecided?: boolean };
      const data = await queue(serviceCtx(request), deps.inbox, {
        includeDecided: body.includeDecided === true,
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
      const workout = await workloadReport(serviceCtx(request));
      return ok(reply, request, { refreshedAt: new Date().toISOString(), workload: workout });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  read('/api/manager/reports/workload', async (request) => workloadReport(serviceCtx(request)));

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

  app.post('/api/manager/deletion/reconcile', async (request, reply) => {
    try {
      const body = ReconcileBody.parse(request.body ?? {});
      return ok(reply, request, await reconcileDeletions(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}

void listTaskSummariesForProject;
