import { parseAddressList } from '@coretask/contracts';

import { htmlToText } from '../../common/utils/rich-text.util';

/** A file that arrived with a message. */
export interface InboundAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/** One message, whichever provider delivered it. */
export interface InboundMessage {
  from: string | null;
  to: string[];
  cc: string[];
  /** To, CC and the envelope's recipients: every address the message reached. */
  recipients: string[];
  subject: string;
  /** The plain body; the HTML's words when only HTML was sent. */
  text: string;
  messageId: string | null;
  attachments: InboundAttachment[];
}

/** A file as multer hands it over, from a multipart delivery. */
export interface UploadedPart {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

type Body = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function first(body: Body, ...keys: string[]): string {
  for (const key of keys) {
    const value = str(body[key]);
    if (value.trim()) return value;
  }
  return '';
}

/** SendGrid sends the SMTP envelope as a JSON string: `{"to":[…],"from":"…"}`. */
function envelopeRecipients(body: Body): string[] {
  const raw = body['envelope'];
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as { to?: unknown };
    return Array.isArray(parsed.to)
      ? parsed.to.filter((to): to is string => typeof to === 'string')
      : [];
  } catch {
    return [];
  }
}

function messageIdOf(body: Body): string | null {
  const direct = first(body, 'messageId', 'Message-Id', 'message-id');
  if (direct) return direct.trim();
  // Postmark: the original header rides in `Headers` (its own `MessageID` is not it).
  const headers = body['Headers'];
  if (Array.isArray(headers)) {
    for (const header of headers) {
      const record = header as { Name?: unknown; Value?: unknown };
      if (typeof record.Name === 'string' && record.Name.toLowerCase() === 'message-id') {
        return str(record.Value).trim() || null;
      }
    }
  }
  // SendGrid: every header as one raw block.
  const raw = str(body['headers']);
  const match = /^Message-ID:\s*(.+)$/im.exec(raw);
  return match?.[1]?.trim() || null;
}

function jsonAttachments(body: Body): InboundAttachment[] {
  const list = body['attachments'] ?? body['Attachments'];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const record = (item ?? {}) as Body;
    const content = str(record['content'] ?? record['Content']);
    const filename = str(record['filename'] ?? record['Name']).trim();
    if (!content || !filename) return [];
    return [
      {
        filename,
        mimeType: str(record['contentType'] ?? record['ContentType']) || 'application/octet-stream',
        content: Buffer.from(content, 'base64'),
      },
    ];
  });
}

/**
 * Reads a delivery from Postmark (JSON), SendGrid's Inbound Parse or Mailgun
 * (multipart or form), or the plain shape documented for anything else:
 * `{ from, to, cc, subject, text, html, messageId, attachments: [{ filename,
 * contentType, content (base64) }] }`.
 */
export function normalizeInbound(body: Body, files: UploadedPart[] = []): InboundMessage {
  const fromFull = body['FromFull'] as { Email?: unknown } | undefined;
  const from =
    parseAddressList(first(body, 'from', 'From', 'sender'), str(fromFull?.Email))[0] ?? null;
  const to = parseAddressList(first(body, 'to', 'To', 'recipient'));
  const cc = parseAddressList(first(body, 'cc', 'Cc', 'CC'));
  const recipients = parseAddressList(
    to,
    cc,
    envelopeRecipients(body),
    str(body['OriginalRecipient']),
  );

  const html = first(body, 'html', 'HtmlBody', 'body-html');
  const text = first(body, 'text', 'TextBody', 'body-plain') || (html ? htmlToText(html) : '');

  return {
    from,
    to,
    cc,
    recipients,
    subject: first(body, 'subject', 'Subject').trim(),
    text: text.trim(),
    messageId: messageIdOf(body),
    attachments: [
      ...jsonAttachments(body),
      ...files.map((file) => ({
        filename: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        content: file.buffer,
      })),
    ],
  };
}
