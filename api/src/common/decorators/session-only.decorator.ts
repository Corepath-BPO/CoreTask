import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const SESSION_ONLY_KEY = 'coretask:sessionOnly';
/** OpenAPI extension the Swagger setup reads to leave the API-key scheme off these operations. */
export const SESSION_ONLY_EXTENSION = 'x-session-only';

/**
 * Marks a route a workspace API key may never call.
 *
 * A key exists to move work — tasks, comments, fields. Managing people, other
 * keys, workspaces or the session itself stays with a signed-in person, so a
 * leaked key cannot widen its own access. Enforced by {@link JwtAuthGuard}, and
 * mirrored into the OpenAPI document so the docs page offers the key only where
 * the server would take it.
 */
export const SessionOnly = () =>
  applyDecorators(SetMetadata(SESSION_ONLY_KEY, true), ApiExtension(SESSION_ONLY_EXTENSION, true));
