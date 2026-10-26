import { ServerEvent } from '@coretask/contracts';
import { useEffect } from 'react';

import { queryClient, queryKeys } from '@/lib/api/query-client';
import { getSocket } from '@/lib/socket/socket-client';

/**
 * Keeps the Tickets page current while it is open.
 *
 * A ticket reported or changed elsewhere — by a teammate, or by a rule on the
 * worker — arrives as `ticket:created` / `ticket:updated` in the workspace
 * room, and the list is refetched rather than patched: its summary counts
 * (open, urgent, unassigned, overdue) come from the whole set. A reconnect
 * refetches too, since events sent while the socket was down are gone.
 */
export function useTicketsRealtime(workspaceId: string | undefined): void {
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !workspaceId) return;

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tickets.all(workspaceId) });
    };

    socket.on(ServerEvent.TICKET_CREATED, refresh);
    socket.on(ServerEvent.TICKET_UPDATED, refresh);
    socket.on('connect', refresh);

    return () => {
      socket.off(ServerEvent.TICKET_CREATED, refresh);
      socket.off(ServerEvent.TICKET_UPDATED, refresh);
      socket.off('connect', refresh);
    };
  }, [workspaceId]);
}
