import type {
  CreatableWorkItemType,
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
  /**
   * What the project's "+ Add" control creates without being asked.
   *
   * Only ever a type that can actually be created — a default the API would
   * refuse renders a button that fails on click.
   */
  defaultWorkItemType: CreatableWorkItemType;
  leadId: string | null;
  /** The team that owns this project, or null when it belongs to nobody in particular. */
  teamId: string | null;
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
  team: ProjectTeamRef | null;
}

/** Just enough of a team to render a badge without loading the whole thing. */
export interface ProjectTeamRef {
  id: string;
  name: string;
  color: string;
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
  defaultWorkItemType?: CreatableWorkItemType;
  leadId?: string | null;
  teamId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface UpdateProjectPayload {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  color?: string;
  defaultWorkItemType?: CreatableWorkItemType;
  leadId?: string | null;
  teamId?: string | null;
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
  /**
   * Applied to a task moved into this section. Null means moving a card here
   * changes nothing but where it sits, which is the default.
   */
  defaultStatusId: string | null;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSectionPayload {
  name: string;
  /** Insert after this sibling. `null` places it first; omitted appends. */
  afterSectionId?: string | null;
  defaultStatusId?: string | null;
}

export interface UpdateSectionPayload {
  name?: string;
  defaultStatusId?: string | null;
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
  /** Monotonic per workspace; the numeric half of `key`. */
  number: number;
  /** Human-readable key, e.g. `CORE-1001`. Stable for the ticket's lifetime. */
  key: string;
  title: string;
  description: string | null;
  type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  severity: TicketSeverity;
  reporterId: string | null;
  reporter: UserRef | null;
  assigneeId: string | null;
  assignee: UserRef | null;
  dueDate: string | null;
  /** Derived from `status`; never set directly. */
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A ticket plus the context a detail panel needs. */
export interface TicketDetail extends Ticket {
  project: { id: string; name: string; key: string; color: string } | null;
}

export interface CreateTicketPayload {
  title: string;
  description?: string;
  projectId?: string | null;
  type?: TicketType;
  status?: TicketStatus;
  priority?: TicketPriority;
  severity?: TicketSeverity;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export interface UpdateTicketPayload {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  type?: TicketType;
  status?: TicketStatus;
  priority?: TicketPriority;
  severity?: TicketSeverity;
  assigneeId?: string | null;
  dueDate?: string | null;
}

/** Rollup returned alongside a ticket list, computed over the whole filter. */
export interface TicketListSummary {
  total: number;
  open: number;
  urgent: number;
  unassigned: number;
  resolved: number;
  overdue: number;
}

export interface TicketListMeta extends PaginationMeta {
  summary: TicketListSummary;
}

export interface Comment {
  id: string;
  workspaceId: string;
  body: string;
  /** Null when the author's account has since been removed. */
  author: UserRef | null;
  authorId: string;
  taskId: string | null;
  ticketId: string | null;
  /** Non-null once the body has been changed; the UI marks these "edited". */
  editedAt: string | null;
  /**
   * Members mentioned in `body`, resolved so the renderer can show a current
   * name rather than whatever the label said when it was typed.
   *
   * Derived from the body, not supplied by the client. A token naming someone
   * who has since left the workspace simply does not appear here — the renderer
   * falls back to the label.
   */
  mentions: UserRef[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentPayload {
  body: string;
}

export interface UpdateCommentPayload {
  body: string;
}
