import { MENTION_PATTERN } from '@coretask/contracts';
import type { UserRef } from '@coretask/types';

export type CommentSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; userId: string; label: string; resolved: boolean };

/**
 * Splits a comment body into plain text and mention tokens.
 *
 * A fresh `RegExp` per call is load-bearing: the shared pattern carries the
 * global flag and is therefore stateful, so reusing it across renders would
 * skip every other match.
 */
export function segmentCommentBody(body: string, mentions: UserRef[]): CommentSegment[] {
  const byId = new Map(mentions.map((user) => [user.id.toLowerCase(), user]));
  const pattern = new RegExp(MENTION_PATTERN);
  const segments: CommentSegment[] = [];

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
