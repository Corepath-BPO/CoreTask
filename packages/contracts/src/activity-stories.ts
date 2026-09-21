/**
 * What an activity line carries in `metadata` when it is a *story* — one of
 * the lines the task panel interleaves with the comments.
 *
 * The `ActivityAction` says what kind of story it is; these shapes say what
 * changed. The server writes them, the client renders them as prose
 * ("changed the due date from Sep 1 to Sep 12"), and `summary` stays the
 * plain-text fallback for any reader that does not know a shape.
 */

/** Which built-in property a field story is about. */
export const StoryField = {
  TITLE: 'title',
  DESCRIPTION: 'description',
  STATUS: 'status',
  COMPLETED: 'completed',
  SECTION: 'section',
  PRIORITY: 'priority',
  ASSIGNEE: 'assignee',
  DUE_DATE: 'dueDate',
  START_DATE: 'startDate',
} as const;
export type StoryField = (typeof StoryField)[keyof typeof StoryField];

/** A person, section, status or option: an id plus the name it had at the time. */
export interface StoryRef {
  id: string;
  label: string;
}

/** A date with the time of day beside it when one was set. */
export interface ScheduleRef {
  date: string;
  at: string | null;
}

export type StoryValue = string | StoryRef | ScheduleRef | null;

/** `UPDATED`, `ASSIGNED`, `UNASSIGNED`, `STATUS_CHANGED` on a task or ticket. */
export interface FieldStoryMetadata {
  field: StoryField;
  before: StoryValue;
  after: StoryValue;
}

/** `FIELD_CHANGED`: a custom field's value moved. */
export interface CustomFieldStoryMetadata {
  fieldId: string;
  fieldName: string;
  type: string;
  before: { value: unknown; label: string | null } | null;
  after: { value: unknown; label: string | null } | null;
  source: 'USER' | 'BULK' | 'AUTOMATION';
}

/** `ATTACHED` / `DETACHED`, filed under the item the file hangs off. */
export interface AttachmentStoryMetadata {
  attachmentId: string;
  filename: string;
  mimeType: string;
  /** Set once the file was posted with a comment; that comment shows it instead. */
  commentId?: string | null;
}

/** `FOLLOWED` / `UNFOLLOWED`. */
export interface FollowerStoryMetadata {
  users: StoryRef[];
  /** The actor added or removed themselves. */
  self: boolean;
}

/** `SUBTASK_ADDED`, filed under the parent. */
export interface SubtaskStoryMetadata {
  subtaskId: string;
  title: string;
}

/** `PINNED` / `UNPINNED`. */
export interface PinStoryMetadata {
  commentId: string;
}

export function isStoryRef(value: unknown): value is StoryRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'label' in value &&
    typeof (value as StoryRef).label === 'string'
  );
}

export function isScheduleRef(value: unknown): value is ScheduleRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'date' in value &&
    typeof (value as ScheduleRef).date === 'string'
  );
}
