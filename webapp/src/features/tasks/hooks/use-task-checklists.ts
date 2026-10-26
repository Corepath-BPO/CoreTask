import { ApiRoutes } from '@coretask/contracts';
import type {
  CreateChecklistPayload,
  TaskChecklist,
  UpdateChecklistItemPayload,
  UpdateChecklistPayload,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** A task's checklists, each with its items, in order. */
export function useTaskChecklists(workspaceId: string | undefined, taskId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.checklists(workspaceId ?? '', taskId),
    queryFn: () =>
      apiClient.get<TaskChecklist[]>(ApiRoutes.tasks.checklists(workspaceId as string, taskId)),
    enabled: Boolean(workspaceId && taskId),
  });
}

/**
 * Every change to a task's checklists, as one hook.
 *
 * Each write answers with the task's checklists as they now are, which is
 * stored as the answer — so a tick shows the moment the server has it, with no
 * second fetch. Ticks are also shown before the server answers: a checkbox
 * that lags a click reads as one that did not take.
 */
export function useChecklistActions(workspaceId: string | undefined, taskId: string) {
  const key = queryKeys.tasks.checklists(workspaceId ?? '', taskId);
  const routes = {
    list: () => ApiRoutes.tasks.checklists(workspaceId as string, taskId),
    one: (checklistId: string) =>
      ApiRoutes.tasks.checklist(workspaceId as string, taskId, checklistId),
    items: (checklistId: string) =>
      ApiRoutes.tasks.checklistItems(workspaceId as string, taskId, checklistId),
    item: (checklistId: string, itemId: string) =>
      ApiRoutes.tasks.checklistItem(workspaceId as string, taskId, checklistId, itemId),
  };
  const store = (checklists: TaskChecklist[]) => queryClient.setQueryData(key, checklists);

  const create = useMutation({
    mutationFn: (payload: CreateChecklistPayload) =>
      apiClient.post<TaskChecklist[]>(routes.list(), payload),
    onSuccess: store,
    onError: (error) => report(error, 'Could not add the checklist.'),
  });

  const update = useMutation({
    mutationFn: ({ checklistId, ...payload }: UpdateChecklistPayload & { checklistId: string }) =>
      apiClient.patch<TaskChecklist[]>(routes.one(checklistId), payload),
    onSuccess: store,
    onError: (error) => report(error, 'Could not change the checklist.'),
  });

  const remove = useMutation({
    mutationFn: (checklistId: string) => apiClient.delete<TaskChecklist[]>(routes.one(checklistId)),
    onSuccess: store,
    onError: (error) => report(error, 'Could not remove the checklist.'),
  });

  const addItem = useMutation({
    mutationFn: ({ checklistId, title }: { checklistId: string; title: string }) =>
      apiClient.post<TaskChecklist[]>(routes.items(checklistId), { title }),
    onSuccess: store,
    onError: (error) => report(error, 'Could not add the item.'),
  });

  const updateItem = useMutation({
    mutationFn: ({
      checklistId,
      itemId,
      ...payload
    }: UpdateChecklistItemPayload & { checklistId: string; itemId: string }) =>
      apiClient.patch<TaskChecklist[]>(routes.item(checklistId, itemId), payload),
    onMutate: async ({ itemId, completed }) => {
      if (completed === undefined) return undefined;
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<TaskChecklist[]>(key);
      queryClient.setQueryData<TaskChecklist[]>(key, (lists) =>
        lists?.map((list) => ({
          ...list,
          items: list.items.map((item) => (item.id === itemId ? { ...item, completed } : item)),
        })),
      );
      return { before };
    },
    onSuccess: store,
    onError: (error, _variables, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
      report(error, 'Could not change the item.');
    },
  });

  const removeItem = useMutation({
    mutationFn: ({ checklistId, itemId }: { checklistId: string; itemId: string }) =>
      apiClient.delete<TaskChecklist[]>(routes.item(checklistId, itemId)),
    onSuccess: store,
    onError: (error) => report(error, 'Could not remove the item.'),
  });

  return { create, update, remove, addItem, updateItem, removeItem };
}
