import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth.store';

import { AuthProvider } from './auth-provider';

const refresh = vi.fn();

vi.mock('@/features/auth/api/auth.api', () => ({
  authApi: {
    refresh: () => refresh(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
  },
}));

const SESSION = {
  user: {
    id: '019fc880-0000-7000-8000-000000000000',
    email: 'demo@coretask.dev',
    name: 'Demo Owner',
    avatarUrl: null,
    timezone: 'UTC',
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  accessToken: 'access-token',
  expiresIn: 900,
};

describe('AuthProvider session restore', () => {
  beforeEach(() => {
    refresh.mockReset();
    useAuthStore.setState({ status: 'restoring', user: null });
  });

  it('adopts the session returned by /auth/refresh', async () => {
    refresh.mockResolvedValue(SESSION);

    render(
      <AuthProvider>
        <div>app</div>
      </AuthProvider>,
    );

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(useAuthStore.getState().user?.email).toBe('demo@coretask.dev');
  });

  it('falls back to anonymous when there is no valid refresh cookie', async () => {
    refresh.mockRejectedValue(new Error('401'));

    render(
      <AuthProvider>
        <div>app</div>
      </AuthProvider>,
    );

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
  });

  /**
   * Regression guard. StrictMode runs effect → cleanup → effect. An earlier
   * version cancelled the in-flight restore in that cleanup, so the result was
   * discarded and the app sat on its loading splash forever.
   */
  it('still settles under StrictMode double-invocation', async () => {
    refresh.mockRejectedValue(new Error('401'));

    render(
      <StrictMode>
        <AuthProvider>
          <div>app</div>
        </AuthProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
  });

  it('calls /auth/refresh exactly once, so rotation is not mistaken for a replay', async () => {
    refresh.mockResolvedValue(SESSION);

    render(
      <StrictMode>
        <AuthProvider>
          <div>app</div>
        </AuthProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('renders its children regardless of the outcome', async () => {
    refresh.mockRejectedValue(new Error('401'));

    render(
      <AuthProvider>
        <div>app content</div>
      </AuthProvider>,
    );

    expect(screen.getByText('app content')).toBeInTheDocument();
  });
});
