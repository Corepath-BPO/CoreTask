import { mentionTokensToHtml } from '@coretask/contracts';

/**
 * Descriptions are HTML — see docs/architecture/task-dates-and-rich-text.md.
 *
 * The API sanitises everything it stores, and the editor only ever renders
 * through ProseMirror's parser, which keeps nothing outside its schema. What
 * this file handles is the seam with the past: descriptions written before the
 * editor existed are plain text with newlines, and a CSV import still sends
 * that shape. They become paragraphs on the way in, exactly as the API does it.
 */

const TAG_PATTERN =
  /<\/?(p|br|strong|b|em|i|u|s|strike|del|ul|ol|li|a|code|pre|h[1-6]|blockquote|hr|div|span|img)\b[^>]*>/i;

/** Whether a stored description is already markup, or plain text from before. */
export function looksLikeHtml(value: string): boolean {
  return TAG_PATTERN.test(value);
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

/** One paragraph per line; an empty line stays an empty paragraph. */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

/** What the editor should load for a stored description. */
export function toEditorHtml(description: string | null | undefined): string {
  if (!description) return '';
  return looksLikeHtml(description) ? description : plainTextToHtml(description);
}

/**
 * A comment body as the thread renders it. The API already converts the rows
 * from before comments were rich text — `@[Name](uuid)` tokens — on the way
 * out; this is the same conversion as a courtesy for anything that reaches
 * the client another way, such as a socket payload.
 */
export function commentToEditorHtml(body: string | null | undefined): string {
  if (!body) return '';
  return looksLikeHtml(body) ? body : mentionTokensToHtml(body);
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * The text of a description, for places that show a line of it rather than
 * the whole thing — a card, a search excerpt. Block boundaries become spaces
 * so two paragraphs do not run into one word.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the markup shows nothing at all — `<p></p>` and friends. An image
 * is something to see even with no words beside it.
 */
export function isEmptyHtml(html: string): boolean {
  return !/<img\b/i.test(html) && htmlToText(html) === '';
}
