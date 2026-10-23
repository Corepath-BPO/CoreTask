import type { AuthSession } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { useAuthStore } from '@/stores/auth.store';
import { renderWithRouter, screen, setupUser, waitFor } from '@/test/test-utils';

import type * as AuthApiModule from '../api/auth.api';
import { LoginPage } from './login-page';

// Signing in to an account with two-step verification on: the real hook and
// page, with the network stubbed at the API module.
const login = vi.fn();
const verifyTwoFactor = vi.fn();

vi.mock('../api/auth.api', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthApiModule>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      login: (...args: unknown[]) => login(...args),
      verifyTwoFactor: (...args: unknown[]) => verifyTwoFactor(...args),
    },
  };
});

const session: AuthSession = {
  accessToken: 'access',
  expiresIn: 900,
  user: {
    id: 'u-1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    avatarUrl: null,
    timezone: 'UTC',
    emailVerified: true,
    emailVerificationDueAt: null,
    hasPassword: true,
    twoFactorEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    pronouns: null,
    jobTitle: null,
    department: null,
    aboutMe: null,
    outOfOffice: null,
  },
};

async function signInWithPassword() {
  const user = setupUser();
  await renderWithRouter(LoginPage, { initialPath: '/login' });
  await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
  await user.type(screen.getByLabelText(/^password/i), 'CoreTask!2024');
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
  return user;
}

beforeEach(() => {
  login
    .mockReset()
    .mockResolvedValue({ twoFactorRequired: true, challenge: 'sealed', expiresIn: 300 });
  verifyTwoFactor.mockReset();
  useAuthStore.getState().markAnonymous();
});

describe('Signing in with two-step verification', () => {
  it('asks for a code after the password, and signs in with it', async () => {
    verifyTwoFactor.mockResolvedValue(session);
    const user = await signInWithPassword();

    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe('anonymous');

    await user.type(screen.getByLabelText(/^code/i), '123 456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(verifyTwoFactor).toHaveBeenCalledWith({ challenge: 'sealed', code: '123 456' }),
    );
    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
  });

  it('takes a recovery code instead', async () => {
    verifyTwoFactor.mockResolvedValue(session);
    const user = await signInWithPassword();

    await user.click(await screen.findByRole('button', { name: 'Use a recovery code' }));
    await user.type(screen.getByLabelText(/recovery code/i), 'abcd-efgh-jkmn-pqrs');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(verifyTwoFactor).toHaveBeenCalledWith({
        challenge: 'sealed',
        code: 'abcd-efgh-jkmn-pqrs',
      }),
    );
  });

  it('keeps the step open on a wrong code, and starts over once the challenge runs out', async () => {
    verifyTwoFactor
      .mockRejectedValueOnce(
        new ApiError({
          status: 400,
          code: 'TWO_FACTOR_CODE_INVALID',
          message: 'That code is not right. Check your authenticator app and try again.',
        }),
      )
      .mockRejectedValueOnce(
        new ApiError({
          status: 401,
          code: 'TWO_FACTOR_CHALLENGE_INVALID',
          message: 'This sign-in took too long. Start again.',
        }),
      );
    const user = await signInWithPassword();

    await user.type(await screen.findByLabelText(/^code/i), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/that code is not right/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/took too long/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start again' }));

    expect(screen.getByRole('heading', { name: /sign in to coretask/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toHaveValue('');
  });
});
