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

  /**
   * A new rule opened from a section, which is how one is really started.
   *
   * The shared fixture rule checks Priority, and with no field picker a
   * condition's field is now settled when the rule is created — so a test about
   * the section comparisons has to start from the section.
   */
  const openSectionRule = async (page: Page) => {
    await page.goto(`/projects/${api.projectId}/automations/new?sectionId=${api.sectionId}`);

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

  /* ------------------------------------------------------------------ */
  /* Branches, which are rows                                            */
  /* ------------------------------------------------------------------ */

  /*
   * A branch is a row: its own question, its own actions beside it, and the
   * next branch on the line below. It used to be a split — a "Split on" card
   * with two placeholder arms — which drew a fork where the rule reads as a
   * list, and made "otherwise if" mean "nest another fork inside the first".
   */

  /** The menu behind the one pill, opened. */
  const openBranchMenu = async (page: Page) => {
    const pill = page.getByRole('button', { name: /^Add branch$/ });

    // One pill per rule. Every branch hangs off the same trigger, so the
    // version of this that keyed on the connection drew one per branch.
    await expect(pill).toHaveCount(1);
    await pill.click();
  };

  const OTHERWISE = /all other conditions are not met/;

  test('“Otherwise if…” adds one question and one place for its actions', async ({ page }) => {
    await openBuilder(page);
    const before = (await nodeBoxes(page)).length;

    await openBranchMenu(page);
    await page.getByRole('menuitem', { name: /^Otherwise if…/ }).click();

    // Two cards and no more: a question, and the invitation beside it. The old
    // shape added four — a split, two arms, and a card for the question.
    await expect
      .poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 })
      .toBe(before + 2);

    const boxes = await nodeBoxes(page);
    const question = boxes.find((box) => box.label.includes('Otherwise if…'));
    const first = boxes.find((box) => box.label.includes('Priority is'));

    expect(question, 'the new branch does not read as the offer that made it').toBeDefined();

    // A row of its own, in the same column as the question above it.
    expect(question!.x).toBe(first!.x);
    expect(question!.y).toBeGreaterThan(first!.y);

    // And its actions sit beside it, on its line rather than under the rule.
    const invitations = boxes.filter((box) => box.label.includes('Add a step'));
    const beside = invitations.find((box) => box.y === question!.y);

    expect(beside, 'the new branch has nowhere to put its actions').toBeDefined();
    expect(beside!.x).toBeGreaterThan(question!.x);
  });

  test('“Otherwise” adds the fallback, which asks nothing', async ({ page }) => {
    await openBuilder(page);
    const before = (await nodeBoxes(page)).length;

    await openBranchMenu(page);
    await page.getByRole('menuitem', { name: OTHERWISE }).click();

    await expect
      .poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 })
      .toBe(before + 2);

    const boxes = await nodeBoxes(page);
    const fallback = boxes.find((box) => box.label.includes('If all other conditions are not met'));

    /*
     * The card says what it is for rather than asking what to check. It has no
     * comparison and must never be given one, so "Check if — choose what to
     * check" would be the canvas insisting on an answer that cannot exist.
     */
    expect(fallback?.label).toBe('Otherwise — If all other conditions are not met');

    const beside = boxes
      .filter((box) => box.label.includes('Add a step'))
      .find((box) => box.y === fallback!.y);
    expect(beside, 'the fallback has nowhere to put its actions').toBeDefined();
  });

  test('offers the fallback once, and then stops offering it', async ({ page }) => {
    /*
     * A rule can only fall back once: the first "otherwise" always runs when
     * nothing else matched, so a second is a branch that never can. Saying so
     * before anybody builds one beats refusing it at publish.
     */
    await openBuilder(page);

    await openBranchMenu(page);
    await expect(page.getByRole('menuitem', { name: OTHERWISE })).toHaveCount(1);
    await page.getByRole('menuitem', { name: OTHERWISE }).click();

    await expect
      .poll(
        async () =>
          (await nodeBoxes(page)).filter((box) => box.label.includes('Otherwise —')).length,
        { timeout: 5000 },
      )
      .toBe(1);

    await openBranchMenu(page);
    await expect(page.getByRole('menuitem', { name: OTHERWISE })).toHaveCount(0);
    // The other offer stays: a rule can go on gaining questions.
    await expect(page.getByRole('menuitem', { name: /^Otherwise if…/ })).toHaveCount(1);
  });

  test('takes a branch off again from the × on its card', async ({ page }) => {
    /*
     * A question nobody has answered is a half-finished thing in the middle of
     * a rule, so the way back out of it has to be on the card rather than a
     * hover away — otherwise the only obvious move is to answer a mis-click.
     */
    await openBuilder(page);
    const before = (await nodeBoxes(page)).length;

    await openBranchMenu(page);
    await page.getByRole('menuitem', { name: /^Otherwise if…/ }).click();

    await expect
      .poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 })
      .toBe(before + 2);

    const remove = page.getByRole('button', { name: /^Remove branch:/ });
    await expect(remove).toHaveCount(1);
    await remove.click();

    // The branch goes, and the invitation beside it goes with it.
    await expect.poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 }).toBe(before);
  });

  test('keeps one branch pill, below the last row and clear of everything', async ({ page }) => {
    /*
     * The pill used to be drawn by whichever connection carried the branch
     * controls, and with branches as rows every one of them qualified: three
     * identical buttons stacked down the spine, and one of them across the card
     * in between.
     */
    await openBuilder(page);

    await openBranchMenu(page);
    await page.getByRole('menuitem', { name: /^Otherwise if…/ }).click();
    await expect.poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 }).toBe(5);

    await openBranchMenu(page);
    await page.getByRole('menuitem', { name: OTHERWISE }).click();
    await expect.poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 }).toBe(7);

    const pill = page.getByRole('button', { name: /^Add branch$/ });
    await expect(pill).toHaveCount(1);

    const box = (await pill.boundingBox())!;
    const boxes = await nodeBoxes(page);

    // Below every card, which is where the branch it adds will appear.
    for (const card of boxes) {
      expect(box.y, `the pill overlaps "${card.label}"`).toBeGreaterThan(card.y + card.height);
    }
  });

  /** Gives the first branch something to do, and closes the panel behind it. */
  const addComment = async (page: Page) => {
    await page.getByRole('button', { name: /^Add a step —/ }).click();
    await page.getByRole('option', { name: /add (a )?comment/i }).click();
    await page.keyboard.press('Escape');

    await expect.poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 }).toBe(3);
  };

  test('duplicates a branch with its actions, onto a row of its own', async ({ page }) => {
    await openBuilder(page);
    await addComment(page);

    const before = (await nodeBoxes(page)).length;

    await page.getByRole('button', { name: /^More for: Priority is/ }).click();
    await page.getByRole('menuitem', { name: /duplicate/i }).click();

    // The question and the action answering it — a copy of one without the
    // other is a branch that asks nothing or answers nothing.
    await expect
      .poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 })
      .toBe(before + 2);

    const boxes = await nodeBoxes(page);
    const first = boxes.find((box) => box.label.startsWith('Check if — Priority is'));
    const copy = boxes.find((box) => box.label.startsWith('Otherwise if — Priority is'));

    /*
     * The copy reads as another branch purely by no longer being first. A
     * second "Check if" would say two branches lead with the same question,
     * rather than that the second is what to do when the first did not hold.
     */
    expect(copy, 'the copy did not read as another branch').toBeDefined();

    // A row of its own, directly below — not a step inside the row it came
    // from, which is what a copy parented to the question would have been.
    expect(copy!.x).toBe(first!.x);
    expect(copy!.y).toBeGreaterThan(first!.y);

    /*
     * And each row has an action of its own.
     *
     * Duplicating an ordinary step lets the copy adopt what followed the
     * original; doing that here would move the actions off the branch being
     * copied, leaving two questions with one answer between them.
     */
    const comments = boxes.filter((box) => box.label.includes('Comment'));
    expect(comments).toHaveLength(2);
    expect(comments.map((box) => box.y).sort()).toEqual([first!.y, copy!.y].sort());

    // It goes away again from the same place, taking its action with it.
    await page
      .getByRole('button', { name: /^More for: Priority is/ })
      .last()
      .click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    await expect.poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 }).toBe(before);
  });

  test('duplicates an ordinary step after the one it came from', async ({ page }) => {
    /*
     * Not beside it: two steps sharing a parent are two paths from one point,
     * and duplicating an action means "do that again with one thing changed".
     */
    await openBuilder(page);
    await addComment(page);

    const before = (await nodeBoxes(page)).length;

    await page.getByRole('button', { name: /^More for: Comment/ }).click();
    await page.getByRole('menuitem', { name: /duplicate/i }).click();

    await expect
      .poll(async () => (await nodeBoxes(page)).length, { timeout: 5000 })
      .toBe(before + 1);

    const copies = (await nodeBoxes(page)).filter((box) => box.label.includes('Comment'));
    expect(copies).toHaveLength(2);
    expect(copies[0]!.y).toBe(copies[1]!.y);
    expect(copies[0]!.x).not.toBe(copies[1]!.x);
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

  test('a condition offers the three comparisons a section has', async ({ page }) => {
    /*
     * Three, not the six its type would give.
     *
     * Every task in a project sits in a section, so "is empty" can never hold;
     * and "is not one of" asks the same question as "is one of" backwards.
     * Offering them makes somebody choose between spellings of one thing, and
     * the one they pick decides whether the rule reads properly afterwards.
     *
     * There is no field picker to reach them through — the condition is a
     * section check and its heading says so.
     */
    await openSectionRule(page);
    const rail = await openStep(page, /Check if/);

    await expect(rail.getByLabel('Field', { exact: true })).toHaveCount(0);

    await rail.getByLabel('Choose an option').click();
    // Named with the field, because the option is the whole condition — an
    // operator on its own is a fragment somebody has to reassemble.
    await expect(page.getByRole('option')).toHaveText([
      'Section is…',
      'Section is not…',
      'Section is one of…',
    ]);

    await page.keyboard.press('Escape');
  });

  test('“is one of” asks for several sections and names them on the card', async ({ page }) => {
    /*
     * The list half of the condition, end to end.
     *
     * "Is one of" holds an array where the other two hold a string, and every
     * layer had to be told: the panel asks for more than one, the card names
     * what was chosen instead of printing "…", and the operator reads as words
     * rather than as `is_one_of`.
     */
    await openSectionRule(page);
    const rail = await openStep(page, /Check if/);

    await rail.getByLabel('Choose an option').click();
    await page.getByRole('option', { name: 'Section is one of…' }).click();

    // The wording changes with the shape: one section, or a set of them.
    await expect(rail.getByText('Choose one or more options for column/section')).toBeVisible();

    await rail.getByLabel('Choose one or more options for column/section').click();
    const first = page.getByRole('menuitemcheckbox').first();
    const chosen = ((await first.textContent()) ?? '').trim();
    await first.click();
    await page.keyboard.press('Escape');

    const card = page.locator('.react-flow__node', { hasText: 'Check if' }).first();

    await expect(card).toContainText('Section is one of');
    await expect(card).toContainText(chosen);
    // The failure this replaces: the card showed the stored key.
    await expect(card).not.toContainText('is_one_of');
  });

  test('the condition reads as a sentence, and never as an identifier', async ({ page }) => {
    await openSectionRule(page);
    const rail = await openStep(page, /Check if/);
    const heading = rail.getByRole('heading', { level: 2 });

    await expect(rail.getByText('Check if… /')).toBeVisible();

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

  /**
   * A branch nobody has answered, with the catalogue open on it.
   *
   * "Otherwise if…" is the route the references show it from, and it is the one
   * that was broken: the row was added and the comparison form opened on it,
   * asking how to compare a field nobody had named.
   */
  const openConditionCatalogue = async (page: Page) => {
    await openBuilder(page);

    await openBranchMenu(page);
    await page.getByRole('menuitem', { name: /^Otherwise if…/ }).click();

    const rail = inspector(page);
    await expect(rail).toBeVisible();

    return rail;
  };

  test('“Otherwise if…” opens the condition catalogue, not a comparison', async ({ page }) => {
    /*
     * The gap this closes. Both halves existed — the endpoint sent the grouped
     * catalogue and the panel could draw one — and nothing routed a condition
     * row to it, so the only thing a new branch could ever be was a section
     * check with the field already assumed.
     */
    const rail = await openConditionCatalogue(page);

    await expect(rail.getByRole('heading', { level: 2 })).toHaveText('Otherwise if…');
    await expect(rail.getByRole('textbox', { name: /search conditions/i })).toBeVisible();

    // The operator select is the *next* question, and must not be the first.
    await expect(rail.getByLabel('Choose an option')).toHaveCount(0);

    /*
     * "Create your own" leads, which is the reason it is declared first: the
     * widest offer in the list belongs where somebody arriving with a question
     * no row answers will see it, rather than below six groups already read
     * past. Taken from the endpoint so renaming a group is not a test to fix.
     */
    const metadata = await (
      await api.request.get(
        `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/automations/metadata`,
        { headers: api.headers },
      )
    ).json();

    const expected: string[] = [];
    for (const entry of metadata.data.conditions) {
      if (!expected.includes(entry.category)) expected.push(entry.category);
    }

    expect(expected[0]).toBe('Create your own');

    const rendered = await rail
      .getByRole('group')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('aria-label') ?? ''),
      );

    expect(rendered).toEqual(expected);

    /* No external tab here: "external conditions" is not a thing anybody asked
       for, and an empty one would be answering a question nobody put. */
    await expect(rail.getByRole('tab')).toHaveCount(0);
  });

  test('a check the engine cannot make is listed with the reason it cannot', async ({ page }) => {
    /*
     * The same convention as the action catalogue, and the constraint the whole
     * feature turns on: availability is the server's answer, derived from what
     * the runner can read and compare. A row greyed here is one the endpoint
     * greyed, never one this client decided to withhold.
     */
    const metadata = await (
      await api.request.get(
        `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/automations/metadata`,
        { headers: api.headers },
      )
    ).json();

    const blocked = metadata.data.conditions.filter(
      (entry: { available: boolean }) => !entry.available,
    );

    expect(
      blocked.length,
      'the metadata offered nothing unavailable, so the convention cannot be checked',
    ).toBeGreaterThan(0);

    const rail = await openConditionCatalogue(page);
    await expect(rail.getByRole('option').first()).toBeVisible();

    const entry = blocked[0] as { label: string; reason: string };
    const row = rail.getByRole('option', { name: entry.label }).first();

    await expect(row).toBeDisabled();
    await expect(row.locator('[data-slot="catalogue-reason"]')).toHaveText(entry.reason);
  });

  test('choosing a check leads straight into its comparison and value', async ({ page }) => {
    /*
     * The choice and the settings are two halves of one act, so the panel
     * carries on into the second rather than closing on a step that says
     * "choose what to check" and offering no obvious way to.
     *
     * The comparison is written with the field, because a condition holding one
     * and not the other is refused at publish — and the card is what says the
     * edit landed, there being no save button on this panel.
     */
    const rail = await openConditionCatalogue(page);

    await rail.getByRole('option', { name: 'Task is in section…' }).click();

    // Same panel, now the comparison form for the field just chosen.
    await expect(rail.getByRole('heading', { level: 2 })).toHaveText('Section is');
    await expect(rail.getByText('Otherwise if… /')).toBeVisible();

    const value = rail.getByLabel('Choose a column/section');
    await value.click();

    const section = ((await page.getByRole('option').first().textContent()) ?? '').trim();
    await page.getByRole('option').first().click();

    await expect
      .poll(async () => (await nodeBoxes(page)).map((box) => box.label).join(' | '), {
        timeout: 5000,
      })
      .toContain(`Otherwise if — Section is ${section}`);
  });

  test('a check on a field the catalogue only names is not offered as working', async ({
    page,
  }) => {
    /*
     * The rule the owner set: never an enabled row that creates a name without
     * functioning task values. "Create conditional check with AI" is the one
     * every reference screenshot shows and the one nothing stands behind, so it
     * has to be visible, greyed, and unclickable — visible because absence
     * reads as "never considered".
     */
    const rail = await openConditionCatalogue(page);

    const ai = rail.getByRole('option', { name: /Create conditional check with AI/ });

    await expect(ai).toBeVisible();
    await expect(ai).toBeDisabled();

    // And a working one beside it, so this is a decision rather than a
    // catalogue that offers nothing.
    await expect(rail.getByRole('option', { name: 'Task is in section…' })).toBeEnabled();
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
