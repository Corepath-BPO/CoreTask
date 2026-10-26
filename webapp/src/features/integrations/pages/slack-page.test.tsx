import type { SlackStatus } from '@coretask/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { SlackPage } from './slack-page';

const install = vi.fn();
const disconnect = vi.fn();
const unlink = vi.fn();
let status: SlackStatus;

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Acme' }, isLoading: false }),
}));

vi.mock('../hooks/use-slack', () => ({
  useSlackStatus: () => ({ data: status, isLoading: false }),
  useStartSlackInstall: () => ({ mutate: install, isPending: false, isSuccess: false }),
  useDisconnectSlack: () => ({ mutate: disconnect, isPending: false }),
  useUnlinkSlack: () => ({ mutate: unlink, isPending: false }),
}));

const base: SlackStatus = {
  configured: true,
  installation: null,
  me: { linked: false, slackUserId: null },
  canManage: true,
};

beforeEach(() => {
  for (const mock of [install, disconnect, unlink]) mock.mockReset();
  status = base;
});

describe('SlackPage', () => {
  it('says plainly when the server has no Slack app', () => {
    status = { ...base, configured: false };
    render(<SlackPage />);
    expect(screen.getByText('Slack is not set up on this server')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to Slack' })).not.toBeInTheDocument();
  });

  it('lets an admin add it, and sends anyone else to an admin', async () => {
    const user = setupUser();
    const { unmount } = render(<SlackPage />);
    await user.click(screen.getByRole('button', { name: 'Add to Slack' }));
    expect(install).toHaveBeenCalledTimes(1);
    unmount();

    status = { ...base, canManage: false };
    render(<SlackPage />);
    expect(screen.getByText('Ask a workspace admin to connect Slack.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to Slack' })).not.toBeInTheDocument();
  });

  it('shows the connection, your link, and what Slack can do', async () => {
    status = {
      ...base,
      installation: {
        teamId: 'T1',
        teamName: 'Acme Slack',
        installedBy: { id: 'u-1', name: 'Ada Owner' },
        installedAt: '2026-10-17T12:00:00Z',
        linkedPeople: 3,
      },
    };
    const user = setupUser();
    const { unmount } = render(<SlackPage />);
    expect(screen.getByText('Connected to Acme Slack')).toBeInTheDocument();
    expect(screen.getByText(/By Ada Owner, .* · 3 people linked/)).toBeInTheDocument();
    expect(screen.getByText('Link your Slack account')).toBeInTheDocument();
    expect(screen.getByText('/coretask link')).toBeInTheDocument();
    expect(screen.getByText('/coretask <task name>')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(disconnect).toHaveBeenCalledTimes(1);
    unmount();

    status = { ...status, me: { linked: true, slackUserId: 'U1' }, canManage: false };
    render(<SlackPage />);
    expect(screen.getByText('Your Slack account is linked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unlink' }));
    expect(unlink).toHaveBeenCalledTimes(1);
  });
});
