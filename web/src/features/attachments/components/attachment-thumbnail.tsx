import type { Attachment } from '@coretask/types';
import { FileText, ImageOff } from 'lucide-react';
import { useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useAttachmentViewUrl } from '../hooks/use-attachment-view-url';
import { isImage } from '../lib/is-image';

interface AttachmentThumbnailProps {
  workspaceId: string | undefined;
  attachment: Attachment;
  /** Opens the lightbox for a picture; a file has nothing to open. */
  onOpen?: (() => void) | undefined;
  className?: string;
}

/**
 * A picture as a tile, as Asana's attachment strip draws one.
 *
 * The URL is fetched when the tile is looked at and never stored — the bucket
 * is private and every link expires — so the same hook the inline image uses
 * resolves it, with the same skeleton while it loads and the same honest
 * placeholder once the file is gone. Anything that is not a raster image
 * shows its icon instead; an SVG counts as a file, because rendered from the
 * storage origin it could carry script.
 */
export function AttachmentThumbnail({
  workspaceId,
  attachment,
  onOpen,
  className,
}: AttachmentThumbnailProps) {
  const picture = isImage(attachment);
  const view = useAttachmentViewUrl(workspaceId, picture ? attachment.id : null);
  const [failures, setFailures] = useState(0);

  const onError = () => {
    setFailures((count) => count + 1);
    if (failures === 0) void view.refetch();
  };

  const frame = cn(
    'flex items-center justify-center overflow-hidden rounded-md border bg-muted/40',
    className,
  );

  if (!picture) {
    return (
      <span className={frame} aria-hidden="true">
        <FileText className="size-6 text-muted-foreground" />
      </span>
    );
  }

  const broken = view.isError || failures > 1;

  const content = broken ? (
    <span
      role="img"
      aria-label={`${attachment.filename} (image unavailable)`}
      className="flex h-full w-full items-center justify-center text-muted-foreground"
    >
      <ImageOff className="size-5" aria-hidden="true" />
    </span>
  ) : view.data ? (
    <img
      src={view.data.url}
      alt={attachment.filename}
      onError={onError}
      className="h-full w-full object-cover"
      draggable={false}
    />
  ) : (
    <Skeleton
      className="h-full w-full rounded-none"
      aria-label={`Loading ${attachment.filename}`}
    />
  );

  if (!onOpen || broken) {
    return <span className={frame}>{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${attachment.filename}`}
      className={cn(
        frame,
        'cursor-zoom-in focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
      )}
    >
      {content}
    </button>
  );
}
