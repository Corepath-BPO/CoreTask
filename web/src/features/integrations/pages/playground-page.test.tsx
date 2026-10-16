import { WorkspaceRole } from '@coretask/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '@/app/config/env';
import { renderWithProviders } from '@/test/test-utils';

import { PlaygroundPage } from './playground-page';

const WORKSPACE = '019fc880-0000-7000-8000-000000000000';
const PROJECT = '019fc880-0000-7000-8000-00000000bbbb';
const SECTION = '019fc880-0000-7000-8000-00000000cccc';
const KEY = 'ctk_secretsecretsecretsecret';

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({
    workspace: { id: WORKSPACE, name: 'Acme Product', role: WorkspaceRole.OWNER },
    workspaces: [],
    isLoading: false,
    select: vi.fn(),
  }),
}));

vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({
    data: { items: [{ id: PROJECT, name: 'Platform Foundation', key: 'PLAT' }] },
  }),
  useProject: (_workspaceId: string, projectId: string) => ({
    data: projectId ? { id: projectId, sections: [{ id: SECTION, name: 'Backlog' }] } : undefined,
  }),
}));

vi.mock('@/lib/api/client', () => ({ getAccessToken: () => 'session-jwt' }));

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** The arguments of the one request the test fired. */
function sentRequest(): {
  url: string;
  init: { method: string; headers: Record<string, string>; body?: string };
} {
  const [url, init] = fetchMock.mock.calls[0] as [
    string,
    { method: string; headers: Record<string, string>; body?: string },
  ];
  return { url, init };
}

/*
 * The two longer journeys here ran past Vitest's 5-second timeout once the
 * whole suite ran in parallel. They now skip two costs none of them is
 * testing: the timer tick user-event waits between actions (a ~15ms timer
 * slice on Windows, over a second across one journey), and typing text a
 * character at a time, which re-renders the whole page per keystroke. What is
 * left is the work they do test, a dozen-odd clicks and accessible-name lookups
 * on the full page, and under that load it still took up to 5.2 seconds, so
 * those two get a 15-second timeout sized for a journey, not a single check.
 */
const setupUser = () => userEvent.setup({ delay: null });

/** Puts the whole text into a field at once, as pasting does. */
async function paste(user: UserEvent, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}

