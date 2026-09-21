import type { Attachment } from '@coretask/types';
import { Download, FileText } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { AttachmentLightbox } from '@/features/attachments/components/attachment-lightbox';
import { AttachmentThumbnail } from '@/features/attachments/components/attachment-thumbnail';
import { useDownloadAttachment } from '@/features/attachments/hooks/use-attachments';
import { formatBytes } from '@/features/attachments/lib/format-bytes';
import { isImage } from '@/features/attachments/lib/is-image';

interface CommentAttachmentsProps {
  workspaceId: string | undefined;
  attachments: Attachment[];
}

/**
 * The files posted with one comment, as Asana shows them under the words:
 * pictures as small tiles that open the viewer, anything else as a chip with
 * a download. The same files are still in the panel's strip above — they
 * belong to the item — this is just where they were said.
 */
export function CommentAttachments({ workspaceId, attachments }: CommentAttachmentsProps) {
  const download = useDownloadAttachment(workspaceId);
  const [open, setOpen] = useState<number | null>(null);

  if (attachments.length === 0) return null;

  const pictures = attachments.filter(isImage);
  const files = attachments.filter((attachment) => !isImage(attachment));

  return (
    <div className="mt-2 space-y-2" aria-label="Attached to this comment">
      {pictures.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {pictures.map((attachment, index) => (
            <li key={attachment.id}>
              <AttachmentThumbnail
                workspaceId={workspaceId}
                attachment={attachment}
                onOpen={() => setOpen(index)}
                className="size-24"
              />
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-1.5 rounded-md border bg-muted/40 py-1 pl-2 pr-1 text-xs"
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="max-w-48 truncate">{attachment.filename}</span>
              <span className="text-muted-foreground">{formatBytes(attachment.sizeBytes)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Download ${attachment.filename}`}
                disabled={download.isPending}
                onClick={() => download.mutate(attachment.id)}
              >
                <Download className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AttachmentLightbox
        workspaceId={workspaceId}
        images={pictures}
        index={open}
        onIndexChange={setOpen}
      />
    </div>
  );
}
