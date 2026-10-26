import type { CreateInvitationPayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { invitationsApi } from '../api/invitations.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

export function useInvitations(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspaces.invitations(workspaceId ?? ''),
    queryFn: () => invitationsApi.list(workspaceId as string),
    // Only administrators may list them; asking as anyone else is a guaranteed
    // 403, so the caller gates on role rather than letting it fail.
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useInviteMember(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateInvitationPayload) =>
      invitationsApi.create(workspaceId as string, payload),
    onSuccess: async (invitation) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workspaces.invitations(workspaceId as string),
      });
      toast.success(`Invitation sent to ${invitation.email}`);
    },
    onError: (error) => reportError(error, 'Could not send the invitation.'),
  });
}

export function useRevokeInvitation(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (invitationId: string) =>
      invitationsApi.revoke(workspaceId as string, invitationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workspaces.invitations(workspaceId as string),
      });
      toast.success('Invitation revoked');
    },
    onError: (error) => reportError(error, 'Could not revoke the invitation.'),
  });
}

/** Resolves the token on the accept page. Works signed out. */
export function useInvitationPreview(token: string | undefined) {
  return useQuery({
    queryKey: queryKeys.invitationPreview(token ?? ''),
    queryFn: () => invitationsApi.preview(token as string),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: (token: string) => invitationsApi.accept(token),
    onError: (error) => reportError(error, 'Could not accept the invitation.'),
  });
}
