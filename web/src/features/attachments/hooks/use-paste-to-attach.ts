import { INLINE_IMAGE_MIME_TYPES, MAX_ATTACHMENTS_PER_ITEM } from '@coretask/contracts';
import type { Attachment } from '@coretask/types';
import type { ClipboardEvent } from 'react';
import { toast } from 'sonner';

import type { AttachmentParent } from '../api/attachments.api';
import { acceptUpload } from '../lib/accept-upload';
import { useAttachments, useUploadAttachment } from './use-attachments';

/**
 * Files handed to an item from a paste, a drop or a picker.
 *
 * Every file becomes an attachment under the same rules as the drop zone. When
 * the caller can show pictures in place — the description editor — a raster
 * image is handed back to it once uploaded, instead of the "added to
 * attachments" pointer, so the screenshot lands where it was pasted.
 */
export function useAttachFiles(
  workspaceId: string | undefined,
  parent: AttachmentParent | null,
  enabled = true,
): (
  files: File[],
  onImage?: (attachment: Attachment) => void,
  onAttached?: (attachment: Attachment) => void,
) => void {
  // Already cached by the AttachmentPanel in the same dialog, so this is free.
  const { data: attachments } = useAttachments(workspaceId, parent);
  const upload = useUploadAttachment(workspaceId, parent);

  return (files, onImage, onAttached) => {
    if (!enabled || files.length === 0) return;

    if ((attachments?.length ?? 0) >= MAX_ATTACHMENTS_PER_ITEM) {
      toast.error(`Only ${MAX_ATTACHMENTS_PER_ITEM} attachments are allowed here.`);
      return;
    }

    for (const file of files) {
      if (!acceptUpload(file)) continue;

      const inline = onImage !== undefined && INLINE_IMAGE_MIME_TYPES.includes(file.type);

      upload.mutate(
        { file },
        {
          onSuccess: (attachment) => {
            // Every upload, picture or not: a comment composer keeps the list
            // of what was posted with it.
            onAttached?.(attachment);
            if (inline) {
              onImage(attachment);
              return;
            }
            if (onAttached) return;
            // Named as a destination: the file does not appear where the caret
            // is, and without the pointer people go looking for it in the text.
            toast.success(`${file.name} added to attachments.`);
          },
        },
      );
    }
  };
}

/**
 * Pasting a screenshot into a text field is how most people try to put an
 * image on a task, and a plain field has nowhere to hold one — the paste just
 * vanished. This routes the clipboard's files into the item's attachments.
 *
 * A paste that carries no files is left entirely alone, so pasting text
 * behaves exactly as it always did.
 */
export function usePasteToAttach(
  workspaceId: string | undefined,
  parent: AttachmentParent | null,
  enabled = true,
): (event: ClipboardEvent<HTMLElement>) => void {
  const attach = useAttachFiles(workspaceId, parent, enabled);

  return (event) => {
    if (!enabled) return;

    const files = [...event.clipboardData.files];
    if (files.length === 0) return;

    event.preventDefault();
    attach(files);
  };
}
