import { MENTION_PATTERN } from '@coretask/contracts';
import type { UserRef } from '@coretask/types';

import { cn } from '@/lib/utils';

interface CommentBodyProps {
  body: string;
  /** Resolved members, used to show current names rather than stale labels. */
  mentions: UserRef[];
  /** Highlights mentions of this user, so being named stands out in a thread. */
  currentUserId?: string;
  className?: string;
}

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; userId: string; label: string; resolved: boolean };

/**
 * Splits a body into text and mention tokens.
 *
 * Exported for tests: this is where a subtle bug would hide, because the shared
 * pattern is global and therefore stateful. A fresh `RegExp` per call keeps
 * repeated renders from skipping every other match.
 */
export function segmentCommentBody(body: string, mentions: UserRef[]): Segment[] {
  const byId = new Map(mentions.map((user) => [user.id.toLowerCase(), user]));
  const pattern = new RegExp(MENTION_PATTERN);
  const segments: Segment[] = [];

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: 'text', value: body.slice(cursor, match.index) });
    }

    const userId = (match[2] ?? '').toLowerCase();
    const resolved = byId.get(userId);

    segments.push({
      kind: 'mention',
      userId,
      // The stored label is a fallback: someone who has left the workspace no
      // longer resolves, and their name at the time is better than an id.
      label: resolved?.name ?? match[1] ?? 'someone',
      resolved: Boolean(resolved),
    });

    cursor = match.index + match[0].length;
  }

  if (cursor < body.length) {
    segments.push({ kind: 'text', value: body.slice(cursor) });
  }

  return segments;
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
