import { WorkspaceRole } from './enums.js';

/**
 * Workspace API keys — the credential a machine caller (n8n, a script) presents.
 *
 * A key acts as a hidden service-account user in one workspace, so everything
 * that records who did something keeps working and reads "n8n created this".
 */

/** Recognisable prefix so a leaked key is identifiable in logs and secret scanners. */
export const API_KEY_PREFIX = 'ctk_';
/** Random bytes behind the prefix; 32 bytes → 43 base64url characters. */
export const API_KEY_TOKEN_BYTES = 32;
/** How many characters after the prefix the list shows. Display only. */
export const API_KEY_DISPLAY_CHARS = 8;
/** Header a machine caller sends. `Authorization: Bearer ctk_…` is accepted too. */
export const API_KEY_HEADER = 'x-api-key';

export const API_KEY_NAME_MAX_LENGTH = 80;
export const MAX_API_KEYS_PER_WORKSPACE = 25;
export const API_KEY_MAX_EXPIRY_DAYS = 3650;

/**
 * Roles a key may hold. Never ADMIN or OWNER: a key cannot manage people, other
 * keys or the workspace itself, so granting it a role that implies it could
 * would only mislead.
 */
export const API_KEY_ROLES = [
  WorkspaceRole.GUEST,
  WorkspaceRole.MEMBER,
  WorkspaceRole.MANAGER,
] as const;
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];

/** Routes an API key may never call are marked `@SessionOnly()` on the API. */
export const INTEGRATION_PRINCIPALS = ['user', 'api_key'] as const;
export type IntegrationPrincipal = (typeof INTEGRATION_PRINCIPALS)[number];

/**
 * Idempotent creates. A caller that may retry — n8n on a flaky network — sends
 * the same `Idempotency-Key` with every try, and the second try gets the first
 * try's answer back instead of a second task.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** Set to `true` on a response that was replayed rather than produced afresh. */
export const IDEMPOTENCY_REPLAYED_HEADER = 'idempotency-replayed';
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
/** How long a used key keeps answering with the stored response. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
