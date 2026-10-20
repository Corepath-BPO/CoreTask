import type { ProjectMemberRole, ProjectNotificationKind } from '@coretask/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { invitationsApi } from '@/features/members/api/invitations.api';
import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { humanizeEnum } from '@/lib/utils';

import { projectMembersApi } from '../api/projects.api';

import { invalidateProjects } from './use-projects';

/**
 * A project's roster. Fetched only while something shows it — the Share
 * dialog — because every summary already carries a preview and a count.
 */
export function useProjectMembers(
  workspaceId: string | undefined,
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.projects.members(workspaceId ?? '', projectId ?? ''),
    queryFn: () => projectMembersApi.list(workspaceId as string, projectId as string),
    enabled: enabled && Boolean(workspaceId) && Boolean(projectId),
  });
}

function reportError(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.code === 'LAST_PROJECT_ADMIN') {
    toast.error(error.message, { description: 'Make someone else an admin first.' });
    return;
  }
  toast.error(error instanceof ApiError ? error.message : fallback);
}

export function useAddProjectMember(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectMemberRole }) =>
      projectMembersApi.add(workspaceId as string, projectId, { userId, role }),
    onSuccess: async (member) => {
      await invalidateProjects(workspaceId as string);
      toast.success(`${member.user.name} added as ${humanizeEnum(member.role).toLowerCase()}`);
    },
    onError: (error) => reportError(error, 'Could not add that person.'),
  });
}

export function useUpdateProjectMemberRole(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectMemberRole }) =>
      projectMembersApi.updateRole(workspaceId as string, projectId, userId, { role }),
    onSuccess: async (member) => {
      await invalidateProjects(workspaceId as string);
      toast.success(`${member.user.name} is now ${humanizeEnum(member.role).toLowerCase()}`);
    },
    onError: (error) => reportError(error, 'Could not change that role.'),
  });
}

export function useRemoveProjectMember(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ userId }: { userId: string; name: string }) =>
      projectMembersApi.remove(workspaceId as string, projectId, userId),
    onSuccess: async (_result, variables) => {
      await invalidateProjects(workspaceId as string);
      toast.success(`${variables.name} removed`);
    },
    onError: (error) => reportError(error, 'Could not remove that person.'),
  });
}

/** One instance serves every row of the browse list, so the project rides in the variables. */
export function useJoinProject(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ projectId }: { projectId: string; name: string }) =>
      projectMembersApi.join(workspaceId as string, projectId),
    onSuccess: async (_member, variables) => {
      await invalidateProjects(workspaceId as string);
      toast.success(`You joined ${variables.name}`);
    },
    onError: (error) => reportError(error, 'Could not join that project.'),
  });
}

export function useLeaveProject(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ projectId }: { projectId: string; name: string }) =>
      projectMembersApi.leave(workspaceId as string, projectId),
    onSuccess: async (_result, variables) => {
      await invalidateProjects(workspaceId as string);
      toast.success(`You left ${variables.name}`);
    },
    onError: (error) => reportError(error, 'Could not leave that project.'),
  });
}

/**
 * Invitations waiting to land someone in this project, for the Share dialog.
 * Only asked for by someone who may manage the roster; anyone else would get
 * a 403.
 */
export function useProjectInvitations(
  workspaceId: string | undefined,
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.projects.invitations(workspaceId ?? '', projectId ?? ''),
    queryFn: () => projectMembersApi.invitations(workspaceId as string, projectId as string),
    enabled: enabled && Boolean(workspaceId) && Boolean(projectId),
  });
}

/** Both lists an invitation shows in: this project's, and the workspace's on Members. */
async function invalidateInvitations(workspaceId: string, projectId: string) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.projects.invitations(workspaceId, projectId),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.invitations(workspaceId) }),
  ]);
}

export function useInviteToProject(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: ProjectMemberRole }) =>
      projectMembersApi.invite(workspaceId as string, projectId, { email, role }),
    onSuccess: async (invitation) => {
      await invalidateInvitations(workspaceId as string, projectId);
      toast.success(`Invited ${invitation.email}`, {
        description: 'They join the workspace and this project when they accept.',
      });
    },
    onError: (error) => reportError(error, 'Could not send that invitation.'),
  });
}

export function useRevokeProjectInvitation(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ invitationId }: { invitationId: string; email: string }) =>
      invitationsApi.revoke(workspaceId as string, invitationId),
    onSuccess: async (_result, variables) => {
      await invalidateInvitations(workspaceId as string, projectId);
      toast.success(`Invitation to ${variables.email} revoked`);
    },
    onError: (error) => reportError(error, 'Could not revoke that invitation.'),
  });
}

/** What a project tells the reader about. Fetched only while its menu is open. */
export function useProjectNotificationSettings(
  workspaceId: string | undefined,
  projectId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.projects.notificationSettings(workspaceId ?? '', projectId),
    queryFn: () => projectMembersApi.notificationSettings(workspaceId as string, projectId),
    enabled: enabled && Boolean(workspaceId),
  });
}

export function useSetProjectNotificationSettings(
  workspaceId: string | undefined,
  projectId: string,
) {
  return useMutation({
    mutationFn: (notifyOn: ProjectNotificationKind[]) =>
      projectMembersApi.setNotificationSettings(workspaceId as string, projectId, { notifyOn }),
    onSuccess: (settings) => {
      queryClient.setQueryData(
        queryKeys.projects.notificationSettings(workspaceId ?? '', projectId),
        settings,
      );
    },
    onError: (error) => reportError(error, 'Could not save your notification choice.'),
  });
}
