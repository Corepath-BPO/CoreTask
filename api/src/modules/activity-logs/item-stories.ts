import {
  ActivityAction,
  StoryField,
  type FieldStoryMetadata,
  type ScheduleRef,
  type StoryRef,
} from '@coretask/contracts';

/**
 * What a task or ticket looked like at one moment, reduced to the properties
 * a story can be about. Every write path builds two of these — before and
 * after — and hands them to `diffItemStories`, so "one place each change is
 * described" is a function rather than something each service remembers.
 */
export interface ItemSnapshot {
  title: string;
  description: string | null;
  status: StoryRef | null;
  completedAt: Date | string | null;
  section: StoryRef | null;
  priority: StoryRef | null;
  assignee: StoryRef | null;
  dueDate: Date | string | null;
  dueAt: Date | string | null;
  startDate: Date | string | null;
  startAt: Date | string | null;
}

export interface StoryDraft {
  action: ActivityAction;
  /** Plain-text fallback for readers that do not know the metadata shape. */
  summary: string;
  metadata: FieldStoryMetadata;
}

export type ItemWord = 'task' | 'ticket';

const iso = (value: Date | string | null | undefined): string | null =>
  value == null ? null : value instanceof Date ? value.toISOString() : value;

const sameRef = (a: StoryRef | null, b: StoryRef | null): boolean =>
  (a?.id ?? null) === (b?.id ?? null);

const schedule = (date: Date | string | null, at: Date | string | null): ScheduleRef | null => {
  const day = iso(date);
  return day === null ? null : { date: day, at: iso(at) };
};

const label = (ref: StoryRef | null, fallback: string): string => ref?.label ?? fallback;

function scheduleStory(
  field: typeof StoryField.DUE_DATE | typeof StoryField.START_DATE,
  before: ScheduleRef | null,
  after: ScheduleRef | null,
): StoryDraft {
  const noun = field === StoryField.DUE_DATE ? 'due date' : 'start date';
  const summary =
    after === null
      ? `Removed the ${noun}`
      : before === null
        ? `Set the ${noun}`
        : `Changed the ${noun}`;

  return { action: ActivityAction.UPDATED, summary, metadata: { field, before, after } };
}

/**
 * One story per property that moved, in the order the panel reads them.
 *
 * Completion and status are one axis for a task — status *is* completion — so
 * a task going to DONE reads "marked complete" and not also "changed status".
 * A ticket keeps its status story instead, because Open → Triaged → Resolved
 * is the thing somebody wants to see.
 */
export function diffItemStories(
  before: ItemSnapshot,
  after: ItemSnapshot,
  itemWord: ItemWord,
): StoryDraft[] {
  const stories: StoryDraft[] = [];

  if (before.title !== after.title) {
    stories.push({
      action: ActivityAction.UPDATED,
      summary: `Renamed the ${itemWord} to “${after.title}”`,
      metadata: { field: StoryField.TITLE, before: before.title, after: after.title },
    });
  }

  if ((before.description ?? null) !== (after.description ?? null)) {
    // The text itself is not carried: a description can be twenty thousand
    // characters, and "edited" is what the feed says about it.
    stories.push({
      action: ActivityAction.UPDATED,
      summary: 'Edited the description',
      metadata: { field: StoryField.DESCRIPTION, before: null, after: null },
    });
  }

  if (!sameRef(before.assignee, after.assignee)) {
    stories.push(
      after.assignee
        ? {
            action: ActivityAction.ASSIGNED,
            summary: `Assigned to ${after.assignee.label}`,
            metadata: {
              field: StoryField.ASSIGNEE,
              before: before.assignee,
              after: after.assignee,
            },
          }
        : {
            action: ActivityAction.UNASSIGNED,
            summary: `Unassigned ${label(before.assignee, 'the assignee')}`,
            metadata: { field: StoryField.ASSIGNEE, before: before.assignee, after: null },
          },
    );
  }

  const wasDone = iso(before.completedAt) !== null;
  const isDone = iso(after.completedAt) !== null;
  const statusMoved = !sameRef(before.status, after.status);

  if (itemWord === 'task' && wasDone !== isDone) {
    stories.push({
      action: ActivityAction.STATUS_CHANGED,
      summary: isDone ? 'Marked the task complete' : 'Marked the task incomplete',
      metadata: {
        field: StoryField.COMPLETED,
        before: wasDone ? 'complete' : 'incomplete',
        after: isDone ? 'complete' : 'incomplete',
      },
    });
  } else if (statusMoved) {
    stories.push({
      action: ActivityAction.STATUS_CHANGED,
      summary: `Changed status from ${label(before.status, 'none')} to ${label(after.status, 'none')}`,
      metadata: { field: StoryField.STATUS, before: before.status, after: after.status },
    });
  } else if (wasDone !== isDone) {
    stories.push({
      action: ActivityAction.STATUS_CHANGED,
      summary: isDone ? `Marked the ${itemWord} complete` : `Marked the ${itemWord} incomplete`,
      metadata: {
        field: StoryField.COMPLETED,
        before: wasDone ? 'complete' : 'incomplete',
        after: isDone ? 'complete' : 'incomplete',
      },
    });
  }

  if (!sameRef(before.section, after.section)) {
    stories.push({
      action: ActivityAction.UPDATED,
      summary: `Moved from ${label(before.section, 'no section')} to ${label(after.section, 'no section')}`,
      metadata: { field: StoryField.SECTION, before: before.section, after: after.section },
    });
  }

  if (!sameRef(before.priority, after.priority)) {
    stories.push({
      action: ActivityAction.UPDATED,
      summary: `Changed priority from ${label(before.priority, 'none')} to ${label(after.priority, 'none')}`,
      metadata: { field: StoryField.PRIORITY, before: before.priority, after: after.priority },
    });
  }

  // A changed time counts as a changed date: 3 PM Friday to 5 PM Friday moved
  // the deadline, whatever the calendar says.
  if (iso(before.dueDate) !== iso(after.dueDate) || iso(before.dueAt) !== iso(after.dueAt)) {
    stories.push(
      scheduleStory(
        StoryField.DUE_DATE,
        schedule(before.dueDate, before.dueAt),
        schedule(after.dueDate, after.dueAt),
      ),
    );
  }

  if (
    iso(before.startDate) !== iso(after.startDate) ||
    iso(before.startAt) !== iso(after.startAt)
  ) {
    stories.push(
      scheduleStory(
        StoryField.START_DATE,
        schedule(before.startDate, before.startAt),
        schedule(after.startDate, after.startAt),
      ),
    );
  }

  return stories;
}

