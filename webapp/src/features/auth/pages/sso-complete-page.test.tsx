import type { AuthSession } from '@coretask/types';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth.store';
import { createTestQueryClient, render, screen, setupUser } from '@/test/test-utils';

import { SsoCompletePage } from './sso-complete-page';

const refresh = vi.fn();
const verifyTwoFactor = vi.fn();

vi.mock('../api/auth.api', () => ({
  authApi: {
    refresh: () => refresh(),
    verifyTwoFactor: (payload: unknown) => verifyTwoFactor(payload),
  },
}));

const SESSION: AuthSession = {
  user: {
    id: 'u-1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    avatarUrl: null,
    timezone: 'UTC',
    emailVerified: true,
    emailVerificationDueAt: null,
    hasPassword: false,
    twoFactorEnabled: true,
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

/** The page where the app mounts it, with the two places it can send the browser on to. */
async function renderAt(path: string) {
  const rootRoute = createRootRoute();
  const completeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sso/complete',
    component: SsoCompletePage,
    validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
      typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {},
  });
  const inboxRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inbox',
    component: () => <p>inbox page</p>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    validateSearch: (search: Record<string, unknown>) => search,
    component: function Login() {
      const search = loginRoute.useSearch();
      return <p>login page {JSON.stringify(search)}</p>;
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([completeRoute, inboxRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();

  render(
    <QueryClientProvider client={createTestQueryClient()}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- an ad-hoc tree, not the app's registered router. */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
}

describe('SsoCompletePage', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'anonymous', user: null });
  });

  it('moves on to where the person was going once the session is in', async () => {
    useAuthStore.setState({ status: 'authenticated', user: SESSION.user });
    await renderAt('/sso/complete?redirect=%2Finbox');

    expect(await screen.findByText('inbox page')).toBeInTheDocument();
    // AuthProvider has already exchanged the cookie; a second refresh would be a replay.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('goes back to sign-in when the session did not stick', async () => {
    await renderAt('/sso/complete?redirect=%2Finbox');

    expect(await screen.findByText(/login page/)).toHaveTextContent('"ssoError":"SSO_FAILED"');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('asks for the code when the fragment carries a challenge, then moves on', async () => {
    verifyTwoFactor.mockResolvedValue(SESSION);
    const user = setupUser();
    await renderAt('/sso/complete?redirect=%2Finbox#challenge=sealed.challenge');

    expect(screen.getByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^code/i), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('inbox page')).toBeInTheDocument();
    expect(verifyTwoFactor).toHaveBeenCalledWith({ challenge: 'sealed.challenge', code: '123456' });
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('starts again from sign-in, keeping the redirect, when the person cancels', async () => {
    const user = setupUser();
    await renderAt('/sso/complete?redirect=%2Finbox#challenge=sealed.challenge');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/login page/)).toHaveTextContent('"redirect":"/inbox"');
  });
});
