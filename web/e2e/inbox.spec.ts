import { expect, test } from './fixtures';

/**
 * The inbox replaced a placeholder page, so the first thing worth asserting is
 * simply that it is real: a live feed rather than "coming soon".
 */
test.describe('inbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/inbox');
  });

  test('renders a real inbox, not the old placeholder', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(page.getByText(/planned for/i)).toBeHidden();
  });

  test('offers the three filters', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: /filter notifications/i });

    for (const label of ['All', 'Unread', 'Mentions']) {
      await expect(tabs.getByRole('tab', { name: label, exact: true })).toBeVisible();
    }
  });

  test('switching filter marks the tab selected', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: /filter notifications/i });
    const unread = tabs.getByRole('tab', { name: 'Unread', exact: true });

    await unread.click();

    await expect(unread).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: 'All', exact: true })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  /**
   * Either a populated list or the empty state is correct — what must not happen
   * is neither, which is what a broken query looks like.
   */
  test('shows either notifications or an empty state', async ({ page }) => {
    // Scoped to the inbox's own list: a bare listitem locator also matches the
    // sidebar's navigation items.
    const list = page.getByRole('list', { name: 'Notifications' }).getByRole('listitem');
    const empty = page.getByText(/nothing here yet|nothing matching/i);

    await expect(list.first().or(empty)).toBeVisible();
  });

  test('the bell and the page agree on the unread count', async ({ page }) => {
    const bell = page.getByRole('button', { name: /notifications/i });
    const label = (await bell.getAttribute('aria-label')) ?? '';
    const badge = /\((\d+) unread\)/.exec(label);

    if (!badge) {
      // Nothing unread: the page must not be offering to clear an empty inbox.
      await expect(page.getByRole('button', { name: /^mark all read$/i })).toBeHidden();
      return;
    }

    const tabs = page.getByRole('tablist', { name: /filter notifications/i });
    await expect(tabs.getByRole('tab', { name: 'Unread' })).toContainText(badge[1] as string);
  });
});
