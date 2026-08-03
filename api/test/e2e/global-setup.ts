import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import '../setup-env';

import { buildE2eDatabaseUrl, E2E_SCHEMA } from './test-database';

/**
 * Prepares the e2e schema once per run.
 *
 * `migrate deploy` is idempotent, so a second run is a fast no-op and the suite
 * always executes against the committed migrations rather than a hand-built
 * schema that could drift from production.
 */
export default function globalSetup(): void {
  const databaseUrl = buildE2eDatabaseUrl();
  process.env['DATABASE_URL'] = databaseUrl;

  try {
    execFileSync(process.execPath, [resolvePrismaCli(), 'migrate', 'deploy'], {
      cwd: resolve(__dirname, '..', '..'),
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Could not migrate the e2e schema "${E2E_SCHEMA}".`,
        'PostgreSQL and Redis must be running:  pnpm infra',
        '',
        detail,
      ].join('\n'),
    );
  }
}

/**
 * Locates Prisma's CLI entry point so it can run under `process.execPath`.
 *
 * Spawning `npx`/`prisma` directly is not portable: Node refuses to
 * `execFile` a Windows `.cmd` shim, and pnpm's store layout means the shim is
 * not always on PATH anyway.
 */
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
