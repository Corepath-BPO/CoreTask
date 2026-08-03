/**
 * ============================================================================
 * TEMPORARY DASHBOARD FIXTURES — DELETE THIS FILE WHEN TICKETS LAND
 * ============================================================================
 *
 * What remains here is only what still has no HTTP surface: tickets and the
 * activity feed. Tasks, projects and workspaces are all live — their fixtures
 * were deleted when their endpoints shipped, which is the intended lifecycle
 * for this file.
 *
 * Only `features/dashboard` and the top bar's unread badge import it, so
 * removing the rest is: point those two at the real endpoints, delete the file.
 *
 * The shapes mirror `@coretask/types` on purpose, so swapping the data source
 * is a change of origin, not of structure.
 * ============================================================================
 */
import { TicketPriority, TicketStatus, TicketType } from '@coretask/contracts';

export const IS_MOCK_DATA = true;

export const UNREAD_NOTIFICATIONS = 3;

export interface MockSummary {
  label: string;
  value: number;
  delta: number;
  hint: string;
}

export const TICKET_SUMMARY: MockSummary[] = [
  { label: 'Open tickets', value: 18, delta: 3, hint: '6 unassigned' },
  { label: 'Urgent', value: 2, delta: 0, hint: 'SLA at risk' },
  { label: 'Resolved (7d)', value: 31, delta: 12, hint: 'Median 1.4 days' },
  { label: 'Awaiting reply', value: 7, delta: -2, hint: 'From reporters' },
];

export interface MockTicket {
  id: string;
  key: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  reporter: string;
  updatedAt: string;
}

export const RECENT_TICKETS: MockTicket[] = [
  {
    id: 'tkt-1',
    key: 'CORE-1003',
    title: 'Attachment upload times out on files above 10 MB',
    type: TicketType.BUG,
    status: TicketStatus.IN_PROGRESS,
    priority: TicketPriority.URGENT,
    reporter: 'Maya Okafor',
    updatedAt: hoursAgo(2),
  },
  {
    id: 'tkt-2',
    key: 'CORE-1001',
    title: 'Login fails with a 500 when the e-mail contains a plus sign',
    type: TicketType.BUG,
    status: TicketStatus.TRIAGED,
    priority: TicketPriority.HIGH,
    reporter: 'Jonas Feld',
    updatedAt: hoursAgo(7),
  },
  {
    id: 'tkt-3',
    key: 'CORE-1002',
    title: 'Add keyboard shortcuts for creating a task',
    type: TicketType.FEATURE,
    status: TicketStatus.OPEN,
    priority: TicketPriority.MEDIUM,
    reporter: 'Priya Raman',
    updatedAt: hoursAgo(26),
  },
  {
    id: 'tkt-4',
    key: 'CORE-1005',
    title: 'Scheduled maintenance: PostgreSQL 17 upgrade',
    type: TicketType.MAINTENANCE,
    status: TicketStatus.OPEN,
    priority: TicketPriority.LOW,
    reporter: 'Demo Owner',
    updatedAt: hoursAgo(52),
  },
];

export interface MockActivity {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
}

export const RECENT_ACTIVITY: MockActivity[] = [
  {
    id: 'act-1',
    actor: 'Maya Okafor',
    action: 'moved',
    target: 'CORE-1001 to Triaged',
    createdAt: hoursAgo(1),
  },
  {
    id: 'act-2',
    actor: 'Jonas Feld',
    action: 'commented on',
    target: 'Board view drag-and-drop',
    createdAt: hoursAgo(3),
  },
  {
    id: 'act-3',
    actor: 'Demo Owner',
    action: 'completed',
    target: 'Refresh-token rotation',
    createdAt: hoursAgo(9),
  },
  {
    id: 'act-4',
    actor: 'Priya Raman',
    action: 'created',
    target: 'Audit-log viewer',
    createdAt: hoursAgo(21),
  },
  {
    id: 'act-5',
    actor: 'Demo Owner',
    action: 'created project',
    target: 'Customer Onboarding',
    createdAt: hoursAgo(30),
  },
];

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}
