import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { followersApi, type FollowerParent } from '../api/followers.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/** Joining or leaving writes a story too, so the item's feed moves with it. */
async function invalidate(workspaceId: string, parent: FollowerParent) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.followers.forParent(workspaceId, parent.kind, parent.id),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.activity.item(workspaceId, parent.kind, parent.id),
    }),
  ]);
}

export function useFollowers(workspaceId: string | undefined, parent: FollowerParent | null) {
  return useQuery({
    queryKey: queryKeys.followers.forParent(
      workspaceId ?? '',
      parent?.kind ?? '',
      parent?.id ?? '',
    ),
    queryFn: () => followersApi.list(workspaceId as string, parent as FollowerParent),
    enabled: Boolean(workspaceId) && Boolean(parent),
  });
}

export function useAddFollowers(workspaceId: string | undefined, parent: FollowerParent | null) {
  return useMutation({
    mutationFn: (userIds: string[]) =>
      followersApi.add(workspaceId as string, parent as FollowerParent, { userIds }),
    onSuccess: async () => {
      await invalidate(workspaceId as string, parent as FollowerParent);
    },
    onError: (error) => reportError(error, 'Could not add the collaborator.'),
  });
}

export function useRemoveFollower(workspaceId: string | undefined, parent: FollowerParent | null) {
  return useMutation({
    mutationFn: (userId: string) =>
      followersApi.remove(workspaceId as string, parent as FollowerParent, userId),
    onSuccess: async () => {
      await invalidate(workspaceId as string, parent as FollowerParent);
    },
    onError: (error) => reportError(error, 'Could not remove the collaborator.'),
  });
}
