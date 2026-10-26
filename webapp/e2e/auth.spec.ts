import { expect, test } from '@playwright/test';

/**
 * Browser end-to-end coverage of the authentication slice.
 *
 * Requires the full stack (`pnpm dev`) with a seeded database. See
 * `playwright.config.ts` for why the server is not started here.
 */

const DEMO_EMAIL = process.env.SEED_USER_EMAIL ?? 'demo@coretask.dev';
const DEMO_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'CoreTask!2024';

test.describe('authentication', () => {
  test('redirects an anonymous visitor to the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /sign in to coretask/i })).toBeVisible();
  });

  test('shows inline validation instead of submitting an empty form', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByText(/e-mail address is required/i)).toBeVisible();
    await expect(page.getByText(/password is required/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('rejects bad credentials with the server message', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(DEMO_EMAIL);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('DefinitelyWrong!1');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByRole('alert').filter({ hasText: /incorrect/i })).toBeVisible();
  });

  test('signs in, lands on the dashboard, and survives a reload', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(DEMO_EMAIL);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { name: /good (morning|afternoon|evening)/i }),
    ).toBeVisible();

    // The access token is memory-only; surviving a reload proves the HTTP-only
    // refresh cookie and the session-restore call are both working.
    await page.reload();
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { name: /good (morning|afternoon|evening)/i }),
    ).toBeVisible();
  });

  test('password visibility toggle reveals and hides the value', async ({ page }) => {
    await page.goto('/login');
    const password = page.getByRole('textbox', { name: 'Password', exact: true });
    await password.fill('CoreTask!2024');

    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: /show password/i }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: /hide password/i }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('signing out returns to login and blocks the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(DEMO_EMAIL);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();

    await expect(page).toHaveURL(/\/login/);

    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});
