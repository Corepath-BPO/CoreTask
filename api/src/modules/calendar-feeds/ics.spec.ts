import { buildCalendar, escapeText, foldLine } from './ics';

describe('ics', () => {
  const now = new Date('2026-10-14T09:30:00.000Z');

  it('escapes the characters iCalendar reserves', () => {
    expect(escapeText('Rent, deposit; keys\\fobs\nunit 12')).toBe(
      'Rent\\, deposit\\; keys\\\\fobs\\nunit 12',
    );
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n ');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(line);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('writes all-day events with an exclusive end, and timed ones in UTC', () => {
    const calendar = buildCalendar(
      'CoreTask · My Tasks',
      [
        {
          uid: 'a@coretask',
          title: 'Renew the lease',
          when: { kind: 'day', start: '2026-10-30', end: '2026-10-31' },
          url: 'http://localhost:5173/my-tasks?task=a',
          updatedAt: now,
        },
        {
          uid: 'b@coretask',
          title: 'Walkthrough',
          when: {
            kind: 'time',
            start: new Date('2026-10-20T15:00:00.000Z'),
            end: new Date('2026-10-20T15:30:00.000Z'),
          },
          description: 'In Platform',
          updatedAt: now,
        },
      ],
      now,
    );

    expect(calendar.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(calendar.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(calendar).toContain('X-WR-CALNAME:CoreTask · My Tasks');
    expect(calendar).toContain('DTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261101');
    expect(calendar).toContain('DTSTART:20261020T150000Z\r\nDTEND:20261020T153000Z');
    expect(calendar).toContain('DTSTAMP:20261014T093000Z');
    expect(calendar).toContain('DESCRIPTION:In Platform');
    expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});
