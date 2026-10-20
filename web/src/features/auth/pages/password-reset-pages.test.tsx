import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { renderWithRouter, screen, setupUser, waitFor } from '@/test/test-utils';

import { ForgotPasswordPage } from './forgot-password-page';
import { LoginPage } from './login-page';
import { ResetPasswordPage } from './reset-password-page';

const forgotPassword = vi.fn();
const resetPassword = vi.fn();
const clear = vi.fn();

vi.mock('../api/auth.api', () => ({
  authApi: {
    forgotPassword: (...args: unknown[]) => forgotPassword(...args),
    resetPassword: (...args: unknown[]) => resetPassword(...args),
  },
}));

vi.mock('../hooks/use-auth', () => ({
  useAuth: () => ({ login: { mutateAsync: vi.fn(), isPending: false, error: null } }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (select: (state: { clear: () => void }) => unknown) => select({ clear }),
}));

beforeEach(() => {
  forgotPassword.mockReset();
  resetPassword.mockReset();
  clear.mockReset();
});

describe('signing in', () => {
  it('offers a way back in for a forgotten password, and no dots in the empty box', async () => {
    await renderWithRouter(LoginPage, { initialPath: '/login' });
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByLabelText(/^password/i)).toHaveAttribute('placeholder', 'Your password');
  });
});

describe('forgot password', () => {
  it('sends the link and says so without saying whether the account exists', async () => {
    forgotPassword.mockResolvedValue({ sent: true });
    const user = setupUser();
    await renderWithRouter(ForgotPasswordPage, { initialPath: '/forgot-password' });

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your e-mail' })).toBeInTheDocument();
    expect(screen.getByText(/If/)).toHaveTextContent('If ada@example.com has a CoreTask account');
    expect(forgotPassword).toHaveBeenCalledWith('ada@example.com');
  });
});

describe('choosing a new password', () => {
  const original = window.location.href;

  afterEach(() => {
    window.history.replaceState(null, '', original);
  });

  it('takes the token from the link, out of the address bar, and sets the password', async () => {
    window.history.replaceState(null, '', '/reset-password?token=tok-123');
    resetPassword.mockResolvedValue(undefined);
    const user = setupUser();
    await renderWithRouter(ResetPasswordPage, {
      initialPath: '/reset-password',
    });

    expect(window.location.search).toBe('');
    await user.type(screen.getByLabelText(/^new password/i), 'Brand-new-pass-2026');
    await user.type(screen.getByLabelText(/^confirm new password/i), 'Brand-new-pass-2026');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(resetPassword).toHaveBeenCalledWith('tok-123', 'Brand-new-pass-2026');
    expect(clear).toHaveBeenCalled();
  });

  it('offers a new link when this one has expired', async () => {
    window.history.replaceState(null, '', '/reset-password?token=old');
    resetPassword.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'PASSWORD_RESET_INVALID',
        message: 'This reset link is invalid, used or expired. Ask for a new one.',
      }),
    );
    const user = setupUser();
    await renderWithRouter(ResetPasswordPage, {
      initialPath: '/reset-password',
    });

    await user.type(screen.getByLabelText(/^new password/i), 'Brand-new-pass-2026');
    await user.type(screen.getByLabelText(/^confirm new password/i), 'Brand-new-pass-2026');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Ask for a new link' })).toBeInTheDocument(),
    );
  });

  it('says so when the link has no token', async () => {
    window.history.replaceState(null, '', '/reset-password');
    await renderWithRouter(ResetPasswordPage, {
      initialPath: '/reset-password',
    });
    expect(screen.getByRole('heading', { name: 'This link is incomplete' })).toBeInTheDocument();
  });
});
