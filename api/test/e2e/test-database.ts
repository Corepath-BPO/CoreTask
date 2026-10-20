import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

// Short enough that the migrations spec's scratch schema, named after this
// one, stays within PostgreSQL's 63-character identifiers. Declared before
// `E2E_SCHEMA`, which reads it as the module loads.
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,45}$/;

/**
 * Points the e2e suite at a dedicated PostgreSQL *schema* inside the existing
 * database.
 *
 * A separate schema (rather than a separate database) means no CREATE DATABASE
 * privilege is needed, `prisma migrate deploy` creates it on first run, and the
 * suite's `TRUNCATE` can never reach development data in `public`.
 *
 * One schema per checkout. Every spec truncates every table, so two runs in one
 * schema — from two git worktrees at once, say — wipe each other's rows
 * mid-test. Named for the checkout, a run finds its own schema again next time,
 * so `migrate deploy` stays a fast no-op, and no other checkout's run can reach
 * it. `E2E_SCHEMA` names one outright, for a second run in the same checkout.
 */
export const E2E_SCHEMA = readSchemaName();

/**
 * The BullMQ key prefix for the same run, for the same reason. The specs drain
 * and read the queues: on the shared prefix they drained another run's jobs,
 * and the development worker's, and that worker took theirs.
 */
export const E2E_QUEUE_PREFIX = E2E_SCHEMA;

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

function readSchemaName(): string {
  const named = process.env['E2E_SCHEMA'];
  if (!named) return checkoutSchema();

  if (!SCHEMA_NAME.test(named)) {
    throw new Error(
      `E2E_SCHEMA must be lower-case letters, digits and underscores, at most 46: "${named}".`,
    );
  }
  return named;
}

/**
 * `coretask_e2e_<folder>_<hash>`: the folder makes it readable in a list of
 * schemas, and the hash of the whole path keeps two clones in folders of the
 * same name apart. Windows paths are hashed without case, as its file system
 * compares them.
 */
function checkoutSchema(): string {
  const root = resolve(__dirname, '..', '..', '..');
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 8);
  const folder = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

  return ['coretask_e2e', folder, hash].filter(Boolean).join('_');
}
