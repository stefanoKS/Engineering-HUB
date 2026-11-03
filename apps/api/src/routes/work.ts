/**
 * Read-only work and project endpoints.
 *
 * Every signed-in role may browse permitted active work here. There is no write path in this
 * module, and the visibility policy (only `INTERNAL`, non-archived projects for MEMBER and VIEWER)
 * is applied on the server before any page is cut.
 */
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TaskListQuery } from '@eh/contracts';
import { actorOf, ok, type AppDependencies } from '../http';
import { sendError } from '../errors';
import { listActiveWork, listWorkProjects, readOnlyProjectDetail, readOnlyTaskDetail } from '../services/work';
import type { ServiceCtx } from '../services/common';

function ctx(request: FastifyRequest): ServiceCtx {
  return {
    db: request.state.db,
    identity: actorOf(request),
    correlationId: request.state.correlationId
  };
}

const ProjectQuery = z.object({
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

const IdParams = z.object({ id: z.string().min(1).max(64) });

export function registerWorkRoutes(app: FastifyInstance, _deps: AppDependencies): void {
  app.get('/api/work/tasks', async (request, reply) => {
    try {
      const query = TaskListQuery.parse(request.query ?? {});
      return ok(reply, request, await listActiveWork(ctx(request), query));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/work/tasks/:id', async (request, reply) => {
    try {
      const { id } = IdParams.parse(request.params ?? {});
      return ok(reply, request, await readOnlyTaskDetail(ctx(request), id));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/work/projects', async (request, reply) => {
    try {
      const query = ProjectQuery.parse(request.query ?? {});
      return ok(reply, request, await listWorkProjects(ctx(request), query));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/work/projects/:id', async (request, reply) => {
    try {
      const { id } = IdParams.parse(request.params ?? {});
      return ok(reply, request, await readOnlyProjectDetail(ctx(request), id));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}
