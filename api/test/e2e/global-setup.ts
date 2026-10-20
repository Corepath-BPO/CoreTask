import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import '../setup-env';

import { Redis } from 'ioredis';

import { parseEnv } from '../../src/config/env';

import { buildE2eDatabaseUrl, E2E_QUEUE_PREFIX, E2E_SCHEMA } from './test-database';

/**
 * Prepares the e2e schema and queues once per run.
 *
 * `migrate deploy` is idempotent, so a second run is a fast no-op and the suite
 * always executes against the committed migrations rather than a hand-built
 * schema that could drift from production.
 */
export default async function globalSetup(): Promise<void> {
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

  await clearQueues();
}

/**
 * Empties the last run's queues.
 *
 * Nothing consumes them: the processors live in the worker, which listens on
 * its own prefix. Every job a run queued — an automation event per task
 * created, a webhook fan-out, an e-mail — would otherwise stay in Redis for
 * good, one run's worth more each time.
 */
async function clearQueues(): Promise<void> {
  const env = parseEnv();
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${E2E_QUEUE_PREFIX}:*`, 'COUNT', 500);
      if (keys.length > 0) await redis.unlink(...keys);
      cursor = next;
    } while (cursor !== '0');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Could not clear the e2e queues "${E2E_QUEUE_PREFIX}:*".`,
        'PostgreSQL and Redis must be running:  pnpm infra',
        '',
        detail,
      ].join('\n'),
    );
  } finally {
    redis.disconnect();
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
