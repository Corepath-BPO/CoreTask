import type { Config } from 'jest';

/**
 * Unit-test configuration. These specs never touch PostgreSQL, Redis or MinIO,
 * so `pnpm test` is safe to run on a bare checkout.
 *
 * Integration coverage lives in `test/e2e` and runs via `pnpm test:e2e`, which
 * requires the infrastructure containers (see README → Testing).
 */
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
