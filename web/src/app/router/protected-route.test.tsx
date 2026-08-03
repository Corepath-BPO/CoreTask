import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth.store';

/**
 * Route protection.
 *
 * The guard is rebuilt here with the same `beforeLoad` logic as
 * `app/router/router.tsx`, so the behaviour can be asserted without mounting the
 * whole application shell (which needs sockets and a live API).
 */
function buildTestRouter(initialPath: string) {
  const rootRoute = createRootRoute();

  const protectedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: 'protected',
    beforeLoad: ({ location }) => {
      if (useAuthStore.getState().status !== 'authenticated') {
        throw redirect({ to: '/login', search: { redirect: location.href } });
      }
    },
  });

  const dashboardRoute = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/',
    component: () => <div>dashboard content</div>,
  });

  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <div>login screen</div>,
    validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
      typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {},
  });

  return createRouter({
    routeTree: rootRoute.addChildren([protectedRoute.addChildren([dashboardRoute]), loginRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

describe('protected routes', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'anonymous', user: null });
  });

  it('redirects an anonymous visitor to /login', async () => {
    const router = buildTestRouter('/');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ad-hoc test tree
    render(<RouterProvider router={router as any} />);

    await waitFor(() => expect(screen.getByText('login screen')).toBeInTheDocument());
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument();
  });

  it('preserves the attempted path so login can return the user to it', async () => {
    const router = buildTestRouter('/');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ad-hoc test tree
    render(<RouterProvider router={router as any} />);

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toMatchObject({ redirect: '/' });
  });

  it('renders the protected content once a session exists', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: '019fc880-0000-7000-8000-000000000000',
        email: 'demo@coretask.dev',
        name: 'Demo Owner',
        avatarUrl: null,
        timezone: 'UTC',
        emailVerified: true,
        createdAt: new Date().toISOString(),
      },
    });

    const router = buildTestRouter('/');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ad-hoc test tree
    render(<RouterProvider router={router as any} />);

    await waitFor(() => expect(screen.getByText('dashboard content')).toBeInTheDocument());
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });

  it('kicks the user out as soon as the session is cleared', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: '019fc880-0000-7000-8000-000000000000',
        email: 'demo@coretask.dev',
        name: 'Demo Owner',
        avatarUrl: null,
        timezone: 'UTC',
        emailVerified: true,
        createdAt: new Date().toISOString(),
      },
    });

    const router = buildTestRouter('/');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ad-hoc test tree
    render(<RouterProvider router={router as any} />);
    await waitFor(() => expect(screen.getByText('dashboard content')).toBeInTheDocument());

    useAuthStore.setState({ status: 'anonymous', user: null });
    await router.invalidate();

    await waitFor(() => expect(screen.getByText('login screen')).toBeInTheDocument());
  });
});
