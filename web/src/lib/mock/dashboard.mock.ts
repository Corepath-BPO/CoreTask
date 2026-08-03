/**
 * ============================================================================
 * TEMPORARY DASHBOARD FIXTURES — DELETE THIS FILE WHEN THE ENDPOINTS LAND
 * ============================================================================
 *
 * The foundation phase ships authentication and workspaces; tasks, tickets,
 * projects and activity have Prisma models and a seed but no HTTP surface yet.
 *
 * Every mock value in the app lives here, and only `features/dashboard`
 * imports it. Removing the placeholder is therefore a two-step change:
 *
 *   1. Point the dashboard hooks at the real endpoints.
 *   2. Delete this file — nothing else references it.
 *
 * The shapes mirror `@coretask/types` on purpose, so swapping the data source
 * is a change of origin, not of structure.
 * ============================================================================
 */
import {
  TaskPriority,
  TaskStatus,
  TicketPriority,
  TicketStatus,
  TicketType,
  type ProjectStatus,
} from '@coretask/contracts';

export const IS_MOCK_DATA = true;

export const UNREAD_NOTIFICATIONS = 3;

export interface MockSummary {
  label: string;
  value: number;
  delta: number;
  hint: string;
}

export const TASK_SUMMARY: MockSummary[] = [
  { label: 'Assigned to you', value: 12, delta: 2, hint: '4 due this week' },
  { label: 'In progress', value: 5, delta: -1, hint: 'Across 2 projects' },
  { label: 'Completed (7d)', value: 23, delta: 8, hint: 'Team total' },
  { label: 'Overdue', value: 2, delta: -3, hint: 'Needs attention' },
];

export const TICKET_SUMMARY: MockSummary[] = [
  { label: 'Open tickets', value: 18, delta: 3, hint: '6 unassigned' },
  { label: 'Urgent', value: 2, delta: 0, hint: 'SLA at risk' },
  { label: 'Resolved (7d)', value: 31, delta: 12, hint: 'Median 1.4 days' },
  { label: 'Awaiting reply', value: 7, delta: -2, hint: 'From reporters' },
];

export interface MockTask {
  id: string;
  title: string;
  project: string;
  projectColor: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  assignee: { name: string; avatarUrl: string | null };
}

export const ASSIGNED_TASKS: MockTask[] = [
  {
    id: 'tsk-1',
    title: 'Wire the dashboard summary endpoints',
    project: 'Platform Foundation',
    projectColor: '#6366F1',
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    dueDate: daysFromNow(2),
    assignee: { name: 'Demo Owner', avatarUrl: null },
  },
  {
    id: 'tsk-2',
    title: 'Board view drag-and-drop with dnd-kit',
    project: 'Platform Foundation',
    projectColor: '#6366F1',
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.MEDIUM,
    dueDate: daysFromNow(9),
    assignee: { name: 'Jonas Feld', avatarUrl: null },
  },
  {
    id: 'tsk-3',
    title: 'Design the workspace switcher',
    project: 'Platform Foundation',
    projectColor: '#6366F1',
    status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM,
    dueDate: daysFromNow(6),
    assignee: { name: 'Maya Okafor', avatarUrl: null },
  },
  {
    id: 'tsk-4',
    title: 'Audit-log viewer for workspace admins',
    project: 'Platform Foundation',
    projectColor: '#6366F1',
    status: TaskStatus.IN_REVIEW,
    priority: TaskPriority.LOW,
    dueDate: daysFromNow(4),
    assignee: { name: 'Priya Raman', avatarUrl: null },
  },
  {
    id: 'tsk-5',
    title: 'Rotate storage credentials for MinIO',
    project: 'Infrastructure',
    projectColor: '#0EA5E9',
    status: TaskStatus.BLOCKED,
    priority: TaskPriority.CRITICAL,
    dueDate: daysFromNow(-1),
    assignee: { name: 'Demo Owner', avatarUrl: null },
  },
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

export interface MockProject {
  id: string;
  name: string;
  key: string;
  color: string;
  status: ProjectStatus;
  completed: number;
  total: number;
  dueDate: string;
  members: string[];
}

export const PROJECT_PROGRESS: MockProject[] = [
  {
    id: 'prj-1',
    name: 'Platform Foundation',
    key: 'PLAT',
    color: '#6366F1',
    status: 'ACTIVE',
    completed: 14,
    total: 22,
    dueDate: daysFromNow(30),
    members: ['Demo Owner', 'Maya Okafor', 'Jonas Feld', 'Priya Raman'],
  },
  {
    id: 'prj-2',
    name: 'Infrastructure',
    key: 'INFRA',
    color: '#0EA5E9',
    status: 'ACTIVE',
    completed: 9,
    total: 12,
    dueDate: daysFromNow(12),
    members: ['Demo Owner', 'Jonas Feld'],
  },
  {
    id: 'prj-3',
    name: 'Customer Onboarding',
    key: 'ONB',
    color: '#10B981',
    status: 'PLANNING',
    completed: 2,
    total: 18,
    dueDate: daysFromNow(58),
    members: ['Maya Okafor', 'Priya Raman'],
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

export interface MockDeadline {
  id: string;
  title: string;
  kind: 'task' | 'ticket' | 'project';
  dueDate: string;
}

export const UPCOMING_DEADLINES: MockDeadline[] = [
  { id: 'dl-1', title: 'Rotate storage credentials', kind: 'task', dueDate: daysFromNow(-1) },
  { id: 'dl-2', title: 'Wire dashboard endpoints', kind: 'task', dueDate: daysFromNow(2) },
  { id: 'dl-3', title: 'CORE-1003 attachment timeout', kind: 'ticket', dueDate: daysFromNow(3) },
  { id: 'dl-4', title: 'Audit-log viewer review', kind: 'task', dueDate: daysFromNow(4) },
  { id: 'dl-5', title: 'Infrastructure milestone', kind: 'project', dueDate: daysFromNow(12) },
];

function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return date.toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}
