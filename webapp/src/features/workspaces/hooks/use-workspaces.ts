import type {
  CreateWorkspacePayload,
  UpdateWorkspacePayload,
  WorkspaceSummary,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';

import { queryClient, queryKeys } from '@/lib/api/query-client';
import { useIsAuthenticated } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

import { workspacesApi } from '../api/workspaces.api';

/** The user's workspaces. Only fetched once a session exists. */
export function useWorkspaces() {
  const isAuthenticated = useIsAuthenticated();

  return useQuery({
    queryKey: queryKeys.workspaces.list(),
    queryFn: () => workspacesApi.list(),
    enabled: isAuthenticated,
  });
}

/**
 * Resolves the active workspace, self-healing when the stored id is stale —
 * left workspace, deleted workspace, or a first-ever sign-in.
 */
export function useActiveWorkspace(): {
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  isLoading: boolean;
  select: (workspaceId: string) => void;
} {
  const { data, isLoading, isFetching } = useWorkspaces();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);

  const workspaces = useMemo(() => data ?? [], [data]);

  const workspace = useMemo(
    () =>
      workspaces.find((candidate) => candidate.id === activeWorkspaceId) ?? workspaces[0] ?? null,
    [workspaces, activeWorkspaceId],
  );

  useEffect(() => {
    // Only correct the stored id against a settled list. While a refetch is in
    // flight the cache can legitimately lack a workspace that already exists —
    // resetting here would clobber a selection made moments earlier, which is
    // exactly what happens right after creating one.
    if (isLoading || isFetching || workspaces.length === 0) return;

    const storedIsValid = workspaces.some((candidate) => candidate.id === activeWorkspaceId);

    if (!storedIsValid && workspace) {
      setActiveWorkspaceId(workspace.id);
    }
  }, [isLoading, isFetching, workspaces, workspace, activeWorkspaceId, setActiveWorkspaceId]);

  return { workspace, workspaces, isLoading, select: setActiveWorkspaceId };
}

export function useCreateWorkspace() {
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);

  return useMutation({
    mutationFn: (payload: CreateWorkspacePayload) => workspacesApi.create(payload),
    onSuccess: async (workspace) => {
      // Seed the cache before switching, so the new workspace is selectable in
      // the same tick rather than only after the refetch lands.
      queryClient.setQueryData<WorkspaceSummary[]>(queryKeys.workspaces.list(), (previous) =>
        previous ? [...previous, workspace] : [workspace],
      );
      setActiveWorkspaceId(workspace.id);

      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      toast.success(`Workspace "${workspace.name}" created`);
    },
  });
}

export function useUpdateWorkspace(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: UpdateWorkspacePayload) =>
      workspacesApi.update(workspaceId as string, payload),
    onSuccess: async (workspace) => {
      queryClient.setQueryData<WorkspaceSummary[]>(queryKeys.workspaces.list(), (previous) =>
        previous?.map((candidate) => (candidate.id === workspace.id ? workspace : candidate)),
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      toast.success('Workspace settings saved');
    },
    onError: () => toast.error('Could not save workspace settings.'),
  });
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workspaces.members(workspaceId ?? ''),
    queryFn: () => workspacesApi.members(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}
