import { BOARD_TASK_LIMIT } from '@coretask/contracts';
import type {
  CreateTaskPayload,
  MoveTaskPayload,
  Task,
  TaskListMeta,
  UpdateTaskPayload,
} from '@coretask/types';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { tasksApi, type TaskListParams } from '../api/tasks.api';
import type { TaskGroups } from '../lib/resolve-task-drop';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/** Invalidates every task query for a workspace, plus project task counts. */
async function invalidateTasks(workspaceId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) }),
    // Project cards and the board header show task rollups.
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) }),
  ]);
}

export function useTasks(workspaceId: string | undefined, params: TaskListParams) {
  return useQuery({
    queryKey: queryKeys.tasks.list(workspaceId ?? '', params as Record<string, unknown>),
    queryFn: () => tasksApi.list(workspaceId as string, params),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

/**
 * Every task on a project's board, in one request.
 *
 * A board is a direct-manipulation surface, so it loads the whole set rather
 * than paging — capped, with the cap surfaced to the caller so the UI can say
 * how many were withheld instead of silently truncating.
 */
export function useBoardTasks(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.board(workspaceId ?? '', projectId),
    queryFn: () => tasksApi.list(workspaceId as string, { projectId, limit: BOARD_TASK_LIMIT }),
    enabled: Boolean(workspaceId) && Boolean(projectId),
  });
}

export function useTaskDetail(workspaceId: string | undefined, taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.tasks.detail(workspaceId ?? '', taskId ?? ''),
    queryFn: () => tasksApi.get(workspaceId as string, taskId as string),
    enabled: Boolean(workspaceId) && Boolean(taskId),
  });
}

export function useCreateTask(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateTaskPayload) => tasksApi.create(workspaceId as string, payload),
    onSuccess: async (task) => {
      await invalidateTasks(workspaceId as string);
      toast.success(`Task "${task.title}" created`);
    },
    onError: (error) => reportError(error, 'Could not create the task.'),
  });
}

export function useUpdateTask(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ taskId, payload }: { taskId: string; payload: UpdateTaskPayload }) =>
      tasksApi.update(workspaceId as string, taskId, payload),
    onSuccess: async () => {
      await invalidateTasks(workspaceId as string);
    },
    onError: (error) => reportError(error, 'Could not update the task.'),
  });
}

export function useArchiveTask(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ taskId, archived }: { taskId: string; archived: boolean }) =>
      archived
        ? tasksApi.restore(workspaceId as string, taskId)
        : tasksApi.archive(workspaceId as string, taskId),
    onSuccess: async (task) => {
      await invalidateTasks(workspaceId as string);
      toast.success(task.archivedAt ? `"${task.title}" archived` : `"${task.title}" restored`);
    },
    onError: (error) => reportError(error, 'Could not change the task.'),
  });
}

/**
 * Moves a task, applying the new board layout optimistically.
 *
 * A card that snaps back to its old column before the request lands reads as a
 * failed drag, so the cache is rewritten first and rolled back only on error.
 */
export function useMoveTask(workspaceId: string | undefined, projectId: string) {
  const boardKey = queryKeys.tasks.board(workspaceId ?? '', projectId);

  return useMutation({
    mutationFn: ({
      taskId,
      payload,
    }: {
      taskId: string;
      payload: MoveTaskPayload;
      groups: TaskGroups;
    }) => tasksApi.move(workspaceId as string, taskId, payload),

    onMutate: async ({ groups }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<{ items: Task[]; meta: TaskListMeta }>(boardKey);

      queryClient.setQueryData<{ items: Task[]; meta: TaskListMeta }>(boardKey, (current) =>
        current ? { ...current, items: flattenGroups(groups) } : current,
      );

      return { previous };
    },

    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous);
      reportError(error, 'Could not move the task.');
    },

    // The server's positions are authoritative: a rebalance can renumber
    // siblings the optimistic update left untouched.
    onSettled: async () => {
      await invalidateTasks(workspaceId as string);
    },
  });
}

/**
 * Moves a task without an optimistic board update.
 *
 * Used by the detail dialog's Section control, where there is no drag to keep
 * in sync — a plain invalidate is simpler and cannot desync the board.
 */
export function useMoveTaskToSection(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ taskId, payload }: { taskId: string; payload: MoveTaskPayload }) =>
      tasksApi.move(workspaceId as string, taskId, payload),
    onSuccess: async (task) => {
      await invalidateTasks(workspaceId as string);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.detail(workspaceId as string, task.id),
      });
    },
    onError: (error) => reportError(error, 'Could not move the task.'),
  });
}

/** Groups board tasks by section id, preserving each column's order. */
export function groupTasksBySection(tasks: Task[], sectionIds: string[]): TaskGroups {
  const groups: TaskGroups = Object.fromEntries(sectionIds.map((id) => [id, [] as Task[]]));

  for (const task of tasks) {
    if (task.sectionId && task.sectionId in groups) {
      (groups[task.sectionId] as Task[]).push(task);
    }
  }

  for (const list of Object.values(groups)) {
    list.sort((a, b) => a.position - b.position);
  }

  return groups;
}

function flattenGroups(groups: TaskGroups): Task[] {
  return Object.entries(groups).flatMap(([sectionId, list]) =>
    // Positions are re-derived by the server; the index keeps the optimistic
    // ordering stable until the refetch replaces it.
    list.map((task, index) => ({ ...task, sectionId, position: index })),
  );
}
