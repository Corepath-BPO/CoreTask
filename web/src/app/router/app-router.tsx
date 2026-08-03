import { RouterProvider } from '@tanstack/react-router';

import { FullPageLoader } from '@/components/feedback/loading';
import { useAuthStatus } from '@/stores/auth.store';

import { router } from './router';

/**
 * Mounts the router only once the session is known.
 *
 * `protectedRoute.beforeLoad` reads the auth store synchronously, and the router
 * evaluates it as soon as it is mounted — before `/auth/refresh` can possibly
 * have answered. Gating the *render* of a layout is not enough: routing has
 * already happened by then, so a signed-in user was bounced to /login on every
 * reload and left there, because `beforeLoad` does not re-run when the store
 * later settles.
 *
 * Holding the mount for the one restore call is the whole fix.
 */
export function AppRouter() {
  const status = useAuthStatus();

  if (status === 'restoring') {
    return <FullPageLoader />;
  }

  return <RouterProvider router={router} />;
}
