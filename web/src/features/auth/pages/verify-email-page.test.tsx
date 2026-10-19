import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { renderWithRouter, screen } from '@/test/test-utils';

import { VerifyEmailPage } from './verify-email-page';

const verifyEmail = vi.fn();
const setUser = vi.fn();
let state: {
  status: 'authenticated' | 'anonymous';
  user: { email: string; emailVerified: boolean } | null;
  setUser: typeof setUser;
};

vi.mock('../api/auth.api', () => ({
  authApi: { verifyEmail: (...args: unknown[]) => verifyEmail(...args) },
}));

vi.mock('@/stores/auth.store', () => {
  const useAuthStore = (select: (value: typeof state) => unknown) => select(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

const original = window.location.href;

beforeEach(() => {
  verifyEmail.mockReset();
  setUser.mockReset();
  state = {
    status: 'authenticated',
    user: { email: 'ada@example.com', emailVerified: false },
    setUser,
  };
});

afterEach(() => {
  window.history.replaceState(null, '', original);
});

describe('confirming an e-mail address', () => {
  it('confirms once on arrival, takes the token out of the bar, and updates this session', async () => {
    window.history.replaceState(null, '', '/verify-email?token=tok-1');
    verifyEmail.mockResolvedValue({ email: 'ada@example.com' });

    await renderWithRouter(VerifyEmailPage, { initialPath: '/verify-email' });

    expect(
      await screen.findByRole('heading', { name: 'E-mail address confirmed' }),
    ).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(verifyEmail).toHaveBeenCalledWith('tok-1');
    expect(setUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com', emailVerified: true }),
    );
    expect(screen.getByRole('link', { name: 'Go to CoreTask' })).toHaveAttribute('href', '/');
  });

  it('offers sign-in to someone who is not signed in on this device', async () => {
    state = { status: 'anonymous', user: null, setUser };
    window.history.replaceState(null, '', '/verify-email?token=tok-2');
    verifyEmail.mockResolvedValue({ email: 'ada@example.com' });

    await renderWithRouter(VerifyEmailPage, { initialPath: '/verify-email' });

    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(setUser).not.toHaveBeenCalled();
  });

  it('says why a used link failed and where to get a new one', async () => {
    window.history.replaceState(null, '', '/verify-email?token=used');
    verifyEmail.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'EMAIL_VERIFICATION_INVALID',
        message:
          'This confirmation link is invalid, used or expired. Send a new one from Settings.',
      }),
    );

    await renderWithRouter(VerifyEmailPage, { initialPath: '/verify-email' });

    expect(
      await screen.findByRole('heading', { name: 'We could not confirm it' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send a new link from Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('says so when the link has no token, without asking the server', async () => {
    window.history.replaceState(null, '', '/verify-email');
    await renderWithRouter(VerifyEmailPage, { initialPath: '/verify-email' });

    expect(screen.getByRole('heading', { name: 'This link is incomplete' })).toBeInTheDocument();
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});
