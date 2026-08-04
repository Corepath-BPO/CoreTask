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

test.describe('managing members', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/members');
  });

  test('offers a role picker for people the owner outranks', async ({ page }) => {
    await expect(page.getByLabel('Role for Jonas Feld')).toBeVisible();
    await expect(page.getByLabel('Role for Maya Okafor')).toBeVisible();
  });

  /** Nobody outranks the owner, so their role is shown but not editable. */
  test('shows the owner’s role as a badge, not a control', async ({ page }) => {
    await expect(page.getByLabel('Role for Demo Owner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Actions for Demo Owner' })).toHaveCount(0);
  });

  test('never offers Owner among the assignable roles', async ({ page }) => {
    await page.getByLabel('Role for Jonas Feld').click();

    await expect(page.getByRole('option', { name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Owner' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('changes a role and puts it back', async ({ page }) => {
    const picker = page.getByLabel('Role for Jonas Feld');

    await picker.click();
    await page.getByRole('option', { name: 'Manager' }).click();
    await expect(picker).toContainText('Manager');

    await page.reload();
    await expect(page.getByLabel('Role for Jonas Feld')).toContainText('Manager');

    await page.getByLabel('Role for Jonas Feld').click();
    await page.getByRole('option', { name: 'Member' }).click();
    await expect(page.getByLabel('Role for Jonas Feld')).toContainText('Member');
  });

  /** Removal is destructive and quiet afterwards, so it must be confirmed. */
  test('asks before removing, and can be dismissed', async ({ page }) => {
    await page.getByRole('button', { name: 'Actions for Jonas Feld' }).click();
    await page.getByRole('menuitem', { name: /remove from workspace/i }).click();

    await expect(page.getByRole('alertdialog')).toContainText(/unassigned/i);

    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // Still there, because nothing was confirmed.
    await expect(page.getByLabel('Role for Jonas Feld')).toBeVisible();
  });

  test('warns what transferring ownership costs', async ({ page }) => {
    await page.getByRole('button', { name: 'Actions for Maya Okafor' }).click();
    await page.getByRole('menuitem', { name: /make owner/i }).click();

    await expect(page.getByRole('alertdialog')).toContainText(/you become an administrator/i);
    await page.getByRole('button', { name: /cancel/i }).click();
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
