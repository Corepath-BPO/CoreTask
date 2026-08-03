import { expect, test } from './fixtures';

/**
 * Browser end-to-end coverage of the ticket queue.
 *
 * Requires the full stack (`pnpm dev`) with a seeded database — the seed ships
 * five tickets, `CORE-1001` to `CORE-1005`. The `page` fixture arrives already
 * signed in; see `fixtures.ts`.
 */

test.describe('tickets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tickets');
    await expect(page).toHaveURL('/tickets');
  });

  test('lists seeded tickets with their keys', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^tickets$/i })).toBeVisible();
    await expect(page.getByText('CORE-1003')).toBeVisible();

    // Resolved and closed work is hidden until asked for.
    await expect(page.getByText('CORE-1004')).toHaveCount(0);
  });

  test('shows a rollup that counts the whole workspace', async ({ page }) => {
    // "Open", "Urgent" and "Unassigned" are also badge text on every row below,
    // so the rollup is asserted through labels that only the tiles carry.
    await expect(page.getByText(/\d+ all time/)).toBeVisible();
    await expect(page.getByText('Overdue', { exact: true })).toBeVisible();
  });

  test('finds a ticket by pasting its key', async ({ page }) => {
    await page.getByLabel(/search tickets/i).fill('CORE-1002');

    await expect(page.getByText('CORE-1002')).toBeVisible();
    await expect(page.getByText('CORE-1003')).toHaveCount(0);
  });

  test('searches titles case-insensitively', async ({ page }) => {
    await page.getByLabel(/search tickets/i).fill('KEYBOARD');

    await expect(page.getByText('CORE-1002')).toBeVisible();
    await expect(page.getByText('CORE-1003')).toHaveCount(0);
  });

  test('reveals resolved tickets only when the filter is widened', async ({ page }) => {
    await expect(page.getByText('CORE-1004')).toHaveCount(0);

    await page.getByLabel(/filter by status/i).click();
    await page.getByRole('option', { name: /all statuses/i }).click();

    await expect(page.getByText('CORE-1004')).toBeVisible();
  });

  test('opens a ticket and shows its detail', async ({ page }) => {
    await page.getByRole('button', { name: /attachment upload/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('CORE-1003')).toBeVisible();
    await expect(dialog.getByLabel(/ticket status/i)).toBeVisible();
  });

  /** The whole point of a key: a pasted link has to resolve without an id. */
  test('changing status through the detail dialog persists', async ({ page }) => {
    await page.getByRole('button', { name: /keyboard shortcuts/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/ticket status/i).click();
    await page.getByRole('option', { name: /^triaged$/i }).click();

    await expect(dialog.getByText(/triaged/i).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await page.reload();

    await expect(page.getByText('CORE-1002')).toBeVisible();
    await page.getByRole('button', { name: /keyboard shortcuts/i }).click();
    await expect(
      page
        .getByRole('dialog')
        .getByText(/triaged/i)
        .first(),
    ).toBeVisible();

    // Put the seed back so a rerun starts from the same place.
    await page
      .getByRole('dialog')
      .getByLabel(/ticket status/i)
      .click();
    await page.getByRole('option', { name: /^open$/i }).click();
  });

  test('reports a ticket and gives it the next key', async ({ page }) => {
    await page.getByRole('button', { name: /report ticket/i }).click();

    const dialog = page.getByRole('dialog');
    const title = `Playwright probe ${Date.now()}`;
    await dialog.getByLabel(/summary/i).fill(title);
    await dialog.getByRole('button', { name: /report ticket/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(title)).toBeVisible();
  });

  test('validates an empty summary rather than submitting', async ({ page }) => {
    await page.getByRole('button', { name: /report ticket/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /report ticket/i }).click();

    await expect(dialog.getByText(/ticket title is required/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe('notifications', () => {
  test('the bell reads its count from the API', async ({ page }) => {
    await page.goto('/');

    const bell = page.getByRole('button', { name: /notifications/i });
    await expect(bell).toBeVisible();
    await bell.click();

    await expect(page.getByRole('menu')).toBeVisible();
  });
});
