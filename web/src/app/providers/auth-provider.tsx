import { useEffect, useRef } from 'react';

import { authApi } from '@/features/auth/api/auth.api';
import { setUnauthenticatedHandler } from '@/lib/api/client';
import { queryClient } from '@/lib/api/query-client';
import { markSignedOut, shouldAttemptRestore } from '@/lib/api/session-hint';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Restores the session on boot.
 *
 * The access token only ever lives in memory, so a reload starts with nothing.
 * One call to `/auth/refresh` exchanges the HTTP-only cookie for a new token;
 * failure simply means "not signed in", which is not an error worth surfacing.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setSession = useAuthStore((state) => state.setSession);
  const markAnonymous = useAuthStore((state) => state.markAnonymous);
  const clear = useAuthStore((state) => state.clear);
  const restored = useRef(false);

  useEffect(() => {
    // React StrictMode double-invokes effects in development; rotating the
    // refresh token twice would look like a replay and revoke the session, so
    // the restore runs exactly once per page load.
    //
    // Deliberately no cancellation flag: the cleanup between StrictMode's two
    // invocations would set it, the guard would skip the second run, and the
    // in-flight result would be discarded — leaving the app on its splash
    // screen forever. This provider wraps the whole app and only unmounts on
    // teardown, so a late state update is harmless.
    if (restored.current) return;
    restored.current = true;

    // This browser is known to be signed out, so there is no cookie to
    // exchange. Skipping avoids a guaranteed 401 on every anonymous page load.
    // Anything less certain than "known signed out" still tries.
    if (!shouldAttemptRestore()) {
      markAnonymous();
      return;
    }

    void authApi
      .refresh()
      .then(setSession)
      .catch(() => {
        // The cookie really is unusable, so record it and stop asking.
        markSignedOut();
        markAnonymous();
      });
  }, [setSession, markAnonymous]);

  // Any request that comes back irrecoverably unauthenticated drops the session.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      clear();
      queryClient.clear();
    });

    return () => setUnauthenticatedHandler(null);
  }, [clear]);

  return <>{children}</>;
}
