/**
 * Accepts any RFC 4122 version, including the v7 ids this schema generates.
 *
 * Guards run before pipes, so `ParseUUIDPipe` on a handler has not fired when
 * a guard reads a route parameter. Without a check of its own, a malformed id
 * reaches PostgreSQL as a uuid comparison and surfaces as a 500 instead of a 400.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidString(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
