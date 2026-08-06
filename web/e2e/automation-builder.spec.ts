import { request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';

import { expect, test } from './fixtures';

/**
 * The rule builder, driven in a real browser.
 *
 * These assertions are mostly about *geometry*, which is unusual for an
 * end-to-end test and is the whole point here. React Flow places nodes by
 * measuring its container and hides any node it could not measure — so a canvas
 * with no width renders a graph that exists, is positioned, and is invisible.
 * Nothing throws. Nothing logs. It simply looks like a feature that failed to
 * load.
 *
 * So: nodes are asserted to have size, to be on screen, and not to sit on top of
 * one another. Those are the failures unit tests cannot see and a person would
 * notice immediately.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const RULE_NAME = `Builder probe ${RUN}`;

const API_ORIGIN = process.env['E2E_API_ORIGIN'] ?? 'http://localhost:3010';

interface Api {
  request: APIRequestContext;
  headers: { authorization: string };
  workspaceId: string;
  projectId: string;
  sectionId: string;
  ruleId: string;
}

async function connect(): Promise<Api> {
  const request = await apiRequest.newContext({ baseURL: API_ORIGIN });

  const login = await request.post('/api/v1/auth/login', {
    data: {
      email: process.env['SEED_USER_EMAIL'] ?? 'demo@coretask.dev',
      password: process.env['SEED_USER_PASSWORD'] ?? 'CoreTask!2024',
    },
  });
  expect(login.ok(), `could not sign in: ${login.status()}`).toBe(true);

  const headers = { authorization: `Bearer ${(await login.json()).data.accessToken}` };
  const workspaces = await (await request.get('/api/v1/workspaces', { headers })).json();
  const workspaceId = workspaces.data[0].id as string;

  /*
   * Its own project, not the seeded one.
   *
   * This spec has to create a rule to have something to draw, and other specs
   * assert that the seeded project shows an empty state. Sharing it made those
   * two true only when they did not run at the same time — which, in parallel
   * workers, is a coin toss that fails somebody else's test and points at the
   * wrong file.
   */
  const project = await request.post(`/api/v1/workspaces/${workspaceId}/projects`, {
    headers,
    // The key is capped at 8 characters, so only the tail of the run id fits.
    data: { name: `Builder probe project ${RUN}`, key: `BP${RUN.slice(-6).toUpperCase()}` },
  });
  expect(project.ok(), `could not create the project: ${project.status()}`).toBe(true);
  const projectId = (await project.json()).data.id as string;

  const section = await request.post(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/sections`,
    { headers, data: { name: 'Incoming' } },
  );
  expect(section.ok(), `could not create the section: ${section.status()}`).toBe(true);
  const sectionId = (await section.json()).data.id as string;

  // Built through the API so the test starts from a known shape rather than
  // whatever the last run happened to leave.
  const created = await request.post(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/automations`,
    {
      headers,
      data: {
        name: RULE_NAME,
        triggerType: 'TASK_MOVED_TO_SECTION',
        triggerConfig: { sectionId },
        nodes: [
          {
            id: 't',
            nodeType: 'TRIGGER',
            subtype: 'TASK_MOVED_TO_SECTION',
            parentId: null,
            configuration: { sectionId },
            order: 0,
          },
          {
            id: 'c',
            nodeType: 'CONDITION',
            subtype: 'FIELD_COMPARISON',
            parentId: 't',
            configuration: { field: 'priority', operator: 'EQUALS', value: 'HIGH' },
            order: 1,
          },
        ],
      },
    },
  );
  expect(created.ok(), `could not create the rule: ${created.status()}`).toBe(true);

  return {
    request,
    headers,
    workspaceId,
    projectId,
    sectionId,
    ruleId: (await created.json()).data.id as string,
  };
}

