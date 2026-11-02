/** Sign-in, session inspection and sign-out. */
import { z } from 'zod';
import { DomainError } from '@eh/domain';
import { localLogin, changePassword, Password } from '../auth/local';
import type { FastifyInstance } from 'fastify';
import { CreateSessionBody } from '@eh/contracts';
import type { AppDependencies } from '../http';
import { ok, refused } from '../http';
import { sendError } from '../errors';
import { actorDto } from '../services/views';

export function registerSessionRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.post('/api/session', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const body = CreateSessionBody.parse(request.body ?? {});
      if (deps.config.authMode === 'local' && (!body.employeeId || !body.password || body.idToken || body.devEmail)) throw new DomainError('UNAUTHENTICATED','Employee ID and password are required');
      const started = deps.config.authMode === 'local'
        ? await localLogin(deps.db, body.employeeId!, body.password!, deps.config.sessionTtlMinutes, String(request.headers['user-agent'] ?? ''))
        : await deps.auth.startSession(body.idToken ? await deps.auth.verifyGoogleIdToken(body.idToken) : deps.auth.verifyDeveloperIdentity(String(body.devEmail ?? '')), String(request.headers['user-agent'] ?? ''));
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