describe('PlaygroundPage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs "who am I" as the signed-in person and shows the real answer', async () => {
    const user = setupUser();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, data: { principal: 'user' } }, { 'x-request-id': 'r-1' }),
    );
    renderWithProviders(<PlaygroundPage />);

    expect(screen.getByText(/Nothing to fill in/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { url, init } = sentRequest();
    expect(url).toBe(`${env.apiUrl}/integration/whoami`);
    expect(init.method).toBe('GET');
    expect(init.headers['Authorization']).toBe('Bearer session-jwt');
    expect(init.body).toBeUndefined();

    expect(await screen.findByLabelText('HTTP 200')).toBeInTheDocument();
    expect(screen.getByTestId('playground-response')).toHaveTextContent('"principal": "user"');
  });

  it('creates a task as an API key, masks the key on screen, and hands the id to the next call', async () => {
    const user = setupUser();
    fetchMock.mockResolvedValue(
      jsonResponse(201, {
        success: true,
        data: { id: 'task-1', title: 'Filed from the playground' },
      }),
    );
    renderWithProviders(<PlaygroundPage />);

    await user.click(screen.getByRole('radio', { name: /An API key/ }));
    await paste(user, screen.getByLabelText('API key'), KEY);

    await user.click(screen.getByRole('button', { name: /Create a task/ }));
    await user.click(screen.getByRole('combobox', { name: /Project/ }));
    await user.click(await screen.findByRole('option', { name: /Platform Foundation/ }));
    await user.click(screen.getByRole('combobox', { name: /Section/ }));
    await user.click(await screen.findByRole('option', { name: 'Backlog' }));
    await paste(user, screen.getByLabelText(/Title/), 'Filed from the playground');

    // The preview never shows the whole key.
    expect(screen.getByText('ctk_secr…')).toBeInTheDocument();
    expect(screen.getByTestId('playground-url')).toHaveTextContent(
      `${env.apiUrl}/workspaces/${WORKSPACE}/tasks`,
    );

    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const { url, init } = sentRequest();
    expect(url).toBe(`${env.apiUrl}/workspaces/${WORKSPACE}/tasks`);
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe(KEY);
    expect(init.headers['Authorization']).toBeUndefined();
    expect(init.headers['Idempotency-Key']).toMatch(/^playground-/);
    expect(JSON.parse(init.body ?? '')).toEqual({
      sectionId: SECTION,
      title: 'Filed from the playground',
    });

    expect(await screen.findByLabelText('HTTP 201')).toBeInTheDocument();
    expect(screen.getByText('id: task-1')).toBeInTheDocument();

    // The new id is waiting in the call that completes a task.
    await user.click(screen.getByRole('button', { name: /Complete a task/ }));
    expect(screen.getByLabelText(/Task ID/)).toHaveValue('task-1');
  }, 15_000);

  it('adds a subtask under the task just created, lists them, and hands a picked one on', async () => {
    const user = setupUser();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(201, { success: true, data: { id: 'task-1', title: 'Parent' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          success: true,
          data: { id: 'sub-1', title: 'Check the deploy', parentTaskId: 'task-1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          success: true,
          data: [
            { id: 'sub-1', title: 'Check the deploy', status: 'TODO' },
            { id: 'sub-2', title: 'Ship it', status: 'DONE' },
          ],
        }),
      );
    renderWithProviders(<PlaygroundPage />);

    // A parent task first.
    await user.click(screen.getByRole('button', { name: /Create a task/ }));
    await user.click(screen.getByRole('combobox', { name: /Project/ }));
    await user.click(await screen.findByRole('option', { name: /Platform Foundation/ }));
    await user.click(screen.getByRole('combobox', { name: /Section/ }));
    await user.click(await screen.findByRole('option', { name: 'Backlog' }));
    await paste(user, screen.getByLabelText(/Title/), 'Parent');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByLabelText('HTTP 201')).toBeInTheDocument();

    // Its id is already the parent of the subtask to add.
    await user.click(screen.getByRole('button', { name: /Add a subtask/ }));
    expect(screen.getByLabelText(/Parent task ID/)).toHaveValue('task-1');
    await paste(user, screen.getByLabelText(/Subtask title/), 'Check the deploy');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, subtaskInit] = fetchMock.mock.calls[1] as [string, { body?: string }];
    expect(JSON.parse(subtaskInit.body ?? '')).toEqual({
      parentTaskId: 'task-1',
      title: 'Check the deploy',
    });
    expect(await screen.findByText('id: sub-1')).toBeInTheDocument();

    // Listing keeps the parent; every row can be handed to the next call.
    await user.click(screen.getByRole('button', { name: /List subtasks/ }));
    expect(screen.getByLabelText(/Parent task ID/)).toHaveValue('task-1');
    expect(screen.getByTestId('playground-url')).toHaveTextContent(
      `${env.apiUrl}/workspaces/${WORKSPACE}/tasks/task-1/subtasks`,
    );
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByLabelText('HTTP 200')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pick one to use as Task ID' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use Ship it as Task ID' }));

    await user.click(screen.getByRole('button', { name: /Complete a task/ }));
    expect(screen.getByLabelText(/Task ID/)).toHaveValue('sub-2');
  }, 15_000);

  it('refuses to run with required fields empty, and sends nothing', async () => {
    const user = setupUser();
    renderWithProviders(<PlaygroundPage />);

    await user.click(screen.getByRole('button', { name: /Create a task/ }));
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('Section is required.')).toBeInTheDocument();
    expect(screen.getByText('Title is required.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a replayed answer for what it is', async () => {
    const user = setupUser();
    fetchMock.mockResolvedValue(
      jsonResponse(
        201,
        { success: true, data: { id: 'task-1' } },
        { 'idempotency-replayed': 'true' },
      ),
    );
    renderWithProviders(<PlaygroundPage />);

    await user.click(screen.getByRole('button', { name: /Add a comment/ }));
    await user.type(screen.getByLabelText(/Task ID/), 'task-1');
    await user.type(screen.getByLabelText(/Comment/), 'Again');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('Replayed from an earlier run')).toBeInTheDocument();
  });
});
