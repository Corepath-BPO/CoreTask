import {
  ActivityAction,
  StoryField,
  isScheduleRef,
  isStoryRef,
  type FieldStoryMetadata,
  type StoryValue,
} from '@coretask/contracts';
import type { ActivityEntry } from '@coretask/types';

import { formatDate } from '@/lib/utils';

/** What the reader is looking at, so a story can say "this task" or "this ticket". */
export interface StoryContext {
  itemWord: 'task' | 'ticket';
  /** The reader's own id, so "assigned to Ada" becomes "assigned to you". */
  meId?: string | undefined;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function person(value: StoryValue, meId: string | undefined): string {
  if (!isStoryRef(value)) return 'someone';
  return value.id === meId ? 'you' : value.label;
}

function name(value: StoryValue, fallback: string): string {
  return isStoryRef(value) ? value.label : fallback;
}

function when(value: StoryValue): string {
  if (!isScheduleRef(value)) return 'nothing';
  const day = formatDate(value.date);
  return value.at ? `${day} at ${timeFormat.format(new Date(value.at))}` : day;
}

function scheduleText(noun: string, metadata: FieldStoryMetadata): string {
  if (metadata.after === null) return `removed the ${noun}`;
  if (metadata.before === null) return `set the ${noun} to ${when(metadata.after)}`;
  return `changed the ${noun} from ${when(metadata.before)} to ${when(metadata.after)}`;
}

function fieldStory(metadata: FieldStoryMetadata, ctx: StoryContext): string | null {
  const item = `this ${ctx.itemWord}`;

  switch (metadata.field) {
    case StoryField.TITLE:
      return typeof metadata.after === 'string'
        ? `renamed ${item} to “${metadata.after}”`
        : `renamed ${item}`;
    case StoryField.DESCRIPTION:
      return 'edited the description';
    case StoryField.ASSIGNEE:
      if (metadata.after === null) return `unassigned ${person(metadata.before, ctx.meId)}`;
      return isStoryRef(metadata.after) && metadata.after.id === ctx.meId
        ? 'assigned this to you'
        : `assigned ${item} to ${person(metadata.after, ctx.meId)}`;
    case StoryField.COMPLETED:
      return metadata.after === 'complete'
        ? `marked ${item} complete`
        : `marked ${item} incomplete`;
    case StoryField.STATUS:
      return `changed the status from ${name(metadata.before, 'none')} to ${name(metadata.after, 'none')}`;
    case StoryField.SECTION:
      return `moved ${item} from ${name(metadata.before, 'no section')} to ${name(metadata.after, 'no section')}`;
    case StoryField.PRIORITY:
      return `changed the priority from ${name(metadata.before, 'none')} to ${name(metadata.after, 'none')}`;
    case StoryField.DUE_DATE:
      return scheduleText('due date', metadata);
    case StoryField.START_DATE:
      return scheduleText('start date', metadata);
    default:
      return null;
  }
}

function label(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const text = (value as { label?: unknown }).label;
  return typeof text === 'string' && text.length > 0 ? text : null;
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'someone';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A story as the panel reads it, without the actor: "changed the due date
 * from Sep 1 to Sep 12". The row puts the name in front. Anything this does
 * not recognise falls back to the server's `summary`, so an old line or a
 * shape from a newer server still reads as something.
 */
export function describeStory(entry: ActivityEntry, ctx: StoryContext): string {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const item = `this ${ctx.itemWord}`;

  switch (entry.action) {
    case ActivityAction.CREATED:
      return `created ${item}`;
    case ActivityAction.ARCHIVED:
      return `archived ${item}`;
    case ActivityAction.RESTORED:
      return `restored ${item}`;
    case ActivityAction.UPDATED:
    case ActivityAction.ASSIGNED:
    case ActivityAction.UNASSIGNED:
    case ActivityAction.STATUS_CHANGED: {
      if (typeof meta['field'] === 'string') {
        const text = fieldStory(meta as unknown as FieldStoryMetadata, ctx);
        if (text) return text;
      }
      return lowerFirst(entry.summary);
    }
    case ActivityAction.FIELD_CHANGED: {
      const field = typeof meta['fieldName'] === 'string' ? meta['fieldName'] : 'a field';
      const before = label(meta['before']);
      const after = label(meta['after']);
      if (after === null) return `cleared ${field}`;
      if (before === null) return `set ${field} to ${after}`;
      return `changed ${field} from ${before} to ${after}`;
    }
    case ActivityAction.ATTACHED:
      return typeof meta['filename'] === 'string'
        ? `attached ${meta['filename']}`
        : 'attached a file';
    case ActivityAction.DETACHED:
      return typeof meta['filename'] === 'string'
        ? `removed ${meta['filename']}`
        : 'removed a file';
    case ActivityAction.FOLLOWED: {
      if (meta['self'] === true) return `joined ${item}`;
      const users = Array.isArray(meta['users'])
        ? (meta['users'] as unknown[]).map((user) =>
            isStoryRef(user) ? (user.id === ctx.meId ? 'you' : user.label) : 'someone',
          )
        : [];
      return `added ${list(users)} as ${users.length === 1 ? 'a collaborator' : 'collaborators'}`;
    }
    case ActivityAction.UNFOLLOWED: {
      if (meta['self'] === true) return `left ${item}`;
      const users = Array.isArray(meta['users'])
        ? (meta['users'] as unknown[]).map((user) =>
            isStoryRef(user) ? (user.id === ctx.meId ? 'you' : user.label) : 'someone',
          )
        : [];
      return `removed ${list(users)} from the collaborators`;
    }
    case ActivityAction.SUBTASK_ADDED:
      return typeof meta['title'] === 'string'
        ? `added subtask “${meta['title']}”`
        : 'added a subtask';
    case ActivityAction.PINNED:
      return 'pinned a comment';
    case ActivityAction.UNPINNED:
      return 'unpinned a comment';
    default:
      return lowerFirst(entry.summary);
  }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
