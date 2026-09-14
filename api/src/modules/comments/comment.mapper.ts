import { COMMENT_LIKERS_PREVIEW } from '@coretask/contracts';
import type { Comment } from '@coretask/types';
import type { Prisma } from '@prisma/client';

import { commentBodyToHtml } from '../../common/utils/rich-text.util';
import { attachmentInclude, toAttachmentDto } from '../attachments/attachment.mapper';

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true, isServiceAccount: true } as const;

export const commentInclude = {
  author: { select: USER_SELECT },
  pinnedBy: { select: USER_SELECT },
  mentions: { select: { user: { select: USER_SELECT } } },
  // Only confirmed files, in the order they were added, as the panel lists them.
  attachments: {
    where: { status: 'READY' as const },
    include: attachmentInclude,
    orderBy: { createdAt: 'asc' as const },
  },
  // The whole list, not a preview: a like list on an internal tool is a
  // handful of rows, and the viewer's own like has to be found in it.
  likes: {
    select: { userId: true, user: { select: USER_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.CommentInclude;

export type CommentWithAuthor = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

/**
 * `viewerId` decides `likedByMe`. Socket payloads pass `null` and clients treat
 * them as "refetch", never as a cache write, so nobody sees another reader's
 * like as their own.
 */
export function toCommentDto(comment: CommentWithAuthor, viewerId: string | null): Comment {
  return {
    id: comment.id,
    workspaceId: comment.workspaceId,
    // Rows from before comments were rich text convert here, on the way out.
    body: commentBodyToHtml(comment.body),
    authorId: comment.authorId,
    author: comment.author,
    taskId: comment.taskId,
    ticketId: comment.ticketId,
    editedAt: comment.editedAt?.toISOString() ?? null,
    mentions: comment.mentions.map((mention) => mention.user),
    attachments: comment.attachments.map(toAttachmentDto),
    likeCount: comment.likes.length,
    likedByMe: viewerId !== null && comment.likes.some((like) => like.userId === viewerId),
    likedBy: comment.likes.slice(0, COMMENT_LIKERS_PREVIEW).map((like) => like.user),
    pinnedAt: comment.pinnedAt?.toISOString() ?? null,
    pinnedBy: comment.pinnedBy,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}
