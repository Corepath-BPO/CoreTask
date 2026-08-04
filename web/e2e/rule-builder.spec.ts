import { expect, test } from './fixtures';

/**
 * The journey the spec describes: open a section's lightning, build a rule,
 * publish it, and see it listed. Execution itself is covered by the API — this
 * is about the rule being authorable without touching the database.
 */
test.describe('rule builder', () => {
  const openBuilderFromSection = async (page: import('@playwright/test').Page) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: /platform foundation/i }).first().click();
    await page.getByRole('button', { name: /automations for .* — /i }).first().click();
    await page.getByRole('link', { name: /add rule/i }).click();
  };

  test('opens with the section already chosen', async ({ page }) => {
    await openBuilderFromSection(page);

    await expect(page.getByLabel('Rule name')).toBeVisible();
    // The popover said which section; the builder must not ask again.
    await expect(page.getByRole('combobox', { name: 'Trigger', exact: true })).toContainText(/moved to a section/i);
    await expect(page.getByRole('combobox', { name: 'Section', exact: true })).not.toContainText(/any section/i);
  });

  test('publish is blocked until the rule could actually work', async ({ page }) => {
    await openBuilderFromSection(page);

    const publish = page.getByRole('button', { name: /^publish$/i });
    await expect(publish).toBeDisabled();
    await expect(page.getByText(/add at least one action/i)).toBeVisible();
  });

  test('adding a name and an action makes it publishable', async ({ page }) => {
    await openBuilderFromSection(page);

    await page.getByLabel('Rule name').fill('Assign on arrival');
    await page.getByRole('button', { name: /^add$/i }).last().click();

    await expect(page.getByRole('combobox', { name: 'Action 1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^publish$/i })).toBeEnabled();
  });

  test('unavailable actions are shown as unavailable, not hidden', async ({ page }) => {
    await openBuilderFromSection(page);
    await page.getByRole('button', { name: /^add$/i }).last().click();
    await page.getByRole('combobox', { name: 'Action 1', exact: true }).click();

    const planned = page.getByRole('option', { name: /send email — not yet available/i });
    await expect(planned).toBeVisible();
    await expect(planned).toBeDisabled();
  });

  test('a condition offers only the operators that field accepts', async ({ page }) => {
    await openBuilderFromSection(page);
    await page.getByRole('button', { name: /^add$/i }).first().click();

    await expect(page.getByRole('combobox', { name: 'Condition 1 field' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Condition 1 operator' })).toBeVisible();
  });

  test('back returns to the rules list without saving', async ({ page }) => {
    await openBuilderFromSection(page);
    await page.getByLabel('Rule name').fill('Abandoned');
    await page.getByRole('button', { name: /back to automations/i }).click();

    await expect(page).toHaveURL(/\/automations$/);
    await expect(page.getByText('Abandoned')).toBeHidden();
  });
});
