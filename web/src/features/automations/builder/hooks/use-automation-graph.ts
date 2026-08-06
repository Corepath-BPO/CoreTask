import type {
  AutomationGraphValidation,
  AutomationMetadata,
  AutomationRuleGraph,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient } from '@/lib/api/query-client';

import { automationKeys } from '../../hooks/use-automations';

const base = (workspaceId: string, projectId: string) =>
  `/workspaces/${workspaceId}/projects/${projectId}/automations`;

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/** The rule as a graph — nodes, and the edges derived from their parentage. */
export function useAutomationGraph(
  workspaceId: string | undefined,
  projectId: string,
  ruleId: string | null,
) {
  return useQuery<AutomationRuleGraph>({
    queryKey: automationKeys.graph(workspaceId ?? '', projectId, ruleId ?? ''),
    queryFn: () =>
      apiClient.get<AutomationRuleGraph>(
        `${base(workspaceId as string, projectId)}/${ruleId}/graph`,
      ),
    enabled: Boolean(workspaceId && projectId && ruleId),
  });
}

/**
 * What the forms may offer.
 *
 * Cached for the session rather than refetched per node: sections and members
 * change rarely, and a selector that stalls on every open is worse than one
 * showing a member who left an hour ago.
 */
export function useAutomationMetadata(workspaceId: string | undefined, projectId: string) {
  return useQuery<AutomationMetadata>({
    queryKey: automationKeys.metadata(workspaceId ?? '', projectId),
    queryFn: () =>
      apiClient.get<AutomationMetadata>(`${base(workspaceId as string, projectId)}/metadata`),
    enabled: Boolean(workspaceId && projectId),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Asks the server whether what is on the canvas could be published.
 *
 * The builder also checks structure locally, so this is not on the keystroke
 * path — it answers the half only the server knows: whether the section still
 * exists, whether the member is still here.
 */
export function useValidateGraph(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ ruleId, name, nodes }: { ruleId: string; name: string; nodes: unknown[] }) =>
      apiClient.post<AutomationGraphValidation>(
        `${base(workspaceId as string, projectId)}/${ruleId}/validate`,
        { name, nodes },
      ),
    onError: (error) => reportError(error, 'Could not check this rule.'),
  });
}

/** Saves the canvas as a draft. Never publishes — that is a separate act. */
export function useSaveGraph(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ ruleId, name, nodes }: { ruleId: string; name: string; nodes: unknown[] }) =>
      apiClient.patch<unknown>(`${base(workspaceId as string, projectId)}/${ruleId}`, {
        name,
        nodes,
      }),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: automationKeys.graph(workspaceId as string, projectId, variables.ruleId),
        }),
        queryClient.invalidateQueries({
          queryKey: automationKeys.all(workspaceId as string, projectId),
        }),
      ]);
    },
    onError: (error) => reportError(error, 'Could not save this rule.'),
  });
}
