import type { UserRef } from '@coretask/types';

import { cn } from '@/lib/utils';

import { segmentCommentBody } from '../lib/segment-comment-body';

interface CommentBodyProps {
  body: string;
  /** Resolved members, used to show current names rather than stale labels. */
  mentions: UserRef[];
  /** Highlights mentions of this user, so being named stands out in a thread. */
  currentUserId?: string;
  className?: string;
}

/** Renders a comment body with its mentions as chips. */
export function CommentBody({ body, mentions, currentUserId, className }: CommentBodyProps) {
  const segments = segmentCommentBody(body, mentions);

  return (
    <p className={cn('whitespace-pre-wrap text-sm', className)}>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <span
            key={index}
            data-mention={segment.userId}
            className={cn(
              'rounded px-1 py-0.5 text-sm font-medium',
              segment.userId === currentUserId?.toLowerCase()
                ? 'bg-primary/15 text-primary'
                : 'bg-muted text-foreground',
              // A mention of someone no longer in the workspace is still
              // readable, just visibly inert.
              !segment.resolved && 'text-muted-foreground',
            )}
          >
            @{segment.label}
          </span>
        ),
      )}
    </p>
  );
}
