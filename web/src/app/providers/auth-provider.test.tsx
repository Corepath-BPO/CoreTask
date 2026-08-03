import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetSessionHint, markSessionStarted, markSignedOut } from '@/lib/api/session-hint';
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
    // Most cases model a returning visitor; the no-hint path is tested below.
    markSessionStarted();
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

  /**
   * The refresh cookie is HTTP-only, so without a hint every anonymous page load
   * fired a request that could only ever 401 — a wasted round trip and a red
   * console error on every visit to the login page.
   */
  it('skips /auth/refresh once the browser is known to be signed out', async () => {
    markSignedOut();

    render(
      <AuthProvider>
        <div>app</div>
      </AuthProvider>,
    );

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * Regression guard for the rollout case. A browser that was already signed in
   * when the hint was introduced holds a valid cookie but no marker. Treating
   * "unknown" as "signed out" logged every one of those sessions out on their
   * next reload.
   */
  it('still restores a session when no hint has ever been recorded', async () => {
    forgetSessionHint();
    refresh.mockResolvedValue(SESSION);

    render(
      <AuthProvider>
        <div>app</div>
      </AuthProvider>,
    );

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('records the signed-out state after a restore that really failed', async () => {
    refresh.mockRejectedValue(new Error('401'));

    render(
      <AuthProvider>
        <div>app</div>
      </AuthProvider>,
    );

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(localStorage.getItem('coretask.session-hint')).toBe('0');
  });

  it('records the hint once a session is adopted', () => {
    forgetSessionHint();
    useAuthStore.getState().setSession(SESSION);

    expect(localStorage.getItem('coretask.session-hint')).toBe('1');
  });

  /**
   * A stray 401 from anywhere in the app is not proof the refresh cookie is
   * gone, so it must leave the hint unknown rather than signed out — otherwise
   * one blip strands a live session on the login page for good.
   */
  it('leaves the hint unknown when the session is cleared by a stray 401', () => {
    markSessionStarted();
    useAuthStore.getState().clear();

    expect(localStorage.getItem('coretask.session-hint')).toBeNull();
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
