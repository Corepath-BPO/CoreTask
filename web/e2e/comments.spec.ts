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
