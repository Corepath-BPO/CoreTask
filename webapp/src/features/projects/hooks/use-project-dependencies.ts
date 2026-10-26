import { ApiRoutes } from '@coretask/contracts';
import type { ProjectDependency } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { taskRelationsApi } from '@/features/tasks/api/task-relations.api';
import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient } from '@/lib/api/query-client';

/**
 * Keyed beside each task's own dependency query, so adding or removing one
 * anywhere — the task pane included — refreshes the Timeline's arrows too.
 */
const key = (workspaceId: string, projectId: string) =>
  ['tasks', workspaceId, 'dependencies', 'project', projectId] as const;

/** Every dependency between two of the project's tasks. */
export function useProjectDependencies(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: key(workspaceId ?? '', projectId),
    queryFn: () =>
      apiClient.get<ProjectDependency[]>(
        ApiRoutes.projectDependencies(workspaceId as string, projectId),
      ),
    enabled: Boolean(workspaceId && projectId),
  });
}

/** Makes `blocked` wait on `blocking` — what dragging between two bars does. */
export function useLinkTasks(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ blocked, blocking }: { blocked: string; blocking: string }) =>
      taskRelationsApi.addDependency(workspaceId as string, blocked, {
        taskId: blocking,
        direction: 'BLOCKED_BY',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'tasks' &&
          query.queryKey[1] === workspaceId &&
          query.queryKey[2] === 'dependencies',
      }),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not link the tasks.'),
  });
}
