import * as vm from 'node:vm';
import type { Config } from 'jest';

/**
 * Unit-test configuration. These specs never touch PostgreSQL, Redis or MinIO,
 * so `pnpm test` is safe to run on a bare checkout.
 *
 * Integration coverage lives in `test/e2e` and runs via `pnpm test:e2e`, which
 * requires the infrastructure containers (see README → Testing).
 *
 * ESM-only dependencies. The HTML sanitizer's parser — htmlparser2 12, with
 * domhandler, domutils, dom-serializer, domelementtype and entities beneath
 * it — ships as ES modules only. Production loads them through Node's own
 * `require(esm)`. Jest has a module loader of its own, and it does the same
 * (Jest 30.4+) only when Node's vm modules are switched on and can evaluate
 * synchronously: `--experimental-vm-modules`, on Node 24.9 or newer. That is
 * why the `test*` scripts start Jest through `node` with that flag rather than
 * through the `jest` binary, and silence the one ExperimentalWarning the flag
 * prints per worker. Nothing is transpiled: the specs exercise the parser as
 * it ships, and the next ESM-only release of anything needs no change here.
 */
// Run any other way, the specs that reach the sanitizer fail with "Cannot use
// import statement outside a module", which says nothing about the cause.
if (typeof vm.SourceTextModule?.prototype.hasAsyncGraph !== 'function') {
  throw new Error(
    'The API suites need Node 24.9+ started with --experimental-vm-modules, so Jest can ' +
      'require() ESM-only dependencies. Run them with `pnpm test`, not the bare jest binary.',
  );
}

const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test/unit'],
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts', '!src/worker.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 15_000,
};

export default config;
