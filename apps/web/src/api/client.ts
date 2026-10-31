/**
 * API client.
 *
 * One transport for every screen: same-origin cookies, the session's CSRF token, a correlation
 * ID on every request, a bounded timeout, and one classifier. A genuine authorization denial
 * emits `session-lost`; a timeout or a network failure never does.
 */
import type { ApiFailureBody, ApiSuccessBody, ErrorCode } from '@eh/contracts';
import { z } from 'zod';

export class ApiFailure extends Error {
  readonly code: ErrorCode | 'NETWORK' | 'INVALID_RESPONSE';
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  readonly correlationId: string;
  readonly status: number;

  constructor(input: {
    code: ErrorCode | 'NETWORK' | 'INVALID_RESPONSE';
    message: string;
    status?: number;
    details?: Record<string, unknown>;
    retryable?: boolean;
    correlationId?: string;
  }) {
    super(input.message);
    this.name = 'ApiFailure';
    this.code = input.code;
    this.details = input.details ?? {};
    this.retryable = input.retryable ?? false;
    this.correlationId = input.correlationId ?? '';
    this.status = input.status ?? 0;
  }

  get isConflict(): boolean {
    return this.code === 'EDIT_CONFLICT';
  }

  get isDenied(): boolean {
    return this.code === 'AUTHORIZATION_DENIED' || this.code === 'UNAUTHENTICATED';
  }
}

export const sessionEvents = new EventTarget();

let csrfToken = '';
let correlationFactory = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function getCsrfToken(): string {
  return csrfToken;
}

export function setCorrelationFactory(factory: () => string): void {
  correlationFactory = factory;
}

const FailureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    retryable: z.boolean(),
    correlationId: z.string()
  })
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-correlation-id': correlationFactory()
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['x-csrf-token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    throw new ApiFailure({
      code: 'NETWORK',
      message: (error as Error).message || 'The request could not be sent',
      retryable: true
    });
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiFailure({
        code: 'INVALID_RESPONSE',
        message: 'The server returned an unreadable response',
        status: response.status,
        retryable: true
      });
    }
  }

  if (!payload || typeof payload !== 'object' || !('ok' in payload)) {
    throw new ApiFailure({
      code: 'INVALID_RESPONSE',
      message: 'The server response did not use the API envelope',
      status: response.status,
      retryable: response.status >= 500
    });
  }

  if ((payload as { ok: boolean }).ok) {
    const success = payload as ApiSuccessBody<T>;
    return success.data;
  }

  const failure = FailureSchema.safeParse(payload);
  if (!failure.success) {
    throw new ApiFailure({
      code: 'INVALID_RESPONSE',
      message: 'The error response did not match the contract',
      status: response.status
    });
  }
  const error = (failure.data as ApiFailureBody).error;
  const apiError = new ApiFailure({
    code: error.code as ErrorCode,
    message: error.message,
    status: response.status,
    details: error.details,
    retryable: error.retryable,
    correlationId: error.correlationId
  });
  if (apiError.isDenied) {
    csrfToken = '';
    sessionEvents.dispatchEvent(new CustomEvent('session-lost', { detail: apiError }));
  }
  throw apiError;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown): Promise<T> => request<T>('DELETE', path, body)
};

export function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
