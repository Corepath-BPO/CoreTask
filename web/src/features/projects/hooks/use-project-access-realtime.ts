import { ServerEvent } from '@coretask/contracts';
import type { ProjectDetail } from '@coretask/types';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { queryClient, queryKeys } from '@/lib/api/query-client';
import { getSocket, leaveProjectRoom } from '@/lib/socket/socket-client';

interface AccessPayload {
  workspaceId: string;
  projectId: string;
}

/**
 * Reacts to a project appearing for, or disappearing from, the signed-in
 * person — added to or removed from a private project, or its privacy
 * flipped. Both arrive on the user's own room, so this lives with the socket
 * provider rather than on a project page.
 *
 * Revocation is the one that needs care: the project's detail, work items and
 * views are *removed* from the cache, not invalidated — a refetch would just
 * 404 — and a tab sitting on that project is sent back to the browse page
 * with a word about why. The room is left too; the server already evicted the
 * socket, but a client that thinks it is still in should not try to stay.
 */
export function useProjectAccessRealtime(workspaceId: string | undefined): void {
  const router = useRouter();
  const navigate = useNavigate();

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !workspaceId) return;

    const onGranted = (payload: AccessPayload) => {
      if (payload.workspaceId !== workspaceId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) });
    };

    const onRevoked = (payload: AccessPayload) => {
      if (payload.workspaceId !== workspaceId) return;
      const { projectId } = payload;

      const name =
        queryClient.getQueryData<ProjectDetail>(queryKeys.projects.detail(workspaceId, projectId))
          ?.name ?? 'this project';

      queryClient.removeQueries({ queryKey: queryKeys.projects.detail(workspaceId, projectId) });
      queryClient.removeQueries({ queryKey: queryKeys.projects.members(workspaceId, projectId) });
      queryClient.removeQueries({ queryKey: queryKeys.workItems.all(workspaceId, projectId) });
      queryClient.removeQueries({ queryKey: queryKeys.projectViews.all(workspaceId, projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) });
      leaveProjectRoom(projectId);

      // Read at event time, so this effect does not re-subscribe on every navigation.
      if (router.state.location.pathname.startsWith(`/projects/${projectId}`)) {
        toast(`You no longer have access to ${name}`);
        void navigate({ to: '/projects' });
      }
    };

    socket.on(ServerEvent.PROJECT_ACCESS_GRANTED, onGranted);
    socket.on(ServerEvent.PROJECT_ACCESS_REVOKED, onRevoked);

    return () => {
      socket.off(ServerEvent.PROJECT_ACCESS_GRANTED, onGranted);
      socket.off(ServerEvent.PROJECT_ACCESS_REVOKED, onRevoked);
    };
  }, [workspaceId, router, navigate]);
}
