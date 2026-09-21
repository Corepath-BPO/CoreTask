import { FilterOperator, RelativeDate, SystemField } from '@coretask/contracts';
import type { ViewFilterCondition, ViewSettings } from '@coretask/types';

/**
 * Asana's one-click filters at the top of the Filter popover.
 *
 * Each is a named shape of ordinary settings rather than a flag of its own,
 * so "Just my tasks" is exactly `assigneeId is any of [me]` — the row list
 * below shows it, the API compiles it, and clearing the chip removes that one
 * condition. A separate flag would have been a second filter language.
 */
export const QuickFilter = {
  INCOMPLETE: 'INCOMPLETE',
  COMPLETED: 'COMPLETED',
  MINE: 'MINE',
  DUE_THIS_WEEK: 'DUE_THIS_WEEK',
  DUE_NEXT_WEEK: 'DUE_NEXT_WEEK',
} as const;
export type QuickFilter = (typeof QuickFilter)[keyof typeof QuickFilter];

export const QUICK_FILTER_LABEL: Record<QuickFilter, string> = {
  INCOMPLETE: 'Incomplete tasks',
  COMPLETED: 'Completed tasks',
  MINE: 'Just my tasks',
  DUE_THIS_WEEK: 'Due this week',
  DUE_NEXT_WEEK: 'Due next week',
};

export const QUICK_FILTERS = Object.values(QuickFilter);

type Settings = Pick<ViewSettings, 'filters' | 'showCompleted'>;

/** The conditions a quick filter is made of. `INCOMPLETE` is the one flag. */
function conditionsFor(quick: QuickFilter, meId: string): ViewFilterCondition[] {
  switch (quick) {
    case QuickFilter.INCOMPLETE:
      return [];
    case QuickFilter.COMPLETED:
      return [{ field: SystemField.COMPLETED_AT, operator: FilterOperator.IS_NOT_EMPTY }];
    case QuickFilter.MINE:
      return [{ field: SystemField.ASSIGNEE, operator: FilterOperator.IN, value: [meId] }];
    case QuickFilter.DUE_THIS_WEEK:
      return [
        {
          field: SystemField.DUE_DATE,
          operator: FilterOperator.GREATER_THAN_OR_EQUAL,
          value: RelativeDate.START_OF_WEEK,
        },
        {
          field: SystemField.DUE_DATE,
          operator: FilterOperator.LESS_THAN_OR_EQUAL,
          value: RelativeDate.END_OF_WEEK,
        },
      ];
    case QuickFilter.DUE_NEXT_WEEK:
      return [
        {
          field: SystemField.DUE_DATE,
          operator: FilterOperator.GREATER_THAN_OR_EQUAL,
          value: RelativeDate.START_OF_NEXT_WEEK,
        },
        {
          field: SystemField.DUE_DATE,
          operator: FilterOperator.LESS_THAN_OR_EQUAL,
          value: RelativeDate.END_OF_NEXT_WEEK,
        },
      ];
  }
}

function sameCondition(a: ViewFilterCondition, b: ViewFilterCondition): boolean {
  return (
    a.field === b.field &&
    a.operator === b.operator &&
    JSON.stringify(a.value ?? null) === JSON.stringify(b.value ?? null)
  );
}

export function isQuickFilterActive(settings: Settings, quick: QuickFilter, meId: string): boolean {
  if (quick === QuickFilter.INCOMPLETE) return settings.showCompleted === false;
  const wanted = conditionsFor(quick, meId);
  return wanted.every((condition) =>
    settings.filters.conditions.some((existing) => sameCondition(existing, condition)),
  );
}

/**
 * Turns a quick filter on or off, touching only its own conditions.
 *
 * Two week filters cannot both hold, so switching one on drops the other;
 * "Incomplete" and "Completed" likewise. Anything else somebody added by hand
 * stays exactly as it was.
 */
export function toggleQuickFilter(
  settings: Settings,
  quick: QuickFilter,
  meId: string,
): Partial<ViewSettings> {
  const active = isQuickFilterActive(settings, quick, meId);

  if (quick === QuickFilter.INCOMPLETE) {
    return {
      showCompleted: active,
      ...(active
        ? {}
        : {
            filters: {
              ...settings.filters,
              conditions: without(
                settings.filters.conditions,
                conditionsFor(QuickFilter.COMPLETED, meId),
              ),
            },
          }),
    };
  }

  const exclusive: QuickFilter[] =
    quick === QuickFilter.DUE_THIS_WEEK
      ? [QuickFilter.DUE_NEXT_WEEK]
      : quick === QuickFilter.DUE_NEXT_WEEK
        ? [QuickFilter.DUE_THIS_WEEK]
        : [];

  let conditions = without(settings.filters.conditions, conditionsFor(quick, meId));
  for (const other of exclusive) conditions = without(conditions, conditionsFor(other, meId));
  if (!active) conditions = [...conditions, ...conditionsFor(quick, meId)];

  return {
    filters: { ...settings.filters, conditions },
    ...(quick === QuickFilter.COMPLETED && !active ? { showCompleted: true } : {}),
  };
}

function without(
  conditions: ViewFilterCondition[],
  remove: ViewFilterCondition[],
): ViewFilterCondition[] {
  return conditions.filter((condition) => !remove.some((gone) => sameCondition(condition, gone)));
}
