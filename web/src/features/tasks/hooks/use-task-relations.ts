import type { AddDependencyPayload, TaskDependencies, TaskLikes } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { useCurrentUser } from '@/stores/auth.store';

import { taskRelationsApi } from '../api/task-relations.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

export function useTaskLikes(workspaceId: string | undefined, taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.tasks.likes(workspaceId ?? '', taskId ?? ''),
    queryFn: () => taskRelationsApi.likes(workspaceId as string, taskId as string),
    enabled: Boolean(workspaceId) && Boolean(taskId),
  });
}

/**
 * Likes or unlikes, shown at once.
 *
 * A thumbs-up that waits for a round trip feels broken, so the count moves
 * on click and the server's answer settles it; a failure puts it back.
 */
export function useToggleTaskLike(workspaceId: string | undefined, taskId: string) {
  const me = useCurrentUser();
  const key = queryKeys.tasks.likes(workspaceId ?? '', taskId);

  return useMutation({
    mutationFn: (liked: boolean) =>
      liked
        ? taskRelationsApi.unlike(workspaceId as string, taskId)
        : taskRelationsApi.like(workspaceId as string, taskId),
    onMutate: async (liked) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskLikes>(key);
      if (previous && me) {
        queryClient.setQueryData<TaskLikes>(key, {
          count: previous.count + (liked ? -1 : 1),
          likedByMe: !liked,
          users: liked
            ? previous.users.filter((user) => user.id !== me.id)
            : [
                ...previous.users,
                { id: me.id, name: me.name, email: me.email, avatarUrl: me.avatarUrl ?? null },
              ],
        });
      }
      return { previous };
    },
    onError: (error, _liked, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      reportError(error, 'Could not save the like.');
    },
    onSuccess: (likes) => queryClient.setQueryData(key, likes),
  });
}

export function useTaskDependencies(workspaceId: string | undefined, taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.tasks.dependencies(workspaceId ?? '', taskId ?? ''),
    queryFn: () => taskRelationsApi.dependencies(workspaceId as string, taskId as string),
    enabled: Boolean(workspaceId) && Boolean(taskId),
  });
}

/**
 * The edge has two ends, and the far end's pane lists it too — so besides
 * writing this task's answer into the cache, every dependency query is
 * refreshed. Only open panes refetch.
 */
async function settleDependencies(
  workspaceId: string,
  taskId: string,
  dependencies: TaskDependencies,
) {
  queryClient.setQueryData(queryKeys.tasks.dependencies(workspaceId, taskId), dependencies);
  await queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'tasks' &&
      query.queryKey[1] === workspaceId &&
      query.queryKey[2] === 'dependencies' &&
      query.queryKey[3] !== taskId,
  });
  // The far end's story landed in its history.
  await queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) });
}

export function useAddDependency(workspaceId: string | undefined, taskId: string) {
  return useMutation({
    mutationFn: (payload: AddDependencyPayload) =>
      taskRelationsApi.addDependency(workspaceId as string, taskId, payload),
    onSuccess: (dependencies) => settleDependencies(workspaceId as string, taskId, dependencies),
    onError: (error) => reportError(error, 'Could not add the dependency.'),
  });
}

export function useRemoveDependency(workspaceId: string | undefined, taskId: string) {
  return useMutation({
    mutationFn: (dependencyId: string) =>
      taskRelationsApi.removeDependency(workspaceId as string, taskId, dependencyId),
    onSuccess: (dependencies) => settleDependencies(workspaceId as string, taskId, dependencies),
    onError: (error) => reportError(error, 'Could not remove the dependency.'),
  });
}
