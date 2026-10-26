import { ApiRoutes } from '@coretask/contracts';
import type { PortfolioStatusUpdate, StatusRequestResult } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  toServerStatus,
  type ProjectStatusUpdateValue,
} from '@/features/projects/hooks/use-project-updates';
import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.portfolios;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** A portfolio's own status updates, newest first. */
export function usePortfolioStatusUpdates(workspaceId: string | undefined, portfolioId: string) {
  return useQuery({
    queryKey: queryKeys.portfolios.statusUpdates(workspaceId ?? '', portfolioId),
    queryFn: () =>
      apiClient.get<PortfolioStatusUpdate[]>(
        routes.statusUpdates(workspaceId as string, portfolioId),
      ),
    enabled: Boolean(workspaceId && portfolioId),
  });
}

/** The history, and the portfolio itself — its header shows the newest. */
const refresh = (workspaceId: string) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.portfolios.all(workspaceId) });

export function usePostPortfolioStatus(workspaceId: string | undefined, portfolioId: string) {
  return useMutation({
    mutationFn: (payload: {
      status: ProjectStatusUpdateValue;
      title: string;
      summary: string;
      nextSteps: string;
    }) =>
      apiClient.post<PortfolioStatusUpdate>(
        routes.statusUpdates(workspaceId as string, portfolioId),
        {
          status: toServerStatus(payload.status),
          title: payload.title,
          summary: payload.summary.trim() || null,
          nextSteps: payload.nextSteps.trim() || null,
        },
      ),
    onSuccess: () => {
      toast.success('Status posted.');
      return refresh(workspaceId as string);
    },
    onError: (error) => report(error, 'Could not post the status.'),
  });
}

export function useDeletePortfolioStatus(workspaceId: string | undefined, portfolioId: string) {
  return useMutation({
    mutationFn: (updateId: string) =>
      apiClient.delete<void>(routes.statusUpdate(workspaceId as string, portfolioId, updateId)),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not delete the status update.'),
  });
}

/** "Request status update" on the portfolio itself: asks its owner. */
export function useRequestPortfolioStatus(workspaceId: string | undefined, portfolioId: string) {
  return useMutation({
    mutationFn: () =>
      apiClient.post<StatusRequestResult>(routes.requestStatus(workspaceId as string, portfolioId)),
    onSuccess: (result) => toast.success(`Asked ${result.recipient.name} for a status update.`),
    onError: (error) => report(error, 'Could not ask for an update.'),
  });
}
