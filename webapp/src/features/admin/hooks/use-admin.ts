import type { AdminHandOverPayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { adminApi } from '../api/admin.api';
import { describeWork } from '../lib/describe-work';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * Everything a membership touches: the console, the Members page, pickers and
 * the activity feed. `workspaces.all` covers the first two.
 */
async function invalidateMembership(workspaceId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) }),
  ]);
}

function handOverMessage(
  name: string,
  verb: string,
  result: {
    tasksReassigned: number;
    ticketsReassigned: number;
    tasksUnassigned: number;
    ticketsUnassigned: number;
  },
): string {
  const moved = describeWork(result.tasksReassigned, result.ticketsReassigned);
  const dropped = describeWork(result.tasksUnassigned, result.ticketsUnassigned);
  return [
    `${name} ${verb}`,
    moved ? `${moved} reassigned` : null,
    dropped ? `${dropped} unassigned` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Super admins only; the caller gates on role so nobody else starts a 403. */
export function useAdminOverview(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.workspaces.admin(workspaceId ?? ''), 'overview'],
    queryFn: () => adminApi.overview(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

export function useAdminMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.workspaces.admin(workspaceId ?? ''), 'members'],
    queryFn: () => adminApi.members(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

export function useAdminTeams(workspaceId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.workspaces.admin(workspaceId ?? ''), 'teams'],
    queryFn: () => adminApi.teams(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

export function useDeactivateMember(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ memberId, payload }: { memberId: string; payload: AdminHandOverPayload }) =>
      adminApi.deactivate(workspaceId as string, memberId, payload),
    onSuccess: async (result) => {
      await invalidateMembership(workspaceId as string);
      toast.success(handOverMessage(result.member.user.name, 'deactivated', result));
    },
    onError: (error) => reportError(error, 'Could not deactivate that member.'),
  });
}

export function useReactivateMember(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (memberId: string) => adminApi.reactivate(workspaceId as string, memberId),
    onSuccess: async (member) => {
      await invalidateMembership(workspaceId as string);
      toast.success(`${member.user.name} can sign in to this workspace again`);
    },
    onError: (error) => reportError(error, 'Could not reactivate that member.'),
  });
}

export function useAdminRemoveMember(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({
      memberId,
      payload,
    }: {
      memberId: string;
      name: string;
      payload: AdminHandOverPayload;
    }) => adminApi.remove(workspaceId as string, memberId, payload),
    onSuccess: async (result, variables) => {
      await invalidateMembership(workspaceId as string);
      toast.success(handOverMessage(variables.name, 'removed', result));
    },
    onError: (error) => reportError(error, 'Could not remove that member.'),
  });
}

/** Issues a fresh link; the previous one stops working. */
export function useInvitationLink(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (invitationId: string) =>
      adminApi.invitationLink(workspaceId as string, invitationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workspaces.invitations(workspaceId as string),
      });
    },
    onError: (error) => reportError(error, 'Could not make an invitation link.'),
  });
}
