import { expect, test, type Page } from './fixtures';

/**
 * Project privacy and the Share dialog, against the seed.
 *
 * "Platform Foundation" is public; the demo owner is its lead and admin.
 * "Leadership Planning" is private to the owner and Maya. Jonas is a workspace
 * member on neither roster — the person the private project must not exist
 * for. Every change made here is undone, so the seed is left as it was.
 */

const SEED_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'CoreTask!2024';

const openProject = async (page: Page, name: RegExp) => {
  await page.goto('/projects');
  await page.getByRole('link', { name }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
};

const openShare = async (page: Page) => {
  await page.getByRole('button', { name: /^share$/i }).click();
  const dialog = page.getByRole('dialog', { name: /share platform foundation/i });
  await expect(dialog).toBeVisible();
  return dialog;
};

/** Picks an option in a Radix Select by its trigger's accessible name. */
const choose = async (page: Page, trigger: RegExp, option: RegExp) => {
  await page.getByRole('combobox', { name: trigger }).click();
  await page.getByRole('option', { name: option }).click();
};

test.describe('project privacy', () => {
  test('marks the private project with a padlock and filters by membership', async ({ page }) => {
    await page.goto('/projects');

    // The padlock sits beside the name, in the same cell as the link.
    const nameCell = (name: RegExp) => page.getByRole('link', { name }).first().locator('..');
    await expect(nameCell(/leadership planning/i)).toBeVisible();
    await expect(
      nameCell(/leadership planning/i).getByRole('img', { name: 'Private project' }),
    ).toBeVisible();
    await expect(
      nameCell(/platform foundation/i).getByRole('img', { name: 'Private project' }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: /^members$/i }).click();
    await page.getByRole('menuitem', { name: /private to members/i }).click();
    await expect(page.getByRole('link', { name: /leadership planning/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /platform foundation/i })).toHaveCount(0);
  });

  test('adds, promotes and removes a member from the Share dialog', async ({ page }) => {
    await openProject(page, /platform foundation/i);
    const dialog = await openShare(page);

    // The owner is on the roster as its admin.
    await expect(dialog.getByRole('combobox', { name: 'Role for Demo Owner' })).toBeVisible();

    // Jonas is seeded as an editor; take him off first so the test starts clean.
    const jonasRemove = dialog.getByRole('button', {
      name: 'Remove Jonas Feld from Platform Foundation',
    });
    if (await jonasRemove.isVisible()) {
      await jonasRemove.click();
      await expect(jonasRemove).toBeHidden();
    }

    try {
      await choose(page, /role for new members/i, /viewer/i);
      await dialog.getByRole('button', { name: 'Add people' }).click();
      await page.getByPlaceholder(/find someone/i).fill('Jonas');
      await page.getByRole('option', { name: /jonas feld/i }).click();

      const jonasRole = dialog.getByRole('combobox', { name: 'Role for Jonas Feld' });
      await expect(jonasRole).toContainText(/viewer/i);

      await choose(page, /role for jonas feld/i, /editor/i);
      await expect(jonasRole).toContainText(/editor/i);

      // Closed and reopened rather than reloaded: the roster is refetched on
      // every change, and a reload mid-rotation of the refresh token can log
      // the shared context out. Persistence itself is the API suite's job.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await openShare(page);
      await expect(page.getByRole('combobox', { name: 'Role for Jonas Feld' })).toContainText(
        /editor/i,
      );
    } finally {
      // Back to the seed: Jonas as an editor of Platform Foundation.
      const reopened = page.getByRole('dialog', { name: /share platform foundation/i });
      if (!(await reopened.isVisible())) await openShare(page);
      const role = page.getByRole('combobox', { name: 'Role for Jonas Feld' });
      if (await role.isVisible()) {
        if (!(await role.textContent())?.match(/editor/i)) {
          await choose(page, /role for jonas feld/i, /editor/i);
        }
      } else {
        await choose(page, /role for new members/i, /editor/i);
        await page.getByRole('button', { name: 'Add people' }).click();
        await page.getByPlaceholder(/find someone/i).fill('Jonas');
        await page.getByRole('option', { name: /jonas feld/i }).click();
        await expect(page.getByRole('combobox', { name: 'Role for Jonas Feld' })).toBeVisible();
      }
    }
  });

  test('flips a project private and back', async ({ page }) => {
    await openProject(page, /platform foundation/i);
    const padlock = page.getByRole('img', { name: 'Private project' });

    // A previous run that died mid-way leaves the project private; start public.
    if (await padlock.first().isVisible()) {
      await openShare(page);
      await choose(page, /who can see this project/i, /public to workspace/i);
      await page.keyboard.press('Escape');
      await expect(padlock).toHaveCount(0);
    }

    await openShare(page);

    try {
      await choose(page, /who can see this project/i, /private to members/i);
      const confirm = page.getByRole('alertdialog');
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: /make private/i }).click();
      await expect(confirm).toBeHidden();

      // Asserted with the dialog closed: while it is open, Radix hides the
      // rest of the page from assistive technology, padlock included.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: /share platform foundation/i })).toBeHidden();
      await expect(padlock.first()).toBeVisible();
    } finally {
      const dialog = page.getByRole('dialog', { name: /share platform foundation/i });
      if (!(await dialog.isVisible())) await openShare(page);
      await choose(page, /who can see this project/i, /public to workspace/i);
      await page.keyboard.press('Escape');
      await expect(padlock).toHaveCount(0);
    }
  });

  test('keeps the last admin of a private project', async ({ page }) => {
    await openProject(page, /leadership planning/i);
    await page.getByRole('button', { name: /^share$/i }).click();
    const dialog = page.getByRole('dialog', { name: /share leadership planning/i });
    await expect(dialog).toBeVisible();

    try {
      await choose(page, /role for maya okafor/i, /viewer/i);
      // With Maya demoted, the owner is the only admin left: the picker locks.
      await expect(dialog.getByRole('combobox', { name: 'Role for Demo Owner' })).toBeDisabled();
    } finally {
      await choose(page, /role for maya okafor/i, /admin/i);
      await expect(dialog.getByRole('combobox', { name: 'Role for Demo Owner' })).toBeEnabled();
    }
  });

  test('does not exist for a workspace member who is not on it', async ({ browser, page }) => {
    // Capture the private project's URL as somebody who can see it.
    await openProject(page, /leadership planning/i);
    const url = page.url();

    // One extra sign-in per run, well inside the login rate limit.
    const context = await browser.newContext();
    const jonas = await context.newPage();
    await jonas.goto('/login');
    await jonas.getByRole('textbox', { name: 'Email', exact: true }).fill('jonas@coretask.dev');
    await jonas.getByRole('textbox', { name: 'Password', exact: true }).fill(SEED_PASSWORD);
    await jonas.getByRole('button', { name: /^sign in$/i }).click();
    await expect(jonas).toHaveURL('/');

    await jonas.goto('/projects');
    await expect(jonas.getByRole('link', { name: /platform foundation/i }).first()).toBeVisible();
    await expect(jonas.getByRole('link', { name: /leadership planning/i })).toHaveCount(0);

    await jonas.goto(url);
    await expect(jonas.getByText(/project not found/i)).toBeVisible();

    await context.close();
  });
});
