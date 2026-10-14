import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationEmailsCard } from './notification-emails-card';

const save = vi.fn();

vi.mock('../hooks/use-notification-preferences', () => ({
  useNotificationPreferences: () => ({
    data: { emailGroups: ['ASSIGNED', 'MENTIONED'], emailAddress: 'bea@example.org' },
    isLoading: false,
  }),
  useSaveNotificationPreferences: () => ({ mutate: save, isPending: false }),
}));

beforeEach(() => save.mockReset());

describe('NotificationEmailsCard', () => {
  it('shows what is emailed, and to where, and saves each change', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NotificationEmailsCard workspaceId="ws-1" />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/to bea@example\.org/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Someone @mentions me' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /comments on something I follow/ }),
    ).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /comments on something I follow/ }));
    expect(save).toHaveBeenLastCalledWith({ emailGroups: ['ASSIGNED', 'MENTIONED', 'COMMENTS'] });

    await user.click(screen.getByRole('checkbox', { name: 'Someone @mentions me' }));
    expect(save).toHaveBeenLastCalledWith({ emailGroups: ['ASSIGNED'] });
  });
});
