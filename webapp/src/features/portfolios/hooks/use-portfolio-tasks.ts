import { PAGINATION_MAX_LIMIT } from '@coretask/contracts';
import { useQueries } from '@tanstack/react-query';

import { tasksApi } from '@/features/tasks/api/tasks.api';
import { queryKeys } from '@/lib/api/query-client';

/**
 * The tasks of every project in a portfolio, subtasks included — what the
 * Workload and Dashboard tabs count.
 *
 * One request per project, under the same keys the task lists use, so a task
 * edited anywhere refreshes these too. Capped per project at the API's page
 * size: a portfolio tab is a summary, and a project with more open work than
 * that is already the headline.
 */
export function usePortfolioTasks(workspaceId: string | undefined, projectIds: readonly string[]) {
  return useQueries({
    queries: projectIds.map((projectId) => {
      const params = { projectId, limit: PAGINATION_MAX_LIMIT, includeSubtasks: true };
      return {
        queryKey: queryKeys.tasks.list(workspaceId ?? '', { portfolio: true, ...params }),
        queryFn: () => tasksApi.list(workspaceId as string, params),
        enabled: Boolean(workspaceId),
      };
    }),
    combine: (results) => ({
      tasks: results.flatMap((result) => result.data?.items ?? []),
      isLoading: results.some((result) => result.isLoading),
    }),
  });
}
