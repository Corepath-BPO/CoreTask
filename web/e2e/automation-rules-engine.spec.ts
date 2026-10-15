import { request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';

import { expect, test } from './fixtures';

/**
 * The rules-engine work in the builder, in a real browser: branch rows dragged
 * into another order.
 *
 * Each rule is built through the API so a test starts from a known shape, in a
 * project of this run's own.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now().toString(36);
const API_ORIGIN = process.env['E2E_API_ORIGIN'] ?? 'http://localhost:3010';

interface Api {
  request: APIRequestContext;
  headers: { authorization: string };
  workspaceId: string;
  projectId: string;
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

  const project = await request.post(`/api/v1/workspaces/${workspaceId}/projects`, {
    headers,
    data: { name: `Rules engine probe ${RUN}`, key: `RE${RUN.slice(-6).toUpperCase()}` },
  });
  expect(project.ok(), `could not create the project: ${project.status()}`).toBe(true);

  return { request, headers, workspaceId, projectId: (await project.json()).data.id as string };
}

const row = (id: string, order: number, configuration: Record<string, unknown>) => ({
  id,
  nodeType: 'CONDITION',
  subtype: 'FIELD_COMPARISON',
  configuration,
  parentId: 't',
  order,
});
const comment = (id: string, parentId: string, order: number, body: string) => ({
  id,
  nodeType: 'ACTION',
  subtype: 'ADD_COMMENT',
  configuration: { body },
  parentId,
  order,
});
const high = { field: 'priority', operator: 'IS', value: 'HIGH' };

test.describe('the rules engine in the builder', () => {
  let api: Api;

  test.beforeAll(async () => {
    api = await connect();
  });

  const createRule = async (name: string, nodes: unknown[], publish = false) => {
    const base = `/api/v1/workspaces/${api.workspaceId}/projects/${api.projectId}/automations`;
    const created = await api.request.post(base, {
      headers: api.headers,
      data: {
        name,
        triggerType: 'TASK_CREATED',
        nodes: [
          { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null, order: 0 },
          ...nodes,
        ],
      },
    });
    expect(created.ok(), `could not create the rule: ${created.status()}`).toBe(true);
    const id = (await created.json()).data.id as string;

    if (publish) {
      const published = await api.request.post(`${base}/${id}/publish`, { headers: api.headers });
      expect(published.ok(), `could not publish: ${published.status()}`).toBe(true);
    }
    return id;
  };

  const open = async (page: Page, ruleId: string) => {
    await page.goto(`/projects/${api.projectId}/automations/${ruleId}`);
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
  };

  /** The branch rows top to bottom, each with the comment beside it. */
  const rowsInOrder = async (page: Page) =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll('.react-flow__node')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.querySelector('button')?.getAttribute('aria-label') ?? '',
          y: Math.round(rect.y),
        };
      });
      return cards
        .filter((card) => card.label.startsWith('Do this'))
        .sort((a, b) => a.y - b.y)
        .map((card) => card.label.replace(/^Do this — Comment: /, ''));
    });

  test('drags a branch row above another, its actions coming with it', async ({ page }) => {
    const ruleId = await createRule(`Reorder ${RUN}`, [
      row('a', 1, high),
      comment('ca', 'a', 5, 'Branch A'),
      row('b', 2, { field: 'priority', operator: 'IS', value: 'CRITICAL' }),
      comment('cb', 'b', 6, 'Branch B'),
      row('c', 3, high),
      comment('cc', 'c', 7, 'Branch C'),
    ]);
    await open(page, ruleId);
    await expect.poll(() => rowsInOrder(page)).toEqual(['“Branch A”', '“Branch B”', '“Branch C”']);

    const handleOf = (name: RegExp) =>
      page
        .locator('.react-flow__node', { has: page.getByRole('button', { name }) })
        .locator('.branch-drag-handle');

    const from = await handleOf(/^Otherwise if — Priority is High$/).boundingBox();
    const to = await handleOf(/^Check if — Priority is High$/).boundingBox();
    expect(from && to).toBeTruthy();

    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2 + 6, { steps: 12 });
    await page.mouse.up();

    await expect.poll(() => rowsInOrder(page)).toEqual(['“Branch C”', '“Branch A”', '“Branch B”']);
    // The first row is the rule's question now; the one it displaced is an alternative.
    await expect(
      page.getByRole('button', { name: /^Otherwise if — Priority is High$/ }),
    ).toHaveCount(1);
  });

  test('moves a row with its menu, and the fallback stays last', async ({ page }) => {
    const ruleId = await createRule(`Move ${RUN}`, [
      row('a', 1, high),
      comment('ca', 'a', 5, 'First'),
      row('b', 2, { field: 'priority', operator: 'IS', value: 'LOW' }),
      comment('cb', 'b', 6, 'Second'),
      row('o', 3, { fallback: true }),
      comment('co', 'o', 7, 'Fallback'),
    ]);
    await open(page, ruleId);

    await page.getByRole('button', { name: 'More for: Priority is Low' }).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();

    await expect.poll(() => rowsInOrder(page)).toEqual(['“Second”', '“First”', '“Fallback”']);

    // Last movable row: nowhere further down to go, and nothing below the fallback.
    await page.getByRole('button', { name: 'More for: Priority is High' }).click();
    await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(
      page
        .locator('.react-flow__node', {
          has: page.getByRole('button', { name: /^Otherwise — / }),
        })
        .locator('.branch-drag-handle'),
    ).toHaveCount(0);
  });
});
