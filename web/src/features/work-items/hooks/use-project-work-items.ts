import type {
  CreateWorkItemPayload,
  MoveWorkItemPayload,
  ProjectWorkItem,
  ProjectWorkItemPage,
  ProjectWorkItemQuery,
  UpdateWorkItemPayload,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { workItemsApi } from '../api/work-items.api';
import { nextCorrelationId } from '../lib/correlation';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * Everything that draws this project, refreshed together.
 *
 * Three families rather than one, because three of them exist and a change to
 * a work item can show up in all of them:
 *
 *   * `workItems` — the shared query these hooks own;
 *   * `tasks` — what the Board still reads, and the task detail dialog;
 *   * `projectViews` — what the List still reads.
 *
 * Invalidating only its own family is exactly the bug this work exists to fix:
 * creating on the Board left the List showing the previous answer, because the
 * two kept the same rows under unrelated keys. The extra invalidations go away
 * as each view moves onto `workItems`, and not before.
 */
async function invalidateProjectWork(workspaceId: string, projectId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.workItems.all(workspaceId, projectId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.projectViews.all(workspaceId, projectId),
    }),
    // Project cards and the board header show task rollups.
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) }),
  ]);
}

export function useProjectWorkItems(
  workspaceId: string | undefined,
  projectId: string,
  query: ProjectWorkItemQuery = {},
) {
  return useQuery<ProjectWorkItemPage>({
    queryKey: queryKeys.workItems.list(
      workspaceId ?? '',
      projectId,
      query as Record<string, unknown>,
    ),
    queryFn: () => workItemsApi.list(workspaceId as string, projectId, query),
    enabled: Boolean(workspaceId && projectId),
  });
}

export function useProjectWorkItem(
  workspaceId: string | undefined,
  projectId: string,
  workItemId: string | null,
) {
  return useQuery<ProjectWorkItem>({
    queryKey: queryKeys.workItems.detail(workspaceId ?? '', projectId, workItemId ?? ''),
    queryFn: () => workItemsApi.get(workspaceId as string, projectId, workItemId as string),
    enabled: Boolean(workspaceId && projectId && workItemId),
  });
}

/**
 * The one creation mutation.
 *
 * The List toolbar, the List section rows, the Board toolbar and the Board
 * columns all call this. A second hook that happened to do the same thing is
 * how the two views drifted until only one of them could create anything.
 */
export function useCreateProjectWorkItem(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    /*
     * Stamped here rather than by the caller. Every write needs one, and the
     * server echoes it on the broadcast so this client can recognise its own
     * change and skip refetching what it already has — see `useProjectRealtime`.
     */
    mutationFn: (payload: CreateWorkItemPayload) =>
      workItemsApi.create(workspaceId as string, projectId, {
        correlationId: nextCorrelationId(),
        ...payload,
      }),
    onSuccess: async () => {
      await invalidateProjectWork(workspaceId as string, projectId);
    },
    onError: (error) => reportError(error, 'Could not create that.'),
  });
}

export function useUpdateProjectWorkItem(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ workItemId, payload }: { workItemId: string; payload: UpdateWorkItemPayload }) =>
      workItemsApi.update(workspaceId as string, projectId, workItemId, payload),
    onSuccess: async (item) => {
      // The detail cache is set rather than invalidated: the response *is* the
      // new state, and refetching it would show the old value for a frame.
      queryClient.setQueryData(
        queryKeys.workItems.detail(workspaceId as string, projectId, item.id),
        item,
      );
      await invalidateProjectWork(workspaceId as string, projectId);
    },
    onError: (error) => reportError(error, 'Could not save that change.'),
  });
}

export function useMoveProjectWorkItem(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ workItemId, payload }: { workItemId: string; payload: MoveWorkItemPayload }) =>
      workItemsApi.move(workspaceId as string, projectId, workItemId, {
        correlationId: nextCorrelationId(),
        ...payload,
      }),
    onSuccess: async () => {
      await invalidateProjectWork(workspaceId as string, projectId);
    },
    onError: (error) => reportError(error, 'Could not move that.'),
  });
}
