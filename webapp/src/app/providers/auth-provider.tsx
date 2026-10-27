import { useEffect, useRef } from 'react';

import { authApi } from '@/features/auth/api/auth.api';
import { ApiError } from '@/lib/api/api-error';
import { setUnauthenticatedHandler } from '@/lib/api/client';
import { queryClient } from '@/lib/api/query-client';
import { isRefreshRefusal, markSignedOut, shouldAttemptRestore } from '@/lib/api/session-hint';
import { useAuthStore } from '@/stores/auth.store';

/** How long a restore that failed for a reason other than a refusal waits to retry. */
export const RESTORE_RETRY_DELAY_MS = 1_500;

const isRefusal = (error: unknown): boolean =>
  error instanceof ApiError && isRefreshRefusal(error.status);

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
    // Anything less certain than "known signed out" still tries — and so does
    // the page single sign-on returns to, where the API has just set a cookie
    // the hint knows nothing about. Unless the account wants its second step:
    // then the fragment carries a challenge, and there is no cookie yet.
    const returningFromSso =
      window.location.pathname === '/sso/complete' && !/[#&]challenge=/.test(window.location.hash);
    if (!returningFromSso && !shouldAttemptRestore()) {
      markAnonymous();
      return;
    }

    void authApi
      .refresh()
      .catch(async (error: unknown) => {
        // A blip — the API still coming up after a restart, say — gets one
        // more try before this load gives up. A refusal will not change.
        if (isRefusal(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, RESTORE_RETRY_DELAY_MS));
        return authApi.refresh();
      })
      .then(setSession)
      .catch((error: unknown) => {
        // Only a refusal proves the cookie is unusable, so only a refusal is
        // recorded. Anything else leaves the hint as it was, and the next load
        // tries again instead of skipping the restore for good.
        if (isRefusal(error)) markSignedOut();
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
