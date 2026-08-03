import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/**
 * Browser end-to-end foundation.
 *
 * Assumes the stack is already running (`pnpm dev`) — Playwright deliberately
 * does not own the dev server here, because the API needs PostgreSQL, Redis and
 * a seeded database that Compose already provides.
 *
 *   pnpm --filter @coretask/web test:e2e:install   (once, downloads Chromium)
 *   pnpm --filter @coretask/web test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Each worker signs in once (see `e2e/fixtures.ts`), and `/auth/login` is
  // rate-limited, so worker count is capped rather than left to core count.
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_500 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
