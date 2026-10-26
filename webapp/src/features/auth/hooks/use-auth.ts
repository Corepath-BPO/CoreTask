import type { LoginPayload, RegisterPayload } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { queryClient } from '@/lib/api/query-client';
import { markSignedOut } from '@/lib/api/session-hint';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

import { authApi, isTwoFactorChallenge } from '../api/auth.api';

/** Login / register / logout, each wired to the auth store and the router. */
export function useAuth() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const clear = useAuthStore((state) => state.clear);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);

  /**
   * Resolves to the session, or to a challenge when the account has two-step
   * verification on — the page then asks for the code (`TwoFactorStep`).
   */
  const login = useMutation({
    mutationFn: (payload: LoginPayload) => authApi.login(payload),
    onSuccess: (result) => {
      if (isTwoFactorChallenge(result)) return;
      setSession(result);
      toast.success(`Welcome back, ${result.user.name.split(' ')[0]}`);
    },
  });

  const register = useMutation({
    mutationFn: (payload: RegisterPayload) => authApi.register(payload),
    onSuccess: (session) => {
      setSession(session);
      toast.success('Your CoreTask account is ready');
    },
  });

  const forgetSession = async () => {
    clear();
    // Deliberate sign-out, so the next load can skip the restore entirely.
    markSignedOut();
    setActiveWorkspaceId(null);
    queryClient.clear();
    await navigate({ to: '/login', replace: true });
  };

  const logout = useMutation({
    mutationFn: () => authApi.logout(),
    // Runs on success *and* failure: if the server already dropped the session,
    // the client must still end up signed out rather than stuck.
    onSettled: forgetSession,
  });

  /**
   * "Sign out everywhere". Unlike a plain sign-out, a failure here is shown
   * rather than papered over: the person asked for the other devices to lose
   * access, and leaving this one would hide that they still have it.
   */
  const logoutEverywhere = useMutation({
    mutationFn: () => authApi.logoutAll(),
    onSuccess: async () => {
      toast.success('Signed out on every device');
      await forgetSession();
    },
    onError: () => toast.error('Could not sign out everywhere. Try again.'),
  });

  const signOut = useCallback(() => logout.mutate(), [logout]);

  return { login, register, logout, logoutEverywhere, signOut };
}
