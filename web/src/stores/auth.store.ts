import type { AuthSession, AuthUser } from '@coretask/types';
import { create } from 'zustand';

import { setAccessToken } from '@/lib/api/client';
import { forgetSessionHint, markSessionStarted } from '@/lib/api/session-hint';

export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Mirrors the in-memory token held by the API client; never persisted. */
  setSession: (session: AuthSession) => void;
  setUser: (user: AuthUser) => void;
  clear: () => void;
  markAnonymous: () => void;
}

/**
 * Session state.
 *
 * Nothing here is written to storage. The access token lives in the API client
 * module and the refresh token in an HTTP-only cookie, so a reload restores the
 * session through `/auth/refresh` rather than by trusting anything on disk.
 */
export const useAuthStore = create<AuthState>()((set) => ({
  status: 'restoring',
  user: null,

  setSession: (session) => {
    setAccessToken(session.accessToken);
    // Not the session itself — just a note that a refresh cookie is worth trying
    // on the next boot. See `lib/api/session-hint`.
    markSessionStarted();
    set({ status: 'authenticated', user: session.user });
  },

  setUser: (user) => set({ user }),

  clear: () => {
    setAccessToken(null);
    // Back to "unknown" rather than "signed out": this also fires on a stray
    // 401 from anywhere in the app, which does not prove the refresh cookie is
    // gone. The next load retries instead of stranding a live session.
    forgetSessionHint();
    set({ status: 'anonymous', user: null });
  },

  markAnonymous: () => set({ status: 'anonymous', user: null }),
}));

/** Selectors — keep component subscriptions narrow. */
export const useCurrentUser = () => useAuthStore((state) => state.user);
export const useAuthStatus = () => useAuthStore((state) => state.status);
export const useIsAuthenticated = () => useAuthStore((state) => state.status === 'authenticated');
