import { test as base, expect, type BrowserContext } from '@playwright/test';

/**
 * A signed-in `page` fixture, backed by one sign-in per worker.
 *
 * Two constraints shape this, and they pull against each other:
 *
 * 1. `/auth/login` is rate-limited at a credential-guessing pace, so a suite
 *    that signed in per test would throttle itself and fail for reasons that
 *    have nothing to do with what it tests.
 * 2. Refresh tokens *rotate*, and presenting a spent one is treated as a replay
 *    that revokes the whole family. That rules out Playwright's usual fix of
 *    saving `storageState` once and replaying it into every test: the first test
 *    rotates the saved token and every later one looks like an attacker.
 *
 * Sharing a live browser context per worker satisfies both. Each worker signs in
 * once, and its pages share the cookie jar, so rotation advances in step the way
 * it does for a real person with several tabs.
 */

const DEMO_EMAIL = process.env.SEED_USER_EMAIL ?? 'demo@coretask.dev';
const DEMO_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'CoreTask!2024';

export const test = base.extend<object, { authenticatedContext: BrowserContext }>({
  authenticatedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto('/login');
      await page.getByRole('textbox', { name: 'Email', exact: true }).fill(DEMO_EMAIL);
      // Exact, or the name also matches the "Show password" toggle.
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill(DEMO_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await expect(page).toHaveURL('/');
      await page.close();

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  page: async ({ authenticatedContext }, use) => {
    const page = await authenticatedContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
