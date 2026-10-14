import { ApiRoutes } from '@coretask/contracts';
import type { Portfolio, PortfolioDraft } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

export type { Portfolio, PortfolioDraft };

/**
 * Portfolios, from the server.
 *
 * They used to live in this browser alone, so a portfolio somebody built was
 * theirs and nobody else's. They are the workspace's now: everyone sees the
 * same portfolios, each filtered to the projects they can open, and a star is
 * still personal.
 */

const routes = ApiRoutes.portfolios;
const NONE: Portfolio[] = [];

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

export function usePortfoliosQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.portfolios.all(workspaceId ?? ''),
    queryFn: () => apiClient.get<Portfolio[]>(routes.list(workspaceId as string)),
    enabled: Boolean(workspaceId),
  });
}

/** The workspace's portfolios, or an empty list while they load. */
export function usePortfolios(workspaceId: string | undefined): Portfolio[] {
  return usePortfoliosQuery(workspaceId).data ?? NONE;
}

/** One portfolio, or null — read off the list the other screens already hold. */
export function usePortfolio(workspaceId: string | undefined, portfolioId: string) {
  const query = usePortfoliosQuery(workspaceId);
  return {
    portfolio: query.data?.find((entry) => entry.id === portfolioId) ?? null,
    isLoading: query.isLoading,
  };
}

/** Every write answers with the portfolio as it now is; the list is patched in place. */
function useWrite<TInput>(
  workspaceId: string | undefined,
  write: (input: TInput) => Promise<Portfolio | void>,
  failure: string,
) {
  return useMutation({
    mutationFn: write,
    onSuccess: (portfolio) => {
      if (!workspaceId) return;
      if (portfolio) {
        queryClient.setQueryData<Portfolio[]>(queryKeys.portfolios.all(workspaceId), (current) =>
          current?.some((entry) => entry.id === portfolio.id)
            ? current.map((entry) => (entry.id === portfolio.id ? portfolio : entry))
            : [...(current ?? []), portfolio],
        );
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.portfolios.all(workspaceId) });
    },
    onError: (error) => report(error, failure),
  });
}

export function useCreatePortfolio(workspaceId: string | undefined) {
  return useWrite(
    workspaceId,
    (draft: PortfolioDraft) => apiClient.post<Portfolio>(routes.list(workspaceId as string), draft),
    'Could not create the portfolio.',
  );
}

export function useUpdatePortfolio(workspaceId: string | undefined) {
  return useWrite(
    workspaceId,
    ({ portfolioId, draft }: { portfolioId: string; draft: Partial<PortfolioDraft> }) =>
      apiClient.patch<Portfolio>(routes.detail(workspaceId as string, portfolioId), draft),
    'Could not save the portfolio.',
  );
}

export function useDeletePortfolio(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (portfolioId: string) =>
      apiClient.delete<void>(routes.detail(workspaceId as string, portfolioId)),
    onSuccess: (_, portfolioId) => {
      if (!workspaceId) return;
      queryClient.setQueryData<Portfolio[]>(queryKeys.portfolios.all(workspaceId), (current) =>
        current?.filter((entry) => entry.id !== portfolioId),
      );
    },
    onError: (error) => report(error, 'Could not delete the portfolio.'),
  });
}

export function useAddPortfolioProjects(workspaceId: string | undefined) {
  return useWrite(
    workspaceId,
    ({ portfolioId, projectIds }: { portfolioId: string; projectIds: string[] }) =>
      apiClient.post<Portfolio>(routes.projects(workspaceId as string, portfolioId), {
        projectIds,
      }),
    'Could not add those projects.',
  );
}

export function useRemovePortfolioProject(workspaceId: string | undefined) {
  return useWrite(
    workspaceId,
    ({ portfolioId, projectId }: { portfolioId: string; projectId: string }) =>
      apiClient.delete<Portfolio>(routes.project(workspaceId as string, portfolioId, projectId)),
    'Could not remove that project.',
  );
}

export function useTogglePortfolioStar(workspaceId: string | undefined) {
  return useWrite(
    workspaceId,
    (portfolio: Portfolio) =>
      apiClient.put<Portfolio>(routes.star(workspaceId as string, portfolio.id), {
        starred: !portfolio.starred,
      }),
    'Could not star the portfolio.',
  );
}

/** One person's Workload capacity; null returns them to the portfolio's default. */
export function useSetPortfolioCapacity(workspaceId: string | undefined) {
  return useWrite(
    workspaceId,
    ({
      portfolioId,
      userId,
      capacity,
    }: {
      portfolioId: string;
      userId: string;
      capacity: number | null;
    }) =>
      apiClient.put<Portfolio>(routes.capacity(workspaceId as string, portfolioId, userId), {
        capacity,
      }),
    'Could not set the capacity.',
  );
}
