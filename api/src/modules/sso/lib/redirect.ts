/** The longest path a sign-in will carry back; anything longer is not one of ours. */
const MAX_REDIRECT_LENGTH = 2_000;

/**
 * Where to send the browser once signing in is done: a path on the web app,
 * never another site. It travels through Google, Microsoft or an identity
 * provider and back, so it is checked on the way out and again on the way in.
 *
 * `//evil.example` is another host to a browser, and so is `/\evil.example`,
 * since browsers read a backslash as a slash. Tabs and newlines are dropped by
 * URL parsers, which can turn `/\t/evil.example` into `//evil.example`. All of
 * those, and anything that is not a path, become `/`.
 */
export function sanitizeRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return '/';
  return value;
}
