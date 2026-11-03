/**
 * Member (employee) work endpoints.
 *
 * Every route re-checks the verified role on the server and answers with a small bounded
 * projection. The member identity, the owner and the project scope come from the session, never
 * from the request body.
 */
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CreateMyTaskBody } from '@eh/contracts';
import { actorOf, ok, type AppDependencies } from '../http';
import { sendError } from '../errors';
import { createMyTask, listMyWork, myWorkProjectOptions, updateMyWork } from '../services/my-work';
import type { ServiceCtx } from '../services/common';

function ctx(request: FastifyRequest): ServiceCtx {
  return {
    db: request.state.db,
    identity: actorOf(request),
    correlationId: request.state.correlationId
  };
}

const PageQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) });
const IdParams = z.object({ id: z.string().min(1).max(100) });
const ProgressBody = z
  .object({
    revision: z.number().int().positive(),
    progressPercent: z.number().min(0).max(99),
    actualHours: z.number().min(0).max(99999)
  })
  .strict();

export function registerMyWork(app: FastifyInstance, _deps: AppDependencies): void {
  app.get('/api/employee/my-work', async (request, reply) => {
    try {
      const { page } = PageQuery.parse(request.query ?? {});
      return ok(reply, request, await listMyWork(ctx(request), page));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/employee/my-work/projects', async (request, reply) => {
    try {
      return ok(reply, request, await myWorkProjectOptions(ctx(request)));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/employee/my-work', async (request, reply) => {
    try {
      const body = CreateMyTaskBody.parse(request.body ?? {});
      return ok(reply, request, await createMyTask(ctx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/employee/my-work/:id', async (request, reply) => {
    try {
      const { id } = IdParams.parse(request.params ?? {});
      const body = ProgressBody.parse(request.body ?? {});
      return ok(reply, request, await updateMyWork(ctx(request), id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}
