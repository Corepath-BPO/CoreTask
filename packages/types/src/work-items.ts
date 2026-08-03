import type {
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  TicketPriority,
  TicketSeverity,
  TicketStatus,
  TicketType,
} from '@coretask/contracts';

import type { PaginationMeta } from './api.js';

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
  leadId: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  /** Non-null means archived. Authoritative; `status` mirrors it for display. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  taskCount: number;
  completedTaskCount: number;
  sectionCount: number;
  lead: UserRef | null;
}

/** A project plus its ordered columns — what the board view loads. */
export interface ProjectDetail extends ProjectSummary {
  sections: Section[];
}

export interface CreateProjectPayload {
  name: string;
  /** Derived from the name when omitted. Unique within the workspace. */
  key?: string;
  description?: string;
  status?: ProjectStatus;
  color?: string;
  leadId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface UpdateProjectPayload {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  color?: string;
  leadId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface Section {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  /** Fractional; only meaningful relative to sibling sections. */
  position: number;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSectionPayload {
  name: string;
  /** Insert after this sibling. `null` places it first; omitted appends. */
  afterSectionId?: string | null;
}

export interface UpdateSectionPayload {
  name: string;
}

export interface MoveSectionPayload {
  /** Sibling to sit after. `null` moves the section to the first position. */
  afterSectionId: string | null;
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
  /** Fractional; only meaningful relative to siblings in the same section. */
  position: number;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  /** Non-null means archived. */
  archivedAt: string | null;
  estimatedMinutes: number | null;
  assigneeId: string | null;
  assignee: UserRef | null;
  createdById: string;
  subtaskCount: number;
  completedSubtaskCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A task plus the context a detail panel needs. */
export interface TaskDetail extends Task {
  subtasks: Task[];
  project: { id: string; name: string; key: string; color: string } | null;
  section: { id: string; name: string } | null;
  createdBy: UserRef | null;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  projectId?: string | null;
  sectionId?: string | null;
  parentTaskId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  /** Insert after this sibling. `null` places it first; omitted appends. */
  afterTaskId?: string | null;
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
}

export interface MoveTaskPayload {
  /** Destination column. `null` detaches the task from any section. */
  sectionId: string | null;
  /** Sibling to sit after within that column. `null` moves it to the top. */
  afterTaskId: string | null;
}

/** Rollup returned alongside a task list, computed over the whole filter. */
export interface TaskListSummary {
  total: number;
  completed: number;
  overdue: number;
  unassigned: number;
}

/** Pagination meta widened with the task rollup. */
export interface TaskListMeta extends PaginationMeta {
  summary: TaskListSummary;
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
