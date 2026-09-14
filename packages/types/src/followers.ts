import type { UserRef } from './work-items.js';

/**
 * One collaborator on a task or ticket — Asana's "Collaborators" row.
 *
 * Only the person and when they joined: how they came to follow (assigned,
 * commented, added by hand) is not kept, because Asana treats every follower
 * the same and re-adds anyone who leaves the next time they are involved.
 */
export interface Follower {
  user: UserRef;
  followedAt: string;
}

export interface AddFollowersPayload {
  userIds: string[];
}
