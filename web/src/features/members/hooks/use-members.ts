import type { WorkspaceRole } from '@coretask/contracts';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { membersApi } from '../api/members.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * A membership change moves what the caller may see and do, so the workspace
 * list goes with it — that is where each workspace's `role` comes from, and the
 * whole UI gates on it.
 */
async function invalidateMembership(workspaceId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) }),
  ]);
}

export function useUpdateMemberRole(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: WorkspaceRole }) =>
      membersApi.updateRole(workspaceId as string, memberId, { role }),
    onSuccess: async (member) => {
      await invalidateMembership(workspaceId as string);
      toast.success(`${member.user.name} is now a ${member.role.toLowerCase()}`);
    },
    onError: (error) => reportError(error, 'Could not change that role.'),
  });
}

export function useRemoveMember(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ memberId }: { memberId: string; name: string }) =>
      membersApi.remove(workspaceId as string, memberId),
    onSuccess: async (result, variables) => {
      await invalidateMembership(workspaceId as string);
      // Unassigned work is a consequence people should hear about, not discover.
      const unassigned = result.tasksUnassigned + result.ticketsUnassigned;
      toast.success(
        unassigned > 0
          ? `${variables.name} removed — ${unassigned} open item${unassigned === 1 ? '' : 's'} unassigned`
          : `${variables.name} removed`,
      );
    },
    onError: (error) => reportError(error, 'Could not remove that member.'),
  });
}

/** Leaving is the same endpoint; the copy and the confirmation differ. */
export function useLeaveWorkspace(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (memberId: string) => membersApi.remove(workspaceId as string, memberId),
    onError: (error) => reportError(error, 'Could not leave the workspace.'),
  });
}

export function useTransferOwnership(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (memberId: string) => membersApi.transferOwnership(workspaceId as string, memberId),
    onSuccess: async (member) => {
      await invalidateMembership(workspaceId as string);
      toast.success(`${member.user.name} now owns this workspace`);
    },
    onError: (error) => reportError(error, 'Could not transfer ownership.'),
  });
}
