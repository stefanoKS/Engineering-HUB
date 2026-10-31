/**
 * Transport-independent API contract: stable error codes, envelopes and primitives.
 *
 * The browser validates every response with these schemas; a missing required field becomes
 * one readable INVALID_RESPONSE instead of a TypeError inside a render function.
 */
import { z } from 'zod';

export const ERROR_CODES = [
  'AUTHORIZATION_DENIED',
  'UNAUTHENTICATED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'EDIT_CONFLICT',
  'CONFIRMATION_REQUIRED',
  'IMMUTABLE_FIELD',
  'INVALID_TRANSITION',
  'STALE_REQUEST',
  'DUPLICATE_DECISION',
  'CONTAINER_NOT_COMPLETABLE',
  'HIERARCHY_CYCLE',
  'HIERARCHY_DEPTH',
  'HIERARCHY_INVALID',
  'DEPENDENCY_CYCLE',
  'DEPENDENCY_INVALID',
  'RESPONSIBILITY_REQUIRED',
  'REQUEST_SUBMISSION_CLOSED',
  'REQUEST_INBOX_UNAVAILABLE',
  'IDEMPOTENCY_REPLAY',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'NOT_CONFIGURED',
  'INTERNAL_ERROR'
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const NON_RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  'AUTHORIZATION_DENIED',
  'UNAUTHENTICATED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'EDIT_CONFLICT',
  'CONFIRMATION_REQUIRED',
  'IMMUTABLE_FIELD',
  'INVALID_TRANSITION',
  'STALE_REQUEST',
  'DUPLICATE_DECISION',
  'CONTAINER_NOT_COMPLETABLE',
  'HIERARCHY_CYCLE',
  'HIERARCHY_DEPTH',
  'HIERARCHY_INVALID',
  'DEPENDENCY_CYCLE',
  'DEPENDENCY_INVALID',
  'RESPONSIBILITY_REQUIRED',
  'REQUEST_SUBMISSION_CLOSED',
  'IDEMPOTENCY_REPLAY',
  'PAYLOAD_TOO_LARGE',
  'NOT_CONFIGURED'
]);

export const Id = z
  .string()
  .trim()
  .min(1)
  .max(64);

export const Revision = z.number().int().min(1);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date in Asia/Tokyo business terms, never an instant. */
export const IsoDate = z
  .string()
  .regex(ISO_DATE, 'Expected YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Not a real calendar date');

export const IsoTimestamp = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime());

/** Optional value that a PATCH may leave alone. `null` clears a field; `undefined` keeps it. */
export const NullableIsoDate = IsoDate.nullable();
export const NullableText = z.string().max(20000).nullable();

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  query: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(40).optional(),
  direction: z.enum(['asc', 'desc']).default('asc')
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export function paged<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(0)
  });
}

export const ApiErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean(),
  correlationId: z.string()
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const ApiSuccess = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data: data,
    meta: z
      .object({
        correlationId: z.string(),
        executionMs: z.number().nonnegative(),
        dbCalls: z.number().int().nonnegative(),
        payloadBytes: z.number().int().nonnegative().optional()
      })
      .optional()
  });

export const ApiFailure = z.object({
  ok: z.literal(false),
  error: ApiErrorBody
});

export const ApiEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.union([ApiSuccess(data), ApiFailure]);

export type ApiSuccessBody<T> = { ok: true; data: T; meta?: ApiSuccessMeta };
export type ApiSuccessMeta = { correlationId: string; executionMs: number; dbCalls: number; payloadBytes?: number };
export type ApiFailureBody = z.infer<typeof ApiFailure>;
export type ApiEnvelopeBody<T> = ApiSuccessBody<T> | ApiFailureBody;

export const IdempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9:_-]{8,120}$/, 'Idempotency-Key must be 8-120 safe characters');

export const Confirm = z.literal(true);
