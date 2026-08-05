import type {
  TaskPriority,
  TaskStatus,
  TicketPriority,
  TicketSeverity,
  TicketStatus,
  TicketType,
  WorkItemType,
} from '@coretask/contracts';

import type { UserRef } from './work-items.js';

/**
 * One row of a project, whatever it is underneath.
 *
 * A project owns work items; List and Board are two drawings of the same set.
 * Both read this shape, so a field means the same thing in both — the previous
 * arrangement had a board card and a list row carrying differently-named
 * versions of the same value, and keeping them in step was manual.
 *
 * Shared fields sit at the top level; anything true of only one kind lives in
 * `details`. That split is what lets the List render a grid without caring what
 * backs each row, while a ticket keeps its key, severity and reporter.
 */
export interface ProjectWorkItem {
  id: string;
  type: WorkItemType;
  workspaceId: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  /** Fractional; only comparable within one section. */
  position: number;

  /**
   * Resolved for display rather than passed through raw.
   *
   * Tasks carry status/priority *definitions*; tickets carry their own enums.
   * Resolving both to a label and a colour token here is what lets one cell
   * render either — the alternative is every consumer switching on `type`.
   */
  status: WorkItemStateRef | null;
  priority: WorkItemStateRef | null;

  assignees: UserRef[];
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  /** Non-null means archived. */
  archivedAt: string | null;

  subtaskCount: number;
  completedSubtaskCount: number;

  /**
   * Empty for types whose values are not stored yet — see
   * `docs/database/work-item-compatibility.md`. Empty means "none", never
   * "not loaded"; the query decides whether to include them at all.
   */
  customFieldValues: WorkItemCustomFieldValue[];

  details: WorkItemDetails;

  createdById: string;
  createdBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
}

/** A status or priority, already resolved to something renderable. */
export interface WorkItemStateRef {
  id: string;
  name: string;
  colorToken: string;
}

export interface WorkItemCustomFieldValue {
  fieldId: string;
  textValue: string | null;
  numberValue: number | null;
  dateValue: string | null;
  booleanValue: boolean | null;
  optionIds: string[];
  userIds: string[];
}

/**
 * The part that differs by type.
 *
 * A discriminated union rather than a bag of optional fields, so reading
 * `details.key` forces a check that this is in fact a ticket.
 */
export type WorkItemDetails = TaskDetails | TicketDetails;

export interface TaskDetails {
  kind: 'TASK';
  estimatedMinutes: number | null;
  /**
   * The legacy enums, alongside the resolved `status`/`priority` above.
   *
   * Both are needed and they are not interchangeable. `status` resolves to a
   * definition when one exists, and its id is then a uuid — fine for display,
   * useless to a control that renders a fixed set of enum badges. A ticket
   * carries its raw values for the same reason; a task doing otherwise made the
   * List print a uuid where a status should be.
   */
  rawStatus: TaskStatus;
  rawPriority: TaskPriority;
}

export interface TicketDetails {
  kind: 'TICKET';
  /** Workspace-scoped, e.g. `CORE-1042`. Quoted in email; never reissued. */
  key: string;
  number: number;
  ticketType: TicketType;
  severity: TicketSeverity;
  reporter: UserRef | null;
  /** The raw enums, for editors that must round-trip them exactly. */
  rawStatus: TicketStatus;
  rawPriority: TicketPriority;
  resolvedAt: string | null;
  closedAt: string | null;
}

/** What both views ask for. */
export interface ProjectWorkItemQuery {
  /** Restrict to these types. Omitted means every type the project holds. */
  types?: WorkItemType[];
  sectionId?: string | null;
  search?: string;
  includeArchived?: boolean;
  includeCustomFields?: boolean;
  includeSubtaskSummary?: boolean;
  cursor?: string | null;
  limit?: number;
}

export interface ProjectWorkItemPage {
  items: ProjectWorkItem[];
  /** Null when there is nothing further. */
  nextCursor: string | null;
}

/**
 * One creation request for every type.
 *
 * Deliberately not a union of per-type payloads: the caller is a button that
 * knows a title and a section, and making it assemble a different shape per
 * type is how the List and the Board drifted apart in the first place. The
 * service maps this onto whichever record the type needs.
 */
export interface CreateWorkItemPayload {
  type: WorkItemType;
  title: string;
  description?: string | null;
  sectionId?: string | null;
  parentId?: string | null;
  statusId?: string | null;
  priorityId?: string | null;
  assigneeIds?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  /** Insert after this sibling. `null` places it first; omitted appends. */
  afterId?: string | null;
  customFieldValues?: Record<string, unknown>;
  /**
   * Echoed back on the socket event so the originating client can recognise
   * its own write and skip re-applying it over its optimistic row.
   */
  correlationId?: string;
}

export interface UpdateWorkItemPayload {
  title?: string;
  description?: string | null;
  statusId?: string | null;
  priorityId?: string | null;
  assigneeIds?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  correlationId?: string;
}

export interface MoveWorkItemPayload {
  /** Destination section. `null` detaches the item from every section. */
  targetSectionId: string | null;
  /** Sibling to land after. `null` means first. */
  afterId?: string | null;
  beforeId?: string | null;
  correlationId?: string;
}
