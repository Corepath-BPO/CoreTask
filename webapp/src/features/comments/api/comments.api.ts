import { ApiRoutes } from '@coretask/contracts';
import type {
  Comment,
  CommentListMeta,
  CreateCommentPayload,
  UpdateCommentPayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

/** Which thread is being read or written to. */
export type CommentParent =
  | { kind: 'task'; id: string }
  /** `id` may be a UUID or a key such as `CORE-1001`. */
  | { kind: 'ticket'; id: string };

const threadUrl = (workspaceId: string, parent: CommentParent) =>
  parent.kind === 'task'
    ? ApiRoutes.comments.forTask(workspaceId, parent.id)
    : ApiRoutes.comments.forTicket(workspaceId, parent.id);

export interface CommentPage {
  items: Comment[];
  meta: CommentListMeta;
}

export const commentsApi = {
  /**
   * The latest window of a thread, or the one before `before`. Ids are
   * time-ordered, so the cursor is the earliest id already on screen.
   */
  list: (
    workspaceId: string,
    parent: CommentParent,
    params: { before?: string; limit?: number } = {},
  ): Promise<CommentPage> =>
    apiClient.getPaginated<Comment, CommentListMeta>(threadUrl(workspaceId, parent), { params }),

  create: (
    workspaceId: string,
    parent: CommentParent,
    payload: CreateCommentPayload,
  ): Promise<Comment> => apiClient.post<Comment>(threadUrl(workspaceId, parent), payload),

  update: (
    workspaceId: string,
    commentId: string,
    payload: UpdateCommentPayload,
  ): Promise<Comment> =>
    apiClient.patch<Comment>(ApiRoutes.comments.update(workspaceId, commentId), payload),

  remove: (workspaceId: string, commentId: string): Promise<{ deleted: boolean }> =>
    apiClient.delete<{ deleted: boolean }>(ApiRoutes.comments.remove(workspaceId, commentId)),

  like: (workspaceId: string, commentId: string): Promise<Comment> =>
    apiClient.post<Comment>(ApiRoutes.comments.like(workspaceId, commentId), {}),

  unlike: (workspaceId: string, commentId: string): Promise<Comment> =>
    apiClient.delete<Comment>(ApiRoutes.comments.like(workspaceId, commentId)),

  pin: (workspaceId: string, commentId: string): Promise<Comment> =>
    apiClient.post<Comment>(ApiRoutes.comments.pin(workspaceId, commentId), {}),

  unpin: (workspaceId: string, commentId: string): Promise<Comment> =>
    apiClient.delete<Comment>(ApiRoutes.comments.pin(workspaceId, commentId)),
};
