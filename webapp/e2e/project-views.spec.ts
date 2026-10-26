import { expect, test } from './fixtures';

/**
 * A project is not a board. These assert the board still works exactly as it
 * did while no longer being the only way to see a project.
 */
test.describe('project views', () => {
  const openProject = async (page: import('@playwright/test').Page) => {
    await page.goto('/projects');
    await page
      .getByRole('link', { name: /platform foundation/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
  };

  /**
   * Toolbar changes reach the saved view through a debounced PATCH. A test
   * that ends inside that window leaves the shared view holding whatever it
   * set, and the next test inherits it — so every change waits for the write.
   */
  const persisted = (page: import('@playwright/test').Page) =>
    page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && response.url().includes('/views/'),
    );

  test('a bare project URL lands on the list', async ({ page }) => {
    await openProject(page);

    await expect(page).toHaveURL(/\/list$/);
    await expect(page.getByRole('tablist', { name: /project views/i })).toBeVisible();
  });

  test('the board still renders its sections', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^board$/i }).click();
    await expect(page).toHaveURL(/\/board$/);

    await expect(page.getByRole('tab', { name: /board/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText(/drag a column by its handle/i)).toBeVisible();
  });

  test('switching back to List shows the same tasks as a table', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^board$/i }).click();
    await expect(page).toHaveURL(/\/board$/);
    await page.getByRole('tab', { name: /^list$/i }).click();

    await expect(page).toHaveURL(/\/list$/);

    /*
     * A table per section, not one for the whole view: each section is its own
     * card, and they line up because every table declares the same widths. So
     * this asks a named section for its table rather than asking the page for
     * "the" table, which now matches five things.
     */
    await expect(page.getByRole('region', { name: 'Backlog' }).getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
  });

  test('the tab choice survives a reload', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^board$/i }).click();
    await expect(page).toHaveURL(/\/board$/);

    await page.reload();

    await expect(page.getByText(/drag a column by its handle/i)).toBeVisible();
    await expect(page.getByRole('tab', { name: /^board$/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('back returns to the previous tab', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^board$/i }).click();
    await expect(page).toHaveURL(/\/board$/);

    await page.goBack();

    await expect(page).toHaveURL(/\/list$/);
  });

  test('Options offers the fields and a density toggle', async ({ page }) => {
    // Asana keeps the column list under Options; the standalone Fields button
    // is gone, and this asserts the columns are reachable where Asana puts them.
    await openProject(page);
    await page.getByRole('tab', { name: /^list$/i }).click();
    await page.getByRole('button', { name: /^options$/i }).click();

    const fields = page.getByRole('region', { name: 'Fields' });
    await expect(fields).toBeVisible();
    await expect(fields.getByRole('menuitemcheckbox', { name: 'Due date' })).toBeVisible();

    // Section is not among them: every row already sits inside a card headed by
    // its section, so the column repeated that down the page for a column's
    // width. Asserted rather than merely dropped — an offer that puts back a
    // column the view will not render is worse than no offer.
    await expect(fields.getByRole('menuitemcheckbox', { name: 'Section' })).toBeHidden();

    await expect(page.getByRole('radiogroup', { name: 'Row density' })).toBeVisible();
  });

  test('a filter survives a reload because the view holds it', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^list$/i }).click();

    await page.getByRole('button', { name: /^filter$/i }).click();
    let saved = persisted(page);
    await page.getByRole('button', { name: 'Just my tasks' }).click();
    await page.keyboard.press('Escape');

    // The button carries the count once a condition holds.
    await expect(page.getByRole('button', { name: /filter, 1 active/i })).toBeVisible();

    // Written a moment after the click; the reload proves it landed.
    await saved;
    await page.reload();
    await expect(page.getByRole('button', { name: /filter, 1 active/i })).toBeVisible();

    await page.getByRole('button', { name: /filter, 1 active/i }).click();
    saved = persisted(page);
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^filter$/i })).toBeVisible();
    await saved;
  });

  test('sorting by a field takes the drag handles away', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^list$/i }).click();
    await expect(page.getByRole('button', { name: /^Move "/ }).first()).toBeAttached();

    await page.getByRole('button', { name: /^sort$/i }).click();
    let saved = persisted(page);
    await page.getByRole('button', { name: 'Add sort' }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: /sort, 1 active/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Move "/ })).toHaveCount(0);
    await saved;

    await page.getByRole('button', { name: /sort, 1 active/i }).click();
    saved = persisted(page);
    await page.getByRole('radio', { name: 'Manual order' }).check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Move "/ }).first()).toBeAttached();
    await saved;
  });

  test('grouping the board by status shows one column per status', async ({ page }) => {
    await openProject(page);
    await page.getByRole('tab', { name: /^board$/i }).click();
    await expect(page).toHaveURL(/\/board$/);

    await page.getByRole('button', { name: /^group$/i }).click();
    let saved = persisted(page);
    await page.getByRole('radio', { name: 'Status' }).check();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('region', { name: /in progress/i })).toBeVisible();
    await saved;

    await page.getByRole('button', { name: /^group/i }).click();
    saved = persisted(page);
    await page.getByRole('radio', { name: 'Section' }).check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Backlog' })).toBeVisible();
    await saved;
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
