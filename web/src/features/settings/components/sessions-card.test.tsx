import type { AccountSession } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen, setupUser, waitFor, within } from '@/test/test-utils';

import { SessionsCard } from './sessions-card';

const sessions = vi.fn();
const revokeSession = vi.fn();
const revokeOtherSessions = vi.fn();
const logoutEverywhere = vi.fn();

vi.mock('@/features/auth/api/auth.api', () => ({
  authApi: {
    sessions: () => sessions(),
    revokeSession: (id: string) => revokeSession(id),
    revokeOtherSessions: () => revokeOtherSessions(),
  },
}));

vi.mock('@/features/auth/hooks/use-auth', () => ({
  useAuth: () => ({ logoutEverywhere: { mutate: logoutEverywhere, isPending: false } }),
}));

const here: AccountSession = {
  id: '018f0000-0000-7000-8000-000000000001',
  current: true,
  method: 'PASSWORD',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  ipAddress: '10.0.0.1',
  signedInAt: '2026-10-20T10:00:00.000Z',
  lastActiveAt: '2026-10-21T10:00:00.000Z',
  expiresAt: '2026-11-20T10:00:00.000Z',
};

const phone: AccountSession = {
  ...here,
  id: '018f0000-0000-7000-8000-000000000002',
  current: false,
  method: 'GOOGLE',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipAddress: '10.0.0.2',
};

beforeEach(() => {
  sessions.mockReset().mockResolvedValue([here, phone]);
  revokeSession.mockReset().mockResolvedValue(undefined);
  revokeOtherSessions.mockReset().mockResolvedValue({ revoked: 1 });
  logoutEverywhere.mockReset();
});

describe('SessionsCard', () => {
  it('names each device, marks this one, and says how the others signed in', async () => {
    renderWithProviders(<SessionsCard />);

    const list = await screen.findByRole('list', { name: 'Sessions' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Chrome on Windows');
    expect(rows[0]).toHaveTextContent('This device');
    expect(rows[1]).toHaveTextContent('Safari on iPhone');
    expect(rows[1]).toHaveTextContent('Google');
    // This session is signed out with "Sign out", not from the list.
    expect(within(rows[0] as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
  });

  it('signs out one other session', async () => {
    renderWithProviders(<SessionsCard />);
    const user = setupUser();

    await user.click(await screen.findByRole('button', { name: 'Sign out Safari on iPhone' }));
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith(phone.id));
  });

  it('asks before signing out the others, and before signing out everywhere', async () => {
    renderWithProviders(<SessionsCard />);
    const user = setupUser();
    await screen.findByRole('list', { name: 'Sessions' });

    await user.click(screen.getByRole('button', { name: 'Sign out other sessions' }));
    expect(revokeOtherSessions).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This one stays signed in');
    await user.click(screen.getByRole('button', { name: 'Sign out others' }));
    await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('this one included');
    await user.click(
      screen.getAllByRole('button', { name: 'Sign out everywhere' }).at(-1) as HTMLElement,
    );
    expect(logoutEverywhere).toHaveBeenCalled();
  });

  it('has nothing to sign out of when this is the only session', async () => {
    sessions.mockResolvedValue([here]);
    renderWithProviders(<SessionsCard />);

    await screen.findByRole('list', { name: 'Sessions' });
    expect(screen.getByRole('button', { name: 'Sign out other sessions' })).toBeDisabled();
  });
});
