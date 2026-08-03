import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';

/** Query client with retries off, so a failing request fails the test immediately. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return render(ui, { wrapper: Providers, ...options });
}

/**
 * Renders a component inside a real router at `initialPath`.
 *
 * Components that call `useNavigate` or render `<Link>` need router context;
 * mocking it would stop the test from proving the navigation actually works.
 */
export async function renderWithRouter(
  component: () => ReactElement,
  { initialPath = '/' }: { initialPath?: string } = {},
): Promise<RenderResult> {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component });

  // Mirrors the real tree's `guest` layout route. The nesting is not cosmetic:
  // pages address their search params by route *id* (`/guest/login`), so a flat
  // test tree would fail to resolve them.
  const guestRoute = createRoute({ getParentRoute: () => rootRoute, id: 'guest' });
  const loginRoute = createRoute({
    getParentRoute: () => guestRoute,
    path: '/login',
    component,
    validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
      typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {},
  });
  const registerRoute = createRoute({
    getParentRoute: () => guestRoute,
    path: '/register',
    component: () => <div>register</div>,
  });

  // Stubs for routes that rendered components link to. `Link` resolves its href
  // against the tree it is mounted in, so a missing route yields a link with no
  // href and the assertion fails for the wrong reason.
  const projectsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects',
    component: () => <div>projects</div>,
  });
  const projectDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/$projectId',
    component: () => <div>project detail</div>,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      guestRoute.addChildren([loginRoute, registerRoute]),
      projectsRoute,
      projectDetailRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  // Resolve the initial match *before* rendering. RouterProvider renders once
  // eagerly, and a component reading its search params by route id would not
  // find a match yet.
  await router.load();

  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TooltipProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the
            ad-hoc test tree is not the app's registered router type. */}
        <RouterProvider router={router as any} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
