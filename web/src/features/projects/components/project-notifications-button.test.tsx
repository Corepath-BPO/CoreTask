import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen, setupUser, waitFor } from '@/test/test-utils';

import { ProjectNotificationsButton } from './project-notifications-button';

const notificationSettings = vi.fn();
const setNotificationSettings = vi.fn();

vi.mock('../api/projects.api', () => ({
  projectMembersApi: {
    notificationSettings: (...args: unknown[]) => notificationSettings(...args),
    setNotificationSettings: (...args: unknown[]) => setNotificationSettings(...args),
  },
}));

beforeEach(() => {
  notificationSettings.mockReset();
  setNotificationSettings.mockReset();
});

describe('ProjectNotificationsButton', () => {
  it('loads the choice when opened, and saves a change', async () => {
    notificationSettings.mockResolvedValue({
      member: true,
      notifyOn: ['STATUS_UPDATES', 'MESSAGES'],
    });
    setNotificationSettings.mockResolvedValue({
      member: true,
      notifyOn: ['STATUS_UPDATES', 'MESSAGES', 'TASKS_COMPLETED'],
    });
    renderWithProviders(
      <ProjectNotificationsButton workspaceId="ws-1" projectId="p-1" projectName="Leasing" />,
    );
    expect(notificationSettings).not.toHaveBeenCalled();
    const user = setupUser();

    await user.click(screen.getByRole('button', { name: 'Notifications for Leasing' }));
    expect(await screen.findByRole('checkbox', { name: /Status updates/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Tasks completed/ })).not.toBeChecked();
    expect(notificationSettings).toHaveBeenCalledWith('ws-1', 'p-1');

    await user.click(screen.getByRole('checkbox', { name: /Tasks completed/ }));
    await waitFor(() =>
      expect(setNotificationSettings).toHaveBeenCalledWith('ws-1', 'p-1', {
        notifyOn: ['STATUS_UPDATES', 'MESSAGES', 'TASKS_COMPLETED'],
      }),
    );
  });
});
