import { expect, test } from './fixtures';

/**
 * A project is not a board. These assert the board still works exactly as it
 * did while no longer being the only way to see a project.
 */
test.describe('project views', () => {
  const openProject = async (page: import('@playwright/test').Page) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: /platform foundation/i }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
  };

  test('a bare project URL lands on the board', async ({ page }) => {
    await openProject(page);

    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole('tablist', { name: /project views/i })).toBeVisible();
  });

  test('the board still renders its sections', async ({ page }) => {
    await openProject(page);

    await expect(page.getByRole('tab', { name: /board/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText(/drag a column by its handle/i)).toBeVisible();
  });

  test('switching to List shows the same tasks as a table', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^list$/i }).click();

    await expect(page).toHaveURL(/\/list$/);

    /*
     * A table per section, not one for the whole view: each section is its own
     * card, and they line up because every table declares the same widths. So
     * this asks a named section for its table rather than asking the page for
     * "the" table, which now matches five things.
     */
    await expect(page.getByRole('region', { name: 'Backlog' }).getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Task' })).toBeVisible();
  });

  test('the tab choice survives a reload', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^list$/i }).click();
    await expect(page).toHaveURL(/\/list$/);

    await page.reload();

    await expect(page.getByRole('region', { name: 'Backlog' }).getByRole('table')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^list$/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('back returns to the previous tab', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^list$/i }).click();
    await expect(page).toHaveURL(/\/list$/);

    await page.goBack();

    await expect(page).toHaveURL(/\/board$/);
  });

  test('the Fields menu offers the columns', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^list$/i }).click();
    await page.getByRole('button', { name: /fields/i }).click();

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Due date' })).toBeVisible();

    // Section is not among them: every row already sits inside a card headed by
    // its section, so the column repeated that down the page for a column's
    // width. Asserted rather than merely dropped — an offer that puts back a
    // column the view will not render is worse than no offer.
    await expect(menu.getByRole('menuitem', { name: 'Section' })).toBeHidden();
  });

  /**
   * Activity, not Automations — Automations became real in milestone 7, and a
   * test asserting it is still a placeholder would pass only for as long as
   * nobody built it.
   */
  test('unbuilt tabs say so rather than faking a screen', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /activity/i }).click();

    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByText(/not built yet/i)).toBeVisible();
  });
});
