import type { Attachment } from '@coretask/types';
import { ChevronLeft, ChevronRight, Download, ImageOff } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

import { useAttachmentViewUrl } from '../hooks/use-attachment-view-url';
import { useDownloadAttachment } from '../hooks/use-attachments';
import { formatBytes } from '../lib/format-bytes';

interface AttachmentLightboxProps {
  workspaceId: string | undefined;
  /** The pictures the arrows move through, in strip order. */
  images: Attachment[];
  /** Which one is open; null closes the lightbox. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

/**
 * Asana's full-size viewer: one picture at a time, arrows and ←/→ to move
 * along the strip, the filename underneath, a download button, Escape to
 * close. The picture's URL is fetched on the way in, like every other view of
 * an attachment, so an expired link is refreshed rather than shown broken.
 */
export function AttachmentLightbox({
  workspaceId,
  images,
  index,
  onIndexChange,
}: AttachmentLightboxProps) {
  const open = index !== null && images.length > 0;
  const current = open ? (images[Math.min(index, images.length - 1)] ?? null) : null;
  const view = useAttachmentViewUrl(workspaceId, current?.id ?? null);
  const download = useDownloadAttachment(workspaceId);

  const step = (delta: number) => {
    if (index === null || images.length === 0) return;
    onIndexChange((index + delta + images.length) % images.length);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, images.length]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onIndexChange(null)}>
      <DialogContent
        className="flex max-h-[95vh] w-[min(96vw,72rem)] max-w-none flex-col gap-3 bg-background/95 p-4 sm:max-w-none"
        aria-label={current ? current.filename : 'Attachment'}
      >
        <DialogTitle className="sr-only">{current?.filename ?? 'Attachment'}</DialogTitle>
        <DialogDescription className="sr-only">
          Use the left and right arrow keys to move between pictures.
        </DialogDescription>

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {images.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous picture"
              onClick={() => step(-1)}
              className="absolute left-0 top-1/2 z-10 -translate-y-1/2"
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Button>
          )}

          {current && view.isError ? (
            <span
              role="img"
              aria-label={`${current.filename} (image unavailable)`}
              className="flex h-64 w-96 max-w-full items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground"
            >
              <ImageOff className="size-5" aria-hidden="true" />
              Image unavailable
            </span>
          ) : current && view.data ? (
            <img
              src={view.data.url}
              alt={current.filename}
              className="max-h-[80vh] max-w-full rounded-md object-contain"
              draggable={false}
            />
          ) : (
            <Skeleton className="h-64 w-96 max-w-full" aria-label="Loading picture" />
          )}

          {images.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Next picture"
              onClick={() => step(1)}
              className="absolute right-0 top-1/2 z-10 -translate-y-1/2"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </Button>
          )}
        </div>

        {current && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="min-w-0 truncate">
              <span className="font-medium">{current.filename}</span>
              <span className="text-muted-foreground">
                {' '}
                · {formatBytes(current.sizeBytes)}
                {images.length > 1 ? ` · ${(index ?? 0) + 1} of ${images.length}` : ''}
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={download.isPending}
              onClick={() => download.mutate(current.id)}
            >
              <Download className="size-4" aria-hidden="true" />
              Download
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
