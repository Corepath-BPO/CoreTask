import type { Config } from 'jest';

/**
 * Integration suite. Needs PostgreSQL and Redis:
 *
 *   pnpm infra                 (starts the containers)
 *   pnpm --filter @coretask/api test:e2e
 *
 * Runs against the `coretask_e2e` schema, so development data is never touched.
 */
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
  // Serial: the specs truncate shared tables between files.
  maxWorkers: 1,
  testTimeout: 45_000,
  forceExit: true,
};

export default config;
