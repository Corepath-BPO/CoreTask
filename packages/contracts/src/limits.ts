/**
 * Field constraints and pagination defaults.
 *
 * The API (class-validator DTOs) and the web client (Zod schemas) both read
 * these constants, so validation rules cannot drift between the two layers.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 120;

export const EMAIL_MAX_LENGTH = 254;

export const WORKSPACE_NAME_MIN_LENGTH = 2;
export const WORKSPACE_NAME_MAX_LENGTH = 80;
export const WORKSPACE_SLUG_MIN_LENGTH = 2;
export const WORKSPACE_SLUG_MAX_LENGTH = 40;
/** Lowercase alphanumerics separated by single hyphens. */
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PROJECT_NAME_MAX_LENGTH = 120;
/** 2–8 uppercase letters/digits — the `CORE` in `CORE-1001`. */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;

export const DESCRIPTION_MAX_LENGTH = 10_000;
export const COMMENT_MAX_LENGTH = 20_000;
export const TASK_TITLE_MAX_LENGTH = 500;

export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

/** Header carrying the per-request correlation id, echoed on every response. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Name of the HTTP-only cookie carrying the rotating refresh token. */
export const REFRESH_TOKEN_COOKIE = 'coretask_rt';

/** Upload guardrails enforced by the storage integration. */
export const ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
