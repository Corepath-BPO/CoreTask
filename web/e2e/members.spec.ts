import { expect, test } from './fixtures';

/**
 * Browser coverage of the members page and the invitation lifecycle.
 *
 * The `page` fixture is signed in as the demo owner. Each test invites a unique
 * address and revokes it again, so the seeded workspace is left as it was.
 */

const uniqueEmail = () => `probe-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;

test.describe('members', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/members');
  });

  test('lists the seeded members with their roles', async ({ page }) => {
    // Scoped to the list: names also appear in the account menu.
    const members = page.getByRole('list', { name: 'Workspace members' });

    await expect(members.getByText('Demo Owner')).toBeVisible();
    await expect(members.getByText('Maya Okafor')).toBeVisible();
    await expect(members.getByText('(you)')).toBeVisible();
    await expect(members.getByText('Owner', { exact: true })).toBeVisible();
  });

  test('invites someone and shows them as pending, then revokes', async ({ page }) => {
    const email = uniqueEmail();

    await page.getByRole('button', { name: /^invite$/i }).click();
    await page.getByLabel(/e-mail/i).fill(email);
    await page.getByRole('button', { name: /send invitation/i }).click();

    await expect(page.getByRole('dialog')).toBeHidden();

    // Anchored on the revoke control rather than the text: the success toast
    // also names the address, and Sonner renders toasts as list items too.
    const revoke = page.getByRole('button', { name: `Revoke the invitation to ${email}` });
    await expect(revoke).toBeVisible();

    await revoke.click();
    await expect(revoke).toHaveCount(0);
  });

  test('refuses to invite someone who is already a member', async ({ page }) => {
    await page.getByRole('button', { name: /^invite$/i }).click();
    await page.getByLabel(/e-mail/i).fill('maya@coretask.dev');
    await page.getByRole('button', { name: /send invitation/i }).click();

    await expect(page.getByRole('alert').filter({ hasText: /already a member/i })).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('validates the address before sending', async ({ page }) => {
    await page.getByRole('button', { name: /^invite$/i }).click();
    await page.getByLabel(/e-mail/i).fill('not-an-address');
    await page.getByRole('button', { name: /send invitation/i }).click();

    await expect(page.getByText(/valid e-mail/i)).toBeVisible();
  });

  /** The picker must not offer a role the API would refuse. */
  test('never offers Owner as an invitable role', async ({ page }) => {
    await page.getByRole('button', { name: /^invite$/i }).click();
    await page.getByLabel(/role/i).click();

    await expect(page.getByRole('option', { name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Owner' })).toHaveCount(0);
  });
});

test.describe('accepting an invitation', () => {
  test('tells an anonymous visitor an unusable link is dead', async ({ browser }) => {
    // A fresh context, because this page is for people with no session at all.
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/invitations/definitely-not-a-real-token');
    await expect(page.getByText(/no longer valid/i)).toBeVisible();

    await context.close();
  });

  /**
   * The route hangs off the root rather than the guest or protected gate, so it
   * must render for a signed-in user too rather than redirecting them away.
   */
  test('renders for a signed-in user rather than bouncing them', async ({ page }) => {
    await page.goto('/invitations/definitely-not-a-real-token');

    await expect(page.getByText(/no longer valid/i)).toBeVisible();
    expect(page.url()).toContain('/invitations/');
  });
});
