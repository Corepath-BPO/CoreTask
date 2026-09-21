import { ApiRoutes } from '@coretask/contracts';
import type { AddFollowersPayload, Follower } from '@coretask/types';

import { apiClient } from '@/lib/api/client';

/** Which item's collaborators are being read or changed. */
export type FollowerParent =
  | { kind: 'task'; id: string }
  /** `id` may be a UUID or a key such as `CORE-1001`. */
  | { kind: 'ticket'; id: string };

const listUrl = (workspaceId: string, parent: FollowerParent) =>
  parent.kind === 'task'
    ? ApiRoutes.followers.forTask(workspaceId, parent.id)
    : ApiRoutes.followers.forTicket(workspaceId, parent.id);

const removeUrl = (workspaceId: string, parent: FollowerParent, userId: string) =>
  parent.kind === 'task'
    ? ApiRoutes.followers.removeFromTask(workspaceId, parent.id, userId)
    : ApiRoutes.followers.removeFromTicket(workspaceId, parent.id, userId);

export const followersApi = {
  list: (workspaceId: string, parent: FollowerParent): Promise<Follower[]> =>
    apiClient.get<Follower[]>(listUrl(workspaceId, parent)),

  add: (
    workspaceId: string,
    parent: FollowerParent,
    payload: AddFollowersPayload,
  ): Promise<Follower[]> => apiClient.post<Follower[]>(listUrl(workspaceId, parent), payload),

  remove: (workspaceId: string, parent: FollowerParent, userId: string): Promise<Follower[]> =>
    apiClient.delete<Follower[]>(removeUrl(workspaceId, parent, userId)),
};
