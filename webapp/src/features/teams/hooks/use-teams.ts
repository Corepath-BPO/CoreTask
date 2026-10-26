import type { CreateTeamPayload, UpdateTeamPayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { teamsApi } from '../api/teams.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * Teams appear on the projects list as a badge and in its filter, so a change
 * to one has to reach the project caches too — otherwise a renamed team keeps
 * its old label on every project card until something else refetches.
 */
async function invalidateTeams(workspaceId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.teams.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) }),
  ]);
}

export function useTeams(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.teams.list(workspaceId as string),
    queryFn: () => teamsApi.list(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

export function useTeam(workspaceId: string | undefined, teamId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.teams.detail(workspaceId as string, teamId as string),
    queryFn: () => teamsApi.detail(workspaceId as string, teamId as string),
    enabled: Boolean(workspaceId && teamId),
  });
}

export function useCreateTeam(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateTeamPayload) => teamsApi.create(workspaceId as string, payload),
    onSuccess: async (team) => {
      await invalidateTeams(workspaceId as string);
      toast.success(`${team.name} created`);
    },
    onError: (error) => reportError(error, 'Could not create that team.'),
  });
}

export function useUpdateTeam(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ teamId, payload }: { teamId: string; payload: UpdateTeamPayload }) =>
      teamsApi.update(workspaceId as string, teamId, payload),
    onSuccess: async (team) => {
      await invalidateTeams(workspaceId as string);
      toast.success(`${team.name} updated`);
    },
    onError: (error) => reportError(error, 'Could not save that team.'),
  });
}

export function useDeleteTeam(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ teamId }: { teamId: string; name: string }) =>
      teamsApi.remove(workspaceId as string, teamId),
    onSuccess: async (_result, variables) => {
      await invalidateTeams(workspaceId as string);
      toast.success(`${variables.name} deleted`);
    },
    onError: (error) => reportError(error, 'Could not delete that team.'),
  });
}

export function useAddTeamMember(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
      teamsApi.addMember(workspaceId as string, teamId, { userId }),
    onSuccess: async () => invalidateTeams(workspaceId as string),
    onError: (error) => reportError(error, 'Could not add that person.'),
  });
}

export function useRemoveTeamMember(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
      teamsApi.removeMember(workspaceId as string, teamId, userId),
    onSuccess: async () => invalidateTeams(workspaceId as string),
    onError: (error) => reportError(error, 'Could not remove that person.'),
  });
}
