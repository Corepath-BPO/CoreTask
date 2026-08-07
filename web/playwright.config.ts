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
  /*
   * One worker, because three cost more than they saved.
   *
   * Every test signs in as the same demo owner and works in the one seeded
   * workspace (see `e2e/fixtures.ts`), so the suite was never as parallel as
   * the runner assumed. At three workers it lost about seven tests a run —
   * never the same seven, always a timeout waiting for an element rather than
   * a wrong value, and every one of them green when its file ran alone.
   *
   * Measured rather than guessed: three workers took 2.6 minutes and failed
   * seven; one takes 3.1 and fails none. Thirty seconds is not worth a suite
   * nobody can read, and a red run that means nothing costs far more than that
   * in the time spent re-running it to find out.
   *
   * This is a cap, not a diagnosis. What actually breaks under concurrency is
   * still unknown — cold Vite transforms, within-file collision and API rate
   * limiting were each tested and ruled out, and refresh-token replay is ruled
   * out too because revocation is scoped per session rather than per user. The
   * real fix is a workspace per test; until then the suite tells the truth.
   */
  workers: 1,
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
