import type { Comment } from '@coretask/types';
import type { Prisma } from '@prisma/client';

export const commentInclude = {
  author: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.CommentInclude;

export type CommentWithAuthor = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

export function toCommentDto(comment: CommentWithAuthor): Comment {
  return {
    id: comment.id,
    workspaceId: comment.workspaceId,
    body: comment.body,
    authorId: comment.authorId,
    author: comment.author,
    taskId: comment.taskId,
    ticketId: comment.ticketId,
    editedAt: comment.editedAt?.toISOString() ?? null,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}
