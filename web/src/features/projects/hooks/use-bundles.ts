import { ApiRoutes } from '@coretask/contracts';
import type {
  Bundle,
  BundleApplyResult,
  BundleRefreshResult,
  CreateBundlePayload,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { automationKeys } from '@/features/automations/hooks/use-automations';
import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.bundles;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** "Added 1 section, 2 rules (1 live) and 1 task template" — what an apply did, in a line. */
export function describeApply(result: BundleApplyResult): string {
  const parts = [
    result.sectionsAdded > 0 && plural(result.sectionsAdded, 'section'),
    result.fieldsAdded > 0 && plural(result.fieldsAdded, 'field'),
    result.rulesWritten > 0 &&
      `${plural(result.rulesWritten, 'rule')}${result.rulesLive > 0 ? ` (${result.rulesLive} live)` : ''}`,
    result.templatesWritten > 0 && plural(result.templatesWritten, 'task template'),
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return 'Already up to date';
  const last = parts.pop();
  return `Added ${parts.length > 0 ? `${parts.join(', ')} and ${last}` : last}`;
}

/** The workspace's bundles. */
export function useBundles(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.bundles.all(workspaceId ?? ''),
    queryFn: () => apiClient.get<Bundle[]>(routes.list(workspaceId as string)),
    enabled: Boolean(workspaceId),
  });
}

/** Everything an apply can change in a project, refreshed together. */
function refreshProject(workspaceId: string, projectId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.bundles.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: automationKeys.all(workspaceId, projectId) }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.taskTemplates.list(workspaceId, projectId),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.projectViews.all(workspaceId, projectId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.workItems.all(workspaceId, projectId) }),
  ]);
}

/** Warns about the rules an apply could not switch on, by name. */
function warnAbout(results: readonly BundleApplyResult[]) {
  const names = [...new Set(results.flatMap((result) => result.rulesNeedingAttention))];
  if (names.length > 0) {
    toast.warning(
      `${names.join(', ')} ${names.length === 1 ? 'needs' : 'need'} a look before ${names.length === 1 ? 'it' : 'they'} can run here.`,
    );
  }
}

export function useCreateBundle(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateBundlePayload) =>
      apiClient.post<Bundle>(routes.list(workspaceId as string), payload),
    onSuccess: (bundle) => {
      toast.success(`Bundle “${bundle.name}” made`);
      return queryClient.invalidateQueries({
        queryKey: queryKeys.bundles.all(workspaceId as string),
      });
    },
    onError: (error) => report(error, 'Could not make the bundle.'),
  });
}

/** Applies a bundle to a project, or brings it up to date — the same request. */
export function useApplyBundle(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (bundleId: string) =>
      apiClient.put<BundleApplyResult>(
        routes.project(workspaceId as string, bundleId, projectId),
        {},
      ),
    onSuccess: async (result) => {
      toast.success(describeApply(result));
      warnAbout([result]);
      await refreshProject(workspaceId as string, projectId);
    },
    onError: (error) => report(error, 'Could not apply the bundle.'),
  });
}

export function useDetachBundle(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (bundleId: string) =>
      apiClient.delete<void>(routes.project(workspaceId as string, bundleId, projectId)),
    onSuccess: async () => {
      toast.success('Bundle removed. Its sections and fields stay.');
      await refreshProject(workspaceId as string, projectId);
    },
    onError: (error) => report(error, 'Could not remove the bundle.'),
  });
}

/** Retakes a bundle from this project and sends it to every project it is on. */
export function useRefreshBundle(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (bundleId: string) =>
      apiClient.post<BundleRefreshResult>(routes.refresh(workspaceId as string, bundleId), {}),
    onSuccess: async (result) => {
      const reached = result.applied.length;
      toast.success(
        reached === 0
          ? `Bundle updated to version ${result.version}`
          : `Bundle updated to version ${result.version} in ${plural(reached, 'project')}`,
      );
      if (result.skipped > 0) {
        toast.info(
          `${plural(result.skipped, 'project')} you do not manage will update when one of its managers syncs.`,
        );
      }
      warnAbout(result.applied);
      await refreshProject(workspaceId as string, projectId);
    },
    onError: (error) => report(error, 'Could not update the bundle.'),
  });
}

export function useDeleteBundle(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (bundleId: string) =>
      apiClient.delete<void>(routes.detail(workspaceId as string, bundleId)),
    onSuccess: () => {
      toast.success('Bundle deleted. What it added to projects stays.');
      return queryClient.invalidateQueries({
        queryKey: queryKeys.bundles.all(workspaceId as string),
      });
    },
    onError: (error) => report(error, 'Could not delete the bundle.'),
  });
}