/** `IN_PROGRESS` → `In progress`, for the enum-backed statuses and priorities. */
export function humanizeEnum(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An enum value as a story ref, or null for the "nothing chosen" member. */
export function enumRef(value: string | null | undefined, none = 'NONE'): StoryRef | null {
  if (!value || value === none) return null;
  return { id: value, label: humanizeEnum(value) };
}

/** Assignee, section and the like, resolved by the caller. */
export interface SnapshotRefs {
  assignee?: StoryRef | null;
  section?: StoryRef | null;
}

/** A task row from Prisma, as a snapshot. Status and priority are the legacy enums. */
export function snapshotFromTask(
  task: {
    title: string;
    description: string | null;
    status: string;
    priority: string;
    completedAt: Date | null;
    dueDate: Date | null;
    dueAt: Date | null;
    startDate: Date | null;
    startAt: Date | null;
  },
  refs: SnapshotRefs = {},
): ItemSnapshot {
  return {
    title: task.title,
    description: task.description,
    status: enumRef(task.status),
    completedAt: task.completedAt,
    section: refs.section ?? null,
    priority: enumRef(task.priority),
    assignee: refs.assignee ?? null,
    dueDate: task.dueDate,
    dueAt: task.dueAt,
    startDate: task.startDate,
    startAt: task.startAt,
  };
}

/** A ticket row from Prisma. Resolution stands in for completion. */
export function snapshotFromTicket(
  ticket: {
    title: string;
    description: string | null;
    status: string;
    priority: string;
    resolvedAt: Date | null;
    dueDate: Date | null;
  },
  refs: SnapshotRefs = {},
): ItemSnapshot {
  return {
    title: ticket.title,
    description: ticket.description,
    status: enumRef(ticket.status),
    completedAt: ticket.resolvedAt,
    section: refs.section ?? null,
    priority: enumRef(ticket.priority),
    assignee: refs.assignee ?? null,
    dueDate: ticket.dueDate,
    dueAt: null,
    startDate: null,
    startAt: null,
  };
}

/** A resolved work item, as the shared List/Board service holds it. */
export function snapshotFromWorkItem(
  item: {
    title: string;
    description: string | null;
    status: { id: string; name: string } | null;
    priority: { id: string; name: string } | null;
    assignees: { id: string; name: string }[];
    completedAt: string | null;
    dueDate: string | null;
    dueAt: string | null;
    startDate: string | null;
    startAt: string | null;
  },
  refs: SnapshotRefs = {},
): ItemSnapshot {
  const first = item.assignees[0];

  return {
    title: item.title,
    description: item.description,
    status: item.status ? { id: item.status.id, label: item.status.name } : null,
    completedAt: item.completedAt,
    section: refs.section ?? null,
    priority: item.priority ? { id: item.priority.id, label: item.priority.name } : null,
    assignee:
      refs.assignee !== undefined
        ? refs.assignee
        : first
          ? { id: first.id, label: first.name }
          : null,
    dueDate: item.dueDate,
    dueAt: item.dueAt,
    startDate: item.startDate,
    startAt: item.startAt,
  };
}
