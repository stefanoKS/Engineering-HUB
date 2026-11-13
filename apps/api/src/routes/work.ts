import { registerWorkEditRoutes } from './work-edit';
/**
 * Read-only work and project endpoints.
 *
 * Every signed-in role may browse permitted active work here. There is no write path in this
 * module, and the visibility policy (only `INTERNAL`, non-archived projects for MEMBER and VIEWER)
 * is applied on the server before any page is cut.
 */
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Id, ProjectListQuery, TaskListQuery, WorkOverviewQuery } from '@eh/contracts';
import { listTaskAssigneeOptions } from '@eh/db';
import { canSeeRestrictedWork, readableDivisionIds, requireRole, scopedDivisionIds } from '@eh/domain';
import { actorOf, ok, type AppDependencies } from '../http';
import { sendError } from '../errors';
import {
  listActiveWork,
  listWorkProjects,
  readOnlyProjectDetail,
  readOnlyTaskDetail,
  workOverview,
  type WorkCtx
} from '../services/work';
import { timelineBranch, timelineProjects } from '../services/timeline';
import { readCtx } from '../services/views';

function ctx(request: FastifyRequest): WorkCtx {
  const read = readCtx(request);
  return {
    db: read.db,
    identity: actorOf(request),
    correlationId: request.state.correlationId,
    cache: read.cache,
    today: read.today,
    divisions: read.divisions
  };
}

/**
 * The read-only project list takes the same filters, sort and paging as the manager list; the
 * server resolves each of them inside the authorized scope before a page is cut.
 */
const ProjectQuery = ProjectListQuery.pick({
  responsibilityId: true,
  divisionId: true,
  unassigned: true,
  schedule: true,
  query: true,
  page: true,
  pageSize: true,
  sort: true,
  direction: true
});

const IdParams = z.object({ id: z.string().min(1).max(64) });
const AssigneeOptionsQuery = z.object({
  query: z.string().trim().max(200).default(''),
  memberId: Id.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
}).strict();

/** The timeline reads a whole active scope at once: same allowlist, never a manager projection. */
const TimelineQuery = z.object({
  projectId: z.string().trim().max(64).optional(),
  subprojectId: z.string().trim().max(64).optional(),
  responsibilityId: z.string().trim().max(64).optional(),
  /** Narrows the authorized scope; it can never widen it. */
  divisionId: z.string().trim().max(64).optional(),
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  includeCompleted: z.enum(['true', 'false']).optional(),
  includeArchived: z.enum(['true', 'false']).optional()
});

export function registerWorkRoutes(app: FastifyInstance, _deps: AppDependencies): void {
  registerWorkEditRoutes(app);
  app.get('/api/work/task-assignees', async (request, reply) => {
    try {
      const identity = requireRole(actorOf(request), 'VIEWER');
      const query = AssigneeOptionsQuery.parse(request.query ?? {});
      const manager = canSeeRestrictedWork(identity);
      // The picker is a filter, not an assignment selector: it is scoped by the divisions the
      // caller may read, and an employee identifier is returned only to a reader who may already
      // see one.
      const result = await listTaskAssigneeOptions(
        request.state.db,
        !manager,
        query.query,
        query.page,
        query.pageSize,
        query.memberId,
        { divisionIds: readableDivisionIds(request.state.divisions), includeEmployeeId: manager }
      );
      return ok(reply, request, { ...result, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(result.total / query.pageSize) });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
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
   * The member overview: the same authorized scope as the lists, resolved before every aggregate
   * and top-N cut. A manager may read it too, but the management overview stays its own endpoint.
   */
  app.get('/api/work/overview', async (request, reply) => {
    try {
      const query = WorkOverviewQuery.parse(request.query ?? {});
      return ok(
        reply,
        request,
        await workOverview(ctx(request), {
          responsibilityId: query.responsibilityId,
          divisionId: query.divisionId,
          upcomingDays: query.upcomingDays
        })
      );
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
      // The same narrowing rule as every other list: refuse an unauthorized division before any
      // branch or page summary is built.
      const divisionIds = scopedDivisionIds(request.state.divisions, query.divisionId);
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
          divisionIds,
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
