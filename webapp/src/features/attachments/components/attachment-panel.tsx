import { ALLOWED_UPLOAD_MIME_TYPES, MAX_ATTACHMENTS_PER_ITEM } from '@coretask/contracts';
import type { Attachment } from '@coretask/types';
import { Download, MessageSquare, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/stores/auth.store';

import type { AttachmentParent } from '../api/attachments.api';
import {
  useAttachments,
  useDeleteAttachment,
  useDownloadAttachment,
  useUploadAttachment,
} from '../hooks/use-attachments';
import { MAX_FILE_SIZE_MB, acceptUpload } from '../lib/accept-upload';
import { formatBytes } from '../lib/format-bytes';
import { isImage } from '../lib/is-image';

import { AttachmentLightbox } from './attachment-lightbox';
import { AttachmentThumbnail } from './attachment-thumbnail';

interface AttachmentPanelProps {
  workspaceId: string | undefined;
  parent: AttachmentParent | null;
  /** Managers may remove anyone's file; everyone else only their own. */
  canManageAny: boolean;
}

/**
 * Asana's attachment strip: a row of cards, a picture on each that is one,
 * the name and size underneath, a viewer behind every picture. Files posted
 * with a comment are here too — they belong to the item — and say so.
 */
export function AttachmentPanel({ workspaceId, parent, canManageAny }: AttachmentPanelProps) {
  const currentUser = useCurrentUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const { data: attachments, isLoading } = useAttachments(workspaceId, parent);
  const upload = useUploadAttachment(workspaceId, parent);
  const download = useDownloadAttachment(workspaceId);
  const remove = useDeleteAttachment(workspaceId, parent);

  const files = attachments ?? [];
  const pictures = files.filter(isImage);
  const full = files.length >= MAX_ATTACHMENTS_PER_ITEM;

  const send = (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    if (chosen.length === 0) return;

    if (full) {
      toast.error(`Only ${MAX_ATTACHMENTS_PER_ITEM} attachments are allowed here.`);
      return;
    }

    // One at a time, so the progress bar means something and a rejected file
    // does not take the rest of the selection down with it.
    for (const file of chosen) {
      if (!acceptUpload(file)) continue;

      upload.mutate(
        { file, onProgress: setProgress },
        {
          onSuccess: () => toast.success(`${file.name} attached.`),
          onSettled: () => setProgress(null),
        },
      );
    }
  };

  const busy = upload.isPending;

  return (
    <section aria-labelledby="attachments-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3
          id="attachments-heading"
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <Paperclip className="size-4" aria-hidden="true" />
          Attachments
          {files.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({files.length})</span>
          )}
        </h3>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          send(event.dataTransfer.files);
        }}
        className={cn(
          'rounded-lg border border-dashed p-4 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-input',
          (busy || full) && 'opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          accept={ALLOWED_UPLOAD_MIME_TYPES.join(',')}
          onChange={(event) => {
            send(event.target.files);
            // Cleared so picking the same file twice in a row still fires.
            event.target.value = '';
          }}
        />

        <Upload className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          Drop a file here, or{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-sm"
            disabled={busy || full}
            onClick={() => inputRef.current?.click()}
          >
            browse
          </Button>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Up to {MAX_FILE_SIZE_MB} MB each.</p>

        {progress !== null && (
          <div className="mt-3 space-y-1">
            <Progress value={Math.round(progress * 100)} />
            <p className="text-xs text-muted-foreground">
              Uploading… {Math.round(progress * 100)}%
            </p>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex gap-3">
          <Skeleton className="h-36 w-40" />
          <Skeleton className="h-36 w-40" />
        </div>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing attached yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {files.map((file) => {
            const mine = file.uploadedBy?.id === currentUser?.id;
            const pictureIndex = pictures.findIndex((picture) => picture.id === file.id);

            return (
              <li
                key={file.id}
                aria-label={`Attachment ${file.filename}`}
                className="group/card flex w-40 flex-col overflow-hidden rounded-lg border border-border bg-card"
              >
                <AttachmentThumbnail
                  workspaceId={workspaceId}
                  attachment={file}
                  onOpen={pictureIndex >= 0 ? () => setOpen(pictureIndex) : undefined}
                  className="h-24 w-full rounded-none border-0 border-b"
                />

                <div className="min-w-0 space-y-0.5 p-2">
                  <p className="truncate text-xs font-medium text-foreground" title={file.filename}>
                    {file.filename}
                  </p>
                  <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                    {formatBytes(file.sizeBytes)}
                    {file.uploadedBy ? ` · ${file.uploadedBy.name}` : ''}
                    {file.commentId && (
                      <MessageSquare
                        className="size-3 shrink-0"
                        aria-label="Posted with a comment"
                      />
                    )}
                  </p>
                </div>

                <div className="mt-auto flex items-center justify-end gap-0.5 border-t px-1 py-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    aria-label={`Download ${file.filename}`}
                    disabled={download.isPending}
                    onClick={() => download.mutate(file.id)}
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                  </Button>

                  {(mine || canManageAny) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      aria-label={`Remove ${file.filename}`}
                      onClick={() => setPendingDelete(file)}
                    >
                      <Trash2 className="size-3.5 text-destructive" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AttachmentLightbox
        workspaceId={workspaceId}
        images={pictures}
        index={open}
        onIndexChange={setOpen}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this attachment?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.filename}” is deleted from storage as well, so this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) remove.mutate(pendingDelete.id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
