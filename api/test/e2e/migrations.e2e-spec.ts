import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { buildE2eDatabaseUrl } from './test-database';

/**
 * Applies every committed migration to an empty schema, in the order Prisma
 * would use in production.
 *
 * The rest of the suite runs against a long-lived schema that is migrated
 * incrementally, so it only ever exercises the *newest* migration against a
 * database the earlier ones already built. That hides ordering faults
 * completely.
 *
 * It hid a real one: the initial migration had been named for a timestamp
 * slightly in the future, so every migration generated afterwards sorted
 * *before* it. Deploying to a fresh database failed with `relation "comments"
 * does not exist`, while every existing database — and the whole test suite —
 * kept working.
 */
describe('Migrations (e2e)', () => {
  const SCRATCH_SCHEMA = 'coretask_migration_check';

  const apiRoot = resolve(__dirname, '..', '..');
  const migrationsDir = resolve(apiRoot, 'prisma', 'migrations');

  const scratchUrl = (): string => {
    const url = new URL(buildE2eDatabaseUrl());
    url.searchParams.set('schema', SCRATCH_SCHEMA);
    return url.toString();
  };

  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: buildE2eDatabaseUrl() } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCRATCH_SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCRATCH_SCHEMA}" CASCADE`);
  });

  it('applies cleanly to an empty database', () => {
    const databaseUrl = scratchUrl();

    // Throws with Prisma's own diagnostics if any migration fails to apply.
    const output = execFileSync(process.execPath, [resolvePrismaCli(), 'migrate', 'deploy'], {
      cwd: apiRoot,
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    }).toString();

    expect(output).toContain('migrations have been successfully applied');
  });

  /**
   * Prisma applies migrations in lexicographic folder order, so the directory
   * listing *is* the deployment plan. Asserting it is sorted is what keeps a
   * hand-named or clock-skewed folder from quietly jumping the queue.
   */
  it('has folder names that sort into the intended order', () => {
    const folders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(folders.length).toBeGreaterThan(0);
    expect([...folders].sort()).toEqual(folders);
    // The schema has to exist before anything can alter it.
    expect(folders[0]).toMatch(/_init$/);
  });
});

/** Prisma's CLI entry point, run under `process.execPath` for portability. */
function resolvePrismaCli(): string {
  const manifestPath = require.resolve('prisma/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };

  const binField = manifest.bin;
  const relative =
    typeof binField === 'string' ? binField : (binField?.['prisma'] ?? 'build/index.js');

  return resolve(dirname(manifestPath), relative);
}
