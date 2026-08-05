import { request as apiRequest, type Page } from '@playwright/test';

import { expect, test } from './fixtures';

/**
 * The whole field journey, end to end: search for something that does not
 * exist, build it, use it, and reuse it on another project.
 *
 * Run in one serial test rather than several, because every step depends on the
 * one before it — a field has to exist before a column can show it, and a
 * column has to exist before a refresh can prove it persisted. Split apart,
 * each step would have to rebuild the state of the last, and the thing actually
 * worth asserting — that the steps join up — would never be tested.
 *
 * Cleans up after itself in `afterAll`, including on failure, so a red run does
 * not leave a field behind that makes the next run fail for a different reason.
 */
test.describe.configure({ mode: 'serial' });

const FIELD = `Risk ${Date.now().toString(36)}`;

test.describe('the field library', () => {
  const openList = async (page: Page, project = /platform foundation/i) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: project }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
    await page.getByRole('tab', { name: /^list$/i }).click();
    await expect(page).toHaveURL(/\/list$/);
  };

  const picker = (page: Page) => page.getByRole('button', { name: 'Add field' });

  test('creates a select field from the picker and uses it', async ({ page }) => {
    await openList(page);

    // 1. The `+` opens a searchable picker.
    await picker(page).click();
    const search = page.getByLabel('Search or create a field');
    await expect(search).toBeVisible();

    // 2. A term that matches nothing offers to create it.
    await search.fill(FIELD);
    await expect(page.getByText(/Create custom field/)).toBeVisible();
    await page.getByText(/Create custom field/).click();

    // 3. The builder opens prefilled, and becomes type-aware on choosing one.
    const dialog = page.getByRole('dialog').filter({ hasText: 'Create a field' });
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(FIELD);

    await dialog.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: /single-select/i }).click();

    // 4. Options, with the colours the builder assigned.
    // By role, not label: every control in an option row carries "option 1" in
    // its own label — the colour swatch, both move buttons and remove.
    const option = (index: number) =>
      dialog.getByRole('textbox', { name: `Option ${index}`, exact: true });

    await option(1).fill('Low');
    await option(2).fill('High');
    await dialog.getByRole('button', { name: /add option/i }).click();
    await option(3).fill('Critical');

    await dialog.getByRole('button', { name: 'Create field' }).click();
    await expect(dialog).toBeHidden();

    // 5. The column arrives as the last one, and its cell is editable at once.
    await expect(page.getByRole('columnheader', { name: FIELD })).toBeVisible();

    const cell = page.getByRole('button', { name: new RegExp(`^${FIELD} for `) }).first();
    await cell.click();
    await page.getByRole('option', { name: 'High' }).click();
    await expect(page.getByText('High').first()).toBeVisible();
  });

  test('keeps the column and the value across a refresh', async ({ page }) => {
    // The point of persisting a view: a column somebody added is still there
    // tomorrow, and so is what they put in it.
    await openList(page);

    await expect(page.getByRole('columnheader', { name: FIELD })).toBeVisible();
    await expect(page.getByText('High').first()).toBeVisible();
  });

  test('offers the same field to another project rather than a copy', async ({ page }) => {
    await openList(page);

    await picker(page).click();

    // Waited for rather than clicked into: the popover grows as results arrive,
    // and clicking the footer mid-load is clicking where it used to be.
    await expect(page.getByText('Loading fields…')).toBeHidden();
    await expect(page.getByText('Field types')).toBeVisible();

    /*
     * Reached from the keyboard rather than the pointer.
     *
     * The picker has to be usable without a mouse, so this exercises the
     * requirement rather than working around it — and it sidesteps the
     * pointer-stability check on a footer that sits below a list whose height
     * follows the results.
     */
    const footer = page.getByRole('button', { name: /choose from field library/i });
    await footer.focus();
    await page.keyboard.press('Enter');

    const library = page.getByRole('dialog').filter({ hasText: 'Field library' });
    await expect(library).toBeVisible();

    // Already used here, so it is shown as present rather than offered again.
    const row = library.getByRole('listitem').filter({ hasText: FIELD });
    await expect(row).toContainText(/in this view|add to view/i);

    // And its options travel with it, which is what makes reuse worth having.
    await expect(row).toContainText('Low');
    await expect(row).toContainText('High');
  });

  test('will not create a second definition with the same name', async ({ page }) => {
    await openList(page);

    await picker(page).click();
    await page.getByLabel('Search or create a field').fill(FIELD);

    // An exact match is not offered as something to create — the picker points
    // at the field that already exists instead.
    await expect(page.getByText(/Create custom field/)).toBeHidden();
  });

  test.afterAll(async () => {
    /*
     * Removed through the API rather than the UI: cleanup has to run even when
     * a test above failed part-way, and driving a broken screen to tidy up is
     * how one failure becomes a suite that can never pass again.
     *
     * Pointed at the API's origin, not at the app, and not at a base carrying a
     * path. The page `baseURL` serves the web dev server, which does not proxy
     * `/api` — the browser calls the API directly — and a hand-built context
     * inherits no `baseURL` at all. A base of `…:3010/api/v1` does not help
     * either: an absolute path replaces the whole path, so `/auth/login`
     * resolves against the origin and drops the prefix. Origin here, prefix on
     * each path.
     *
     * Worth getting right rather than skipping: while this silently 404'd, the
     * cleanup did nothing and left six fields behind — each one a name the next
     * run would find already taken.
     */
    const request = await apiRequest.newContext({
      baseURL: process.env['E2E_API_ORIGIN'] ?? 'http://localhost:3010',
    });

    const login = await request.post('/api/v1/auth/login', {
      data: {
        email: process.env['SEED_USER_EMAIL'] ?? 'demo@coretask.dev',
        password: process.env['SEED_USER_PASSWORD'] ?? 'CoreTask!2024',
      },
    });

    expect(login.ok(), `cleanup could not sign in: ${login.status()} ${await login.text()}`).toBe(
      true,
    );

    {
      const token = (await login.json()).data.accessToken;
      const headers = { authorization: `Bearer ${token}` };

      const workspaces = await (await request.get('/api/v1/workspaces', { headers })).json();
      const workspaceId = workspaces.data[0]?.id;

      const projects = await (
        await request.get(`/api/v1/workspaces/${workspaceId}/projects`, { headers })
      ).json();

      for (const project of projects.data ?? []) {
        const fields = await (
          await request.get(
            `/api/v1/workspaces/${workspaceId}/projects/${project.id}/custom-fields`,
            { headers },
          )
        ).json();

        for (const field of fields.data ?? []) {
          if (!field.name.startsWith('Risk ')) continue;

          await request.delete(
            `/api/v1/workspaces/${workspaceId}/projects/${project.id}/custom-fields/${field.id}`,
            { headers },
          );
        }
      }
    }

    await request.dispose();
  });
});
