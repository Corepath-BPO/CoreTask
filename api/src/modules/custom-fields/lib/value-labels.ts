import { CustomFieldType } from '@coretask/contracts';
import type { TaskCustomFieldValue } from '@coretask/types';

/** A field as the labeller needs it: its type, its options (archived too), its labels. */
export interface LabelledField {
  type: CustomFieldType;
  options: { id: string; label: string }[];
  /** The JSON settings document, whatever the row's column type says. */
  settings: unknown;
}

export interface ValueSnapshot {
  value: TaskCustomFieldValue;
  /** What the story reads: "High", "Ada Lovelace, Grace Hopper", "2026-09-12", "Yes". */
  label: string | null;
}

/**
 * The words a story uses for a value, resolved at the time of the change.
 *
 * Options and people are named now rather than by id, because a story is a
 * record of what was said: an option renamed next month, or a member who has
 * left, must not rewrite last week's line. Dates and numbers are carried raw
 * — ISO and a plain number — and the client formats them the way it formats
 * the cell, so the feed and the grid can never disagree about "1.5" versus
 * "€1.50".
 */
export function labelValue(
  field: LabelledField,
  value: TaskCustomFieldValue | null,
  peopleNames: ReadonlyMap<string, string>,
): ValueSnapshot | null {
  if (value === null) return null;

  switch (field.type) {
    case CustomFieldType.TEXT:
    case CustomFieldType.URL:
    case CustomFieldType.EMAIL:
      return { value, label: value.text };
    case CustomFieldType.NUMBER:
    case CustomFieldType.RATING:
    case CustomFieldType.FORMULA:
      return { value, label: value.number === null ? null : String(value.number) };
    case CustomFieldType.DATE:
      return { value, label: value.date };
    case CustomFieldType.CHECKBOX: {
      const settings = (field.settings ?? {}) as Record<string, unknown>;
      const yes = typeof settings['checkedLabel'] === 'string' ? settings['checkedLabel'] : 'Yes';
      const no = typeof settings['uncheckedLabel'] === 'string' ? settings['uncheckedLabel'] : 'No';
      return { value, label: value.checkbox === null ? null : value.checkbox ? yes : no };
    }
    case CustomFieldType.SINGLE_SELECT:
    case CustomFieldType.MULTI_SELECT: {
      const labels = value.optionIds
        .map((id) => field.options.find((option) => option.id === id)?.label)
        .filter((label): label is string => typeof label === 'string');
      return { value, label: labels.length > 0 ? labels.join(', ') : null };
    }
    case CustomFieldType.PEOPLE: {
      const names = value.userIds.map((id) => peopleNames.get(id) ?? 'Someone');
      return { value, label: names.length > 0 ? names.join(', ') : null };
    }
    default:
      return { value, label: null };
  }
}

/** Whether a snapshot holds anything — a cleared select and a missing row both mean "empty". */
export function isBlank(snapshot: ValueSnapshot | null): boolean {
  return snapshot === null || snapshot.label === null;
}
