import { COMMENT_PAGE_LIMIT } from '@coretask/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { commentsApi, type CommentParent } from '../api/comments.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * Commenting writes an activity line and notifies the thread, so the feeds have
 * to move with it — otherwise the dashboard sits next to a conversation it
 * knows nothing about.
 */
async function invalidateThread(workspaceId: string, parent: CommentParent) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.comments.thread(workspaceId, parent.kind, parent.id),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(workspaceId) }),
  ]);
}

export function useComments(workspaceId: string | undefined, parent: CommentParent | null) {
  return useQuery({
    queryKey: queryKeys.comments.thread(workspaceId ?? '', parent?.kind ?? '', parent?.id ?? ''),
    queryFn: () =>
      commentsApi.list(workspaceId as string, parent as CommentParent, {
        limit: COMMENT_PAGE_LIMIT,
      }),
    enabled: Boolean(workspaceId) && Boolean(parent),
  });
}

export function useCreateComment(workspaceId: string | undefined, parent: CommentParent | null) {
  return useMutation({
    mutationFn: (body: string) =>
      commentsApi.create(workspaceId as string, parent as CommentParent, { body }),
    onSuccess: async () => {
      await invalidateThread(workspaceId as string, parent as CommentParent);
    },
    onError: (error) => reportError(error, 'Could not post the comment.'),
  });
}

export function useUpdateComment(workspaceId: string | undefined, parent: CommentParent | null) {
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      commentsApi.update(workspaceId as string, commentId, { body }),
    onSuccess: async () => {
      await invalidateThread(workspaceId as string, parent as CommentParent);
    },
    onError: (error) => reportError(error, 'Could not save the comment.'),
  });
}

export function useDeleteComment(workspaceId: string | undefined, parent: CommentParent | null) {
  return useMutation({
    mutationFn: (commentId: string) => commentsApi.remove(workspaceId as string, commentId),
    onSuccess: async () => {
      await invalidateThread(workspaceId as string, parent as CommentParent);
      toast.success('Comment deleted');
    },
    onError: (error) => reportError(error, 'Could not delete the comment.'),
  });
}
