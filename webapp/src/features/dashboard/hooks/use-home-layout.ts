import { ApiRoutes, DEFAULT_HOME_WIDGETS } from '@coretask/contracts';
import type { HomeLayout, UpdateHomeLayoutPayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

/** What Home shows before the server has answered — the defaults, so nothing jumps. */
export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  widgets: [...DEFAULT_HOME_WIDGETS],
  notepad: '',
  customized: false,
};

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** The caller's Home in this workspace: which widgets, in order, and their notepad. */
export function useHomeLayout(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.home(workspaceId ?? ''),
    queryFn: () => apiClient.get<HomeLayout>(ApiRoutes.home(workspaceId as string)),
    enabled: Boolean(workspaceId),
  });
}

/**
 * Saves a change to Home, drawn at once: rearranging a page should not wait
 * on a round trip, and the server's answer replaces the guess when it lands.
 */
export function useUpdateHomeLayout(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: UpdateHomeLayoutPayload) =>
      apiClient.put<HomeLayout>(ApiRoutes.home(workspaceId as string), payload),
    onMutate: async (payload) => {
      const key = queryKeys.home(workspaceId as string);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<HomeLayout>(key);
      queryClient.setQueryData<HomeLayout>(key, {
        ...(previous ?? DEFAULT_HOME_LAYOUT),
        ...payload,
        customized: true,
      });
      return { previous };
    },
    onError: (error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.home(workspaceId as string), context.previous);
      }
      report(error, 'Could not save your Home.');
    },
    onSuccess: (layout) => queryClient.setQueryData(queryKeys.home(workspaceId as string), layout),
  });
}

/** Back to the default widgets; the notepad stays. */
export function useResetHomeLayout(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: () => apiClient.delete<HomeLayout>(ApiRoutes.home(workspaceId as string)),
    onSuccess: (layout) => queryClient.setQueryData(queryKeys.home(workspaceId as string), layout),
    onError: (error) => report(error, 'Could not reset your Home.'),
  });
}
