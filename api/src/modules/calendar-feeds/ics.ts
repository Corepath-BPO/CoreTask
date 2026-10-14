/**
 * Just enough of iCalendar (RFC 5545) to publish tasks as events: a calendar of
 * all-day and timed events, escaped and folded the way calendar apps expect.
 */

/** An all-day span, by calendar day, both ends inclusive; or a span in time. */
export type IcsWhen =
  { kind: 'day'; start: string; end: string } | { kind: 'time'; start: Date; end: Date };

export interface IcsEvent {
  uid: string;
  title: string;
  when: IcsWhen;
  description?: string;
  url?: string;
  updatedAt: Date;
}

/** RFC 5545 §3.3.11: backslash, semicolon and comma are escaped; newlines become `\n`. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: lines longer than 75 octets continue on the next line after
 * a space. Counted in UTF-8 bytes, and never splitting a character.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  // A continuation line spends one octet on its leading space.
  let limit = 75;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (size + width > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74;
    }
    current += char;
    size += width;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** `20261020T150000Z`: a UTC instant. */
function stamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** `20261020`: a calendar day, from `YYYY-MM-DD`. */
function day(value: string): string {
  return value.replace(/-/g, '');
}

/** The day after a `YYYY-MM-DD`: an all-day event's end is exclusive. */
function nextDay(value: string): string {
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** A whole calendar, CRLF-separated, ready to serve as `text/calendar`. */
export function buildCalendar(name: string, events: IcsEvent[], now: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CoreTask//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    // A hint; each calendar app keeps its own schedule.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${stamp(now)}`);
    if (event.when.kind === 'day') {
      lines.push(
        `DTSTART;VALUE=DATE:${day(event.when.start)}`,
        `DTEND;VALUE=DATE:${day(nextDay(event.when.end))}`,
      );
    } else {
      lines.push(`DTSTART:${stamp(event.when.start)}`, `DTEND:${stamp(event.when.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push(`LAST-MODIFIED:${stamp(event.updatedAt)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
