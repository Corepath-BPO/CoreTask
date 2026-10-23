import type { RequestEmailChangePayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { authApi } from '@/features/auth/api/auth.api';
import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { useAuthStore } from '@/stores/auth.store';

/** The browsers and devices signed in to this account. */
export function useSessions() {
  return useQuery({ queryKey: queryKeys.auth.sessions, queryFn: () => authApi.sessions() });
}

export function useRevokeSession() {
  return useMutation({
    mutationFn: (sessionId: string) => authApi.revokeSession(sessionId),
    onSuccess: () => {
      toast.success('That session is signed out.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not sign it out. Try again.'),
  });
}

export function useRevokeOtherSessions() {
  return useMutation({
    mutationFn: () => authApi.revokeOtherSessions(),
    onSuccess: ({ revoked }) => {
      toast.success(
        revoked === 0
          ? 'No other sessions were open.'
          : `Signed out ${revoked === 1 ? 'one other session' : `${revoked} other sessions`}.`,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions });
    },
    onError: () => toast.error('Could not sign out the other sessions. Try again.'),
  });
}

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: queryKeys.auth.twoFactor,
    queryFn: () => authApi.twoFactorStatus(),
  });
}

/** After turning it on or off: the badge, the status and the profile all change. */
export function setTwoFactorEnabled(enabled: boolean): void {
  const { user, setUser } = useAuthStore.getState();
  if (user) setUser({ ...user, twoFactorEnabled: enabled });
  void queryClient.invalidateQueries({ queryKey: queryKeys.auth.twoFactor });
}

export function usePendingEmailChange() {
  return useQuery({
    queryKey: queryKeys.auth.emailChange,
    queryFn: () => authApi.pendingEmailChange(),
  });
}

export function useRequestEmailChange() {
  return useMutation({
    mutationFn: (payload: RequestEmailChangePayload) => authApi.requestEmailChange(payload),
    onSuccess: (pending) => {
      queryClient.setQueryData(queryKeys.auth.emailChange, pending);
      toast.success(`We sent a link to ${pending.email}. Open it to finish the change.`);
    },
  });
}

export function useCancelEmailChange() {
  return useMutation({
    mutationFn: () => authApi.cancelEmailChange(),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.auth.emailChange, null);
      toast.success('The change is cancelled. Your address stays as it is.');
    },
    onError: () => toast.error('Could not cancel the change. Try again.'),
  });
}
