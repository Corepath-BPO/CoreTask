import type { TagRef } from '@coretask/types';
import { X } from 'lucide-react';

import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { cn } from '@/lib/utils';

/** One tag: its name tinted by its colour, with a remove button when asked. */
export function TagChip({
  tag,
  onRemove,
  className,
}: {
  tag: TagRef;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <SemanticBadge color={{ colorToken: tag.color }} className={cn('max-w-[10rem]', className)}>
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove the tag ${tag.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="-mr-1 rounded-sm opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </SemanticBadge>
  );
}

/**
 * A row of tags that fits where it is put: the first few, then "+N" naming
 * the rest in its title, so a crowded card stays one line.
 */
export function TagChips({
  tags,
  max = 3,
  className,
}: {
  tags: readonly TagRef[];
  max?: number;
  className?: string;
}) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const hidden = tags.slice(max);

  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((tag) => (
        <TagChip key={tag.id} tag={tag} className="px-1.5 py-0 text-[11px]" />
      ))}
      {hidden.length > 0 && (
        <span
          className="text-[11px] text-muted-foreground"
          title={hidden.map((tag) => tag.name).join(', ')}
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
}
