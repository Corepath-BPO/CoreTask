import { ApiRoutes } from '@coretask/contracts';
import type {
  Comment,
  CreateCommentPayload,
  PaginationMeta,
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

export const commentsApi = {
  list: (
    workspaceId: string,
    parent: CommentParent,
    params: { page?: number; limit?: number } = {},
  ): Promise<{ items: Comment[]; meta: PaginationMeta }> =>
    apiClient.getPaginated<Comment>(threadUrl(workspaceId, parent), { params }),

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
};
