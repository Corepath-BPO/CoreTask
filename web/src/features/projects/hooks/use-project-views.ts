import type { UpdateProjectViewPayload, ViewSettings } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import {
  customFieldsApi,
  projectViewsApi,
  type ViewTaskQuery,
} from '../api/project-views.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

export function useProjectViews(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectViews.all(workspaceId ?? '', projectId),
    queryFn: () => projectViewsApi.list(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
  });
}

export function useFieldMetadata(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectViews.metadata(workspaceId ?? '', projectId),
    queryFn: () => projectViewsApi.fieldMetadata(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
    // Fields, statuses and members change far less often than tasks do, and
    // every cell render reads this.
    staleTime: 60_000,
  });
}

/**
 * The tasks behind a view.
 *
 * `query` is spread into the key rather than passed by reference: an object
 * literal rebuilt on every render is a new key every render, which puts the
 * query into a refetch loop. That is what caused the 429 storm on the
 * dashboard, and it is invisible until the network tab is open.
 */
export function useViewTasks(
  workspaceId: string | undefined,
  projectId: string,
  query: ViewTaskQuery,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.projectViews.tasks(workspaceId ?? '', projectId),
      query.page ?? 1,
      query.search ?? '',
      JSON.stringify(query.filters ?? []),
      JSON.stringify(query.sorts ?? []),
    ],
    queryFn: () => projectViewsApi.queryTasks(workspaceId as string, projectId, query),
    enabled: Boolean(workspaceId),
  });
}

/**
 * A parent's subtasks, fetched the first time its row is expanded.
 *
 * `enabled` is the whole point: most rows are never opened, and fetching every
 * task's children with the page would multiply the payload for something nobody
 * asked to see. Once fetched the result stays cached, so collapsing and
 * reopening a row costs nothing.
 */
export function useSubtasks(
  workspaceId: string | undefined,
  projectId: string,
  taskId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.projectViews.subtasks(workspaceId ?? '', projectId, taskId),
    queryFn: () => projectViewsApi.subtasks(workspaceId as string, projectId, taskId),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useUpdateProjectView(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ viewId, payload }: { viewId: string; payload: UpdateProjectViewPayload }) =>
      projectViewsApi.update(workspaceId as string, projectId, viewId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.all(workspaceId as string, projectId),
      });
    },
    onError: (error) => reportError(error, 'Could not save the view.'),
  });
}

/**
 * Persists a settings change to the server.
 *
 * Column choices belong in PostgreSQL rather than localStorage: someone who
 * arranges a view on a laptop expects the same arrangement on a second machine,
 * and a shared view has to look the same to everyone who opens it.
 */
export function useSaveViewSettings(workspaceId: string | undefined, projectId: string) {
  const update = useUpdateProjectView(workspaceId, projectId);

  return (viewId: string, settings: ViewSettings) =>
    update.mutate({ viewId, payload: { settings } });
}

export function useCreateCustomField(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: Parameters<typeof customFieldsApi.create>[2]) =>
      customFieldsApi.create(workspaceId as string, projectId, payload),
    onSuccess: async () => {
      toast.success('Field created.');
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.metadata(workspaceId as string, projectId),
      });
    },
    onError: (error) => reportError(error, 'Could not create the field.'),
  });
}

export function useSetCustomFieldValue(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({
      taskId,
      fieldId,
      value,
    }: {
      taskId: string;
      fieldId: string;
      value: Record<string, unknown>;
    }) => customFieldsApi.setValue(workspaceId as string, taskId, fieldId, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.tasks(workspaceId as string, projectId),
      });
    },
    onError: (error) => reportError(error, 'Could not save that value.'),
  });
}
