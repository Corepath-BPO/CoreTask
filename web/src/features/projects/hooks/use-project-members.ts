import type { ProjectMemberRole } from '@coretask/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryKeys } from '@/lib/api/query-client';
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
