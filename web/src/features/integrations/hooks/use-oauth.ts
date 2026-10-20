import { OAuthAppPolicy } from '@coretask/contracts';
import type {
  ApproveWorkspaceAppPayload,
  CreateOAuthAppPayload,
  UpdateOAuthAppPayload,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { oauthApi } from '../api/oauth.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

export function useOAuthApps() {
  return useQuery({ queryKey: queryKeys.oauthApps, queryFn: oauthApi.apps });
}

/**
 * The result carries the client secret, which the dialog shows once from its
 * own state. It never goes into the query cache — the list is refetched without it.
 */
export function useCreateOAuthApp() {
  return useMutation({
    mutationFn: (payload: CreateOAuthAppPayload) => oauthApi.createApp(payload),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.oauthApps });
      toast.success(`App “${created.app.name}” registered`);
    },
    onError: (error) => reportError(error, 'Could not register the app.'),
  });
}

export function useUpdateOAuthApp() {
  return useMutation({
    mutationFn: ({ appId, payload }: { appId: string; payload: UpdateOAuthAppPayload }) =>
      oauthApi.updateApp(appId, payload),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.oauthApps });
      toast.success(`App “${updated.name}” updated`);
    },
    onError: (error) => reportError(error, 'Could not update the app.'),
  });
}

export function useRotateOAuthSecret() {
  return useMutation({
    mutationFn: (appId: string) => oauthApi.rotateSecret(appId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.oauthApps });
    },
    onError: (error) => reportError(error, 'Could not replace the secret.'),
  });
}

export function useDeleteOAuthApp() {
  return useMutation({
    mutationFn: (appId: string) => oauthApi.deleteApp(appId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.oauthApps });
      toast.success('App deleted');
    },
    onError: (error) => reportError(error, 'Could not delete the app.'),
  });
}

export function useConnectedApps() {
  return useQuery({ queryKey: queryKeys.connectedApps, queryFn: oauthApi.connectedApps });
}

export function useDisconnectApp() {
  return useMutation({
    mutationFn: (appId: string) => oauthApi.disconnect(appId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.connectedApps });
      toast.success('App disconnected');
    },
    onError: (error) => reportError(error, 'Could not disconnect the app.'),
  });
}

export function useAppDirectory(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.appDirectory(workspaceId ?? ''),
    queryFn: () => oauthApi.appDirectory(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

export function useSetAppPolicy(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (policy: OAuthAppPolicy) =>
      oauthApi.setAppPolicy(workspaceId as string, { policy }),
    onSuccess: (directory) => {
      queryClient.setQueryData(queryKeys.appDirectory(workspaceId ?? ''), directory);
      toast.success(
        directory.policy === OAuthAppPolicy.APPROVED
          ? 'Only approved apps can act here now'
          : 'Any app members connect can act here now',
      );
    },
    onError: (error) => reportError(error, 'Could not change which apps are allowed.'),
  });
}

export function useApproveDirectoryApp(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: ApproveWorkspaceAppPayload) =>
      oauthApi.approveApp(workspaceId as string, payload),
    onSuccess: async (approved) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.appDirectory(workspaceId ?? '') });
      toast.success(`“${approved.app.name}” approved`);
    },
    onError: (error) => reportError(error, 'Could not approve the app.'),
  });
}

export function useRemoveDirectoryApp(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (appId: string) => oauthApi.removeDirectoryApp(workspaceId as string, appId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.appDirectory(workspaceId ?? '') });
      toast.success('App removed from the directory');
    },
    onError: (error) => reportError(error, 'Could not remove the app.'),
  });
}
