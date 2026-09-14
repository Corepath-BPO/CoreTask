import { ApiRoutes } from '@coretask/contracts';
import type {
  ApiKey,
  CreateApiKeyPayload,
  CreatedApiKey,
  UpdateApiKeyPayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const apiKeysApi = {
  list: (workspaceId: string): Promise<ApiKey[]> =>
    apiClient.get<ApiKey[]>(ApiRoutes.apiKeys.list(workspaceId)),

  /** The only response carrying the secret. Never cache it. */
  create: (workspaceId: string, payload: CreateApiKeyPayload): Promise<CreatedApiKey> =>
    apiClient.post<CreatedApiKey>(ApiRoutes.apiKeys.create(workspaceId), payload),

  update: (workspaceId: string, apiKeyId: string, payload: UpdateApiKeyPayload): Promise<ApiKey> =>
    apiClient.patch<ApiKey>(ApiRoutes.apiKeys.update(workspaceId, apiKeyId), payload),

  revoke: (workspaceId: string, apiKeyId: string): Promise<ApiKey> =>
    apiClient.delete<ApiKey>(ApiRoutes.apiKeys.revoke(workspaceId, apiKeyId)),
};