test.describe('the automation builder', () => {
  let api: Api;

  test.beforeAll(async () => {
    api = await connect();
  });

  /*
   * Waits for the builder to be ready, not for a particular name.
   *
   * These run in order and one of them renames the rule, so asserting the
   * original name here made every later test depend on which had run before it
   * — a failure that says "dark mode is broken" when the truth is "the name was
   * changed two tests ago".
   */
  const openBuilder = async (page: Page) => {
    await page.goto(`/projects/${api.projectId}/automations/${api.ruleId}`);

    await expect(page.getByRole('textbox', { name: 'Rule name' })).toHaveValue(
      new RegExp(RULE_NAME),
    );
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
  };

  /** Every node's box, from the browser rather than from the model. */
  const nodeBoxes = async (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__node')].map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          /*
           * The accessible name, not the raw text.
           *
           * A card renders its value as a separate chip, so `textContent` runs
           * the pieces together — "Priority isHigh" — while the card itself
           * spaces them with flex gap. The name is the one place the whole
           * sentence exists as a sentence, which is what is being asserted.
           */
          label: (
            element.querySelector('button')?.getAttribute('aria-label') ??
            element.textContent ??
            ''
          )
            .replace(/\s+/g, ' ')
            .trim(),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          hidden: (element as HTMLElement).style.visibility === 'hidden',
        };
      }),
    );

  test('draws the rule, with nodes that have actual size', async ({ page }) => {
    /*
     * The failure this exists for. A canvas whose container has no width leaves
     * every node measured at zero and marked hidden — present in the DOM, absent
     * from the screen, and silent about it.
     */
    await openBuilder(page);

    await expect(page.locator('.react-flow__node').first()).toBeVisible();

    const boxes = await nodeBoxes(page);

    expect(boxes.length).toBeGreaterThanOrEqual(3);
    expect(boxes.filter((box) => box.hidden)).toEqual([]);

    for (const box of boxes) {
      expect(box.width, `"${box.label}" has no width`).toBeGreaterThan(100);
      expect(box.height, `"${box.label}" has no height`).toBeGreaterThan(20);
    }
  });

  test('reads as a sentence rather than a row of identifiers', async ({ page }) => {
    // A node saying "Assign 019fc8d5-…" is a node nobody can read.
    await openBuilder(page);

    const labels = (await nodeBoxes(page)).map((box) => box.label);
    const joined = labels.join(' | ');

    expect(joined).toMatch(/When/);
    expect(joined).toMatch(/Check if/);
    // Humanised, not shouted: the value is a legacy enum and the card should
    // not print it as one.
    expect(joined).toContain('Priority is High');
    expect(joined).not.toContain('HIGH');

    // No bare uuid anywhere on a card.
    expect(joined).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test('keeps the steps apart from each other', async ({ page }) => {
    // Nodes stacked on the same point is what an unplaced legacy rule looks
    // like, and what a layout that quietly did nothing looks like too.
    await openBuilder(page);

    const boxes = await nodeBoxes(page);

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;

        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;

        expect(overlaps, `"${a.label}" sits on top of "${b.label}"`).toBe(false);
      }
    }
  });

  test('connects them with edges', async ({ page }) => {
    await openBuilder(page);

    // A path with real length: a zero-length edge means both ends resolved to
    // the same point, which is the same failure as an unmeasured node.
    const lengths = await page.evaluate(() =>
      [...document.querySelectorAll('.react-flow__edge-path')].map((path) =>
        Math.round((path as SVGPathElement).getTotalLength()),
      ),
    );

    expect(lengths.length).toBeGreaterThanOrEqual(2);
    for (const length of lengths) expect(length).toBeGreaterThan(10);
  });

  test('says what is missing, and refuses to publish until it is not', async ({ page }) => {
    await openBuilder(page);

    // The rule has no action yet.
    await expect(page.getByText('Add at least one action.')).toBeVisible();
    await expect(page.getByRole('button', { name: /publish rule/i })).toBeDisabled();
  });

  test('adds an action from the selector, and it appears on the canvas', async ({ page }) => {
    await openBuilder(page);

    await page.getByRole('button', { name: /^Add action$/i }).click();
    await page.getByRole('option', { name: /add a comment/i }).click();

    /*
     * The count does not change, and that is the point: the placeholder is the
     * absence of an action, so choosing one replaces it rather than joining it.
     * A rule that grew both would show an invitation to add a step immediately
     * after the step somebody just added.
     */
    await expect
      .poll(async () => (await nodeBoxes(page)).map((box) => box.label).join(' | '), {
        timeout: 5000,
      })
      .toContain('Do this');

    const labels = (await nodeBoxes(page)).map((box) => box.label).join(' | ');
    expect(labels).not.toContain('Add a step');
  });

  test('adds a branch, and draws both of its arms', async ({ page }) => {
    /*
     * A split showing only the path somebody built looks like it goes one way.
     * Both arms have to be on screen, and they must not land on each other.
     */
    await openBuilder(page);

    await page.getByRole('button', { name: /^Add branch$/i }).click();

    await expect
      .poll(
        async () =>
          (await nodeBoxes(page)).filter((box) => box.label.includes('Add a step')).length,
        {
          timeout: 5000,
        },
      )
      .toBe(2);

    const arms = (await nodeBoxes(page)).filter((box) => box.label.includes('Add a step'));

    expect(arms[0]!.y).not.toBe(arms[1]!.y);
  });

  test('opens a step to configure it, without hiding the rule', async ({ page }) => {
    await openBuilder(page);

    await page.locator('.react-flow__node').first().click();

    const rail = page.getByRole('complementary', { name: /step settings/i });
    await expect(rail).toBeVisible();

    // The canvas is the context that makes the step make sense; a full-screen
    // form takes it away.
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
  });

  test('a change in the panel shows on the card as it is typed', async ({ page }) => {
    /*
     * There is no save button on the panel, so the card updating is the only
     * thing that says an edit landed. If that stopped working, the form would
     * look like it does nothing.
     */
    await openBuilder(page);

    await page.getByRole('button', { name: /^Add action$/i }).click();
    await page.getByRole('option', { name: /add a comment/i }).click();

    const rail = page.getByRole('complementary', { name: /step settings/i });
    await expect(rail).toBeVisible();

    await rail.getByRole('textbox').fill('Thanks for filing this.');

    await expect
      .poll(async () => (await nodeBoxes(page)).map((box) => box.label).join(' | '), {
        timeout: 5000,
      })
      .toContain('Thanks for filing this.');
  });

  test('deletes a step from the panel', async ({ page }) => {
    await openBuilder(page);

    const before = (await nodeBoxes(page)).length;

    // The condition, which is the one step here that may be removed.
    await page
      .locator('.react-flow__node')
      .filter({ hasText: /Check if/ })
      .first()
      .click();

    const rail = page.getByRole('complementary', { name: /step settings/i });
    await rail.getByRole('button', { name: /delete this step/i }).click();

    await expect
      .poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 })
      .toBeLessThan(before);

    const labels = (await nodeBoxes(page)).map((box) => box.label).join(' | ');
    expect(labels).not.toContain('Check if');
    // The trigger survives, and so does whatever followed the removed step.
    expect(labels).toContain('When');
  });

  test('the trigger cannot be deleted', async ({ page }) => {
    // A rule with nothing to start it is not a rule; the way to change what
    // starts one is to choose a different trigger.
    await openBuilder(page);

    await page.locator('.react-flow__node').filter({ hasText: /When/ }).first().click();

    const rail = page.getByRole('complementary', { name: /step settings/i });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('button', { name: /delete this step/i })).toHaveCount(0);
  });

  test('saves a draft and keeps it across a reload', async ({ page }) => {
    await openBuilder(page);

    const renamed = `${RULE_NAME} saved`;
    await page.getByRole('textbox', { name: 'Rule name' }).fill(renamed);
    await page.getByRole('button', { name: /save draft/i }).click();

    await expect(page.getByRole('button', { name: /save draft/i })).toBeDisabled();

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Rule name' })).toHaveValue(renamed);
  });

  test('renders in dark mode too', async ({ page }) => {
    // The canvas brings its own stylesheet, which is the usual way a graph ends
    // up as dark text on a dark background.
    await page.emulateMedia({ colorScheme: 'dark' });
    await openBuilder(page);

    const boxes = await nodeBoxes(page);
    expect(boxes.filter((box) => box.hidden)).toEqual([]);
    expect(boxes.length).toBeGreaterThanOrEqual(3);

    await page.emulateMedia({ colorScheme: 'light' });
  });

  test.afterAll(async () => {
    if (!api) return;

    /*
     * The rule is deleted; the project is archived, which is all that endpoint
     * does — it stays reversible because tasks and activity still point at it.
     * Archived projects are left out of every listing, so the row a run leaves
     * behind is inert rather than something the next run has to step around.
     */
    await api.request.delete(
      `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/automations/${api.ruleId}`,
      { headers: api.headers },
    );
    await api.request.delete(`/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}`, {
      headers: api.headers,
    });
    await api.request.dispose();
  });
});
