import { expect, test } from './fixtures';

/**
 * Browser coverage of the teams page and the project association.
 *
 * The `page` fixture is signed in as the demo owner. Every test creates a
 * uniquely named team and deletes it again, so the seeded workspace is left as
 * it was — the demo data is what the README tells people to expect.
 */

const uniqueName = () => `Probe ${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** Creates a team through the UI and returns its name. */
async function createTeam(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: /new team/i }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/team name/i).fill(name);
  await dialog.getByRole('button', { name: /create team/i }).click();
  await expect(dialog).toBeHidden();

  return page.getByRole('list', { name: 'Teams' }).getByText(name, { exact: true });
}

async function deleteTeam(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: /delete team/i }).click();

  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: /^delete$/i }).click();
  await expect(confirm).toBeHidden();
}

test.describe('teams', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/teams');
  });

  test('creates a team, shows it, and deletes it again', async ({ page }) => {
    const name = uniqueName();

    await expect(await createTeam(page, name)).toBeVisible();

    // A brand new team has nobody on it and owns nothing.
    const card = page.getByRole('listitem').filter({ hasText: name });
    await expect(card.getByText('0 members')).toBeVisible();
    await expect(card.getByText('No lead')).toBeVisible();

    await deleteTeam(page, name);
    await expect(page.getByRole('list', { name: 'Teams' }).getByText(name)).toHaveCount(0);
  });

  test('refuses a duplicate name and keeps the dialog open', async ({ page }) => {
    const name = uniqueName();
    await createTeam(page, name);

    await page.getByRole('button', { name: /new team/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/team name/i).fill(name);
    await dialog.getByRole('button', { name: /create team/i }).click();

    await expect(page.getByRole('alert').filter({ hasText: /already exists/i })).toBeVisible();
    await expect(dialog).toBeVisible();

    await page.getByRole('button', { name: /cancel/i }).click();
    await deleteTeam(page, name);
  });

  test('validates the name before sending anything', async ({ page }) => {
    await page.getByRole('button', { name: /new team/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/team name/i).fill('X');
    await dialog.getByRole('button', { name: /create team/i }).click();

    await expect(dialog.getByText(/at least 2 characters/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('adds a member to the roster and removes them', async ({ page }) => {
    const name = uniqueName();
    await createTeam(page, name);

    const card = page.getByRole('listitem').filter({ hasText: name });
    await card.getByRole('button', { name: /manage members/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: /person to add/i }).click();
    await page.getByRole('option', { name: 'Maya Okafor' }).click();
    await dialog.getByRole('button', { name: /^add$/i }).click();

    const roster = dialog.getByRole('list', { name: `${name} members` });
    await expect(roster.getByText('Maya Okafor')).toBeVisible();

    await dialog.getByRole('button', { name: `Remove Maya Okafor from ${name}` }).click();
    await expect(roster.getByText('Maya Okafor')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await deleteTeam(page, name);
  });

  test('assigns a project to a team, then filters the list by it', async ({ page }) => {
    const name = uniqueName();
    await createTeam(page, name);

    // Attach an existing seeded project rather than creating one: a project is
    // a heavier thing to clean up, and editing proves the same association.
    await page.goto('/projects');
    const project = page.getByRole('heading', { name: 'Platform Foundation' });
    await expect(project).toBeVisible();

    await page.getByRole('button', { name: /actions for platform foundation/i }).click();
    await page.getByRole('menuitem', { name: /edit project/i }).click();

    const form = page.getByRole('dialog');
    await form.getByRole('combobox', { name: /^team$/i }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await form.getByRole('button', { name: /save changes/i }).click();
    await expect(form).toBeHidden();

    // The badge is the visible proof the association stuck.
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

    /*
     * Counted, not compared against another project by name: the seed owns one
     * project and a developer's database has others, so "assert X disappeared"
     * would pass vacuously wherever X never existed. Exclusion is pinned down
     * rigorously by the API suite, which creates both projects itself.
     */
    const cards = page.locator('a[href^="/projects/"]');

    await page.getByRole('combobox', { name: /filter by team/i }).click();
    await page.getByRole('option', { name, exact: true }).click();

    await expect(page).toHaveURL(/teamId=/);
    await expect(cards).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Platform Foundation' })).toBeVisible();

    // Back to the seed's own association — the seed puts this project on the
    // "Platform" team, so leaving it teamless would quietly break the demo data
    // for everything that runs afterwards.
    await page.getByRole('button', { name: /actions for platform foundation/i }).click();
    await page.getByRole('menuitem', { name: /edit project/i }).click();
    await form.getByRole('combobox', { name: /^team$/i }).click();
    await page.getByRole('option', { name: 'Platform', exact: true }).click();
    await form.getByRole('button', { name: /save changes/i }).click();
    await expect(form).toBeHidden();

    await page.goto('/teams');
    await deleteTeam(page, name);
  });
});
