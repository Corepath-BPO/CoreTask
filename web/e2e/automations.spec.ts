import { expect, test } from './fixtures';

test.describe('automations', () => {
  const openProject = async (page: import('@playwright/test').Page) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: /platform foundation/i }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
  };

  test('the Automations tab is real, not a placeholder', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /automations/i }).click();

    await expect(page).toHaveURL(/\/automations$/);
    await expect(page.getByText(/not built yet/i)).toBeHidden();
    await expect(page.getByText(/no automations yet/i)).toBeVisible();
  });

  test('each section header offers its rules', async ({ page }) => {
    await openProject(page);

    // Named for its state, so the meaning is not carried by colour alone.
    const lightning = page.getByRole('button', { name: /automations for .* — /i }).first();
    await expect(lightning).toBeVisible();
  });

  test('the popover explains an empty section rather than showing nothing', async ({ page }) => {
    await openProject(page);
    await page.getByRole('button', { name: /automations for .* — /i }).first().click();

    await expect(page.getByText(/rules for/i)).toBeVisible();
    await expect(page.getByText(/nothing runs when a task lands here yet/i)).toBeVisible();
  });

  /**
   * The section has to travel with the link. Without it the builder would ask
   * again for something the click already said.
   */
  test('Add rule carries the section into the builder', async ({ page }) => {
    await openProject(page);
    await page.getByRole('button', { name: /automations for .* — /i }).first().click();
    await page.getByRole('link', { name: /add rule/i }).click();

    await expect(page).toHaveURL(/\/automations\?.*sectionId=[0-9a-f-]+/);
  });

  test('Manage all reaches the rules page', async ({ page }) => {
    await openProject(page);
    await page.getByRole('button', { name: /automations for .* — /i }).first().click();
    await page.getByRole('link', { name: /manage all/i }).click();

    await expect(page).toHaveURL(/\/automations$/);
  });
});
