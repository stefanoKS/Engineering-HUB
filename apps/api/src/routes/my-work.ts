/**
 * Member (employee) work endpoints.
 *
 * Every route re-checks the verified role on the server and answers with a small bounded
 * projection. The member identity, the owner and the project scope come from the session, never
 * from the request body. My Assigned Work is available to every role (a manager keeps a personal
 * list beside the departmental one), while creating a project, a task or a subproject belongs to
 * MEMBER only and progress editing no longer exists: a member finishes work through the reviewed
 * completion request. A member-created record is live immediately - creation is not an approval
 * step. Editing, archiving, deleting and reopening stay manager or ADMIN capabilities.
 */
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CreateMyProjectBody, CreateMySubprojectBody, CreateMyTaskBody } from '@eh/contracts';
import { actorOf, ok, type AppDependencies } from '../http';
import { sendError } from '../errors';
import {
  createMyProject,
  createMySubproject,
  createMyTask,
  listMyWork,
  listMyWorkProjectFilter,
  myWorkProjectFormOptions,
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

const Flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

const PageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  section: z.enum(['active', 'completed']).default('active'),
  query: z.string().trim().max(120).optional(),
  projectId: z.string().trim().max(64).optional(),
  overdue: Flag,
  dueThisWeek: Flag,
  awaitingReview: Flag
});

const ProjectFilterQuery = z.object({
  query: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  selectedId: z.string().trim().max(64).optional()
});

export function registerMyWork(app: FastifyInstance, _deps: AppDependencies): void {
  app.get('/api/employee/my-work', async (request, reply) => {
    try {
      const { page, section, query, projectId, overdue, dueThisWeek, awaitingReview } = PageQuery.parse(
        request.query ?? {}
      );
      return ok(
        reply,
        request,
        await listMyWork(ctx(request), page, section as MyWorkSection, {
          query: query || undefined,
          projectId: projectId || undefined,
          overdue,
          dueThisWeek,
          awaitingReview
        })
      );
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

  /** The narrow options for a member-created project: active responsibilities, identity and label. */
  app.get('/api/employee/references', async (request, reply) => {
    try {
      return ok(reply, request, await myWorkProjectFormOptions(ctx(request)));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  // The project filter of the member's own work: paged and searchable, never a silent row cap.
  app.get('/api/employee/my-work/project-filter', async (request, reply) => {
    try {
      const query = ProjectFilterQuery.parse(request.query ?? {});
      return ok(
        reply,
        request,
        await listMyWorkProjectFilter(ctx(request), {
          query: query.query || undefined,
          page: query.page,
          pageSize: query.pageSize,
          selectedId: query.selectedId || undefined
        })
      );
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

  // A MEMBER files a project immediately; the owner, the status and the visibility stay server-side.
  app.post('/api/employee/projects', async (request, reply) => {
    try {
      const body = CreateMyProjectBody.parse(request.body ?? {});
      return ok(reply, request, await createMyProject(ctx(request), body));
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}
