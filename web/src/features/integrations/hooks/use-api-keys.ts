import type { CreateApiKeyPayload, UpdateApiKeyPayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { apiKeysApi } from '../api/api-keys.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

export function useApiKeys(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.apiKeys.list(workspaceId ?? ''),
    queryFn: () => apiKeysApi.list(workspaceId as string),
    // Administrators only; asking as anyone else is a guaranteed 403.
    enabled: Boolean(workspaceId) && enabled,
  });
}

/**
 * The result carries the secret, which the dialog shows once from its own
 * state. It is deliberately never written into the query cache — the list is
 * invalidated and refetched without it.
 */
export function useCreateApiKey(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateApiKeyPayload) => apiKeysApi.create(workspaceId as string, payload),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.apiKeys.all(workspaceId as string),
      });
      toast.success(`Key “${created.key.name}” created`);
    },
    onError: (error) => reportError(error, 'Could not create the key.'),
  });
}

export function useUpdateApiKey(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ apiKeyId, payload }: { apiKeyId: string; payload: UpdateApiKeyPayload }) =>
      apiKeysApi.update(workspaceId as string, apiKeyId, payload),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.apiKeys.all(workspaceId as string),
      });
      toast.success(`Key “${updated.name}” updated`);
    },
    onError: (error) => reportError(error, 'Could not update the key.'),
  });
}

export function useRevokeApiKey(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (apiKeyId: string) => apiKeysApi.revoke(workspaceId as string, apiKeyId),
    onSuccess: async (revoked) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.apiKeys.all(workspaceId as string),
      });
      toast.success(`Key “${revoked.name}” revoked`);
    },
    onError: (error) => reportError(error, 'Could not revoke the key.'),
  });
}
