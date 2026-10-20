import type { AuthUser } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { renderWithProviders, screen, setupUser, waitFor, within } from '@/test/test-utils';

import { AccountSecurityCard } from './account-security-card';

const changePassword = vi.fn();
const resend = vi.fn();
const forgotPassword = vi.fn();
const pendingEmailChange = vi.fn();
const requestEmailChange = vi.fn();
const twoFactorStatus = vi.fn();
const setupTwoFactor = vi.fn();
const enableTwoFactor = vi.fn();
const disableTwoFactor = vi.fn();

vi.mock('@/features/auth/api/auth.api', () => ({
  authApi: {
    changePassword: (...args: unknown[]) => changePassword(...args),
    forgotPassword: (...args: unknown[]) => forgotPassword(...args),
    pendingEmailChange: () => pendingEmailChange(),
    requestEmailChange: (...args: unknown[]) => requestEmailChange(...args),
    twoFactorStatus: () => twoFactorStatus(),
    setupTwoFactor: () => setupTwoFactor(),
    enableTwoFactor: (...args: unknown[]) => enableTwoFactor(...args),
    disableTwoFactor: (...args: unknown[]) => disableTwoFactor(...args),
  },
}));

vi.mock('@/features/auth/hooks/use-email-verification', () => ({
  useResendVerification: () => ({ mutate: resend, isPending: false }),
}));

const account: AuthUser = {
  id: 'u-1',
  email: 'bea@example.com',
  name: 'Bea Lin',
  avatarUrl: null,
  timezone: 'UTC',
  emailVerified: false,
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

beforeEach(() => {
  changePassword.mockReset();
  resend.mockReset();
  forgotPassword.mockReset().mockResolvedValue({ sent: true });
  pendingEmailChange.mockReset().mockResolvedValue(null);
  requestEmailChange.mockReset();
  twoFactorStatus
    .mockReset()
    .mockResolvedValue({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 });
  setupTwoFactor.mockReset();
  enableTwoFactor.mockReset();
  disableTwoFactor.mockReset();
});

describe('AccountSecurityCard', () => {
  it('offers a new link while the address is unconfirmed, and not after', async () => {
    const { rerender } = renderWithProviders(<AccountSecurityCard user={account} />);
    const user = setupUser();

    expect(screen.getByText('Not confirmed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send confirmation link' }));
    expect(resend).toHaveBeenCalled();

    rerender(<AccountSecurityCard user={{ ...account, emailVerified: true }} />);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send confirmation link' }),
    ).not.toBeInTheDocument();
  });

  it('says when the address has to be confirmed by', () => {
    renderWithProviders(
      <AccountSecurityCard
        user={{ ...account, emailVerificationDueAt: '2026-10-28T12:00:00.000Z' }}
      />,
    );
    expect(screen.getByText(/confirm it by oct 28.* to keep using coretask/i)).toBeInTheDocument();
  });

  it('changes the password with the current one, and closes when it worked', async () => {
    changePassword.mockResolvedValue(undefined);
    renderWithProviders(<AccountSecurityCard user={account} />);
    const user = setupUser();

    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await user.type(screen.getByLabelText(/^current password/i), 'Old-pass-2024!');
    await user.type(screen.getByLabelText(/^new password/i), 'Brand-new-pass-2026');
    await user.type(screen.getByLabelText(/^confirm new password/i), 'Brand-new-pass-2026');
    await user.click(
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
    renderWithProviders(<AccountSecurityCard user={account} />);
    const user = setupUser();

    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await user.type(screen.getByLabelText(/^current password/i), 'wrong');
    await user.type(screen.getByLabelText(/^new password/i), 'Brand-new-pass-2026');
    await user.type(screen.getByLabelText(/^confirm new password/i), 'Brand-new-pass-2026');
    await user.click(
      screen.getAllByRole('button', { name: 'Change password' }).at(-1) as HTMLElement,
    );

    expect(await screen.findByText('Your current password is not right.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('turns on two-step verification once a code checks out, then shows the recovery codes', async () => {
    setupTwoFactor.mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/CoreTask:bea@example.com?secret=JBSW',
      qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      setupToken: 'sealed-setup',
    });
    enableTwoFactor
      .mockRejectedValueOnce(
        new ApiError({
          status: 400,
          code: 'TWO_FACTOR_CODE_INVALID',
          message: 'That code is not right. Check your authenticator app and try again.',
        }),
      )
      .mockResolvedValueOnce({ recoveryCodes: ['abcd-efgh-jkmn-pqrs', 'stuv-wxyz-2345-6789'] });
    renderWithProviders(<AccountSecurityCard user={account} />);
    const user = setupUser();

    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByAltText(/qr code/i)).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(setupTwoFactor).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/code from the app/i), '000000');
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    expect(await within(dialog).findByText(/that code is not right/i)).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/code from the app/i));
    await user.type(within(dialog).getByLabelText(/code from the app/i), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }));

    await waitFor(() =>
      expect(enableTwoFactor).toHaveBeenLastCalledWith({
        setupToken: 'sealed-setup',
        code: '123456',
      }),
    );
    const codes = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(codes).toHaveTextContent('abcd-efgh-jkmn-pqrs');
  });

  it('asks for the password before turning two-step verification off', async () => {
    disableTwoFactor.mockResolvedValue(undefined);
    twoFactorStatus.mockResolvedValue({
      enabled: true,
      enabledAt: '2026-10-01T00:00:00.000Z',
      recoveryCodesRemaining: 8,
    });
    renderWithProviders(<AccountSecurityCard user={{ ...account, twoFactorEnabled: true }} />);
    const user = setupUser();

    expect(await screen.findByText(/8 of 10 recovery codes left/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Turn off' })).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/your password/i), 'Old-pass-2024!');
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    await waitFor(() =>
      expect(disableTwoFactor).toHaveBeenCalledWith({ password: 'Old-pass-2024!' }),
    );
  });

  it('sends a link to a new address, and says when the address is taken', async () => {
    requestEmailChange
      .mockRejectedValueOnce(
        new ApiError({
          status: 409,
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with this e-mail address already exists.',
        }),
      )
      .mockResolvedValueOnce({ email: 'bea@new.example', expiresAt: '2026-10-22T00:00:00.000Z' });
    renderWithProviders(<AccountSecurityCard user={account} />);
    const user = setupUser();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/new e-mail address/i), 'Bea@New.Example');
    await user.type(within(dialog).getByLabelText(/your password/i), 'Old-pass-2024!');
    await user.click(within(dialog).getByRole('button', { name: 'Send link' }));
    expect(await within(dialog).findByText(/another account already uses/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Send link' }));
    await waitFor(() =>
      expect(requestEmailChange).toHaveBeenLastCalledWith({
        email: 'bea@new.example',
        password: 'Old-pass-2024!',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a waiting change, and lets an account without a password set one by e-mail', async () => {
    pendingEmailChange.mockResolvedValue({
      email: 'bea@new.example',
      expiresAt: '2026-10-22T00:00:00.000Z',
    });
    renderWithProviders(<AccountSecurityCard user={{ ...account, hasPassword: false }} />);
    const user = setupUser();

    expect(await screen.findByText('bea@new.example')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel change' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Set a password' }));
    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('bea@example.com'));
  });
});
