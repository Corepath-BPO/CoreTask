import type {
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  TicketPriority,
  TicketSeverity,
  TicketStatus,
  TicketType,
} from '@coretask/contracts';

/** Minimal user projection embedded in list responses. */
export interface UserRef {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  status: ProjectStatus;
  color: string;
  startDate: string | null;
  dueDate: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  taskCount: number;
  completedTaskCount: number;
  lead: UserRef | null;
}

export interface Section {
  id: string;
  projectId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string | null;
  sectionId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  assignee: UserRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: string;
  workspaceId: string;
  projectId: string | null;
  /** Human-readable key, e.g. `CORE-1001`. */
  key: string;
  title: string;
  description: string | null;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  severity: TicketSeverity;
  reporter: UserRef | null;
  assignee: UserRef | null;
  dueDate: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  workspaceId: string;
  body: string;
  author: UserRef;
  taskId: string | null;
  ticketId: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
