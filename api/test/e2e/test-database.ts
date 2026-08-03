/**
 * Points the e2e suite at a dedicated PostgreSQL *schema* inside the existing
 * database.
 *
 * A separate schema (rather than a separate database) means no CREATE DATABASE
 * privilege is needed, `prisma migrate deploy` creates it on first run, and the
 * suite's `TRUNCATE` can never reach development data in `public`.
 */
export const E2E_SCHEMA = 'coretask_e2e';

export function buildE2eDatabaseUrl(baseUrl: string = requireDatabaseUrl()): string {
  const url = new URL(baseUrl);
  url.searchParams.set('schema', E2E_SCHEMA);
  return url.toString();
}

function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The e2e suite needs PostgreSQL — run `pnpm infra` first.',
    );
  }

  return url;
}
