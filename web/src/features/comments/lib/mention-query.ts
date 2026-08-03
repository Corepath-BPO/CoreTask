import { formatMention } from '@coretask/contracts';

/** An in-progress `@…` the caret is sitting inside. */
export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** What has been typed after it, used to filter members. */
  query: string;
}

/** Beyond this, it stopped being a name and became a sentence. */
const MAX_QUERY_LENGTH = 40;

/**
 * Finds the mention being typed at the caret, if any.
 *
 * Two rules keep this from firing on ordinary prose:
 *
 * - The `@` must open a word — preceded by the start of the text or whitespace,
 *   so an e-mail address never triggers the picker.
 * - The text between it and the caret may contain spaces, because people type
 *   "@Ada Lo" to reach a surname, but not a newline, and not the bracket
 *   characters that would already be part of a completed token.
 */
export function findMentionQuery(value: string, caret: number): MentionQuery | null {
  const upToCaret = value.slice(0, caret);
  const at = upToCaret.lastIndexOf('@');

  if (at === -1) return null;

  const before = at === 0 ? '' : (upToCaret[at - 1] ?? '');
  if (before !== '' && !/\s/.test(before)) return null;

  const query = upToCaret.slice(at + 1);

  if (query.length > MAX_QUERY_LENGTH) return null;
  // A leading space means the `@` was left standing on its own.
  if (/^\s/.test(query)) return null;
  if (/[\n\r[\]()]/.test(query)) return null;

  return { start: at, query };
}

/** Filters members by name or e-mail, case-insensitively. */
export function matchesQuery(member: { name: string; email: string }, query: string): boolean {
  if (query === '') return true;

  const needle = query.toLowerCase();
  return member.name.toLowerCase().includes(needle) || member.email.toLowerCase().includes(needle);
}

/**
 * Replaces the in-progress `@…` with a finished token.
 *
 * Returns where the caret should land — after the trailing space — so typing
 * can continue without the picker immediately reopening on the same text.
 */
export function applyMention(
  value: string,
  mention: MentionQuery,
  caret: number,
  user: { id: string; name: string },
): { value: string; caret: number } {
  const token = `${formatMention(user.id, user.name)} `;
  const next = value.slice(0, mention.start) + token + value.slice(caret);

  return { value: next, caret: mention.start + token.length };
}
