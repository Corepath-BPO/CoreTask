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

/**
 * A mention inside a rich-text description: `<span data-mention="uuid">@Name</span>`.
 *
 * The same attribute the comment chip renders, so one style rule and one
 * sanitiser entry cover both. The server writes the id in lower case and
 * strips every other span, so this pattern only ever meets sanitised markup.
 */
export const DESCRIPTION_MENTION_PATTERN = /<span\b[^>]*\bdata-mention="([0-9a-fA-F-]{36})"/g;

/** Every user mentioned in a description, in order, de-duplicated and capped. */
export function parseDescriptionMentionIds(html: string): string[] {
  const seen = new Set<string>();

  for (const match of html.matchAll(new RegExp(DESCRIPTION_MENTION_PATTERN))) {
    const userId = (match[1] ?? '').toLowerCase();
    if (!userId || seen.has(userId)) continue;

    seen.add(userId);
    if (seen.size >= MAX_MENTIONS_PER_COMMENT) break;
  }

  return [...seen];
}

/**
 * Both shapes at once, for a comment body that may be either.
 *
 * Comments were plain text with `@[Name](uuid)` tokens before they became
 * rich text with `<span data-mention>` chips, and the old rows are converted
 * on read rather than rewritten — so the server indexes whichever shape it is
 * handed. Order is kept, duplicates dropped, the cap shared.
 */
export function parseAnyMentionIds(body: string): string[] {
  const seen = new Set<string>();

  for (const userId of [...parseMentionIds(body), ...parseDescriptionMentionIds(body)]) {
    if (seen.size >= MAX_MENTIONS_PER_COMMENT) break;
    seen.add(userId);
  }

  return [...seen];
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * A legacy comment body — plain text with `@[Name](uuid)` tokens — as the
 * HTML the editor stores today: one paragraph per line, each token a
 * `<span data-mention>` chip. Text runs are escaped, so a `<` somebody typed
 * stays a `<`; only the chip is markup.
 */
export function mentionTokensToHtml(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${lineToHtml(line)}</p>`)
    .join('');
}

function lineToHtml(line: string): string {
  let html = '';
  let last = 0;

  for (const match of line.matchAll(new RegExp(MENTION_PATTERN))) {
    const index = match.index ?? 0;
    html += escapeHtml(line.slice(last, index));
    html += `<span data-mention="${(match[2] ?? '').toLowerCase()}">@${escapeHtml(match[1] ?? '')}</span>`;
    last = index + match[0].length;
  }

  return html + escapeHtml(line.slice(last));
}
