import { expect, test } from './fixtures';

/**
 * Browser end-to-end coverage of comment threads.
 *
 * Requires the full stack (`pnpm dev`) with a seeded database. The `page`
 * fixture arrives already signed in as the demo owner; see `fixtures.ts`.
 */

/** Unique per run, so a rerun never collides with what the last one left. */
const stamp = () => `probe-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

test.describe('ticket comments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tickets');
    await page.getByRole('button', { name: /attachment upload/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('shows the thread inside the ticket detail', async ({ page }) => {
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('heading', { name: /comments/i })).toBeVisible();
    await expect(dialog.getByLabel(/write a comment/i)).toBeVisible();
  });

  test('posts a comment and clears the box', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    const body = `Ticket comment ${stamp()}`;

    await dialog.getByLabel(/write a comment/i).fill(body);
    await dialog.getByRole('button', { name: /^comment$/i }).click();

    await expect(dialog.getByText(body)).toBeVisible();
    await expect(dialog.getByLabel(/write a comment/i)).toHaveValue('');

    // Clean up so the seeded thread stays as the seed left it.
    await dialog
      .getByRole('listitem')
      .filter({ hasText: body })
      .getByRole('button', { name: /delete/i })
      .click();
    await expect(dialog.getByText(body)).toHaveCount(0);
  });

  test('will not post an empty comment', async ({ page }) => {
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('button', { name: /^comment$/i })).toBeDisabled();
    await dialog.getByLabel(/write a comment/i).fill('   ');
    await expect(dialog.getByRole('button', { name: /^comment$/i })).toBeDisabled();
  });

  test('edits a comment and marks it edited', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    const body = `Editable ${stamp()}`;
    const revised = `${body} (revised)`;

    await dialog.getByLabel(/write a comment/i).fill(body);
    await dialog.getByRole('button', { name: /^comment$/i }).click();
    await expect(dialog.getByText(body)).toBeVisible();

    const row = dialog.getByRole('listitem').filter({ hasText: body });
    await row.getByRole('button', { name: /edit/i }).click();
    await dialog.getByLabel(/edit comment/i).fill(revised);
    await dialog.getByRole('button', { name: /save/i }).click();

    await expect(dialog.getByText(revised)).toBeVisible();
    await expect(dialog.getByRole('listitem').filter({ hasText: revised })).toContainText(
      '(edited)',
    );

    await dialog
      .getByRole('listitem')
      .filter({ hasText: revised })
      .getByRole('button', { name: /delete/i })
      .click();
    await expect(dialog.getByText(revised)).toHaveCount(0);
  });

  /** A thread has to survive a reload — it is the record, not a draft. */
  test('a posted comment persists across a reload', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    const body = `Durable ${stamp()}`;

    await dialog.getByLabel(/write a comment/i).fill(body);
    await dialog.getByRole('button', { name: /^comment$/i }).click();
    await expect(dialog.getByText(body)).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: /attachment upload/i }).click();

    const reopened = page.getByRole('dialog');
    await expect(reopened.getByText(body)).toBeVisible();

    await reopened
      .getByRole('listitem')
      .filter({ hasText: body })
      .getByRole('button', { name: /delete/i })
      .click();
    await expect(reopened.getByText(body)).toHaveCount(0);
  });
});

test.describe('mentions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tickets');
    await page.getByRole('button', { name: /attachment upload/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('renders a seeded mention as a chip, not raw token syntax', async ({ page }) => {
    // The seeded thread is on CORE-1001, where Maya mentions the demo owner.
    await page.goto('/tickets');
    await page.getByRole('button', { name: /login fails with a 500/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('@Demo Owner')).toBeVisible();
    await expect(dialog.getByText('](')).toHaveCount(0);
  });

  test('offers teammates after typing @ and completes the token', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    const box = dialog.getByLabel(/write a comment/i);

    await box.fill('Ping @may');
    const options = dialog.getByRole('listbox', { name: /mention a teammate/i });
    await expect(options).toBeVisible();

    await options.getByRole('option', { name: /maya okafor/i }).click();

    // The chip is what shows; the token stays in the textarea value.
    await expect(box).toHaveValue(/@\[Maya Okafor\]\([0-9a-f-]{36}\) $/);
  });

  test('picks with the keyboard without submitting the comment', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    const box = dialog.getByLabel(/write a comment/i);

    await box.fill('Ping @');
    await expect(dialog.getByRole('listbox')).toBeVisible();

    // Enter belongs to the picker while it is open.
    await box.press('Enter');
    await expect(dialog.getByRole('listbox')).toHaveCount(0);
    await expect(box).toHaveValue(/@\[[^\]]+\]\([0-9a-f-]{36}\) $/);
  });

  test('does not open the picker on an e-mail address', async ({ page }) => {
    const dialog = page.getByRole('dialog');

    await dialog.getByLabel(/write a comment/i).fill('mail me at ada@example');
    await expect(dialog.getByRole('listbox')).toHaveCount(0);
  });

  test('posts a mention and shows it as a chip', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    const box = dialog.getByLabel(/write a comment/i);
    const marker = stamp();

    await box.fill('Ping @may');
    await dialog.getByRole('option', { name: /maya okafor/i }).click();
    await box.press('End');
    await box.pressSequentially(`please review ${marker}`);
    await dialog.getByRole('button', { name: /^comment$/i }).click();

    const posted = dialog.getByRole('listitem').filter({ hasText: marker });
    await expect(posted).toBeVisible();
    await expect(posted.getByText('@Maya Okafor')).toBeVisible();
    await expect(posted).not.toContainText('](');

    await posted.getByRole('button', { name: /delete/i }).click();
    await expect(dialog.getByText(marker)).toHaveCount(0);
  });
});

test.describe('task comments', () => {
  test('posts on a task from My Tasks', async ({ page }) => {
    await page.goto('/my-tasks');
    await page.getByRole('button', { name: /wire the dashboard/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const body = `Task comment ${stamp()}`;
    await dialog.getByLabel(/write a comment/i).fill(body);
    await dialog.getByRole('button', { name: /^comment$/i }).click();

    await expect(dialog.getByText(body)).toBeVisible();

    await dialog
      .getByRole('listitem')
      .filter({ hasText: body })
      .getByRole('button', { name: /delete/i })
      .click();
    await expect(dialog.getByText(body)).toHaveCount(0);
  });
});
