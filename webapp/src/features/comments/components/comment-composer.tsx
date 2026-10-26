import { ALLOWED_UPLOAD_MIME_TYPES, MAX_ATTACHMENTS_PER_COMMENT } from '@coretask/contracts';
import type { Attachment, WorkspaceMember } from '@coretask/types';
import type { Editor } from '@tiptap/react';
import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { toast } from 'sonner';

import { RichTextEditor } from '@/components/forms/rich-text-editor';
import type { AttachmentParent } from '@/features/attachments/api/attachments.api';
import { useDeleteAttachment } from '@/features/attachments/hooks/use-attachments';
import { useAttachFiles } from '@/features/attachments/hooks/use-paste-to-attach';
import { insertAttachmentImage } from '@/components/forms/extensions/attachment-image';
import { cn } from '@/lib/utils';

/** What the thread reaches for: focus from the Tab+C chord, clear after a post. */
export interface CommentComposerHandle {
  focus(): void;
  /** Empties the text and forgets the pending files (they stay on the item). */
  clear(): void;
}

interface CommentComposerProps {
  workspaceId: string | undefined;
  /** The item the files go to. Null while the panel has nothing to show. */
  parent: AttachmentParent | null;
  /** Stored HTML when editing; nothing when composing. */
  initialValue?: string | null;
  /** Fired on every edit with the HTML, or `null` when empty. */
  onChange: (html: string | null) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmit: () => void;
  /** The files uploaded through this box, as they stand. */
  onAttachmentsChange?: ((attachments: Attachment[]) => void) | undefined;
  members: WorkspaceMember[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** Editing an existing comment: no paperclip, the files already belong to it. */
  canAttach?: boolean;
  autoFocus?: boolean;
  ref?: Ref<CommentComposerHandle> | undefined;
}

/**
 * The comment box: the description's editor in a shorter frame, with the
 * paperclip Asana puts beside the formatting tools. A picture pasted or
 * picked lands inline; any file lands in a strip under the text and is posted
 * with the comment. The buttons live in the thread, which owns the draft.
 */
export function CommentComposer({
  workspaceId,
  parent,
  initialValue,
  onChange,
  onSubmit,
  onAttachmentsChange,
  members,
  label,
  placeholder,
  disabled = false,
  canAttach = true,
  autoFocus = false,
  ref,
}: CommentComposerProps) {
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Attachment[]>([]);

  const attachFiles = useAttachFiles(workspaceId, parent, canAttach && !disabled);
  const removeAttachment = useDeleteAttachment(workspaceId, parent);

  const mentionables = members.map((member) => ({
    id: member.user.id,
    name: member.user.name,
    email: member.user.email,
    avatarUrl: member.user.avatarUrl,
  }));

  const rememberPending = (attachment: Attachment) => {
    setPending((current) => {
      if (current.some((row) => row.id === attachment.id)) return current;
      const next = [...current, attachment];
      onAttachmentsChange?.(next);
      return next;
    });
  };

  const forget = (attachment: Attachment) => {
    setPending((current) => {
      const next = current.filter((row) => row.id !== attachment.id);
      onAttachmentsChange?.(next);
      return next;
    });
  };

  const takeFiles = (files: File[], insertImage?: (attachment: Attachment) => void) => {
    if (pending.length + files.length > MAX_ATTACHMENTS_PER_COMMENT) {
      toast.error(`Only ${MAX_ATTACHMENTS_PER_COMMENT} files can go with one comment.`);
      return;
    }
    attachFiles(files, insertImage, rememberPending);
  };

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.commands.focus('end'),
    clear: () => {
      editorRef.current?.commands.clearContent(true);
      setPending([]);
      onAttachmentsChange?.([]);
    },
  }));

  return (
    <div className="space-y-2">
      <RichTextEditor
        initialValue={initialValue ?? ''}
        editorRef={editorRef}
        onChange={onChange}
        onSubmit={onSubmit}
        workspaceId={workspaceId}
        mentionables={mentionables}
        placeholder={placeholder ?? 'Ask a question or post an update…'}
        ariaLabel={label}
        editable={!disabled}
        toolbar="always"
        minHeightClassName="min-h-[3rem]"
        autoFocus={autoFocus}
        className="mx-0 border-input bg-card"
        onFiles={
          canAttach
            ? (files, insertImage) =>
                takeFiles(files, (attachment) =>
                  insertImage({ attachmentId: attachment.id, alt: attachment.filename }),
                )
            : undefined
        }
        toolbarExtras={
          canAttach ? (
            <>
              <button
                type="button"
                aria-label="Attach a file"
                title="Attach a file"
                onClick={() => fileInputRef.current?.click()}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:size-4"
              >
                <Paperclip />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_UPLOAD_MIME_TYPES.join(',')}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = '';
                  if (files.length === 0) return;
                  // Picked with the clip rather than pasted: files, not
                  // pictures in the text — even an image goes to the strip.
                  takeFiles(files, (attachment) => {
                    if (editorRef.current) {
                      insertAttachmentImage(editorRef.current, {
                        attachmentId: attachment.id,
                        alt: attachment.filename,
                      });
                    }
                  });
                }}
              />
            </>
          ) : undefined
        }
      />

      {pending.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Files to post with this comment">
          {pending.map((attachment) => (
            <li
              key={attachment.id}
              className={cn(
                'flex items-center gap-1.5 rounded-md border bg-muted/40 py-1 pl-2 pr-1 text-xs',
              )}
            >
              {attachment.mimeType.startsWith('image/') ? (
                <ImageIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              ) : (
                <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="max-w-40 truncate">{attachment.filename}</span>
              <button
                type="button"
                aria-label={`Remove ${attachment.filename}`}
                disabled={removeAttachment.isPending}
                onClick={() =>
                  removeAttachment.mutate(attachment.id, { onSuccess: () => forget(attachment) })
                }
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
