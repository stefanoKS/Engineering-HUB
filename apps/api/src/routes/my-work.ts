/**
 * Member (employee) work endpoints.
 *
 * Every route re-checks the verified role on the server and answers with a small bounded
 * projection. The member identity, the owner and the project scope come from the session, never
 * from the request body. My Assigned Work is available to every role (a manager keeps a personal
 * list beside the departmental one), while creating a task or a subproject belongs to MEMBER only
 * and progress editing no longer exists: a member finishes work through the reviewed completion
 * request. A member-created subproject is live immediately - creation is not an approval step.
 */
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CreateMySubprojectBody, CreateMyTaskBody } from '@eh/contracts';
import { actorOf, ok, type AppDependencies } from '../http';
import { sendError } from '../errors';
import {
  createMySubproject,
  createMyTask,
  listMyWork,
  myWorkProjectOptions,
  type MyWorkSection
} from '../services/my-work';
import type { ServiceCtx } from '../services/common';

function ctx(request: FastifyRequest): ServiceCtx {
  return {
    db: request.state.db,
    identity: actorOf(request),
    correlationId: request.state.correlationId
  };
}

const PageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  section: z.enum(['active', 'completed']).default('active')
});

export function registerMyWork(app: FastifyInstance, _deps: AppDependencies): void {
  app.get('/api/employee/my-work', async (request, reply) => {
    try {
      const { page, section } = PageQuery.parse(request.query ?? {});
      return ok(reply, request, await listMyWork(ctx(request), page, section as MyWorkSection));
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

  // A MEMBER files a subproject immediately; `POST /api/manager/subprojects` stays manager-only.
  app.post('/api/employee/subprojects', async (request, reply) => {
    try {
      const body = CreateMySubprojectBody.parse(request.body ?? {});
      return ok(reply, request, await createMySubproject(ctx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}
