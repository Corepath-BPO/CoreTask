import { ServerEvent } from '@coretask/contracts';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { getAccessToken } from '@/lib/api/client';
import { queryClient } from '@/lib/api/query-client';
import {
  connectSocket,
  disconnectSocket,
  joinWorkspaceRoom,
  leaveWorkspaceRoom,
} from '@/lib/socket/socket-client';
import { useIsAuthenticated } from '@/stores/auth.store';

interface NotificationPayload {
  id: string;
  title: string;
  body: string | null;
}

/**
 * Owns the realtime connection for the authenticated part of the app.
 *
 * Renders nothing — it exists so socket lifetime is tied to the session, and so
 * no component has to remember to disconnect.
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useIsAuthenticated();
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      return;
    }

    const socket = connectSocket(getAccessToken);

    const onNotification = (payload: NotificationPayload) => {
      toast(payload.title, { description: payload.body ?? undefined });

      /*
       * A toast is not the inbox. Without this the bell badge and an open Inbox
       * page keep showing the count from the last fetch, and the notification
       * that just arrived is nowhere except a toast that disappears.
       *
       * Invalidated by the bare prefix, which covers every workspace's key and
       * both the dropdown's and the inbox's. That is not as broad as it looks:
       * TanStack refetches only *active* queries, so this touches what is on
       * screen and nothing else.
       *
       * Safe against the refetch loop that caused the earlier 429 storm,
       * because this fires on a socket event rather than on render — no amount
       * of re-rendering can trigger it.
       */
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };

    socket.on(ServerEvent.NOTIFICATION_CREATED, onNotification);

    return () => {
      socket.off(ServerEvent.NOTIFICATION_CREATED, onNotification);
    };
  }, [isAuthenticated]);

  // Room membership follows the workspace switcher.
  useEffect(() => {
    if (!isAuthenticated || !workspaceId) return;

    joinWorkspaceRoom(workspaceId);
    return () => leaveWorkspaceRoom(workspaceId);
  }, [isAuthenticated, workspaceId]);

  // Tear the connection down when the whole app unmounts.
  useEffect(() => disconnectSocket, []);

  return <>{children}</>;
}
