import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { asanaImportApi } from '../api/asana-import.api';
import { isRunActive } from '../lib/import-runs';

/** How often the page looks again while a run is going. */
const RUNNING_POLL_MS = 3_000;

/** Whether Asana is set up, who may import, and this workspace's runs — live while one runs. */
export function useAsanaImportStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.asanaImport.status(workspaceId ?? ''),
    queryFn: () => asanaImportApi.status(workspaceId as string),
    enabled: Boolean(workspaceId),
    refetchInterval: (query) => (isRunActive(query.state.data) ? RUNNING_POLL_MS : false),
  });
}

/**
 * Starts a run. The first one makes a new workspace, so the workspace list is
 * refreshed for the switcher to show it.
 */
export function useStartAsanaImport(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: () => asanaImportApi.start(workspaceId as string),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.asanaImport.status(workspaceId ?? ''),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.asanaImport.status(result.workspace.id),
        }),
      ]);
      toast.success(
        result.workspace.id === workspaceId
          ? 'Sync from Asana started'
          : `Importing into “${result.workspace.name}”`,
      );
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not start the import.'),
  });
}
