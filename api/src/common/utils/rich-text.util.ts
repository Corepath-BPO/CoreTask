import { mentionTokensToHtml } from '@coretask/contracts';
import sanitizeHtml from 'sanitize-html';

/**
 * Descriptions are stored as HTML.
 *
 * The editor speaks HTML, and storing what it produces means a description
 * round-trips without a lossy conversion on either side. Storing markup that
 * other people's browsers will render is also exactly the shape of a stored
 * XSS, so nothing reaches the database without passing through here first —
 * the client sanitising too would be a courtesy, not a defence.
 *
 * The allow-list is the editor's feature set and nothing more: text marks,
 * lists, links, code, headings, quotes, a mention chip, an attachment image.
 * No tables, no styles, no classes, no ids, and never a `src` — an image names
 * the attachment it shows, and the client fetches a URL for it at render time.
 * See docs/architecture/task-dates-and-rich-text.md.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tag no allow-list names, so `discard` mode drops it and keeps its text. */
const UNWRAP: sanitizeHtml.Tag = { tagName: 'x-unwrap', attribs: {} };

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'del',
  'ul',
  'ol',
  'li',
  'a',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
  'blockquote',
  'hr',
  'span',
  'img',
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['data-mention'],
    img: ['data-attachment', 'alt'],
  },
  // `javascript:` and `data:` links are the classic payload; only the three
  // schemes a person would actually type survive.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  // Every link opens elsewhere and never gets a handle on the page that opened
  // it, whatever the client sent.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    // A span is only ever a mention chip. Anything else wearing the tag is
    // renamed to one that is not allowed, so `discard` mode unwraps it and
    // keeps its text — an `exclusiveFilter` would take the words with it.
    span: (_tagName, attribs): sanitizeHtml.Tag => {
      const userId = attribs['data-mention'];
      if (userId && UUID.test(userId)) {
        return { tagName: 'span', attribs: { 'data-mention': userId.toLowerCase() } };
      }
      return UNWRAP;
    },
  },
  // An image that names no attachment shows nothing: there is no text to
  // keep, so the whole element goes.
  exclusiveFilter: (frame) =>
    frame.tag === 'img' && !UUID.test(frame.attribs['data-attachment'] ?? ''),
  // A disallowed element's text survives; only the tag goes. `<script>` and
  // `<style>` are the exception — their contents are dropped with them.
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe'],
};

/**
 * Whether a value is already markup, or plain text that predates the editor.
 *
 * Only block and inline tags the editor emits count. A stray `<` in a sentence
 * — "a < b" — is text, and treating it as HTML would eat it.
 */
const TAG_PATTERN =
  /<\/?(p|br|strong|b|em|i|u|s|strike|del|ul|ol|li|a|code|pre|h[1-6]|blockquote|hr|div|span|img)\b[^>]*>/i;

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

/**
 * Plain text becomes one paragraph per line.
 *
 * Every description written before the editor existed is plain text with
 * newlines, and so is anything a CSV import or a form's textarea still sends.
 * A line per paragraph is what those newlines meant; an empty line stays an
 * empty paragraph so a deliberate gap survives.
 */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

/**
 * True when the markup shows nothing at all — `<p></p>` and friends.
 *
 * An image is something to see even with no words beside it, so a
 * description that is only a screenshot is not empty.
 */
export function isEmptyHtml(html: string): boolean {
  if (/<img\b/i.test(html)) return false;

  return (
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim() === ''
  );
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
 * The words of a description, for places that cannot render markup — a
 * notification body. Block boundaries become spaces so two paragraphs do not
 * run into one word.
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
 * What every description write goes through.
 *
 * `undefined` means "not part of this update" and passes straight through;
 * `null`, whitespace, and markup with nothing in it all mean "cleared" and
 * come out as `null`, so an emptied editor and a never-written field are the
 * same thing to every reader.
 */
export function normalizeRichText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const html = looksLikeHtml(trimmed) ? sanitizeHtml(trimmed, OPTIONS) : plainTextToHtml(trimmed);

  return isEmptyHtml(html) ? null : html;
}

/**
 * What every comment write goes through — the description's sanitiser, with
 * one extra seam: a body that is still plain text with `@[Name](uuid)` tokens
 * (an older client, a rule's ADD_COMMENT action) becomes the chip markup
 * first, so the stored row has one shape whatever sent it. `null` means
 * there was nothing to say.
 */
export function normalizeCommentBody(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const markup = looksLikeHtml(trimmed) ? trimmed : mentionTokensToHtml(trimmed);
  const html = sanitizeHtml(markup, OPTIONS);

  return isEmptyHtml(html) ? null : html;
}

/**
 * A stored comment body as the client renders it. Rows written before comments
 * were rich text hold tokens; they are converted here, on the way out, rather
 * than rewritten in place — the audit trail keeps what was actually posted.
 */
export function commentBodyToHtml(stored: string): string {
  return looksLikeHtml(stored) ? stored : mentionTokensToHtml(stored);
}
