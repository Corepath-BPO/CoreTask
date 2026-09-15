/**
 * Machine-readable error codes returned in `ApiErrorResponse.error.code`.
 *
 * Clients branch on these, never on the human-readable `message`.
 */
export const ErrorCode = {
  // Generic
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Authentication
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCESS_TOKEN_EXPIRED: 'ACCESS_TOKEN_EXPIRED',
  ACCESS_TOKEN_INVALID: 'ACCESS_TOKEN_INVALID',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',

  // API keys
  API_KEY_INVALID: 'API_KEY_INVALID',
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  API_KEY_EXPIRED: 'API_KEY_EXPIRED',
  API_KEY_NOT_ALLOWED: 'API_KEY_NOT_ALLOWED',
  API_KEY_ROLE_NOT_ALLOWED: 'API_KEY_ROLE_NOT_ALLOWED',
  API_KEY_LIMIT_REACHED: 'API_KEY_LIMIT_REACHED',

  // Webhooks
  WEBHOOK_URL_NOT_ALLOWED: 'WEBHOOK_URL_NOT_ALLOWED',
  WEBHOOK_ENDPOINT_LIMIT_REACHED: 'WEBHOOK_ENDPOINT_LIMIT_REACHED',

  // Idempotent creates
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',

  // Authorization / tenancy
  FORBIDDEN: 'FORBIDDEN',
  WORKSPACE_ACCESS_DENIED: 'WORKSPACE_ACCESS_DENIED',
  INSUFFICIENT_WORKSPACE_ROLE: 'INSUFFICIENT_WORKSPACE_ROLE',
  WORKSPACE_CONTEXT_REQUIRED: 'WORKSPACE_CONTEXT_REQUIRED',
  /** Used by the realtime gateway; over REST an invisible project is a 404. */
  PROJECT_ACCESS_DENIED: 'PROJECT_ACCESS_DENIED',
  /** The project is visible, but the caller's role inside it is too low. */
  INSUFFICIENT_PROJECT_ROLE: 'INSUFFICIENT_PROJECT_ROLE',
  LAST_PROJECT_ADMIN: 'LAST_PROJECT_ADMIN',

  // Domain
  WORKSPACE_SLUG_TAKEN: 'WORKSPACE_SLUG_TAKEN',
  PROJECT_KEY_TAKEN: 'PROJECT_KEY_TAKEN',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Default human-readable copy per code. Services may override per call site. */
export const ERROR_CODE_MESSAGES: Record<ErrorCode, string> = {
  INTERNAL_SERVER_ERROR: 'An unexpected error occurred. Please try again.',
  VALIDATION_FAILED: 'The submitted data is invalid.',
  BAD_REQUEST: 'The request could not be processed.',
  RESOURCE_NOT_FOUND: 'The requested resource could not be found.',
  RESOURCE_CONFLICT: 'The resource conflicts with an existing record.',
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please slow down and try again shortly.',
  PAYLOAD_TOO_LARGE: 'The uploaded payload exceeds the maximum allowed size.',
  UNSUPPORTED_MEDIA_TYPE: 'The provided file type is not supported.',
  SERVICE_UNAVAILABLE: 'A required service is temporarily unavailable.',

  UNAUTHORIZED: 'Authentication is required to access this resource.',
  INVALID_CREDENTIALS: 'The e-mail address or password is incorrect.',
  ACCESS_TOKEN_EXPIRED: 'The access token has expired.',
  ACCESS_TOKEN_INVALID: 'The access token is invalid.',
  REFRESH_TOKEN_INVALID: 'The refresh token is invalid.',
  REFRESH_TOKEN_EXPIRED: 'The refresh token has expired.',
  REFRESH_TOKEN_REUSED: 'The refresh token has already been used. All sessions were revoked.',
  EMAIL_ALREADY_REGISTERED: 'An account with this e-mail address already exists.',
  ACCOUNT_DISABLED: 'This account has been disabled.',

  API_KEY_INVALID: 'The API key is not recognised.',
  API_KEY_REVOKED: 'The API key has been revoked.',
  API_KEY_EXPIRED: 'The API key has expired.',
  API_KEY_NOT_ALLOWED: 'This action needs a signed-in person, not an API key.',
  API_KEY_ROLE_NOT_ALLOWED: 'An API key can be a guest, a member or a manager.',
  API_KEY_LIMIT_REACHED: 'This workspace already has the maximum number of API keys.',

  WEBHOOK_URL_NOT_ALLOWED: 'CoreTask cannot send webhooks to that address.',
  WEBHOOK_ENDPOINT_LIMIT_REACHED:
    'This workspace already has the maximum number of webhook endpoints.',

  IDEMPOTENCY_KEY_REUSED: 'This Idempotency-Key was already used for a different request.',
  IDEMPOTENCY_IN_PROGRESS: 'A request with this Idempotency-Key is still being processed.',

  FORBIDDEN: 'You do not have permission to perform this action.',
  WORKSPACE_ACCESS_DENIED: 'You are not a member of this workspace.',
  INSUFFICIENT_WORKSPACE_ROLE: 'Your workspace role does not allow this action.',
  WORKSPACE_CONTEXT_REQUIRED: 'A workspace context is required for this request.',
  PROJECT_ACCESS_DENIED: 'You do not have access to this project.',
  INSUFFICIENT_PROJECT_ROLE: 'Your role in this project does not allow this action.',
  LAST_PROJECT_ADMIN: 'A private project must keep at least one admin.',

  WORKSPACE_SLUG_TAKEN: 'That workspace URL is already in use.',
  PROJECT_KEY_TAKEN: 'That project key is already in use in this workspace.',
};
