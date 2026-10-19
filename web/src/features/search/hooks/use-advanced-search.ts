import { ApiRoutes, type TaskSearchFilters } from '@coretask/contracts';
import type {
  SavedSearch,
  SaveSearchPayload,
  TaskSearchPage,
  UpdateSavedSearchPayload,
} from '@coretask/types';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.savedSearches;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** Today where the searcher is, so "due today" means their today. */
export function localToday(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Tasks matching the filters; the previous page stays up while the next loads. */
export function useTaskSearch(workspaceId: string | undefined, filters: TaskSearchFilters) {
  const today = localToday();
  return useQuery({
    queryKey: queryKeys.search.tasks(workspaceId ?? '', filters, today),
    queryFn: () =>
      apiClient.post<TaskSearchPage>(routes.tasks(workspaceId as string), { filters, today }),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

/** The searcher's own saved searches, oldest first. */
export function useSavedSearches(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.search.saved(workspaceId ?? ''),
    queryFn: () => apiClient.get<SavedSearch[]>(routes.list(workspaceId as string)),
    enabled: Boolean(workspaceId),
  });
}

const refresh = (workspaceId: string) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.search.saved(workspaceId) });

export function useSaveSearch(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: SaveSearchPayload) =>
      apiClient.post<SavedSearch>(routes.list(workspaceId as string), payload),
    onSuccess: (saved) => {
      void refresh(workspaceId as string);
      toast.success(`Saved “${saved.name}”.`);
    },
    onError: (error) => report(error, 'Could not save the search.'),
  });
}

export function useUpdateSavedSearch(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ searchId, payload }: { searchId: string; payload: UpdateSavedSearchPayload }) =>
      apiClient.patch<SavedSearch>(routes.detail(workspaceId as string, searchId), payload),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not save the search.'),
  });
}

export function useDeleteSavedSearch(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (searchId: string) =>
      apiClient.delete<void>(routes.detail(workspaceId as string, searchId)),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not delete the search.'),
  });
}
