import { COMMENT_PAGE_LIMIT } from '@coretask/contracts';
import type { Comment, CreateCommentPayload } from '@coretask/types';
import { useInfiniteQuery, useMutation, type InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { commentsApi, type CommentPage, type CommentParent } from '../api/comments.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/**
 * Commenting writes an activity line and notifies the thread, so the feeds have
 * to move with it — otherwise the dashboard sits next to a conversation it
 * knows nothing about. The rows and cards carry a comment count, so they do too.
 */
async function invalidateThread(workspaceId: string, parent: CommentParent) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.comments.thread(workspaceId, parent.kind, parent.id),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: ['work-items', workspaceId] }),
  ]);
}

/**
 * A thread, latest window first, older pages behind "Show earlier comments".
 *
 * Pages are fetched *backwards*: the first request returns the newest fifty,
 * and each `fetchPreviousPage` asks for the ones before the earliest on
 * screen. The list is flattened oldest-first by the reader.
 */
export function useComments(workspaceId: string | undefined, parent: CommentParent | null) {
  return useInfiniteQuery({
    queryKey: queryKeys.comments.thread(workspaceId ?? '', parent?.kind ?? '', parent?.id ?? ''),
    queryFn: ({ pageParam }) =>
      commentsApi.list(workspaceId as string, parent as CommentParent, {
        limit: COMMENT_PAGE_LIMIT,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    // Older pages only. There is no "next" page: new comments arrive through
    // the socket and a refetch of the latest window.
    getNextPageParam: () => undefined,
    getPreviousPageParam: (firstPage) =>
      firstPage.meta.hasEarlier ? (firstPage.meta.earliestId ?? undefined) : undefined,
    enabled: Boolean(workspaceId) && Boolean(parent),
  });
}

/** Every loaded comment, oldest first, with the pinned one hoisted to the top. */
export function flattenComments(data: InfiniteData<CommentPage> | undefined): Comment[] {
  if (!data) return [];
  const seen = new Set<string>();
  const items: Comment[] = [];
  for (const page of data.pages) {
    for (const comment of page.items) {
      if (seen.has(comment.id)) continue;
      seen.add(comment.id);
      items.push(comment);
    }
  }
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pinned = items.findIndex((comment) => comment.pinnedAt !== null);
  if (pinned > 0) {
    const [row] = items.splice(pinned, 1);
    if (row) items.unshift(row);
  }
  return items;
}

export function useCreateComment(workspaceId: string | undefined, parent: CommentParent | null) {
  return useMutation({
    mutationFn: (payload: CreateCommentPayload) =>
      commentsApi.create(workspaceId as string, parent as CommentParent, payload),
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

/** Swaps one comment inside the cached pages, for an optimistic like. */
function patchCached(
  workspaceId: string,
  parent: CommentParent,
  commentId: string,
  patch: (comment: Comment) => Comment,
): InfiniteData<CommentPage> | undefined {
  const key = queryKeys.comments.thread(workspaceId, parent.kind, parent.id);
  const previous = queryClient.getQueryData<InfiniteData<CommentPage>>(key);
  if (!previous) return undefined;

  queryClient.setQueryData<InfiniteData<CommentPage>>(key, {
    ...previous,
    pages: previous.pages.map((page) => ({
      ...page,
      items: page.items.map((comment) => (comment.id === commentId ? patch(comment) : comment)),
    })),
  });

  return previous;
}

/**
 * A thumbs-up, applied to the screen before the server answers — a like that
 * takes a round trip to light up feels broken — and rolled back if it fails.
 */
export function useToggleCommentLike(
  workspaceId: string | undefined,
  parent: CommentParent | null,
  me: { id: string; name: string; email: string; avatarUrl: string | null } | null,
) {
  return useMutation({
    mutationFn: ({ commentId, liked }: { commentId: string; liked: boolean }) =>
      liked
        ? commentsApi.unlike(workspaceId as string, commentId)
        : commentsApi.like(workspaceId as string, commentId),
    onMutate: ({ commentId, liked }) =>
      patchCached(workspaceId as string, parent as CommentParent, commentId, (comment) => ({
        ...comment,
        likedByMe: !liked,
        likeCount: Math.max(0, comment.likeCount + (liked ? -1 : 1)),
        likedBy: liked
          ? comment.likedBy.filter((user) => user.id !== me?.id)
          : me
            ? [...comment.likedBy, me]
            : comment.likedBy,
      })),
    onError: (error, _variables, previous) => {
      if (previous) {
        queryClient.setQueryData(
          queryKeys.comments.thread(
            workspaceId as string,
            (parent as CommentParent).kind,
            (parent as CommentParent).id,
          ),
          previous,
        );
      }
      reportError(error, 'Could not save your like.');
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.comments.thread(
          workspaceId as string,
          (parent as CommentParent).kind,
          (parent as CommentParent).id,
        ),
      });
    },
  });
}

export function useToggleCommentPin(workspaceId: string | undefined, parent: CommentParent | null) {
  return useMutation({
    mutationFn: ({ commentId, pinned }: { commentId: string; pinned: boolean }) =>
      pinned
        ? commentsApi.unpin(workspaceId as string, commentId)
        : commentsApi.pin(workspaceId as string, commentId),
    onSuccess: async (_comment, { pinned }) => {
      await invalidateThread(workspaceId as string, parent as CommentParent);
      toast.success(pinned ? 'Comment unpinned' : 'Comment pinned');
    },
    onError: (error) => reportError(error, 'Could not pin the comment.'),
  });
}
