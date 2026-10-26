import { ApiRoutes } from '@coretask/contracts';
import type { PortfolioMessage, PostProjectMessagePayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.portfolios;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** A portfolio's messages, newest first, with their replies. */
export function usePortfolioMessages(workspaceId: string | undefined, portfolioId: string) {
  return useQuery({
    queryKey: queryKeys.portfolios.messages(workspaceId ?? '', portfolioId),
    queryFn: () =>
      apiClient.get<PortfolioMessage[]>(routes.messages(workspaceId as string, portfolioId)),
    enabled: Boolean(workspaceId && portfolioId),
  });
}

const refresh = (workspaceId: string, portfolioId: string) =>
  queryClient.invalidateQueries({
    queryKey: queryKeys.portfolios.messages(workspaceId, portfolioId),
  });

export function usePostPortfolioMessage(workspaceId: string | undefined, portfolioId: string) {
  return useMutation({
    mutationFn: (payload: PostProjectMessagePayload) =>
      apiClient.post<PortfolioMessage>(
        routes.messages(workspaceId as string, portfolioId),
        payload,
      ),
    onSuccess: () => refresh(workspaceId as string, portfolioId),
    onError: (error) => report(error, 'Could not post the message.'),
  });
}

export function useReplyToPortfolioMessage(workspaceId: string | undefined, portfolioId: string) {
  return useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: string }) =>
      apiClient.post<PortfolioMessage>(
        routes.replies(workspaceId as string, portfolioId, messageId),
        { body },
      ),
    onSuccess: () => refresh(workspaceId as string, portfolioId),
    onError: (error) => report(error, 'Could not post the reply.'),
  });
}

export function useDeletePortfolioMessage(workspaceId: string | undefined, portfolioId: string) {
  return useMutation({
    mutationFn: (messageId: string) =>
      apiClient.delete<void>(routes.message(workspaceId as string, portfolioId, messageId)),
    onSuccess: () => refresh(workspaceId as string, portfolioId),
    onError: (error) => report(error, 'Could not delete the message.'),
  });
}
