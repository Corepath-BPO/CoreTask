import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markSignedOut } from '@/lib/api/session-hint';
import { useAuthStore } from '@/stores/auth.store';

import { AuthProvider } from './auth-provider';

const refresh = vi.fn();

vi.mock('@/features/auth/api/auth.api', () => ({
  authApi: { refresh: () => refresh() },
}));

const SESSION = {
  user: {
    id: 'u-1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    avatarUrl: null,
    timezone: 'UTC',
    emailVerified: true,
    emailVerificationDueAt: null,
    hasPassword: false,
    twoFactorEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    pronouns: null,
    jobTitle: null,
    department: null,
    aboutMe: null,
    outOfOffice: null,
  },
  accessToken: 'access-token',
  expiresIn: 900,
};

const boot = () =>
  render(
    <AuthProvider>
      <div>app</div>
    </AuthProvider>,
  );

/**
 * Coming back from single sign-on, the API has just set a session cookie
 * that the "signed out" hint in this browser knows nothing about.
 */
describe('AuthProvider after single sign-on', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'restoring', user: null });
    // The browser was signed out before it left for the provider.
    markSignedOut();
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('restores the session on the return page whatever the hint says', async () => {
    window.history.replaceState(null, '', '/sso/complete?redirect=%2Finbox');
    refresh.mockResolvedValue(SESSION);

    boot();

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves it alone while a two-step challenge waits: there is no cookie yet', async () => {
    window.history.replaceState(null, '', '/sso/complete?redirect=%2Finbox#challenge=abc');

    boot();

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('still skips the call anywhere else', async () => {
    window.history.replaceState(null, '', '/login');

    boot();

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(refresh).not.toHaveBeenCalled();
  });
});
