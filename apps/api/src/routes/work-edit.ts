import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PatchTaskBody, PatchSubprojectBody, RemoveBody } from '@eh/contracts';
import { getTask, getSubproject, getProject, listSubprojects, listSkills } from '@eh/db';
import { DomainError, requireRole } from '@eh/domain';
import { actorOf, ok } from '../http';
import { sendError } from '../errors';
import { readCtx } from '../services/views';
import { readOnlyTaskDetail } from '../services/work';
import { authorizeWorkEdit } from '../services/work-edit';
import { patchTask, parentTaskOptions } from '../services/tasks';
import { patchSubproject } from '../services/projects';
import { removalPreflight, removeEntity } from '../services/deletion';

function context(request: FastifyRequest) {
  return { ...readCtx(request), identity: requireRole(actorOf(request), 'MEMBER'), correlationId: request.state.correlationId };
}

/** These endpoints expose only the fields needed by the shared task/subproject editors. */
export function registerWorkEditRoutes(app: FastifyInstance): void {
  const get = (path: string, handler: (request: FastifyRequest) => Promise<unknown>) => {
    app.get(path, async (request, reply) => {
      try { return ok(reply, request, await handler(request)); }
      catch (error) { return sendError(reply, request.state, error); }
    });
  };
  get('/api/work/editor/tasks/:id', async request => {
    const ctx = context(request);
    const task = await getTask(ctx.db, (request.params as { id: string }).id);
    if (!task) throw new DomainError('NOT_FOUND', 'Task not found');
    await authorizeWorkEdit(ctx, task.projectId);
    const detail = await readOnlyTaskDetail(ctx, task.taskId);
    return { ...detail, record: { ...detail.record, plannedStart: task.plannedStart }, canWrite: true };
  });
  get('/api/work/editor/subprojects/:id', async request => {
    const ctx = context(request);
    const item = await getSubproject(ctx.db, (request.params as { id: string }).id);
    if (!item || item.status === 'Archived') throw new DomainError('NOT_FOUND', 'Subproject not found');
    await authorizeWorkEdit(ctx, item.projectId);
    return { record: {
      subprojectId: item.subprojectId, projectId: item.projectId, subprojectName: item.subprojectName,
      description: item.description, ownerId: item.ownerId, status: item.status,
      estimatedHours: item.estimatedHours, nextAction: item.nextAction, revision: item.revision
    } };
  });
  get('/api/work/editor/projects/:id', async request => {
    const ctx = context(request);
    const id = (request.params as { id: string }).id;
    await authorizeWorkEdit(ctx, id);
    const project = (await getProject(ctx.db, id))!;
    return { record: { projectId: id, projectName: project.projectName, divisionId: project.divisionId } };
  });
  get('/api/work/editor/references', async request => {
    const ctx = context(request);
    const { projectId } = z.object({ projectId: z.string().min(1).max(64) }).parse(request.query);
    await authorizeWorkEdit(ctx, projectId);
    const project = (await getProject(ctx.db, projectId))!;
    const members = await ctx.db.many<{ memberId: string; name: string; active: boolean; workDivisionIds: string[] }>(
      `SELECT m.member_id AS "memberId", m.name, m.active, ARRAY[d.division_id] AS "workDivisionIds"
         FROM members m JOIN member_divisions d ON d.member_id = m.member_id
        WHERE d.division_id = $1 AND d.access_kind = 'WORK' AND d.removed_at IS NULL
        ORDER BY m.name, m.member_id`, [project.divisionId]);
    const subprojects = (await listSubprojects(ctx.db, projectId)).filter(item => item.status !== 'Archived');
    return { members, skills: (await listSkills(ctx.db)).map(item => ({ skillId: item.skillId, skillName: item.skillName })),
      subprojects: subprojects.map(item => ({ id: item.subprojectId, name: item.subprojectName, projectId, status: item.status, parentId: item.parentSubprojectId })) };
  });
  get('/api/work/editor/parent-options', async request => {
    const ctx = context(request);
    const query = z.object({ projectId: z.string().min(1), subprojectId: z.string().optional(), excludeTaskId: z.string().optional(), query: z.string().max(120).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), selectedId: z.string().optional() }).parse(request.query);
    await authorizeWorkEdit(ctx, query.projectId);
    return parentTaskOptions(ctx, query);
  });
  get('/api/work/removal/preflight', async request => {
    const query = z.object({ entityType: z.enum(['TASKS', 'SUBPROJECTS']), entityId: z.string().min(1).max(64) }).parse(request.query);
    return removalPreflight(context(request), query.entityType, query.entityId);
  });
  for (const kind of ['tasks', 'subprojects'] as const) {
    app.patch(`/api/work/${kind}/:id`, async (request, reply) => {
      try {
        const ctx = context(request);
        const id = (request.params as { id: string }).id;
        if (kind === 'tasks') {
          const task = await patchTask(ctx, id, PatchTaskBody.parse(request.body));
          return ok(reply, request, { task: { taskId: task.taskId, projectId: task.projectId, revision: task.revision } });
        }
        const item = await patchSubproject(ctx, id, PatchSubprojectBody.parse(request.body));
        return ok(reply, request, { subproject: { subprojectId: item.subprojectId, projectId: item.projectId, revision: item.revision } });
      } catch (error) { return sendError(reply, request.state, error); }
    });
    app.post(`/api/work/${kind}/:id/remove`, async (request, reply) => {
      try { return ok(reply, request, await removeEntity(context(request), kind === 'tasks' ? 'TASKS' : 'SUBPROJECTS', (request.params as { id: string }).id, RemoveBody.parse(request.body))); }
      catch (error) { return sendError(reply, request.state, error); }
    });
  }
}
