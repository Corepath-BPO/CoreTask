import { ServerEvent } from '@coretask/contracts';
import { useEffect, useState } from 'react';

import { queryClient, queryKeys } from '@/lib/api/query-client';
import { getSocket } from '@/lib/socket/socket-client';

import type { CommentParent } from '../api/comments.api';

interface ItemEvent {
  taskId?: string | null;
  ticketId?: string | null;
  entityId?: string;
}

/**
 * Keeps an open thread in step with everyone else's.
 *
 * The server has emitted `comment:*` events since threads existed, but
 * nothing on the client ever listened, so a reply from the other browser sat
 * unseen until something else refetched. This subscribes for the life of the
 * panel and invalidates — never patches — because the feed interleaves
 * comments with stories and one payload cannot rebuild that.
 *
 * Returns when the last comment arrived, so the thread can scroll to it.
 */
export function useThreadRealtime(
  workspaceId: string | undefined,
  parent: CommentParent | null,
): { lastCommentAt: number | null } {
  const [lastCommentAt, setLastCommentAt] = useState<number | null>(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !workspaceId || !parent) return;

    const mine = (event: ItemEvent) =>
      parent.kind === 'task'
        ? event.taskId === parent.id || event.entityId === parent.id
        : event.ticketId === parent.id || event.entityId === parent.id;

    const refreshThread = (event: ItemEvent) => {
      if (!mine(event)) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.comments.thread(workspaceId, parent.kind, parent.id),
      });
      // Counts on the rows and cards moved with it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: ['work-items', workspaceId] });
    };

    const onCommentCreated = (event: ItemEvent) => {
      if (!mine(event)) return;
      refreshThread(event);
      setLastCommentAt(Date.now());
    };

    const onActivity = (event: ItemEvent) => {
      if (!mine(event)) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.activity.item(workspaceId, parent.kind, parent.id),
      });
    };

    const onFollowers = (event: ItemEvent) => {
      if (!mine(event)) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.followers.forParent(workspaceId, parent.kind, parent.id),
      });
    };

    socket.on(ServerEvent.COMMENT_CREATED, onCommentCreated);
    socket.on(ServerEvent.COMMENT_UPDATED, refreshThread);
    socket.on(ServerEvent.COMMENT_DELETED, refreshThread);
    socket.on(ServerEvent.ACTIVITY_RECORDED, onActivity);
    socket.on(ServerEvent.FOLLOWERS_CHANGED, onFollowers);

    return () => {
      socket.off(ServerEvent.COMMENT_CREATED, onCommentCreated);
      socket.off(ServerEvent.COMMENT_UPDATED, refreshThread);
      socket.off(ServerEvent.COMMENT_DELETED, refreshThread);
      socket.off(ServerEvent.ACTIVITY_RECORDED, onActivity);
      socket.off(ServerEvent.FOLLOWERS_CHANGED, onFollowers);
    };
  }, [workspaceId, parent?.kind, parent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { lastCommentAt };
}
