/**
 * Request lifecycle helpers: correlation ID, session resolution, CSRF/origin checks and the
 * authorization guards every route uses.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, requireRole, type Identity, type RoleName } from '@eh/domain';
import type { Database } from '@eh/db';
import { Database as DatabaseContext } from '@eh/db';
import type { AppConfig } from './config';
import type { AuthService, SessionContext } from './auth/auth';
import type { InboxSource } from './inbox';
import { failure, success, type RequestContext } from './errors';

export type AppDependencies = {
  config: AppConfig;
  db: Database;
  auth: AuthService;
  inbox: InboxSource;
};

export type RequestState = RequestContext & {
  session: SessionContext | null;
  /** Per-request database handle: its call counter is what `meta.dbCalls` reports. */
  db: Database;
  /** Execution-local read cache: one query per table per request, never shared across users. */
  cache: Map<string, Promise<unknown>>;
};

declare module 'fastify' {
  interface FastifyRequest {
    state: RequestState;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function registerContext(app: FastifyInstance, deps: AppDependencies): void {
  app.decorateRequest('state', null as unknown as RequestState);

  app.addHook('onRequest', async (request) => {
    const supplied = String(request.headers['x-correlation-id'] ?? '');
    const correlationId = /^[A-Za-z0-9:_-]{8,80}$/.test(supplied) ? supplied : randomUUID();
    const db = new DatabaseContext(deps.db.pool, { calls: 0 });
    request.state = {
      correlationId,
      startedAt: Date.now(),
      dbCalls: db.counter,
      session: null,
      db,
      cache: new Map()
    };
    void request.id;
  });

  app.addHook('preHandler', async (request) => {
    request.state.session = await deps.auth.resolve(request);

    if (SAFE_METHODS.has(request.method)) return;

    // The session API is the only mutation that is allowed to run without a session.
    if (request.url.startsWith('/api/session')) return;

    if (!request.state.session) {
      throw new DomainError('UNAUTHENTICATED', 'Sign in is required for this operation');
    }
    const csrf = String(request.headers['x-csrf-token'] ?? '');
    if (!csrf || csrf !== request.state.session.csrfToken) {
      throw new DomainError('AUTHORIZATION_DENIED', 'A valid CSRF token is required');
    }
    const origin = String(request.headers.origin ?? '');
    if (origin) {
      const allowed = [deps.config.publicOrigin, ...deps.config.allowedOrigins];
      if (!allowed.includes(origin)) {
        throw new DomainError('AUTHORIZATION_DENIED', 'This origin is not allowed to mutate data');
      }
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-correlation-id', request.state.correlationId);
    reply.header('cache-control', 'no-store');
    return payload;
  });
}

export function actorOf(request: FastifyRequest): Identity {
  if (!request.state.session) {
    throw new DomainError('UNAUTHENTICATED', 'A verified account is required');
  }
  return request.state.session.identity;
}

export function requireRoleOf(request: FastifyRequest, minimum: RoleName): Identity {
  return requireRole(actorOf(request), minimum);
}

export function managerOf(request: FastifyRequest): Identity {
  return requireRoleOf(request, 'MANAGER');
}

export function adminOf(request: FastifyRequest): Identity {
  return requireRoleOf(request, 'ADMIN');
}

export function ok<T>(reply: FastifyReply, request: FastifyRequest, data: T, includeMetrics = false): FastifyReply {
  return success(reply, request.state, data, { includeMetrics });
}

export function refused(
  reply: FastifyReply,
  request: FastifyRequest,
  code: Parameters<typeof failure>[2],
  message: string,
  status = 400,
  details?: Record<string, unknown>
): FastifyReply {
  return failure(reply, request.state, code, message, status, details);
}
