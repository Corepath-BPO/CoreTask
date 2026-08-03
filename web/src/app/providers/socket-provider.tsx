import { ServerEvent } from '@coretask/contracts';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { getAccessToken } from '@/lib/api/client';
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
