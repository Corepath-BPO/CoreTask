import type { AdminMember } from '@coretask/types';

const COLUMNS: { header: string; value: (member: AdminMember) => string | number }[] = [
  { header: 'Name', value: (member) => member.user.name },
  { header: 'Email', value: (member) => member.user.email },
  { header: 'Role', value: (member) => member.role },
  { header: 'Status', value: (member) => member.status },
  { header: 'Joined', value: (member) => member.joinedAt },
  { header: 'Last active', value: (member) => member.user.lastActiveAt ?? '' },
  { header: 'Sign-in methods', value: (member) => member.user.signInMethods.join(' ') },
  { header: 'Two-step verification', value: (member) => (member.user.twoFactorEnabled ? 'Yes' : 'No') },
  { header: 'Open tasks', value: (member) => member.openTasks },
  { header: 'Open tickets', value: (member) => member.openTickets },
  { header: 'Deactivated', value: (member) => member.deactivatedAt ?? '' },
];

/**
 * The console's member list as CSV, as Asana's console exports it.
 *
 * A cell that begins with `=`, `+`, `-` or `@` is prefixed with an apostrophe
 * so a spreadsheet shows a name like "=SUM(…)" instead of running it.
 */
export function membersCsv(members: AdminMember[]): string {
  const rows = [
    COLUMNS.map((column) => column.header),
    ...members.map((member) => COLUMNS.map((column) => String(column.value(member)))),
  ];
  return `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
