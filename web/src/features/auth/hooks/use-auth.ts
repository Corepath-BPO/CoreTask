import type { LoginPayload, RegisterPayload } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { queryClient } from '@/lib/api/query-client';
import { markSignedOut } from '@/lib/api/session-hint';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

import { authApi } from '../api/auth.api';

/** Login / register / logout, each wired to the auth store and the router. */
export function useAuth() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const clear = useAuthStore((state) => state.clear);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);

  const login = useMutation({
    mutationFn: (payload: LoginPayload) => authApi.login(payload),
    onSuccess: (session) => {
      setSession(session);
      toast.success(`Welcome back, ${session.user.name.split(' ')[0]}`);
    },
  });

  const register = useMutation({
    mutationFn: (payload: RegisterPayload) => authApi.register(payload),
    onSuccess: (session) => {
      setSession(session);
      toast.success('Your CoreTask account is ready');
    },
  });

  const logout = useMutation({
    mutationFn: () => authApi.logout(),
    // Runs on success *and* failure: if the server already dropped the session,
    // the client must still end up signed out rather than stuck.
    onSettled: async () => {
      clear();
      // Deliberate sign-out, so the next load can skip the restore entirely.
      markSignedOut();
      setActiveWorkspaceId(null);
      queryClient.clear();
      await navigate({ to: '/login', replace: true });
    },
  });

  const signOut = useCallback(() => logout.mutate(), [logout]);

  return { login, register, logout, signOut };
}
