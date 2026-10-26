import type { AuthUser, WorkspaceSummary } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { renderWithProviders, screen, setupUser, waitFor } from '@/test/test-utils';

import { DeleteWorkspaceCard } from './delete-workspace-card';

const deleteWorkspace = vi.fn();
const navigate = vi.fn();

vi.mock('../api/account.api', () => ({
  accountApi: { deleteWorkspace: (...args: unknown[]) => deleteWorkspace(...args) },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigate,
}));

const owner: AuthUser = {
  id: 'u-1',
  email: 'olive@example.com',
  name: 'Olive Owner',
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

const workspace = {
  id: 'ws-1',
  name: 'Acme Product',
  role: 'OWNER',
  memberCount: 4,
  projectCount: 2,
} as WorkspaceSummary;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' });
});

const openDialog = async (user: ReturnType<typeof setupUser>) => {
  await user.click(screen.getByRole('button', { name: 'Delete workspace' }));
  return screen.getByRole('dialog');
};

const confirmButton = () =>
  screen.getAllByRole('button', { name: 'Delete workspace' }).at(-1) as HTMLElement;

describe('DeleteWorkspaceCard', () => {
  it('needs the name exactly and the password, then deletes and leaves the workspace', async () => {
    deleteWorkspace.mockResolvedValue(undefined);
    renderWithProviders(<DeleteWorkspaceCard workspace={workspace} user={owner} />);
    const user = setupUser();

    const dialog = await openDialog(user);
    expect(dialog).toHaveTextContent('webhook in it is deleted, for all 4 members. Nobody');
    expect(confirmButton()).toBeDisabled();

    await user.type(screen.getByLabelText(/^type acme product to confirm/i), 'acme product');
    await user.type(screen.getByLabelText(/^your password/i), 'CoreTask!2024');
    expect(confirmButton()).toBeDisabled();

    await user.clear(screen.getByLabelText(/^type acme product to confirm/i));
    await user.type(screen.getByLabelText(/^type acme product to confirm/i), 'Acme Product');
    expect(confirmButton()).toBeEnabled();
    await user.click(confirmButton());

    await waitFor(() =>
      expect(deleteWorkspace).toHaveBeenCalledWith('ws-1', {
        confirmation: 'Acme Product',
        password: 'CoreTask!2024',
      }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });

  it('puts a wrong password beside the password, and keeps the dialog open', async () => {
    deleteWorkspace.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Your current password is not right.',
      }),
    );
    renderWithProviders(<DeleteWorkspaceCard workspace={workspace} user={owner} />);
    const user = setupUser();

    await openDialog(user);
    await user.type(screen.getByLabelText(/^type acme product to confirm/i), 'Acme Product');
    await user.type(screen.getByLabelText(/^your password/i), 'wrong');
    await user.click(confirmButton());

    expect(await screen.findByText('Your current password is not right.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
  });

  it('asks an owner who signs in only with SSO for the name alone', async () => {
    deleteWorkspace.mockResolvedValue(undefined);
    const ssoOwner = { ...owner, hasPassword: false };
    renderWithProviders(<DeleteWorkspaceCard workspace={workspace} user={ssoOwner} />);
    const user = setupUser();

    await openDialog(user);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^type acme product to confirm/i), 'Acme Product');
    await user.click(confirmButton());

    await waitFor(() =>
      expect(deleteWorkspace).toHaveBeenCalledWith('ws-1', { confirmation: 'Acme Product' }),
    );
  });
});
