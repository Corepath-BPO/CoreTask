import type {
  DeleteAccountPayload,
  DeleteWorkspacePayload,
  WorkspaceSummary,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { queryClient, queryKeys } from '@/lib/api/query-client';
import { markSignedOut } from '@/lib/api/session-hint';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

import { accountApi } from '../api/account.api';

const deletionPreviewKey = ['auth', 'account-deletion'] as const;

/** What deleting the account would take with it. Asked fresh each time the dialog opens. */
export function useAccountDeletionPreview(enabled: boolean) {
  return useQuery({
    queryKey: deletionPreviewKey,
    queryFn: () => accountApi.deletionPreview(),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/*
 * Both deletions finish here rather than in the dialog: what they change —
 * the signed-in user, the active workspace — unmounts the dialog that asked,
 * and callbacks passed to `mutate` do not run once it is gone.
 */

/**
 * Deletes the account. Afterwards this browser forgets it the way a
 * deliberate sign-out does — the server has already cleared the cookie, so
 * the next load need not try to restore anything.
 */
export function useDeleteAccount() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (payload: DeleteAccountPayload) => accountApi.deleteAccount(payload),
    onSuccess: async () => {
      useAuthStore.getState().clear();
      markSignedOut();
      useWorkspaceStore.getState().setActiveWorkspaceId(null);
      queryClient.clear();
      toast.success('Your account is deleted.');
      await navigate({ to: '/login', replace: true });
    },
  });
}

/**
 * Deletes a workspace. Nothing in it can be read afterwards, so its cached
 * queries go, the selection is cleared, and the switcher picks whatever is
 * left once the list is fetched again.
 */
export function useDeleteWorkspace(workspace: Pick<WorkspaceSummary, 'id' | 'name'>) {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (payload: DeleteWorkspacePayload) =>
      accountApi.deleteWorkspace(workspace.id, payload),
    onSuccess: async () => {
      queryClient.setQueryData<WorkspaceSummary[]>(queryKeys.workspaces.list(), (previous) =>
        previous?.filter((candidate) => candidate.id !== workspace.id),
      );
      useWorkspaceStore.getState().setActiveWorkspaceId(null);
      toast.success(`${workspace.name} is deleted.`);
      await navigate({ to: '/' });
      // Every key scoped to it names its id; the list does not, and stays.
      queryClient.removeQueries({ predicate: (query) => query.queryKey.includes(workspace.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    },
  });
}
