import { escapeHtml } from '../../common/utils/rich-text.util';

/**
 * The one HTML shell every standalone CoreTask e-mail is rendered into.
 *
 * Written against the 2003 Word rendering engine Outlook still uses, which is
 * why it reads the way it does: tables rather than flex or grid, every style
 * inline because Gmail strips `<style>` from the clipped copy, and a `<td>`
 * carrying the button's colour so the shape survives in clients that drop
 * `border-radius`.
 *
 * Threaded replies deliberately do *not* use this. Task update e-mails are a
 * conversation — chrome of this weight would be re-quoted into every reply
 * underneath them.
 */

/*
 * The app's own tokens, resolved to hex: `oklch()` reaches no mail client, and
 * a colour here has to be literal. Kept in step with web/src/styles/globals.css
 * by hand — there are five of them and they change about once a year.
 */
const CANVAS = '#f4f4f5';
const CARD = '#ffffff';
const BORDER = '#e4e4e7';
const INK = '#18181b';
const MUTED = '#52525b';
const FAINT = '#71717a';

/**
 * The brand green, carrying dark text rather than white.
 *
 * Same reasoning as the button in the app: at L=0.76 this green gives white
 * text 2.02:1, which fails AA outright, and dark text 10.4:1.
 */
const BRAND = '#85c854';

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export interface EmailLayout {
  /** The line an inbox shows after the subject. Never rendered in the body. */
  preheader: string;
  heading: string;
  /** Paragraphs, already escaped and wrapped in `<p>`. */
  bodyHtml: string;
  cta?: { label: string; href: string };
  /** Small print under the button — expiry, what to do if you did not ask. */
  note?: string;
  /** Grey line below the card, outside the signature. */
  footnote?: string;
}

/** The mark, drawn in table cells: three outlined squares and a filled one. */
function markHtml(): string {
  const cell = `width:13px;height:13px;font-size:0;line-height:0;mso-line-height-rule:exactly;`;
  const outlined = `${cell}border:3px solid ${INK};`;
  const filled = `${cell}background:${INK};`;
  return [
    `<table role="presentation" cellpadding="0" cellspacing="3" border="0" style="border-collapse:separate;">`,
    `<tr>`,
    `<td style="${outlined}">&nbsp;</td>`,
    `<td style="${outlined}">&nbsp;</td>`,
    `</tr>`,
    `<tr>`,
    `<td style="${outlined}">&nbsp;</td>`,
    `<td style="${filled}">&nbsp;</td>`,
    `</tr>`,
    `</table>`,
  ].join('');
}

export function renderEmailHtml(layout: EmailLayout): string {
  const { preheader, heading, bodyHtml, cta, note, footnote } = layout;

  const button = cta
    ? [
        `<tr><td style="padding:28px 32px 0;">`,
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0">`,
        `<tr><td bgcolor="${BRAND}" style="border-radius:8px;">`,
        `<a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:13px 24px;`,
        // 1.25 rather than 1: on a phone a long label wraps, and at 1 the two
        // lines touch.
        `font-family:${FONT};font-size:15px;font-weight:600;line-height:1.25;color:${INK};`,
        `text-decoration:none;border-radius:8px;">${escapeHtml(cta.label)}</a>`,
        `</td></tr></table>`,
        `</td></tr>`,
        // Some corporate gateways rewrite or strip the anchor; the bare URL is
        // the difference between a dead e-mail and one the reader can still use.
        `<tr><td style="padding:18px 32px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${FAINT};">`,
        `If the button does not work, paste this into your browser:<br>`,
        `<span style="color:${MUTED};word-break:break-all;">${escapeHtml(cta.href)}</span>`,
        `</td></tr>`,
      ].join('')
    : '';

  const noteRow = note
    ? `<tr><td style="padding:22px 32px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${FAINT};">${escapeHtml(note)}</td></tr>`
    : '';

  // Its own table, not a bare row: this sits *below* the card, outside the
  // table the card is built from, and a loose `<tr>` there is invalid markup
  // that Outlook drops and browsers hoist somewhere unintended.
  const footnoteBlock = footnote
    ? [
        `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">`,
        `<tr><td align="center" style="padding:18px 16px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#a1a1aa;">${footnote}</td></tr>`,
        `</table>`,
      ].join('')
    : '';

  return [
    `<!doctype html>`,
    `<html lang="en"><head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    // Without these a dark-mode client inverts the card to near-black and the
    // mark, which is near-black, disappears into it.
    `<meta name="color-scheme" content="light">`,
    `<meta name="supported-color-schemes" content="light">`,
    `<title>${escapeHtml(heading)}</title>`,
    `</head>`,
    `<body style="margin:0;padding:0;background:${CANVAS};color-scheme:light;">`,
    `<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</span>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">`,
    `<tr><td align="center" style="padding:32px 16px 40px;">`,

    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${CARD};border:1px solid ${BORDER};border-radius:12px;">`,

    // Mark and wordmark, side by side.
    `<tr><td style="padding:30px 32px 0;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td valign="middle">${markHtml()}</td>`,
    `<td valign="middle" style="padding-left:12px;font-family:${FONT};font-size:17px;font-weight:600;letter-spacing:-0.01em;color:${INK};">CoreTask</td>`,
    `</tr></table>`,
    `</td></tr>`,

    `<tr><td style="padding:26px 32px 0;font-family:${FONT};font-size:21px;font-weight:600;line-height:1.3;letter-spacing:-0.01em;color:${INK};">${escapeHtml(heading)}</td></tr>`,

    `<tr><td style="padding:14px 32px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${MUTED};">${bodyHtml}</td></tr>`,

    button,
    noteRow,

    `<tr><td style="padding:28px 32px 30px;">`,
    `<div style="border-top:1px solid ${BORDER};padding-top:18px;font-family:${FONT};font-size:13px;color:${FAINT};">— The CoreTask team</div>`,
    `</td></tr>`,

    `</table>`,

    footnoteBlock,

    `</td></tr></table>`,
    `</body></html>`,
  ].join('');
}

/** Body paragraphs in the shell's own type scale. */
export function paragraph(html: string): string {
  return `<p style="margin:0 0 14px;">${html}</p>`;
}
