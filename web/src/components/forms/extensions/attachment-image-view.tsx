import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ImageOff } from 'lucide-react';
import { useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useAttachmentViewUrl } from '@/features/attachments/hooks/use-attachment-view-url';
import { cn } from '@/lib/utils';

import type { AttachmentImageOptions } from './attachment-image';

/**
 * How an attachment image is drawn: the URL is fetched when the picture is
 * looked at, a skeleton stands in while it loads, and a deleted attachment
 * leaves an honest placeholder in the text rather than a broken icon.
 */
export function AttachmentImageView({ node, extension, selected }: NodeViewProps) {
  const { workspaceId } = extension.options as AttachmentImageOptions;
  const attachmentId = (node.attrs['attachmentId'] as string | null) ?? null;
  const alt = (node.attrs['alt'] as string | null) ?? '';

  const view = useAttachmentViewUrl(workspaceId, attachmentId);
  // One more try when the picture fails to load — the URL may just have
  // expired between the fetch and the paint. After that it is broken.
  const [failures, setFailures] = useState(0);

  const onError = () => {
    setFailures((count) => count + 1);
    if (failures === 0) void view.refetch();
  };

  const broken = view.isError || failures > 1 || !workspaceId || !attachmentId;

  return (
    <NodeViewWrapper
      data-drag-handle
      data-attachment={attachmentId ?? undefined}
      className={cn('attachment-image my-2 w-fit max-w-full', selected && 'ring-2 ring-ring/40')}
    >
      {broken ? (
        <span
          role="img"
          aria-label={alt ? `${alt} (image unavailable)` : 'Image unavailable'}
          className="flex h-24 w-48 items-center justify-center gap-2 rounded-md border border-dashed text-xs text-muted-foreground"
        >
          <ImageOff className="size-4" aria-hidden="true" />
          Image unavailable
        </span>
      ) : view.data ? (
        <img
          src={view.data.url}
          alt={alt}
          onError={onError}
          className="max-h-[32rem] max-w-full rounded-md"
          draggable={false}
        />
      ) : (
        <Skeleton className="h-40 w-64" aria-label="Loading image" />
      )}
    </NodeViewWrapper>
  );
}
