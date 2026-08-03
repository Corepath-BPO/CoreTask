/**
 * The wire format for an @mention inside a comment body.
 *
 * A mention is stored **in the text**, as `@[Ada Lovelace](019fc880-…)`, rather
 * than as a separate list of ids alongside a plain-text body. Three things fall
 * out of that:
 *
 * - Editing is honest. Deleting the token deletes the mention; there is no way
 *   for the text and the id list to disagree.
 * - The server can parse the body itself, so a client cannot claim to have
 *   mentioned someone it did not, or quietly notify half the workspace.
 * - Ordering and position survive, which is what lets the renderer put the chip
 *   back exactly where it was typed.
 *
 * The label is a convenience for plain-text contexts (notification bodies,
 * e-mail). Anything rendering the comment should prefer the resolved user from
 * `Comment.mentions`, so a renamed member shows their current name.
 */

/** `@[Label](uuid)`. The label may not contain `]`, which is what bounds it. */
export const MENTION_PATTERN = /@\[([^\]]{1,120})\]\(([0-9a-fA-F-]{36})\)/g;

/** Ceiling per comment: each mention is a notification. */
export const MAX_MENTIONS_PER_COMMENT = 20;

export interface ParsedMention {
  userId: string;
  label: string;
}

/**
 * Every mention in a body, in the order written, de-duplicated by user.
 *
 * Mentioning someone twice in one comment is one mention of them — it should
 * not notify twice, and the index has one row per pair regardless.
 */
export function parseMentions(body: string): ParsedMention[] {
  const seen = new Set<string>();
  const mentions: ParsedMention[] = [];

  // `matchAll` needs its own traversal; the shared regex is stateful otherwise.
  for (const match of body.matchAll(new RegExp(MENTION_PATTERN))) {
    const userId = (match[2] ?? '').toLowerCase();
    const label = match[1] ?? '';

    if (!userId || seen.has(userId)) continue;

    seen.add(userId);
    mentions.push({ userId, label });
  }

  return mentions;
}

/** Just the ids, for validating against membership and fanning out notifications. */
export function parseMentionIds(body: string): string[] {
  return parseMentions(body).map((mention) => mention.userId);
}

/** Builds a token. Labels containing `]` would break parsing, so it is stripped. */
export function formatMention(userId: string, label: string): string {
  return `@[${label.replace(/[[\]]/g, '')}](${userId})`;
}

/**
 * Replaces every token with its plain label, for places that cannot render
 * markup — notification bodies, e-mail, search indexing.
 */
export function stripMentionTokens(body: string): string {
  return body.replace(new RegExp(MENTION_PATTERN), '@$1');
}
