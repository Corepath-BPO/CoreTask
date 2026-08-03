import { Outlet } from '@tanstack/react-router';

import { FullPageLoader } from '@/components/feedback/loading';
import { useAuthStatus } from '@/stores/auth.store';

/**
 * Outermost route component.
 *
 * Holds rendering until the session-restore call settles: routing before that
 * would bounce an authenticated user to /login on every reload.
 */
export function RootLayout() {
  const status = useAuthStatus();

  if (status === 'restoring') {
    return <FullPageLoader />;
  }

  return (
    <>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Outlet />
    </>
  );
}
