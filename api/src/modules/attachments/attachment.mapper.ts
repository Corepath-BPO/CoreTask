import type { Attachment } from '@coretask/types';
import type { Prisma } from '@prisma/client';

/**
 * Shared by the attachments module and the comments module, which lists a
 * comment's files inline. One include and one mapper, so a file reads the
 * same in the panel's strip and under the comment that posted it.
 */
export const attachmentInclude = {
  uploader: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.AttachmentInclude;

export type AttachmentWithUploader = Prisma.AttachmentGetPayload<{
  include: typeof attachmentInclude;
}>;

export function toAttachmentDto(attachment: AttachmentWithUploader): Attachment {
  return {
    id: attachment.id,
    workspaceId: attachment.workspaceId,
    taskId: attachment.taskId,
    ticketId: attachment.ticketId,
    commentId: attachment.commentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    status: attachment.status,
    uploadedBy: attachment.uploader,
    createdAt: attachment.createdAt.toISOString(),
  };
}
