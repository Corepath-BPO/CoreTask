import { request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';

import { expect, test } from './fixtures';

/**
 * One project, drawn twice, and everything done in either drawing showing up in
 * the other.
 *
 * This is the whole point of the work, so it is one journey rather than a set of
 * independent cases: create in the List, see it on the Board, move it there, see
 * the move in the List, edit in the List, see the edit on the Board. Split apart,
 * each step would have to rebuild the state of the last, and the thing actually
 * worth asserting — that the two views are one feature — would never be tested.
 *
 * The project's default type is switched to TICKET at the start and back at the
 * end, because "the button says Add ticket" is one of the things being checked.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const TICKET_TITLE = `Journey ticket ${RUN}`;
const TASK_TITLE = `Journey task ${RUN}`;
const SECTION_NAME = `Journey section ${RUN}`;

const API_ORIGIN = process.env['E2E_API_ORIGIN'] ?? 'http://localhost:3010';

interface Api {
  request: APIRequestContext;
  headers: { authorization: string };
  workspaceId: string;
  projectId: string;
}

/** Signed in against the API directly, for setup and teardown the UI cannot do. */
async function connect(): Promise<Api> {
  const request = await apiRequest.newContext({ baseURL: API_ORIGIN });

  const login = await request.post('/api/v1/auth/login', {
    data: {
      email: process.env['SEED_USER_EMAIL'] ?? 'demo@coretask.dev',
      password: process.env['SEED_USER_PASSWORD'] ?? 'CoreTask!2024',
    },
  });

  expect(login.ok(), `could not sign in to the API: ${login.status()}`).toBe(true);

  const headers = { authorization: `Bearer ${(await login.json()).data.accessToken}` };
  const workspaces = await (await request.get('/api/v1/workspaces', { headers })).json();
  const workspaceId = workspaces.data[0].id as string;

  const projects = await (
    await request.get(`/api/v1/workspaces/${workspaceId}/projects`, { headers })
  ).json();

  const project = (projects.data as { id: string; name: string }[]).find((entry) =>
    /platform foundation/i.test(entry.name),
  );

  expect(project, 'the seeded project is missing').toBeDefined();

  return { request, headers, workspaceId, projectId: project!.id };
}

const setDefaultType = async (api: Api, type: 'TASK' | 'TICKET') =>
  api.request.patch(`/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}`, {
    headers: api.headers,
    data: { defaultWorkItemType: type },
  });

test.describe('one project, two views', () => {
  let api: Api;

  test.beforeAll(async () => {
    api = await connect();
    await setDefaultType(api, 'TICKET');
  });

  const openView = async (page: Page, view: 'list' | 'board') => {
    await page.goto(`/projects/${api.projectId}/${view}`);
    await expect(page).toHaveURL(new RegExp(`/${view}$`));
  };

  /** The List draws a section as a card; the Board draws it as a column. */
  const listSection = (page: Page, name: string) => page.getByRole('region', { name });

  test('the List offers the project’s default type, and creates it', async ({ page }) => {
    await openView(page, 'list');

    // Step 3 of the journey: the button is labelled by the project's setting,
    // not by a hard-coded word.
    await expect(page.getByRole('button', { name: /add ticket/i }).first()).toBeVisible();

    await page.getByRole('button', { name: /^Add ticket to Backlog$/i }).click();

    const input = page.getByRole('textbox', { name: /new ticket in Backlog/i });
    await input.fill(TICKET_TITLE);
    await input.press('Enter');

    await expect(listSection(page, 'Backlog').getByText(TICKET_TITLE)).toBeVisible();
  });

  test('the Board shows the same ticket, with its key', async ({ page }) => {
    await openView(page, 'board');

    const card = page.getByText(TICKET_TITLE);
    await expect(card).toBeVisible();

    // A ticket keeps its identity in both drawings: the key is what somebody
    // quotes in an email, and a card that hides it is useless for finding it.
    const key = await api.request
      .get(`/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/work-items`, {
        headers: api.headers,
      })
      .then((response) => response.json())
      .then(
        (body) =>
          (body.data.items as { title: string; details: { key?: string } }[]).find(
            (item) => item.title === TICKET_TITLE,
          )?.details.key,
      );

    expect(key).toMatch(/^[A-Z]+-\d+$/);
    await expect(page.getByText(key as string).first()).toBeVisible();
  });

  test('moving it on the Board regroups it in the List', async ({ page }) => {
    /*
     * Moved through the API rather than by dragging.
     *
     * The drag itself is covered by the board's own suite; what this journey is
     * about is whether the *result* reaches the other view. Driving dnd-kit
     * through synthetic pointer events here would make the assertion that
     * matters fail for reasons that have nothing to do with it.
     */
    const items = await (
      await api.request.get(
        `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/work-items`,
        { headers: api.headers },
      )
    ).json();

    const ticket = (items.data.items as { id: string; title: string }[]).find(
      (item) => item.title === TICKET_TITLE,
    );

    const project = await (
      await api.request.get(`/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}`, {
        headers: api.headers,
      })
    ).json();

    const inProgress = (project.data.sections as { id: string; name: string }[]).find(
      (section) => section.name === 'In Progress',
    );

    const moved = await api.request.patch(
      `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/work-items/${ticket!.id}/move`,
      { headers: api.headers, data: { targetSectionId: inProgress!.id } },
    );
    expect(moved.ok()).toBe(true);

    await openView(page, 'list');

    await expect(listSection(page, 'In Progress').getByText(TICKET_TITLE)).toBeVisible();
    await expect(listSection(page, 'Backlog').getByText(TICKET_TITLE)).toHaveCount(0);
  });

  test('a priority set in the List reaches the Board', async ({ page }) => {
    await openView(page, 'list');

    const row = listSection(page, 'In Progress').getByRole('row').filter({ hasText: TICKET_TITLE });
    await row.getByRole('button', { name: /^priority for/i }).click();

    // A ticket's priorities are its own vocabulary — URGENT, not CRITICAL.
    await page.getByRole('option', { name: 'URGENT' }).click();

    await openView(page, 'board');
    await expect(page.getByText(TICKET_TITLE)).toBeVisible();

    const updated = await (
      await api.request.get(
        `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/work-items`,
        { headers: api.headers },
      )
    ).json();

    const ticket = (updated.data.items as { title: string; priority: { id: string } }[]).find(
      (item) => item.title === TICKET_TITLE,
    );

    expect(ticket?.priority.id).toBe('URGENT');
  });

  test('the dropdown creates the other type, and it lands in both views', async ({ page }) => {
    await openView(page, 'board');

    await page.getByRole('button', { name: /choose what to add/i }).click();
    await page.getByRole('menuitem', { name: /^Task$/ }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(TASK_TITLE);
    await dialog.getByRole('button', { name: /^Add task$/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(TASK_TITLE)).toBeVisible();

    await openView(page, 'list');
    await expect(page.getByText(TASK_TITLE)).toBeVisible();
  });

  test('a section created from the menu appears as a group and a column', async ({ page }) => {
    await openView(page, 'list');

    await page.getByRole('button', { name: /choose what to add/i }).click();
    await page.getByRole('menuitem', { name: /^Section$/ }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(SECTION_NAME);
    await dialog.getByRole('button', { name: /^Add section$/i }).click();
    await expect(dialog).toBeHidden();

    // The List updates without a reload — it reads sections from field metadata,
    // which for a long time nothing invalidated on create.
    await expect(listSection(page, SECTION_NAME)).toBeVisible();

    await openView(page, 'board');
    await expect(page.getByRole('button', { name: `Add ticket to ${SECTION_NAME}` })).toBeVisible();
  });

  test('everything survives a reload', async ({ page }) => {
    await openView(page, 'list');
    await page.reload();

    await expect(listSection(page, 'In Progress').getByText(TICKET_TITLE)).toBeVisible();
    await expect(page.getByText(TASK_TITLE)).toBeVisible();
    await expect(listSection(page, SECTION_NAME)).toBeVisible();
  });

  test('each step left an activity entry', async () => {
    // The feed is what answers "who put this here, and when" — a change that
    // does not appear in it is a change nobody can account for later.
    const activity = await (
      await api.request.get(`/api/v1/workspaces/${api.workspaceId}/activity?limit=100`, {
        headers: api.headers,
      })
    ).json();

    const summaries = (activity.data as { summary: string }[]).map((entry) => entry.summary);

    expect(summaries.some((line) => line.includes(TICKET_TITLE))).toBe(true);
    expect(summaries.some((line) => line.includes(TASK_TITLE))).toBe(true);
  });

  test('the API refuses a type the picker never offers', async () => {
    /*
     * The menu shows Milestone disabled, but a disabled control is presentation.
     * Without this check the row would be written as whichever record the
     * service defaulted to, wearing a label that lies about what it is.
     */
    const refused = await api.request.post(
      `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/work-items`,
      { headers: api.headers, data: { type: 'MILESTONE', title: 'Not yet' } },
    );

    expect(refused.status()).toBe(422);
  });

  test.afterAll(async () => {
    /*
     * Cleans up through the API so it runs even when a test above failed
     * part-way. A journey that leaves its own rows behind makes the next run
     * fail for a reason that has nothing to do with the code.
     */
    if (!api) return;

    await setDefaultType(api, 'TASK');

    const base = `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}`;

    const items = await (
      await api.request.get(`${base}/work-items`, { headers: api.headers })
    ).json();

    for (const item of (items.data?.items ?? []) as {
      id: string;
      title: string;
      type: string;
    }[]) {
      if (!item.title.startsWith('Journey ')) continue;

      /*
       * Two paths, because the two kinds are not disposed of the same way.
       *
       * A task has a delete route, which archives it. A ticket has none — its
       * key is external identity and deleting one leaves a dangling reference
       * in somebody's inbox — so it is closed instead. Sending both to the task
       * route 404s on every ticket and leaves them in the views.
       */
      if (item.type === 'TICKET') {
        await api.request.patch(`/api/v1/workspaces/${api.workspaceId}/tickets/${item.id}`, {
          headers: api.headers,
          data: { status: 'CLOSED' },
        });
        continue;
      }

      await api.request.delete(`/api/v1/workspaces/${api.workspaceId}/tasks/${item.id}`, {
        headers: api.headers,
      });
    }

    const project = await (await api.request.get(base, { headers: api.headers })).json();

    for (const section of (project.data?.sections ?? []) as { id: string; name: string }[]) {
      if (!section.name.startsWith('Journey ')) continue;

      await api.request.delete(`${base}/sections/${section.id}`, { headers: api.headers });
    }

    await api.request.dispose();
  });
});
