/** Sign-in, session inspection and sign-out. */
import { z } from 'zod';
import { DomainError } from '@eh/domain';
import { localLogin, changePassword, Password } from '../auth/local';
import { hashToken } from '../auth/auth';
import type { FastifyInstance } from 'fastify';
import { CreateSessionBody } from '@eh/contracts';
import type { AppDependencies } from '../http';
import { ok, refused } from '../http';
import { sendError } from '../errors';
import { actorDto } from '../services/views';
import { divisionReferences, loadScope } from '../services/divisions';
import { listDivisions, revokeSession } from '@eh/db';

/**
 * The divisions a signed-in person may read and write, resolved on the server.
 *
 * The browser may render this list, but every request re-resolves the scope, so a forged payload
 * grants nothing. It exists so the shell can offer a division switch without a second round trip.
 */
async function divisionPayload(db: AppDependencies['db'], identity: Parameters<typeof actorDto>[0]) {
  const scope = await loadScope(db, identity);
  // A retired division the caller may already read stays in the readable list (history), while
  // `writable` never offers it for new work.
  const divisions = await listDivisions(db, { includeRetired: true });
  const { readable, writable } = divisionReferences(scope, divisions);
  return {
    readable,
    writable,
    allDivisions: scope.manageAll || scope.overseeAll,
    defaultDivisionId: writable[0]?.divisionId ?? readable[0]?.divisionId ?? null
  };
}

export function registerSessionRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.post('/api/session', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const body = CreateSessionBody.parse(request.body ?? {});
      if (deps.config.authMode === 'local' && (!body.employeeId || !body.password || body.idToken || body.devEmail)) throw new DomainError('UNAUTHENTICATED','Employee ID and password are required');
      const started = deps.config.authMode === 'local'
        ? await localLogin(deps.db, body.employeeId!, body.password!, deps.config.sessionTtlMinutes, String(request.headers['user-agent'] ?? ''))
        : await deps.auth.startSession(body.idToken ? await deps.auth.verifyGoogleIdToken(body.idToken) : deps.auth.verifyDeveloperIdentity(String(body.devEmail ?? '')), String(request.headers['user-agent'] ?? ''));
      // The session payload needs the resolved divisions, so it is built before the cookie is
      // issued: a build whose database still needs its migration refuses with one readiness error
      // and leaves no usable session behind.
      let divisions: Awaited<ReturnType<typeof divisionPayload>>;
      try {
        divisions = await divisionPayload(deps.db, started.identity);
      } catch (error) {
        await revokeSession(deps.db, hashToken(started.token)).catch(() => undefined);
        throw error;
      }
      reply.setCookie(deps.config.cookieName, started.token, {
        httpOnly: true,
        secure: deps.config.secureCookies,
        sameSite: 'lax',
        path: '/',
        maxAge: deps.config.sessionTtlMinutes * 60
      });
      return ok(reply, request, {
        authMode: deps.config.authMode,
        actor: actorDto(started.identity),
        divisions,
        mustChangePassword: 'mustChangePassword' in started ? started.mustChangePassword : false,
        csrfToken: started.csrfToken,
        expiresAt: started.expiresAt
      });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.get('/api/session', async (request, reply) => {
    const session = request.state.session;
    if (!session) {
      return refused(reply, request, 'UNAUTHENTICATED', 'No active session', 401);
    }
    return ok(reply, request, {
      authMode: deps.config.authMode,
      actor: actorDto(session.identity),
      divisions: await divisionPayload(deps.db, session.identity),
      mustChangePassword: session.mustChangePassword ?? false,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt
    });
  });

  app.post('/api/account/password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (deps.config.authMode !== 'local' || !request.state.session) throw new DomainError('AUTHORIZATION_DENIED','Local account required');
    const body=z.object({currentPassword:z.string().min(1).max(128), password:Password}).strict().parse(request.body);
    await changePassword(deps.db,request.state.session.identity.memberId,body.currentPassword,body.password);
    reply.clearCookie(deps.config.cookieName,{path:'/'});
    return ok(reply,request,{changed:true});
  });

  app.delete('/api/session', async (request, reply) => {
    await deps.auth.endSession(request.state.session);
    reply.clearCookie(deps.config.cookieName, { path: '/' });
    return ok(reply, request, { signedOut: true });
  });
}
