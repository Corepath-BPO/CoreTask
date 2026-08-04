/**
 * Runs before any module is imported (Jest `setupFiles`).
 *
 * Loads the repository `.env` and then fills in test-safe defaults for anything
 * still missing, so `pnpm test` works on a bare checkout without a `.env` file.
 */
import '../src/config/load-env';

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] ??= 'silent';

process.env['DATABASE_URL'] ??=
  'postgresql://coretask:coretask_dev_password@localhost:5432/coretask?schema=public';

process.env['JWT_ACCESS_SECRET'] ??= 'test_only_access_secret_at_least_32_characters_long';
process.env['JWT_REFRESH_SECRET'] ??= 'test_only_refresh_secret_at_least_32_characters_long';
process.env['JWT_ACCESS_EXPIRES_IN'] ??= '15m';
process.env['JWT_REFRESH_EXPIRES_IN'] ??= '30d';

// The suites make far more auth calls than a human would; the throttler is
// exercised deliberately in its own case rather than tripping every other test.
/*
 * The suite *is* the browser here.
 *
 * Presigned URLs are signed for the host the client will connect to, and this
 * client runs inside the API container — so the address a real browser uses
 * (localhost:9000, published to the developer's machine) resolves to the
 * container itself and every fetch of a signed URL fails. On the compose
 * network the reachable address is the service name.
 */
// Assigned, not defaulted: the container already carries the browser's value,
// and that is precisely the one this process cannot reach.
process.env['STORAGE_PUBLIC_ENDPOINT'] = process.env['STORAGE_ENDPOINT'] ?? '';

process.env['RATE_LIMIT_MAX'] = '100000';
process.env['AUTH_RATE_LIMIT_MAX'] = '100000';
