import type { CreateGoalPayload, UpdateGoalPayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient } from '@/lib/api/query-client';

import { goalsApi } from '../api/goals.api';

const key = (workspaceId: string) => ['goals', workspaceId] as const;

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/*
 * One list, refetched after every write rather than patched: a goal's progress
 * can roll up into its parent's and its grandparent's, so any change can move
 * numbers the response for that one goal does not carry.
 */
const refresh = (workspaceId: string | undefined) =>
  queryClient.invalidateQueries({ queryKey: key(workspaceId ?? '') });

export function useGoals(workspaceId: string | undefined) {
  return useQuery({
    queryKey: key(workspaceId ?? ''),
    queryFn: () => goalsApi.list(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateGoal(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateGoalPayload) => goalsApi.create(workspaceId as string, payload),
    onSuccess: () => refresh(workspaceId),
    onError: (error) => reportError(error, 'Could not create the goal.'),
  });
}

export function useUpdateGoal(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ goalId, payload }: { goalId: string; payload: UpdateGoalPayload }) =>
      goalsApi.update(workspaceId as string, goalId, payload),
    onSuccess: () => refresh(workspaceId),
    onError: (error) => reportError(error, 'Could not save the goal.'),
  });
}

export function useDeleteGoal(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (goalId: string) => goalsApi.remove(workspaceId as string, goalId),
    onSuccess: () => {
      toast.success('Goal deleted');
      return refresh(workspaceId);
    },
    onError: (error) => reportError(error, 'Could not delete the goal.'),
  });
}

export function useGoalProjectLink(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({
      goalId,
      projectId,
      linked,
    }: {
      goalId: string;
      projectId: string;
      linked: boolean;
    }) =>
      linked
        ? goalsApi.linkProject(workspaceId as string, goalId, projectId)
        : goalsApi.unlinkProject(workspaceId as string, goalId, projectId),
    onSuccess: () => refresh(workspaceId),
    onError: (error) => reportError(error, 'Could not change the connected projects.'),
  });
}
