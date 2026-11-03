/**
 * Read-only work endpoints.
 *
 * Every signed-in role may browse permitted active work here. There is no write path in this
 * module: a mutation is refused by the manager or member command that owns it.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TaskListQuery } from '@eh/contracts';
import { actorOf, ok, type AppDependencies } from '../http';
import { sendError } from '../errors';
import { listActiveWork, readOnlyTaskDetail } from '../services/work';
import type { ServiceCtx } from '../services/common';

function ctx(request: FastifyRequest): ServiceCtx {
  return {
    db: request.state.db,
    identity: actorOf(request),
    correlationId: request.state.correlationId
  };
}

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
      const { id } = request.params as { id: string };
      return ok(reply, request, await readOnlyTaskDetail(ctx(request), id));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}
