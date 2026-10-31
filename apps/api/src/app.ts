/**
 * Fastify application factory.
 *
 * The transport is deliberately thin: sessions and CSRF at the edge, bounded bodies, rate
 * limits, strict security headers and one error envelope. Business rules live in services.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Database } from '@eh/db';
import type { AppConfig } from './config';
import { AuthService } from './auth/auth';
import { registerContext, type AppDependencies } from './http';
import { sendError } from './errors';
import { registerSessionRoutes } from './routes/session';
import { registerManagerRoutes } from './routes/manager';
import { registerEmployeeRoutes } from './routes/employee';
import { registerHealthRoutes } from './routes/health';
import type { InboxSource } from './inbox';

export type BuildOptions = {
  config: AppConfig;
  db: Database;
  inbox: InboxSource;
  logger?: FastifyServerOptions['logger'];
  webRoot?: string;
};

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'req.headers["x-csrf-token"]',
                'res.headers["set-cookie"]'
              ],
              censor: '[redacted]'
            }
          },
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimitBytes,
    disableRequestLogging: true
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'", 'https://accounts.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", 'https://accounts.google.com'],
        frameSrc: ['https://accounts.google.com'],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'same-origin' }
  });
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip
  });

  const deps: AppDependencies = {
    config,
    db,
    auth: new AuthService(config, db),
    inbox: options.inbox
  };

  registerContext(app, deps);
  registerHealthRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerManagerRoutes(app, deps);
  registerEmployeeRoutes(app, deps);

  if (options.webRoot && existsSync(join(options.webRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: options.webRoot, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Unknown endpoint',
            retryable: false,
            correlationId: request.state.correlationId
          }
        });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request, reply) =>
      reply.code(404).send({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Unknown endpoint',
          retryable: false,
          correlationId: request.state.correlationId
        }
      })
    );
  }

  app.setErrorHandler((error, request, reply) => sendError(reply, request.state, error));

  return app;
}
