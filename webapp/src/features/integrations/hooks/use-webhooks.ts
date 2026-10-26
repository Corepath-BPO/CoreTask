import type { CreateWebhookPayload, UpdateWebhookPayload, WebhookEndpoint } from '@coretask/types';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { webhooksApi } from '../api/webhooks.api';

const DELIVERY_PAGE_LIMIT = 25;

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

async function invalidateEndpoints(workspaceId: string) {
  await queryClient.invalidateQueries({ queryKey: queryKeys.webhooks.all(workspaceId) });
}

export function useWebhooks(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.webhooks.list(workspaceId ?? ''),
    queryFn: () => webhooksApi.list(workspaceId as string),
    // Administrators only; asking as anyone else is a guaranteed 403.
    enabled: Boolean(workspaceId) && enabled,
  });
}

/** The result carries the signing secret; the dialog shows it once from its own state, never the cache. */
export function useCreateWebhook(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateWebhookPayload) =>
      webhooksApi.create(workspaceId as string, payload),
    onSuccess: async (created) => {
      await invalidateEndpoints(workspaceId as string);
      toast.success(`Endpoint “${created.endpoint.name}” added`);
    },
    onError: (error) => reportError(error, 'Could not add the endpoint.'),
  });
}

export function useUpdateWebhook(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ endpointId, payload }: { endpointId: string; payload: UpdateWebhookPayload }) =>
      webhooksApi.update(workspaceId as string, endpointId, payload),
    onSuccess: async (updated) => {
      await invalidateEndpoints(workspaceId as string);
      toast.success(`Endpoint “${updated.name}” updated`);
    },
    onError: (error) => reportError(error, 'Could not update the endpoint.'),
  });
}

/**
 * The enable switch flips at once and rolls back on failure. Re-enabling also
 * clears the auto-disable reason locally, as the server does.
 */
export function useSetWebhookEnabled(workspaceId: string | undefined) {
  const key = queryKeys.webhooks.list(workspaceId ?? '');

  return useMutation({
    mutationFn: ({ endpointId, enabled }: { endpointId: string; enabled: boolean }) =>
      webhooksApi.update(workspaceId as string, endpointId, { enabled }),
    onMutate: async ({ endpointId, enabled }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WebhookEndpoint[]>(key);

      queryClient.setQueryData<WebhookEndpoint[]>(key, (rows) =>
        rows?.map((row) =>
          row.id === endpointId
            ? {
                ...row,
                enabled,
                disabledReason: enabled ? null : row.disabledReason,
                consecutiveFailures: enabled ? 0 : row.consecutiveFailures,
              }
            : row,
        ),
      );

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      reportError(error, 'Could not change the endpoint.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteWebhook(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (endpointId: string) => webhooksApi.remove(workspaceId as string, endpointId),
    onSuccess: async () => {
      await invalidateEndpoints(workspaceId as string);
      toast.success('Endpoint removed');
    },
    onError: (error) => reportError(error, 'Could not remove the endpoint.'),
  });
}

/** Returns the new secret to the caller only; nothing is written to the cache. */
export function useRotateWebhookSecret(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (endpointId: string) => webhooksApi.rotateSecret(workspaceId as string, endpointId),
    onError: (error) => reportError(error, 'Could not rotate the secret.'),
  });
}

export function useTestWebhook(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (endpointId: string) => webhooksApi.test(workspaceId as string, endpointId),
    onSuccess: async (_result, endpointId) => {
      await Promise.all([
        invalidateEndpoints(workspaceId as string),
        queryClient.invalidateQueries({
          queryKey: queryKeys.webhooks.deliveries(workspaceId as string, endpointId),
        }),
      ]);
      toast.success('Test event queued — watch the deliveries for the result');
    },
    onError: (error) => reportError(error, 'Could not send the test event.'),
  });
}

/** The row flips to pending in the list; the next refresh shows how it went. */
export function useRedeliverWebhook(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (deliveryId: string) => webhooksApi.redeliver(workspaceId as string, deliveryId),
    onSuccess: async (updated) => {
      await Promise.all([
        invalidateEndpoints(workspaceId as string),
        queryClient.invalidateQueries({
          queryKey: queryKeys.webhooks.delivery(workspaceId as string, updated.id),
        }),
      ]);
      toast.success('Delivery queued again — watch the list for the result');
    },
    onError: (error) => reportError(error, 'Could not queue the delivery again.'),
  });
}

/** Newest first, older pages on demand by id cursor. */
export function useWebhookDeliveries(workspaceId: string | undefined, endpointId: string | null) {
  return useInfiniteQuery({
    queryKey: queryKeys.webhooks.deliveries(workspaceId ?? '', endpointId ?? ''),
    queryFn: ({ pageParam }) =>
      webhooksApi.deliveries(workspaceId as string, {
        endpointId: endpointId as string,
        limit: DELIVERY_PAGE_LIMIT,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextBefore ?? undefined) : undefined,
    enabled: Boolean(workspaceId) && Boolean(endpointId),
  });
}

/** The payload and attempt history, fetched when a row is expanded. */
export function useWebhookDelivery(workspaceId: string | undefined, deliveryId: string | null) {
  return useQuery({
    queryKey: queryKeys.webhooks.delivery(workspaceId ?? '', deliveryId ?? ''),
    queryFn: () => webhooksApi.delivery(workspaceId as string, deliveryId as string),
    enabled: Boolean(workspaceId) && Boolean(deliveryId),
  });
}
