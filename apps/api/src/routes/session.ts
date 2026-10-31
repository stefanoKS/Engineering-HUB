/** Sign-in, session inspection and sign-out. */
import type { FastifyInstance } from 'fastify';
import { CreateSessionBody } from '@eh/contracts';
import type { AppDependencies } from '../http';
import { ok, refused } from '../http';
import { sendError } from '../errors';
import { actorDto } from '../services/views';

export function registerSessionRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.post('/api/session', async (request, reply) => {
    try {
      const body = CreateSessionBody.parse(request.body ?? {});
      const claims = body.idToken
        ? await deps.auth.verifyGoogleIdToken(body.idToken)
        : await Promise.resolve(
            deps.auth.verifyDeveloperIdentity(String(body.devEmail ?? ''))
          );
      const started = await deps.auth.startSession(claims, String(request.headers['user-agent'] ?? ''));
      reply.setCookie(deps.config.cookieName, started.token, {
        httpOnly: true,
        secure: deps.config.production,
        sameSite: 'lax',
        path: '/',
        maxAge: deps.config.sessionTtlMinutes * 60
      });
      return ok(reply, request, {
        actor: actorDto(started.identity),
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
      actor: actorDto(session.identity),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt
    });
  });

  app.delete('/api/session', async (request, reply) => {
    await deps.auth.endSession(request.state.session);
    reply.clearCookie(deps.config.cookieName, { path: '/' });
    return ok(reply, request, { signedOut: true });
  });
}
