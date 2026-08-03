import { ERROR_CODE_MESSAGES, type ErrorCode } from '@coretask/contracts';
import type { ApiErrorResponse } from '@coretask/types';

/**
 * Normalised failure from the API layer.
 *
 * Every rejection out of `apiClient` is one of these, so callers never have to
 * poke at Axios internals to find out what went wrong.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | null;

  constructor(params: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: Record<string, unknown> | null;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details ?? null;
  }

  /** True when a token refresh could plausibly fix this. */
  get isAuthExpiry(): boolean {
    return this.code === 'ACCESS_TOKEN_EXPIRED';
  }

  /** True when the user must sign in again. */
  get isUnauthenticated(): boolean {
    return (
      this.status === 401 &&
      [
        'UNAUTHORIZED',
        'ACCESS_TOKEN_INVALID',
        'REFRESH_TOKEN_INVALID',
        'REFRESH_TOKEN_EXPIRED',
        'REFRESH_TOKEN_REUSED',
      ].includes(this.code)
    );
  }

  /** Field-level messages from a 422, keyed for form binding. */
  get fieldErrors(): string[] {
    const fields = this.details?.['fields'];
    return Array.isArray(fields) ? fields.map(String) : [];
  }

  static fromResponse(body: unknown, status: number): ApiError {
    if (isApiErrorResponse(body)) {
      return new ApiError({
        code: body.error.code,
        message: body.error.message || ERROR_CODE_MESSAGES[body.error.code],
        status,
        details: body.error.details,
      });
    }

    return new ApiError({
      code: 'INTERNAL_SERVER_ERROR',
      message: ERROR_CODE_MESSAGES.INTERNAL_SERVER_ERROR,
      status,
    });
  }

  /** Request never reached the server (offline, DNS, CORS, timeout). */
  static network(message = 'Cannot reach the CoreTask API. Check your connection.'): ApiError {
    return new ApiError({ code: 'SERVICE_UNAVAILABLE', message, status: 0 });
  }
}

function isApiErrorResponse(body: unknown): body is ApiErrorResponse {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Partial<ApiErrorResponse>;

  return (
    candidate.success === false &&
    typeof candidate.error === 'object' &&
    candidate.error !== null &&
    typeof candidate.error.code === 'string'
  );
}
