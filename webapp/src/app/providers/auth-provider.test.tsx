import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/api-error';
import { forgetSessionHint, markSessionStarted, markSignedOut } from '@/lib/api/session-hint';
import { useAuthStore } from '@/stores/auth.store';

import { AuthProvider, RESTORE_RETRY_DELAY_MS } from './auth-provider';

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
    emailVerificationDueAt: null,
    hasPassword: true,
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

/** What /auth/refresh answers when there is no usable cookie. */
const REFUSED = new ApiError({
  code: 'REFRESH_TOKEN_INVALID',
  message: 'The refresh token is invalid.',
  status: 401,
});

const boot = () =>
  render(
    <AuthProvider>
      <div>app</div>
    </AuthProvider>,
  );

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
    refresh.mockRejectedValue(REFUSED);

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
    refresh.mockRejectedValue(REFUSED);

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

  it.each([
    ['a 401', REFUSED],
    [
      'a 403',
      new ApiError({
        code: 'ACCOUNT_DISABLED',
        message: 'This account has been disabled.',
        status: 403,
      }),
    ],
  ])('records the signed-out state after %s, without retrying', async (_, refusal) => {
    refresh.mockRejectedValue(refusal);

    boot();

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(localStorage.getItem('coretask.session-hint')).toBe('0');
    expect(refresh).toHaveBeenCalledTimes(1);
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
    refresh.mockRejectedValue(REFUSED);

    render(
      <AuthProvider>
        <div>app content</div>
      </AuthProvider>,
    );

    expect(screen.getByText('app content')).toBeInTheDocument();
  });
});

/**
 * Regression guard. Every failed restore used to record "signed out", so a
 * network error — the API still starting after `docker start` — made every
 * later load skip the refresh and show /login with a perfectly good cookie.
 */
describe('AuthProvider when the API cannot answer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ status: 'restoring', user: null });
    markSessionStarted();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['a network error', ApiError.network()],
    [
      'a 503',
      new ApiError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'A required service is temporarily unavailable.',
        status: 503,
      }),
    ],
  ])('leaves the hint alone after %s, so the next load tries again', async (_, failure) => {
    refresh.mockRejectedValue(failure);

    boot();
    await vi.advanceTimersByTimeAsync(RESTORE_RETRY_DELAY_MS);

    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(localStorage.getItem('coretask.session-hint')).toBe('1');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('stays on the splash screen and retries once, adopting the session', async () => {
    refresh.mockRejectedValueOnce(ApiError.network()).mockResolvedValueOnce(SESSION);

    boot();
    await vi.advanceTimersByTimeAsync(RESTORE_RETRY_DELAY_MS - 1);
    expect(useAuthStore.getState().status).toBe('restoring');
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('records the signed-out state when the retry is refused', async () => {
    refresh.mockRejectedValueOnce(ApiError.network()).mockRejectedValueOnce(REFUSED);

    boot();
    await vi.advanceTimersByTimeAsync(RESTORE_RETRY_DELAY_MS);

    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(localStorage.getItem('coretask.session-hint')).toBe('0');
  });
});
