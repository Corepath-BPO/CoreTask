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
   * These run in order and two of them rename the rule, so asserting any
   * particular name here made every later test depend on which had run before
   * it — a failure that says "dark mode is broken" when the truth is "the name
   * was changed two tests ago". A drawn node is the real signal anyway: it
   * means the rule loaded and the canvas measured it.
   */
  const openBuilder = async (page: Page) => {
    await page.goto(`/projects/${api.projectId}/automations/${api.ruleId}`);

    await expect(page.locator('.react-flow__node').first()).toBeVisible();
  };

  /**
   * The connector furthest along the rule — the end of the main path.
   *
   * Chosen by position rather than by index. Every connector renders its
   * controls through a portal into one shared layer, so their order in the DOM
   * is the order they happened to mount in and not the order they appear on
   * screen; `.last()` was picking a different arm depending on what had been
   * added before it.
   */
  const endConnector = async (page: Page) => {
    const dots = page.getByRole('button', { name: /add a step here/i });
    await expect(dots.first()).toBeVisible();

    // All of them in one pass. Measuring them one at a time answered `null` for
    // any that had not settled yet, which silently fell back to the first.
    const xs = await dots.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().x),
    );

    return dots.nth(xs.indexOf(Math.max(...xs)));
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

    /*
     * The count sits beside Publish rather than in a banner over the canvas, so
     * the reason the button is off is one click from the button itself. A
     * disabled control with nothing next to it is the dead end this replaced.
     */
    await expect(page.getByRole('button', { name: /publish rule/i })).toBeDisabled();

    // The rule has no action yet.
    await page.getByRole('button', { name: /^\d+ problems?$/ }).click();
    await expect(page.getByText('Add at least one action.')).toBeVisible();
  });

  test('adds an action from the selector, and it appears on the canvas', async ({ page }) => {
    await openBuilder(page);

    // From the placeholder on the canvas: the card that says "choose a step" is
    // the invitation, so pressing it is how an action gets chosen.
    await page.getByRole('button', { name: /^Add a step —/ }).click();
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

    // Split from the connector at the end of the rule — the point on the
    // drawing where "and then it goes two ways" is actually being decided.
    await (await endConnector(page)).click();
    await page.getByRole('button', { name: /^Add branch$/ }).click();

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

  test('chains another question onto the otherwise arm', async ({ page }) => {
    await openBuilder(page);
    await (await endConnector(page)).click();
    await page.getByRole('button', { name: /^Add branch$/ }).click();

    await expect
      .poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 })
      .toBeGreaterThan(2);

    /*
     * The offer belongs to the otherwise arm and nowhere else.
     *
     * On the matching arm it would read as "if this matched, then ask a
     * different question", which is not what it does — so exactly one of the
     * connectors on screen may carry it.
     */
    const dots = page.getByRole('button', { name: /add a step here/i });
    let found = -1;

    for (let index = 0; index < (await dots.count()); index += 1) {
      await dots.nth(index).click();

      if ((await page.getByRole('button', { name: /^Otherwise if…$/ }).count()) > 0) {
        found = index;
        break;
      }

      await dots.nth(index).click();
    }

    expect(found, 'no connector offered to chain another question').toBeGreaterThanOrEqual(0);
    await page.getByRole('button', { name: /^Otherwise if…$/ }).click();

    // Two questions, stacked in one column, each with its own answer beside it.
    await expect
      .poll(
        async () => (await nodeBoxes(page)).filter((box) => box.label.includes('Split on')).length,
        { timeout: 5000 },
      )
      .toBe(2);

    const splits = (await nodeBoxes(page)).filter((box) => box.label.includes('Split on'));

    expect(splits[0]!.x).toBe(splits[1]!.x);
    expect(splits[0]!.y).not.toBe(splits[1]!.y);
  });

  test('duplicates and deletes a step from its own card', async ({ page }) => {
    await openBuilder(page);

    const condition = page.getByRole('button', { name: /^More for: Priority is/ });
    const before = (await nodeBoxes(page)).length;

    await condition.click();
    await page.getByRole('menuitem', { name: /duplicate/i }).click();

    /*
     * The copy runs after the original, not beside it.
     *
     * Two steps sharing a parent are two paths from one point — a branch — and
     * duplicating an action means "do that again", not "fork the rule here".
     */
    await expect
      .poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 })
      .toBe(before + 1);

    const copies = (await nodeBoxes(page)).filter((box) => box.label.includes('Priority is'));
    expect(copies).toHaveLength(2);
    expect(copies[0]!.y).toBe(copies[1]!.y);
    expect(copies[0]!.x).not.toBe(copies[1]!.x);

    // And the copy goes away again from the same place.
    await page
      .getByRole('button', { name: /^More for: Priority is/ })
      .last()
      .click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    await expect.poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 }).toBe(before);
  });

  test('the trigger has no delete in its menu', async ({ page }) => {
    await openBuilder(page);

    await page.getByRole('button', { name: /^More for: When a task/ }).click();

    await expect(page.getByRole('menuitem', { name: /duplicate/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /delete/i })).toHaveCount(0);
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

    await page.getByRole('button', { name: /^Add a step —/ }).click();
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

  test('the rule settings panel edits the rule itself', async ({ page }) => {
    await openBuilder(page);

    await page.getByRole('button', { name: /^Rule settings$/ }).click();

    const rail = page.getByRole('complementary', { name: /rule settings/i });
    await expect(rail).toBeVisible();

    // The owner, so somebody knows who to ask before changing a live rule.
    await expect(rail.getByText(/rule owner/i)).toBeVisible();

    /*
     * The title here and the heading in the header are the same field.
     *
     * They are two controls over one piece of state, which is exactly the shape
     * that drifts: typing in one and reading the other is the only way to know
     * they have not become two separate drafts of the name.
     */
    await rail.getByLabel('Title').fill('Renamed from the panel');
    await expect(
      page.getByRole('button', { name: 'Rule name: Renamed from the panel' }),
    ).toBeVisible();

    await rail.getByLabel('Description').fill('Explains itself.');

    // Only a control the engine honours is offered, so this one has to persist.
    const chaining = rail.getByRole('switch', { name: /trigger via other rules/i });
    await expect(chaining).toHaveAttribute('aria-checked', 'true');
    await chaining.click();
    await expect(chaining).toHaveAttribute('aria-checked', 'false');

    /*
     * Written with the keyboard, because there is no Save button any more.
     *
     * The header reports what the save did rather than offering to start one,
     * so the shortcut is the whole path — and a path with no control on screen
     * is exactly the one that has to be covered here.
     */
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: /^Rule settings$/ }).click();

    const reopened = page.getByRole('complementary', { name: /rule settings/i });
    await expect(reopened.getByLabel('Title')).toHaveValue('Renamed from the panel');
    await expect(reopened.getByLabel('Description')).toHaveValue('Explains itself.');
    await expect(
      reopened.getByRole('switch', { name: /trigger via other rules/i }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  test('renames in place, and keeps it across a reload', async ({ page }) => {
    await openBuilder(page);

    const renamed = `${RULE_NAME} saved`;

    /*
     * The name is a heading until it is pressed.
     *
     * A field sitting in the header permanently made the one line that says
     * what the rule *is* look like something to fill in, so the input only
     * exists while somebody is typing — and this is the round trip that proves
     * the swap actually commits rather than only looking edited.
     */
    await page.getByRole('button', { name: /^Rule name:/ }).click();
    await page.getByRole('textbox', { name: 'Rule name' }).fill(renamed);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('button', { name: `Rule name: ${renamed}` })).toBeVisible();

    await page.keyboard.press('Control+s');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: `Rule name: ${renamed}` })).toBeVisible();
  });

  test('abandons a rename on Escape without leaving the builder', async ({ page }) => {
    /*
     * Escape has two meanings here and only one of them can win.
     *
     * The builder is a dialog, so a loose Escape closes it — which would make
     * backing out of a typo also throw away the rule. The name has to swallow
     * its own key.
     */
    await openBuilder(page);

    const heading = page.getByRole('button', { name: /^Rule name:/ });
    const before = (await heading.textContent()) ?? '';

    await heading.click();
    await page.getByRole('textbox', { name: 'Rule name' }).fill('Typed by mistake');
    await page.keyboard.press('Escape');

    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await expect(page.getByRole('button', { name: `Rule name: ${before}` })).toBeVisible();
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
