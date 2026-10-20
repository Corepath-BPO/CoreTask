import type { AuthUser } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/test-utils';

import { AccountSecurityCard } from './account-security-card';

const changePassword = vi.fn();
const resend = vi.fn();
const logoutEverywhere = vi.fn();

vi.mock('@/features/auth/api/auth.api', () => ({
  authApi: { changePassword: (...args: unknown[]) => changePassword(...args) },
}));

vi.mock('@/features/auth/hooks/use-email-verification', () => ({
  useResendVerification: () => ({ mutate: resend, isPending: false }),
}));

vi.mock('@/features/auth/hooks/use-auth', () => ({
  useAuth: () => ({ logoutEverywhere: { mutate: logoutEverywhere, isPending: false } }),
}));

const user: AuthUser = {
  id: 'u-1',
  email: 'bea@example.com',
  name: 'Bea Lin',
  avatarUrl: null,
  timezone: 'UTC',
  emailVerified: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  pronouns: null,
  jobTitle: null,
  department: null,
  aboutMe: null,
  outOfOffice: null,
};

beforeEach(() => {
  changePassword.mockReset();
  resend.mockReset();
  logoutEverywhere.mockReset();
});

describe('AccountSecurityCard', () => {
  it('offers a new link while the address is unconfirmed, and not after', async () => {
    const { rerender } = renderWithProviders(<AccountSecurityCard user={user} />);

    expect(screen.getByText('Not confirmed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send confirmation link' }));
    expect(resend).toHaveBeenCalled();

    rerender(<AccountSecurityCard user={{ ...user, emailVerified: true }} />);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send confirmation link' }),
    ).not.toBeInTheDocument();
  });

  it('changes the password with the current one, and closes when it worked', async () => {
    changePassword.mockResolvedValue(undefined);
    renderWithProviders(<AccountSecurityCard user={user} />);

    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await userEvent.type(screen.getByLabelText(/^current password/i), 'Old-pass-2024!');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'Brand-new-pass-2026');
    await userEvent.type(screen.getByLabelText(/^confirm new password/i), 'Brand-new-pass-2026');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Change password' }).at(-1) as HTMLElement,
    );

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith('Old-pass-2024!', 'Brand-new-pass-2026'),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('puts a wrong current password on its own field', async () => {
    changePassword.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Your current password is not right.',
      }),
    );
    renderWithProviders(<AccountSecurityCard user={user} />);

    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await userEvent.type(screen.getByLabelText(/^current password/i), 'wrong');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'Brand-new-pass-2026');
    await userEvent.type(screen.getByLabelText(/^confirm new password/i), 'Brand-new-pass-2026');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Change password' }).at(-1) as HTMLElement,
    );

    expect(await screen.findByText('Your current password is not right.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('asks before signing out everywhere', async () => {
    renderWithProviders(<AccountSecurityCard user={user} />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(logoutEverywhere).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('this one included');

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Sign out everywhere' }).at(-1) as HTMLElement,
    );
    expect(logoutEverywhere).toHaveBeenCalled();
  });
});
