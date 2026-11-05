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
import { listActiveWork, listWorkProjects, readOnlyProjectDetail, readOnlyTaskDetail, type WorkCtx } from '../services/work';
import { timelineBranch, timelineProjects } from '../services/timeline';
import { readCtx } from '../services/views';

function ctx(request: FastifyRequest): WorkCtx {
  const read = readCtx(request);
  return {
    db: read.db,
    identity: actorOf(request),
    correlationId: request.state.correlationId,
    cache: read.cache,
    today: read.today
  };
}

const ProjectQuery = z.object({
  query: z.string().trim().max(200).optional(),
  responsibilityId: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

const IdParams = z.object({ id: z.string().min(1).max(64) });

/** The timeline reads a whole active scope at once: same allowlist, never a manager projection. */
const TimelineQuery = z.object({
  projectId: z.string().trim().max(64).optional(),
  subprojectId: z.string().trim().max(64).optional(),
  responsibilityId: z.string().trim().max(64).optional(),
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  includeCompleted: z.enum(['true', 'false']).optional(),
  includeArchived: z.enum(['true', 'false']).optional()
});

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

  /**
   * Read-only timeline. One project branch when `projectId` is given, otherwise the permitted
   * project summaries for the paged scope.
   */
  app.get('/api/work/timeline', async (request, reply) => {
    try {
      const query = TimelineQuery.parse(request.query ?? {});
      if (query.projectId) {
        return ok(
          reply,
          request,
          await timelineBranch(ctx(request), query.projectId, {
            includeCompleted: query.includeCompleted !== 'false',
            subprojectId: query.subprojectId || undefined
          })
        );
      }
      return ok(
        reply,
        request,
        await timelineProjects(ctx(request), {
          responsibilityId: query.responsibilityId || undefined,
          query: query.query || undefined,
          page: query.page,
          pageSize: query.pageSize,
          includeArchived: query.includeArchived === 'true',
          includeCompleted: query.includeCompleted !== 'false'
        })
      );
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}
