import * as vm from 'node:vm';
import type { Config } from 'jest';

/**
 * Integration suite. Needs PostgreSQL and Redis:
 *
 *   pnpm infra                 (starts the containers)
 *   pnpm --filter @coretask/api test:e2e
 *
 * Runs against this checkout's own `coretask_e2e_…` schema and queue prefix
 * (see e2e/test-database.ts), so development data is never touched and runs
 * from two worktrees at once cannot reach each other's.
 *
 * Like the unit suite, it needs Node's vm modules for the ESM-only parser
 * behind the HTML sanitizer — see the note in ../jest.config.ts.
 */
if (typeof vm.SourceTextModule?.prototype.hasAsyncGraph !== 'function') {
  throw new Error(
    'The API suites need Node 24.9+ started with --experimental-vm-modules, so Jest can ' +
      'require() ESM-only dependencies. Run them with `pnpm test:e2e`, not the bare jest binary.',
  );
}

const config: Config = {
  rootDir: '..',
  roots: ['<rootDir>/test/e2e'],
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  // Serial: the specs truncate shared tables between files. One worker rather
  // than `--runInBand`, which runs the specs inside Jest's own process, where
  // the memory limit below cannot apply.
  maxWorkers: 1,
  /*
   * Replace the worker whenever it holds more than this after a spec file.
   * Every spec boots a whole Nest application and not all of it is handed
   * back, so a single process running the files in turn grows the whole way
   * through: measured at 1.9 GB rising to 3.7 GB over five minutes, never
   * levelling off. A CI runner allows the heap about 2 GB, and the suite died
   * there with "JavaScript heap out of memory". A fresh worker between files
   * keeps it bounded however many specs are added.
   */
  workerIdleMemoryLimit: '1GB',
  testTimeout: 45_000,
  forceExit: true,
};

export default config;
