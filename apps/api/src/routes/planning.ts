/**
 * Planning Board endpoints (計画ボード).
 *
 * Every route re-checks the verified role on the server; the plan itself is readable and writable
 * only by its author. The response shapes come from `@eh/contracts`, and the export is a single
 * command that never loops over the ordinary create endpoints from the browser.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ArchivePlanBody,
  CreatePlanBody,
  ExportPlanBody,
  PlanListQuery,
  ReviewPlanQuery,
  UpdatePlanBody
} from '@eh/contracts';
import { managerOf, ok, type AppDependencies } from '../http';
import { sendError } from '../errors';
import {
  archivePlan,
  createPlan,
  exportPlan,
  getPlan,
  listPlans,
  planExportReceipt,
  reviewPlan,
  savePlan
} from '../services/planning';
import type { ServiceCtx } from '../services/common';

const PlanParams = z.object({ id: z.string().min(1).max(64) }).strict();
const ExportParams = z
  .object({ id: z.string().min(1).max(64), exportId: z.string().min(1).max(64) })
  .strict();

function serviceCtx(request: FastifyRequest): ServiceCtx {
  return {
    db: request.state.db,
    identity: managerOf(request),
    correlationId: request.state.correlationId,
    divisions: request.state.divisions
  };
}

export function registerPlanningRoutes(app: FastifyInstance, _deps: AppDependencies): void {
  app.get('/api/manager/plans', async (request, reply) => {
    try {
      const query = PlanListQuery.parse(request.query ?? {});
      return ok(reply, request, await listPlans(serviceCtx(request), query));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/manager/plans/:id', async (request, reply) => {
    try {
      const { id } = PlanParams.parse(request.params ?? {});
      return ok(reply, request, { plan: await getPlan(serviceCtx(request), id) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/plans', async (request, reply) => {
    try {
      const body = CreatePlanBody.parse(request.body ?? {});
      return ok(reply, request, await createPlan(serviceCtx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.patch('/api/manager/plans/:id', async (request, reply) => {
    try {
      const { id } = PlanParams.parse(request.params ?? {});
      const body = UpdatePlanBody.parse(request.body ?? {});
      return ok(reply, request, await savePlan(serviceCtx(request), id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/plans/:id/archive', async (request, reply) => {
    try {
      const { id } = PlanParams.parse(request.params ?? {});
      const body = ArchivePlanBody.parse(request.body ?? {});
      return ok(reply, request, await archivePlan(serviceCtx(request), id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/manager/plans/:id/review', async (request, reply) => {
    try {
      const { id } = PlanParams.parse(request.params ?? {});
      const query = ReviewPlanQuery.parse(request.query ?? {});
      return ok(reply, request, { review: await reviewPlan(serviceCtx(request), id, query.revision) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/manager/plans/:id/export', async (request, reply) => {
    try {
      const { id } = PlanParams.parse(request.params ?? {});
      const body = ExportPlanBody.parse(request.body ?? {});
      return ok(reply, request, await exportPlan(serviceCtx(request), id, body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/manager/plans/:id/exports', async (request, reply) => {
    try {
      const { id } = PlanParams.parse(request.params ?? {});
      return ok(reply, request, await planExportReceipt(serviceCtx(request), id));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/manager/plans/:id/exports/:exportId', async (request, reply) => {
    try {
      const { id, exportId } = ExportParams.parse(request.params ?? {});
      return ok(reply, request, await planExportReceipt(serviceCtx(request), id, exportId));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}
