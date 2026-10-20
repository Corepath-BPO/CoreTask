import type { ProjectAppConnection } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { paste, setupUser } from '@/test/test-utils';

import { CustomizeAppsSection } from './customize-apps-section';

const connect = vi.fn();
const update = vi.fn();
const test = vi.fn();
const disconnect = vi.fn();
let apps: ProjectAppConnection[];
let slackInstalled: boolean;

vi.mock('../../hooks/use-project-apps', () => ({
  useProjectApps: () => ({ data: apps, isLoading: false }),
  useConnectProjectApp: () => ({ mutate: connect, isPending: false }),
  useUpdateProjectApp: () => ({ mutate: update, isPending: false }),
  useTestProjectApp: () => ({ mutate: test, isPending: false }),
  useDisconnectProjectApp: () => ({ mutate: disconnect, isPending: false }),
}));

vi.mock('@/features/integrations/hooks/use-slack', () => ({
  useSlackStatus: (workspaceId: string | undefined) => ({
    isLoading: false,
    data: workspaceId
      ? {
          configured: true,
          installation: slackInstalled
            ? {
                teamId: 'T1',
                teamName: 'Acme',
                installedBy: null,
                installedAt: '2026-10-17T00:00:00Z',
                linkedPeople: 1,
              }
            : null,
          me: { linked: false, slackUserId: null },
          canManage: true,
        }
      : undefined,
  }),
  useSlackChannels: (_workspaceId: string | undefined, enabled: boolean) => ({
    isLoading: false,
    isError: false,
    data: enabled
      ? [
          { id: 'G0BOARD', name: 'board', isPrivate: true },
          { id: 'C0LEASING', name: 'leasing', isPrivate: false },
        ]
      : undefined,
  }),
}));

const connection = (over: Partial<ProjectAppConnection> = {}): ProjectAppConnection => ({
  id: 'a-1',
  app: 'SLACK',
  name: '#maintenance',
  urlHint: 'hooks.slack.com/…/abcd',
  slackChannel: null,
  events: ['task.created', 'task.completed', 'comment.created'],
  enabled: true,
  disabledReason: null,
  lastDeliveryAt: null,
  lastDeliveryStatus: null,
  lastSuccessAt: null,
  createdBy: { id: 'u-1', name: 'Ada' },
  createdAt: '2026-10-14T00:00:00Z',
  ...over,
});

const renderSection = (canEdit = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CustomizeAppsSection workspaceId="ws-1" projectId="p-1" canEdit={canEdit} />
    </QueryClientProvider>,
  );

/*
 * Connecting Slack ran past Vitest's 5-second timeout once the whole suite ran
 * in parallel, so these tests skip two costs neither is testing: the timer tick
 * user-event waits between actions (a ~15ms timer slice on Windows), and typing
 * 70-odd characters one at a time, which re-renders the dialog per keystroke.
 * What is left still took up to 4.3 seconds under that load, so connecting
 * Slack gets a 15-second timeout sized for a journey, not a single check.
 */
beforeEach(() => {
  for (const mock of [connect, update, test, disconnect]) mock.mockReset();
  apps = [];
  slackInstalled = false;
});

describe('CustomizeAppsSection', () => {
  it('connects Slack with the URL, a name and what to post', async () => {
    const user = setupUser();
    renderSection();

    expect(screen.getByText('No apps yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Slack' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeDisabled();

    await paste(user, within(dialog).getByLabelText('Webhook URL'), 'https://example.org/x');
    expect(
      within(dialog).getByText('That does not look like a Slack webhook URL.'),
    ).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Webhook URL'));
    await paste(
      user,
      within(dialog).getByLabelText('Webhook URL'),
      'https://hooks.slack.com/services/T0/B0/x',
    );
    expect(within(dialog).queryByText(/does not look like/)).not.toBeInTheDocument();
    await paste(user, within(dialog).getByLabelText('Channel name'), '#maintenance');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Someone comments' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'A task is assigned' }));
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));

    expect(connect).toHaveBeenCalledWith(
      {
        app: 'SLACK',
        url: 'https://hooks.slack.com/services/T0/B0/x',
        name: '#maintenance',
        events: ['task.created', 'task.completed', 'task.assigned', 'project.status_updated'],
      },
      expect.anything(),
    );
  }, 15_000);

  it('lists a connection with what it posts and how its last post went', async () => {
    const user = setupUser();
    apps = [
      connection(),
      connection({
        id: 'a-2',
        app: 'TEAMS',
        name: 'Leasing team',
        events: ['task.completed'],
        enabled: false,
        disabledReason: 'Failed 20 times in a row',
      }),
    ];
    renderSection();

    const list = screen.getByRole('list', { name: 'Connected apps' });
    const [slack, teams] = within(list).getAllByRole('listitem');
    expect(slack).toHaveTextContent('#maintenance · Slack');
    expect(slack).toHaveTextContent(
      'Posts when a task is added, a task is completed or someone comments.',
    );
    expect(slack).toHaveTextContent('Nothing posted yet');
    expect(teams).toHaveTextContent('Switched off: Failed 20 times in a row');

    await user.click(
      within(slack as HTMLElement).getByRole('switch', { name: 'Post to #maintenance' }),
    );
    expect(update).toHaveBeenCalledWith({ appId: 'a-1', payload: { enabled: false } });

    await user.click(screen.getByRole('button', { name: 'More for #maintenance' }));
    await user.click(screen.getByRole('menuitem', { name: 'Send a test message' }));
    expect(test).toHaveBeenCalledWith('a-1');

    await user.click(screen.getByRole('button', { name: 'More for #maintenance' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Webhook URL')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'A task is added' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenLastCalledWith(
      {
        appId: 'a-1',
        payload: { name: '#maintenance', events: ['task.completed', 'comment.created'] },
      },
      expect.anything(),
    );
  });

  it('posts as the CoreTask Slack app to a chosen channel when the workspace has it', async () => {
    slackInstalled = true;
    apps = [
      connection({
        id: 'a-2',
        name: '#leasing',
        urlHint: '#leasing',
        slackChannel: { id: 'C0LEASING', name: 'leasing' },
      }),
    ];
    const user = setupUser();
    renderSection();

    expect(screen.getByRole('list', { name: 'Connected apps' })).toHaveTextContent(
      '#leasing · CoreTask Slack app',
    );

    await user.click(screen.getByRole('button', { name: 'Add Slack' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /As the CoreTask app/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(dialog).queryByLabelText('Webhook URL')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeDisabled();

    await user.click(within(dialog).getByRole('combobox', { name: 'Channel' }));
    await user.click(await screen.findByRole('option', { name: '#leasing' }));
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(connect).toHaveBeenCalledWith(
      {
        app: 'SLACK',
        slackChannelId: 'C0LEASING',
        events: ['task.created', 'task.completed', 'comment.created', 'project.status_updated'],
      },
      expect.anything(),
    );

    await user.click(within(dialog).getByRole('radio', { name: /Incoming webhook/ }));
    expect(within(dialog).getByLabelText('Webhook URL')).toBeInTheDocument();
  });

  it('sends people who cannot edit to an editor', () => {
    renderSection(false);
    expect(screen.getByText(/Ask a project editor to connect one/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Slack' })).not.toBeInTheDocument();
  });
});
