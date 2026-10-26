import { ApiRoutes } from '@coretask/contracts';
import type {
  ReportDashboard,
  ReportDashboardDraft,
  ReportQuery,
  ReportResult,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.reports;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** The workspace's report dashboards. */
export function useReportDashboards(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reports.dashboards(workspaceId ?? ''),
    queryFn: () => apiClient.get<ReportDashboard[]>(routes.dashboards(workspaceId as string)),
    enabled: Boolean(workspaceId),
  });
}

/** One chart's numbers, for the reader. Refetched whenever the question changes. */
export function useReportResult(workspaceId: string | undefined, query: ReportQuery) {
  return useQuery({
    queryKey: queryKeys.reports.result(workspaceId ?? '', query),
    queryFn: () =>
      apiClient.get<ReportResult>(routes.tasks(workspaceId as string), {
        params: {
          groupBy: query.groupBy,
          completion: query.completion,
          overdueOnly: query.overdueOnly,
          ...(query.projectIds.length > 0 ? { projectIds: query.projectIds.join(',') } : {}),
        },
      }),
    enabled: Boolean(workspaceId),
  });
}

/** Every write answers with the dashboard as it now is; the list is patched in place. */
function patchList(workspaceId: string, dashboard: ReportDashboard) {
  queryClient.setQueryData<ReportDashboard[]>(
    queryKeys.reports.dashboards(workspaceId),
    (current) =>
      current?.some((entry) => entry.id === dashboard.id)
        ? current.map((entry) => (entry.id === dashboard.id ? dashboard : entry))
        : [...(current ?? []), dashboard],
  );
}

export function useCreateReportDashboard(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (draft: ReportDashboardDraft) =>
      apiClient.post<ReportDashboard>(routes.dashboards(workspaceId as string), draft),
    onSuccess: (dashboard) => patchList(workspaceId as string, dashboard),
    onError: (error) => report(error, 'Could not make the dashboard.'),
  });
}

export function useUpdateReportDashboard(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({
      dashboardId,
      draft,
    }: {
      dashboardId: string;
      draft: Partial<ReportDashboardDraft>;
    }) =>
      apiClient.patch<ReportDashboard>(routes.dashboard(workspaceId as string, dashboardId), draft),
    onSuccess: (dashboard) => patchList(workspaceId as string, dashboard),
    onError: (error) => report(error, 'Could not save the dashboard.'),
  });
}

export function useDeleteReportDashboard(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (dashboardId: string) =>
      apiClient.delete<void>(routes.dashboard(workspaceId as string, dashboardId)),
    onSuccess: (_, dashboardId) =>
      queryClient.setQueryData<ReportDashboard[]>(
        queryKeys.reports.dashboards(workspaceId as string),
        (current) => current?.filter((entry) => entry.id !== dashboardId),
      ),
    onError: (error) => report(error, 'Could not delete the dashboard.'),
  });
}
