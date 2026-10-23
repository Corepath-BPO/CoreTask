import type { AccountDeletionPreview, AuthUser } from '@coretask/types';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { shouldAttemptRestore } from '@/lib/api/session-hint';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { renderWithProviders, screen, setupUser, waitFor, within } from '@/test/test-utils';

import { DeleteAccountCard } from './delete-account-card';

const deletionPreview = vi.fn();
const deleteAccount = vi.fn();
const navigate = vi.fn();

vi.mock('../api/account.api', () => ({
  accountApi: {
    deletionPreview: (...args: unknown[]) => deletionPreview(...args),
    deleteAccount: (...args: unknown[]) => deleteAccount(...args),
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  // jsdom cannot follow a real link; the click handler is what is under test.
  Link: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <a
      href="/members"
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));

const account: AuthUser = {
  id: 'u-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  avatarUrl: null,
  timezone: 'UTC',
  emailVerified: true,
  emailVerificationDueAt: null,
  hasPassword: true,
  twoFactorEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  pronouns: null,
  jobTitle: null,
  department: null,
  aboutMe: null,
  outOfOffice: null,
};

const clear: AccountDeletionPreview = {
  workspacesDeleted: [{ id: 'ws-alone', name: 'Only Ada' }],
  workspacesBlocking: [],
  workspacesLeft: [{ id: 'ws-bob', name: 'Bob’s' }],
  reauth: 'password',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ status: 'authenticated', user: account });
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-bob' });
});

const confirmButton = () => screen.getByRole('button', { name: 'Delete my account' });

describe('DeleteAccountCard', () => {
  it('shows what goes and what is left, then deletes and signs this browser out', async () => {
    deletionPreview.mockResolvedValue(clear);
    deleteAccount.mockResolvedValue(undefined);
    renderWithProviders(<DeleteAccountCard user={account} />);
    const user = setupUser();

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const deleted = await screen.findByRole('region', { name: 'Deleted with your account' });
    expect(within(deleted).getByText('Only Ada')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Workspaces you leave' })).getByText('Bob’s'),
    ).toBeInTheDocument();

    expect(confirmButton()).toBeDisabled();
    await user.type(screen.getByLabelText(/^type delete to confirm/i), 'delete');
    await user.type(screen.getByLabelText(/^your password/i), 'CoreTask!2024');
    expect(confirmButton()).toBeDisabled();
    await user.clear(screen.getByLabelText(/^type delete to confirm/i));
    await user.type(screen.getByLabelText(/^type delete to confirm/i), 'DELETE');
    await user.click(confirmButton());

    await waitFor(() =>
      expect(deleteAccount).toHaveBeenCalledWith({
        confirmation: 'DELETE',
        password: 'CoreTask!2024',
      }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login', replace: true }));
    expect(useAuthStore.getState().user).toBeNull();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    // Known signed out: the next load does not try to restore a session.
    expect(shouldAttemptRestore()).toBe(false);
  });

  it('will not go ahead while it owns a shared workspace, and points at its members', async () => {
    deletionPreview.mockResolvedValue({
      ...clear,
      workspacesBlocking: [{ id: 'ws-shared', name: 'Ada and Bob', memberCount: 3 }],
    });
    renderWithProviders(<DeleteAccountCard user={account} />);
    const user = setupUser();

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const blocking = await screen.findByRole('region', { name: 'Workspaces to deal with first' });
    expect(blocking).toHaveTextContent('Ada and Bob');
    expect(blocking).toHaveTextContent('3 members');
    expect(screen.queryByLabelText(/^type delete to confirm/i)).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();

    await user.click(within(blocking).getByText('Manage members'));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-shared');
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('puts a wrong password beside the password, and stays signed in', async () => {
    deletionPreview.mockResolvedValue(clear);
    deleteAccount.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Your current password is not right.',
      }),
    );
    renderWithProviders(<DeleteAccountCard user={account} />);
    const user = setupUser();

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await screen.findByRole('region', { name: 'Deleted with your account' });
    await user.type(screen.getByLabelText(/^type delete to confirm/i), 'DELETE');
    await user.type(screen.getByLabelText(/^your password/i), 'wrong');
    await user.click(confirmButton());

    expect(await screen.findByText('Your current password is not right.')).toBeInTheDocument();
    expect(useAuthStore.getState().user).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
