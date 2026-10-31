/** Employee endpoints: published tasks, request submission and receipt. */
import type { FastifyInstance } from 'fastify';
import { SubmitRequestBody } from '@eh/contracts';
import { DomainError } from '@eh/domain';
import { actorOf, ok, type AppDependencies } from '../http';
import { sendError } from '../errors';
import { employeeSnapshot, requestReceipt, submitRequest } from '../services/requests';
import type { ServiceCtx } from '../services/common';

function ctx(request: Parameters<typeof actorOf>[0]): ServiceCtx {
  return {
    db: request.state.db,
    identity: actorOf(request),
    correlationId: request.state.correlationId
  };
}

export function registerEmployeeRoutes(app: FastifyInstance, _deps: AppDependencies): void {
  app.get('/api/employee/snapshot', async (request, reply) => {
    try {
      actorOf(request);
      return ok(reply, request, await employeeSnapshot(ctx(request)));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/employee/requests', async (request, reply) => {
    try {
      const body = SubmitRequestBody.parse(request.body ?? {});
      return ok(reply, request, await submitRequest(ctx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/employee/requests/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      if (!id) throw new DomainError('VALIDATION_FAILED', 'A request ID is required');
      return ok(reply, request, await requestReceipt(ctx(request), id));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}
