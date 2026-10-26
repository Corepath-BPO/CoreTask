import { expect, test } from './fixtures';

/**
 * Every notification carries an `actionUrl`, and for a long time none of them
 * went anywhere: tickets pointed at `/tickets/CORE-1001`, a route that does not
 * exist, and `/my-tasks?task=<id>` resolved but the page ignored the parameter.
 * Clicking an inbox entry landed you on a list to find the thing yourself.
 */
test.describe('notification deep links', () => {
  test('a ticket link opens that ticket', async ({ page }) => {
    await page.goto('/tickets?ticket=CORE-1003');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('CORE-1003');
  });

  test('a ticket link survives a reload, so it can be shared', async ({ page }) => {
    await page.goto('/tickets?ticket=CORE-1001');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.reload();

    await expect(page.getByRole('dialog')).toContainText('CORE-1001');
  });

  test('a nonsense ticket key is ignored rather than breaking the page', async ({ page }) => {
    await page.goto('/tickets?ticket=not-a-key');

    // The queue renders as normal and nothing is opened.
    await expect(page.getByText('CORE-1001')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the queue still opens normally with no parameter', async ({ page }) => {
    await page.goto('/tickets');

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('CORE-1001')).toBeVisible();
  });
});
