import { ServerEvent, type WorkItemEventPayload } from '@coretask/contracts';
import { useEffect } from 'react';

import { queryClient, queryKeys } from '@/lib/api/query-client';
import { getSocket, joinProjectRoom, leaveProjectRoom } from '@/lib/socket/socket-client';

import { isOwnChange } from '../lib/correlation';

/**
 * Makes somebody else's change show up without a refresh.
 *
 * The socket has been connected since the app shell was built, and the server
 * has been emitting task and ticket events all along — but nothing on the
 * client ever listened, so "real-time" meant "real-time for the person who did
 * it". Two people on the same board saw different projects until one of them
 * reloaded.
 *
 * Scoped to a project room rather than the workspace: a tab looking at one
 * project should not do work every time a different one changes.
 *
 * Events carrying this client's own correlation id are ignored. The mutation
 * already updated the cache; refetching on the echo would make every edit cost
 * two requests and flicker the grid between the two answers.
 */
export function useProjectRealtime(workspaceId: string | undefined, projectId: string): void {
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !workspaceId || !projectId) return;

    const refresh = () => {
      /*
       * Invalidated, not patched.
       *
       * The payload carries the item, and writing it straight into the cache
       * would be faster — but the List and Board also show counts, section
       * rollups and a progress bar derived from the whole set, and none of
       * those can be recomputed from one row. Refetching is the honest answer
       * to "something over there changed".
       */
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workItems.all(workspaceId, projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectViews.all(workspaceId, projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) });
    };

    /*
     * Joined on every connect, not once on mount.
     *
     * Two reasons, and the second is the one that bites. A socket.io room is
     * per-connection: a reconnect after a dropped network silently leaves every
     * room, and a tab that joined once would go quiet for the rest of its life
     * while looking perfectly healthy. And on a cold load the socket may still
     * be connecting when this mounts, so joining only here would miss it
     * entirely.
     *
     * Rejoining an already-joined room is a no-op server-side, so the duplicate
     * on a normal mount costs nothing.
     */
    const join = () => joinProjectRoom(projectId);

    /*
     * A reconnect also refetches. Events that arrived while the socket was down
     * are gone for good, so the cache is of unknown age — rejoining the room
     * only restores *future* events.
     */
    const rejoin = () => {
      join();
      refresh();
    };

    join();
    socket.on('connect', rejoin);

    const onWorkItem = (payload: WorkItemEventPayload) => {
      // Guarded on the project too: the room is scoped, but a socket that has
      // joined several is one broadcast away from refetching the wrong one.
      if (payload.projectId !== projectId) return;
      if (isOwnChange(payload.correlationId)) return;

      refresh();
    };

    /*
     * Sections come over the *workspace* room, because they predate the project
     * room and other screens listen for them. Filtering by project here is what
     * keeps a section added elsewhere from refetching this one.
     */
    const onSection = (payload: { projectId?: string }) => {
      if (payload?.projectId !== projectId) return;

      refresh();
    };

    const workItemEvents = [
      ServerEvent.WORK_ITEM_CREATED,
      ServerEvent.WORK_ITEM_UPDATED,
      ServerEvent.WORK_ITEM_MOVED,
      ServerEvent.WORK_ITEM_DELETED,
    ];

    const sectionEvents = [
      ServerEvent.SECTION_CREATED,
      ServerEvent.SECTION_UPDATED,
      ServerEvent.SECTION_DELETED,
      ServerEvent.SECTION_MOVED,
    ];

    for (const event of workItemEvents) socket.on(event, onWorkItem);
    for (const event of sectionEvents) socket.on(event, onSection);

    return () => {
      socket.off('connect', rejoin);
      for (const event of workItemEvents) socket.off(event, onWorkItem);
      for (const event of sectionEvents) socket.off(event, onSection);

      // Left on unmount so a tab that navigates away stops being woken by a
      // project it is no longer showing.
      leaveProjectRoom(projectId);
    };
  }, [workspaceId, projectId]);
}
