import { ApiRoutes } from '@coretask/contracts';
import type {
  CreateWebhookPayload,
  CreatedWebhookEndpoint,
  UpdateWebhookPayload,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookDeliveryListQuery,
  WebhookDeliveryPage,
  WebhookEndpoint,
  WebhookSecretRotation,
  WebhookTestResult,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const webhooksApi = {
  list: (workspaceId: string): Promise<WebhookEndpoint[]> =>
    apiClient.get<WebhookEndpoint[]>(ApiRoutes.webhooks.list(workspaceId)),

  /** The only response carrying the signing secret. Never cache it. */
  create: (workspaceId: string, payload: CreateWebhookPayload): Promise<CreatedWebhookEndpoint> =>
    apiClient.post<CreatedWebhookEndpoint>(ApiRoutes.webhooks.create(workspaceId), payload),

  update: (
    workspaceId: string,
    endpointId: string,
    payload: UpdateWebhookPayload,
  ): Promise<WebhookEndpoint> =>
    apiClient.patch<WebhookEndpoint>(ApiRoutes.webhooks.update(workspaceId, endpointId), payload),

  remove: (workspaceId: string, endpointId: string): Promise<void> =>
    apiClient.delete<void>(ApiRoutes.webhooks.remove(workspaceId, endpointId)),

  rotateSecret: (workspaceId: string, endpointId: string): Promise<WebhookSecretRotation> =>
    apiClient.post<WebhookSecretRotation>(ApiRoutes.webhooks.rotateSecret(workspaceId, endpointId)),

  test: (workspaceId: string, endpointId: string): Promise<WebhookTestResult> =>
    apiClient.post<WebhookTestResult>(ApiRoutes.webhooks.test(workspaceId, endpointId)),

  deliveries: (
    workspaceId: string,
    query: WebhookDeliveryListQuery,
  ): Promise<WebhookDeliveryPage> =>
    apiClient.get<WebhookDeliveryPage>(ApiRoutes.webhookDeliveries.list(workspaceId), {
      params: query,
    }),

  delivery: (workspaceId: string, deliveryId: string): Promise<WebhookDeliveryDetail> =>
    apiClient.get<WebhookDeliveryDetail>(
      ApiRoutes.webhookDeliveries.detail(workspaceId, deliveryId),
    ),

  /** Queues the same payload again; the row comes back pending. */
  redeliver: (workspaceId: string, deliveryId: string): Promise<WebhookDelivery> =>
    apiClient.post<WebhookDelivery>(ApiRoutes.webhookDeliveries.redeliver(workspaceId, deliveryId)),
};
