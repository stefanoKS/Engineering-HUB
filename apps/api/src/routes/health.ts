/** Liveness, readiness and version endpoints. */
import type { FastifyInstance } from 'fastify';
import type { AppDependencies } from '../http';
import { ok } from '../http';
import { schemaVersion } from '@eh/db';

export function registerHealthRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.get('/healthz', async (_request, reply) => reply.code(200).send({ ok: true, status: 'live' }));

  app.get('/readyz', async (request, reply) => {
    try {
      await deps.db.query('SELECT 1');
      const version = await schemaVersion(deps.db.pool);
      return ok(reply, request, { status: 'ready', schemaVersion: version });
    } catch (error) {
      return reply.code(503).send({
        ok: false,
        status: 'unavailable',
        error: (error as Error).message.split('\n')[0]
      });
    }
  });

  app.get('/api/version', async (request, reply) =>
    ok(reply, request, {
      version: deps.config.version,
      apiVersion: '2.0.0',
      environment: deps.config.appEnv,
      contractVersion: '1.6'
    })
  );
}
