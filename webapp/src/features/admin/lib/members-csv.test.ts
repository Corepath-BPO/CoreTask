import type { AdminMember } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { membersCsv } from './members-csv';

const member = (name: string): AdminMember => ({
  id: 'm-1',
  role: 'MEMBER',
  status: 'ACTIVE',
  joinedAt: '2026-10-01T00:00:00.000Z',
  invitedBy: null,
  deactivatedAt: null,
  deactivatedBy: null,
  user: {
    id: 'u-1',
    name,
    email: 'pat@acme.test',
    avatarUrl: null,
    jobTitle: null,
    lastActiveAt: null,
    twoFactorEnabled: true,
    emailVerified: true,
    signInMethods: ['PASSWORD', 'GOOGLE'],
  },
  openTasks: 2,
  openTickets: 0,
});

describe('membersCsv', () => {
  it('writes a header and one row per person', () => {
    const [header, row] = membersCsv([member('Pat')]).trim().split('\r\n');

    expect(header).toMatch(/^Name,Email,Role,Status,/);
    expect(row).toBe(
      'Pat,pat@acme.test,MEMBER,ACTIVE,2026-10-01T00:00:00.000Z,,PASSWORD GOOGLE,Yes,2,0,',
    );
  });

  it('quotes commas and quotes', () => {
    const [, row] = membersCsv([member('Lee, "Pat"')]).split('\r\n');
    expect(row?.startsWith('"Lee, ""Pat"""')).toBe(true);
  });

  /** A name a spreadsheet would run as a formula is shown as text instead. */
  it('defuses formulas', () => {
    const [, row] = membersCsv([member('=HYPERLINK("x")')]).split('\r\n');
    expect(row?.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
  });
});
