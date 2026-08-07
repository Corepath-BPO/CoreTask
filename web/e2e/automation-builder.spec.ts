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

  /*
   * A custom field, so the catalogue has one to generate a row from.
   *
   * The generated rows are the whole point of the "Change ⟨field⟩ to…" group,
   * and a project with no fields produces an empty group that proves nothing.
   */
  const field = await request.post(
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/custom-fields`,
    {
      headers,
      data: {
        name: `Effort ${RUN}`,
        type: 'SINGLE_SELECT',
        options: [{ label: 'Small' }, { label: 'Large' }],
      },
    },
  );
  expect(field.ok(), `could not create the field: ${field.status()}`).toBe(true);

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
    await page.getByRole('option', { name: /add (a )?comment/i }).click();

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

    /*
     * From the pill on the trigger's connector, which is the only place a
     * branch can start — every branch belongs to the same trigger, so offering
     * it between a check and its action would offer one where none can go.
     */
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
    const chain = page.getByRole('button', { name: /^Otherwise if…$/ });

    // Exactly one arm carries it, and it is on screen rather than behind a dot.
    await expect(chain).toHaveCount(1);
    await chain.click();

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

  test('leaves nothing behind when an insert is abandoned', async ({ page }) => {
    /*
     * The step used to be created before it was chosen, so closing the list
     * left a card that is nothing — no label, no settings, and a fork in the
     * rule that refuses to publish. Nothing exists now until somebody picks.
     */
    await openBuilder(page);

    const before = (await nodeBoxes(page)).length;

    /*
     * From the placeholder, which is where a fresh rule offers a step.
     *
     * No card carries a plus here: every step already leads somewhere, and the
     * plus means "and then" rather than "insert between". That is the leaf-only
     * rule doing its job, not a missing control.
     */
    await page.getByRole('button', { name: /^Add a step —/ }).click();

    const rail = page.getByRole('complementary', { name: /step settings/i });
    await expect(rail).toBeVisible();

    await page.keyboard.press('Escape');

    await expect.poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 }).toBe(before);

    const labels = (await nodeBoxes(page)).map((box) => box.label).join(' | ');
    expect(labels).not.toContain('Do this — ');
  });

  test('a chosen trigger can still be swapped', async ({ page }) => {
    /*
     * The card opens the picker while nothing is chosen and that step's
     * settings afterwards, so a set trigger had no route back to the list —
     * the only way to correct a mis-click was to delete the rule.
     */
    await openBuilder(page);

    await page.getByRole('button', { name: /^More for: When a task/ }).click();
    await page.getByRole('menuitem', { name: /change trigger/i }).click();

    const rail = page.getByRole('complementary', { name: /step settings/i });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('option').first()).toBeVisible();
  });

  test('configures a custom field the catalogue row already named', async ({ page }) => {
    /*
     * The row says which field it means, so the form must not ask again.
     *
     * Every "Change ⟨field⟩ to…" shares one subtype and differs only by the
     * field, so before the entry was carried through, choosing one landed on a
     * form with an empty picker — the click thrown away.
     */
    await openBuilder(page);

    await page.getByRole('button', { name: /^Add a step —/ }).click();
    await page.getByRole('option', { name: /^Change Effort/i }).click();

    const rail = page.getByRole('complementary', { name: /step settings/i });
    await expect(rail).toBeVisible();

    // The field is already answered, and its own options are what it offers.
    await expect(rail.getByLabel('Field')).toContainText(/Effort/);

    await rail.getByLabel('Value').click();
    await page.getByRole('option', { name: 'Large' }).click();

    await expect
      .poll(async () => (await nodeBoxes(page)).map((box) => box.label).join(' | '), {
        timeout: 5000,
      })
      .toContain('Large');
  });

  test('the trigger card follows whichever shape was chosen', async ({ page }) => {
    /*
     * The card is where a rule is read without opening it, so a trigger that
     * shows only its kind makes two rules firing on completely different moves
     * look identical. Each shape has to reach the card, and "is not" has to say
     * so — a list with no verb reads as the opposite rule.
     */
    await openBuilder(page);
    const rail = await openStep(page, /When/);

    const trigger = async () => (await nodeBoxes(page))[0]!.label;

    await rail.getByLabel('Choose an option').click();
    await page.getByRole('option', { name: 'Section is not…' }).click();
    await expect.poll(trigger, { timeout: 5000 }).toContain('not Incoming');

    await rail.getByLabel('Choose an option').click();
    await page.getByRole('option', { name: 'Section is one of…' }).click();
    await rail.getByLabel('Choose one or more options for column/section').click();
    await page.getByRole('menuitemcheckbox').nth(1).click();
    await page.keyboard.press('Escape');

    await expect.poll(trigger, { timeout: 5000 }).toContain('one of');

    // And the shape that names no section says nothing about one.
    await rail.getByLabel('Choose an option').click();
    await page.getByRole('option', { name: 'Section is changed' }).click();

    await expect.poll(trigger, { timeout: 5000 }).not.toContain('one of');
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
    await page.getByRole('option', { name: /add (a )?comment/i }).click();

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

  /* ------------------------------------------------------------------ */
  /* The three inspectors                                                */
  /* ------------------------------------------------------------------ */

  /** The panel, whichever of its jobs it is currently doing. */
  const inspector = (page: Page) => page.getByRole('complementary', { name: /step settings/i });

  const openStep = async (page: Page, name: RegExp) => {
    await page.locator('.react-flow__node').filter({ hasText: name }).first().click();

    const rail = inspector(page);
    await expect(rail).toBeVisible();

    return rail;
  };

  test('the When inspector offers exactly the four ways a move can be narrowed', async ({
    page,
  }) => {
    /*
     * The whole point of the trigger panel.
     *
     * A move can be watched four ways, and the old panel — one optional section
     * — could express exactly one of them. If this list ever shrinks back, the
     * inspector has quietly lost three quarters of what it is for.
     */
    await openBuilder(page);
    const rail = await openStep(page, /When/);

    // A breadcrumb above, the particular trigger below it — and the trigger
    // does not say "When" twice.
    await expect(rail.getByText('When… /')).toBeVisible();
    await expect(rail.getByRole('heading', { level: 2 })).toHaveText(
      'A task is moved to a section',
    );

    await rail.getByLabel('Choose an option').click();

    await expect(page.getByRole('option')).toHaveText([
      'Section is changed',
      'Section is…',
      'Section is not…',
      'Section is one of…',
    ]);

    await page.keyboard.press('Escape');
  });

  test('“Section is one of…” asks for several sections at once', async ({ page }) => {
    await openBuilder(page);
    const rail = await openStep(page, /When/);

    await rail.getByLabel('Choose an option').click();
    await page.getByRole('option', { name: 'Section is one of…' }).click();

    /*
     * One section is a select; several is a menu of checkboxes.
     *
     * The difference between the two controls *is* the difference between the
     * two forms, so a "one of" that renders the single picker would be a rule
     * that can only ever name one section however it is labelled.
     */
    await expect(rail.getByLabel('Choose a column/section')).toHaveCount(0);

    const picker = rail.getByLabel('Choose one or more options for column/section');
    await expect(picker).toBeVisible();
    await picker.click();

    const boxes = page.getByRole('menuitemcheckbox');
    await expect(boxes.first()).toBeVisible();

    const first = ((await boxes.nth(0).textContent()) ?? '').trim();
    const second = ((await boxes.nth(1).textContent()) ?? '').trim();

    // The second click without reopening: a question with more than one answer
    // by definition cannot shut its menu after the first.
    await boxes.nth(0).click();
    await boxes.nth(1).click();
    await page.keyboard.press('Escape');

    await expect(picker).toContainText(first);
    await expect(picker).toContainText(second);
  });

  test('the comparisons on offer follow the field being checked', async ({ page }) => {
    /*
     * "Due date contains High" is the combination this exists to prevent. The
     * endpoint refuses it too, so the form is a convenience — but a form that
     * offers it makes somebody build a rule that cannot be saved.
     */
    await openBuilder(page);
    const rail = await openStep(page, /Check if/);

    await rail.getByLabel('Field', { exact: true }).click();
    await page.getByRole('option', { name: 'Section', exact: true }).click();

    await rail.getByLabel('Choose an option').click();
    // Named with the field, because the option is the whole condition — an
    // operator on its own is a fragment somebody has to reassemble.
    await expect(page.getByRole('option')).toHaveText([
      'Section is…',
      'Section is not…',
      'Section is one of…',
      'Section is not one of…',
      'Section is empty',
      'Section is not empty',
    ]);
    await page.keyboard.press('Escape');

    await rail.getByLabel('Field', { exact: true }).click();
    await page.getByRole('option', { name: 'Due date' }).click();

    await rail.getByLabel('Choose an option').click();
    const dates = await page.getByRole('option').allTextContents();

    expect(dates).toContain('Due date is before…');
    expect(dates).toContain('Due date is overdue');
    // Nothing on a date contains anything.
    expect(dates).not.toContain('contains');

    await page.keyboard.press('Escape');
  });

  test('the condition reads as a sentence, and never as an identifier', async ({ page }) => {
    await openBuilder(page);
    const rail = await openStep(page, /Check if/);
    const heading = rail.getByRole('heading', { level: 2 });

    await expect(rail.getByText('Check if… /')).toBeVisible();

    await rail.getByLabel('Field', { exact: true }).click();
    await page.getByRole('option', { name: 'Section', exact: true }).click();

    // The section field asks in the words of the thing it is asking about.
    const value = rail.getByLabel('Choose a column/section');
    await value.click();

    const section = ((await page.getByRole('option').first().textContent()) ?? '').trim();
    await page.getByRole('option').first().click();

    /*
     * The heading names the question, and the card names the answer.
     *
     * It used to carry the value too, directly above the control holding it —
     * the same thing twice, and a heading that rewrote itself as somebody typed
     * into the field beneath it. The value moved to the card, which is where a
     * rule is read without opening it.
     */
    await expect(heading).toHaveText('Section is');

    /*
     * And something says the edit landed.
     *
     * There is no save button on this panel, so with the value gone from the
     * heading the card is the only thing left that confirms it — which makes
     * this worth asserting rather than assuming.
     */
    await expect
      .poll(async () => (await nodeBoxes(page)).map((box) => box.label).join(' | '), {
        timeout: 5000,
      })
      .toContain(section);

    await rail.getByLabel('Choose an option').click();
    await page.getByRole('option', { name: 'Section is one of…', exact: true }).click();

    await expect(heading).toHaveText('Section is one of');

    // Never the id behind the name. One on a heading looks like data rather
    // than like a mistake, and the mistake is what needs noticing.
    expect(await heading.textContent()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test('the action catalogue is grouped, and keeps a tab for external actions', async ({
    page,
  }) => {
    await openBuilder(page);
    await page.getByRole('button', { name: /^Add a step —/ }).click();

    const rail = inspector(page);
    await expect(rail.getByRole('heading', { level: 2 })).toHaveText('Do this…');
    await expect(
      rail.getByText('Add an action that occurs as a result of the rule.'),
    ).toBeVisible();

    /*
     * Grouped in the server's order, not in whichever order a Map happened to
     * hand back. Taken from the endpoint rather than hard-coded, so renaming a
     * category is not a test to fix.
     */
    const metadata = await (
      await api.request.get(
        `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/automations/metadata`,
        { headers: api.headers },
      )
    ).json();

    const expected: string[] = [];
    for (const entry of metadata.data.actions) {
      if (!expected.includes(entry.category)) expected.push(entry.category);
    }

    const rendered = await rail
      .getByRole('group')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('aria-label') ?? ''),
      );

    expect(rendered).toEqual(expected);

    // Every offer is still an option inside a listbox, so a screen reader can
    // say how much catalogue is left below the fold.
    await expect(rail.getByRole('listbox')).toBeVisible();
    await expect(rail.getByRole('option').first()).toBeVisible();

    /*
     * The tab exists and says it is not ready, rather than being quietly
     * removed so that nobody asks. No fake integrations behind it.
     */
    await rail.getByRole('tab', { name: 'External actions' }).click();
    await expect(rail.getByText('External actions will be available later.')).toBeVisible();
    await expect(rail.getByRole('option')).toHaveCount(0);
  });

  test('an action the engine cannot run is listed with the reason it cannot', async ({ page }) => {
    /*
     * Listed rather than filtered. Absence reads as "never considered"; a
     * greyed row with a reason reads as "not yet", which is the truth and saves
     * somebody searching for it a second time somewhere else.
     */
    const metadata = await (
      await api.request.get(
        `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/automations/metadata`,
        { headers: api.headers },
      )
    ).json();

    const blocked = metadata.data.actions.filter(
      (entry: { available: boolean }) => !entry.available,
    );

    expect(
      blocked.length,
      'the metadata offered nothing unavailable, so the convention cannot be checked',
    ).toBeGreaterThan(0);

    await openBuilder(page);
    await page.getByRole('button', { name: /^Add a step —/ }).click();

    const rail = inspector(page);
    await expect(rail.getByRole('option').first()).toBeVisible();

    const entry = blocked[0] as { label: string; reason: string };
    const row = rail.getByRole('option', { name: entry.label }).first();

    await expect(row).toBeDisabled();
    await expect(row.locator('[data-slot="catalogue-reason"]')).toHaveText(entry.reason);
  });

  test('searching the catalogue matches the group as well as the row', async ({ page }) => {
    await openBuilder(page);
    await page.getByRole('button', { name: /^Add a step —/ }).click();

    const rail = inspector(page);
    const groups = rail.getByRole('group');
    await expect(groups.first()).toBeVisible();

    const heading = (await groups.first().getAttribute('aria-label')) ?? '';

    // The category is printed above every row, so a search that cannot find it
    // reads as a search that is broken.
    await rail.getByRole('textbox', { name: /search actions/i }).fill(heading);

    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toHaveAttribute('aria-label', heading);
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
