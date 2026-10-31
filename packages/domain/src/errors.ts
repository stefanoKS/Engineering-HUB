import type { ErrorCode } from '@eh/contracts';

const STATUS: Record<ErrorCode, number> = {
  AUTHORIZATION_DENIED: 403,
  UNAUTHENTICATED: 401,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  EDIT_CONFLICT: 409,
  CONFIRMATION_REQUIRED: 400,
  IMMUTABLE_FIELD: 400,
  INVALID_TRANSITION: 409,
  STALE_REQUEST: 409,
  DUPLICATE_DECISION: 409,
  CONTAINER_NOT_COMPLETABLE: 409,
  HIERARCHY_CYCLE: 400,
  HIERARCHY_DEPTH: 400,
  HIERARCHY_INVALID: 400,
  DEPENDENCY_CYCLE: 400,
  DEPENDENCY_INVALID: 400,
  RESPONSIBILITY_REQUIRED: 400,
  REQUEST_SUBMISSION_CLOSED: 403,
  REQUEST_INBOX_UNAVAILABLE: 503,
  IDEMPOTENCY_REPLAY: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  NOT_CONFIGURED: 503,
  INTERNAL_ERROR: 500
};

/**
 * One refusal type for every layer. The code is stable and the message is a human fallback;
 * a browser never has to classify the wording of an error.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}, retryable = false) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }

  get httpStatus(): number {
    return STATUS[this.code] ?? 500;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

export const fail = {
  validation(message: string, details: Record<string, unknown> = {}): never {
    throw new DomainError('VALIDATION_FAILED', message, details);
  },
  notFound(entity: string, id: string): never {
    throw new DomainError('NOT_FOUND', `${entity} not found: ${id}`, { entity, id });
  },
  conflict(message = 'Reload and review; your draft is preserved'): never {
    throw new DomainError('EDIT_CONFLICT', message);
  },
  denied(message = 'A verified active account with sufficient role is required'): never {
    throw new DomainError('AUTHORIZATION_DENIED', message);
  },
  confirmation(message: string): never {
    throw new DomainError('CONFIRMATION_REQUIRED', message);
  },
  immutable(field: string): never {
    throw new DomainError('IMMUTABLE_FIELD', `${field} is immutable`, { field });
  }
};
