import { expect, test } from './fixtures';

test.describe('automations', () => {
  const openProject = async (page: import('@playwright/test').Page) => {
    await page.goto('/projects');
    await page
      .getByRole('link', { name: /platform foundation/i })
      .first()
      .click();
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
    await page
      .getByRole('button', { name: /automations for .* — /i })
      .first()
      .click();

    await expect(page.getByText(/rules for/i)).toBeVisible();
    await expect(page.getByText(/nothing runs when a task lands here yet/i)).toBeVisible();
  });

  /**
   * The section has to travel with the link. Without it the builder would ask
   * again for something the click already said.
   */
  test('Add rule carries the section into the builder', async ({ page }) => {
    await openProject(page);
    await page
      .getByRole('button', { name: /automations for .* — /i })
      .first()
      .click();
    await page.getByRole('link', { name: /add rule/i }).click();

    await expect(page).toHaveURL(/\/automations\/new\?.*sectionId=[0-9a-f-]+/);

    /*
     * And opens as a sentence somebody can edit rather than compose.
     *
     * Three cards: when this happens, if this is true, do this. The check is
     * filled in from the section the click came from — a rule that opens with
     * its own first question already answered is the point of starting from a
     * section at all.
     */
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__node')].map(
        (node) => node.querySelector('button')?.getAttribute('aria-label') ?? '',
      ),
    );

    // Named after the section too, so a rule arrives with something a person
    // would recognise in a list rather than a blank field to fill in. A heading
    // rather than an input: the name is only a field while it is being typed.
    await expect(page.getByRole('button', { name: /^Rule name: When moved to \S/ })).toBeVisible();

    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/^When/);
    expect(labels[1]).toMatch(/^Check if — Section is \S/);
    expect(labels[2]).toMatch(/^Add a step/);
  });

  test('Manage all reaches the rules page', async ({ page }) => {
    await openProject(page);
    await page
      .getByRole('button', { name: /automations for .* — /i })
      .first()
      .click();
    await page.getByRole('link', { name: /manage all/i }).click();

    await expect(page).toHaveURL(/\/automations$/);
  });
});
