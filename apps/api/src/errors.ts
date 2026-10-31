/**
 * Error translation at the API boundary.
 *
 * A domain refusal keeps its stable code; a validation failure becomes a structured field
 * list; anything unexpected becomes INTERNAL_ERROR with a correlation ID and no internal text.
 */
import { ZodError } from 'zod';
import type { FastifyReply } from 'fastify';
import { DomainError } from '@eh/domain';
import type { ApiFailureBody, ApiSuccessMeta } from '@eh/contracts';
import { NON_RETRYABLE, type ErrorCode } from '@eh/contracts';

export type RequestContext = {
  correlationId: string;
  startedAt: number;
  dbCalls: { calls: number };
};

export function failure(
  reply: FastifyReply,
  context: RequestContext,
  code: ErrorCode,
  message: string,
  statusCode: number,
  details?: Record<string, unknown>
): FastifyReply {
  const body: ApiFailureBody = {
    ok: false,
    error: {
      code,
      message,
      details,
      retryable: !NON_RETRYABLE.has(code),
      correlationId: context.correlationId
    }
  };
  return reply.code(statusCode).send(body);
}

export function success<T>(
  reply: FastifyReply,
  context: RequestContext,
  data: T,
  options: { includeMetrics?: boolean } = {}
): FastifyReply {
  const meta: ApiSuccessMeta = {
    correlationId: context.correlationId,
    executionMs: Date.now() - context.startedAt,
    dbCalls: context.dbCalls.calls
  };
  if (options.includeMetrics) meta.payloadBytes = Buffer.byteLength(JSON.stringify(data ?? null));
  return reply.code(200).send({ ok: true, data, meta });
}

export function sendError(reply: FastifyReply, context: RequestContext, error: unknown): FastifyReply {
  if (error instanceof DomainError) {
    return failure(reply, context, error.code, error.message, error.httpStatus, error.details);
  }
  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '_';
      fields[path] = fields[path] ?? issue.message;
    }
    return failure(reply, context, 'VALIDATION_FAILED', 'The request did not pass validation', 400, {
      fields
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/duplicate key value/.test(message)) {
    return failure(reply, context, 'VALIDATION_FAILED', 'A record with this identity already exists', 409);
  }
  if (/hierarchy|Subproject|Task.*limited|cycle|cannot be completed/i.test(message)) {
    const code: ErrorCode = /cycle/i.test(message)
      ? 'HIERARCHY_CYCLE'
      : /limited/i.test(message)
        ? 'HIERARCHY_DEPTH'
        : /cannot be completed/i.test(message)
          ? 'CONTAINER_NOT_COMPLETABLE'
          : 'HIERARCHY_INVALID';
    return failure(reply, context, code, message, 400);
  }
  reply.log.error({ err: error, correlationId: context.correlationId }, 'unhandled request failure');
  return failure(
    reply,
    context,
    'INTERNAL_ERROR',
    'An unexpected error occurred',
    500,
    process.env.NODE_ENV === 'production' ? undefined : { reason: message.slice(0, 500) }
  );
}
