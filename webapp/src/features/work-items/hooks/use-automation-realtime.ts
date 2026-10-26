import { ServerEvent, type WorkItemEventPayload } from '@coretask/contracts';
import { useEffect } from 'react';

import { queryClient, queryKeys } from '@/lib/api/query-client';
import { getSocket } from '@/lib/socket/socket-client';

/**
 * Makes a rule's change to a task show up wherever the task is open.
 *
 * A rule runs in the worker, after the edit that triggered it, and its
 * broadcast is the only word any tab gets of what it did — a checklist added,
 * a team set, a comment left. That broadcast used to reach only the project's
 * room, so a task panel opened from My Tasks, the inbox or search kept the
 * fields and checklists from before the rule until something else refetched.
 * It now goes to everyone who may see the project, and this hears it on any
 * screen; it lives with the socket provider for that reason.
 *
 * The task's own caches are refreshed here, and only here: `useProjectRealtime`
 * hears the same event on the project's page and leaves them to this, so the
 * open panel is not fetched twice. Everything under `tasks` is invalidated —
 * the panel's detail and checklists, and My Tasks' rows — but only active
 * queries refetch, so a tab showing none of them pays nothing.
 */
export function useAutomationRealtime(workspaceId: string | undefined): void {
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !workspaceId) return;

    const onWorkItem = (payload: WorkItemEventPayload) => {
      if (payload?.source !== 'automation' || payload.workspaceId !== workspaceId) return;

      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) });
      // A rule may also have commented, added collaborators or written
      // history, none of which the task itself carries.
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.followers.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) });
    };

    const events = [
      ServerEvent.WORK_ITEM_CREATED,
      ServerEvent.WORK_ITEM_UPDATED,
      ServerEvent.WORK_ITEM_MOVED,
      ServerEvent.WORK_ITEM_DELETED,
    ];

    for (const event of events) socket.on(event, onWorkItem);

    return () => {
      for (const event of events) socket.off(event, onWorkItem);
    };
  }, [workspaceId]);
}
