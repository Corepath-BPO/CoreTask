import { CONDITION_OPERATOR, type ConditionOperator } from '@coretask/contracts';

/**
 * The comparisons that go through no filter — `DIRECT_CONDITION_OPERATORS`.
 *
 * `conditionHolds` translates every other operator to a `FilterOperator` and
 * switches on that. These have nothing to translate to: "is checked" has no
 * right-hand side, "between" has two, the three date checks compare against
 * the clock rather than against a configured value, and the two text ones are
 * shapes the filter bar never offered. They are evaluated here on
 * the operator as the builder wrote it.
 *
 * Kept out of the service so the date arithmetic can be tested against a
 * chosen `now` rather than the wall clock. An unparseable side fails the check
 * rather than throwing — a condition nobody can evaluate blocks the rule, it
 * does not crash the run.
 */
export function directComparison(
  operator: ConditionOperator,
  actual: unknown,
  expected: unknown,
  now: Date = new Date(),
): boolean {
  switch (operator) {
    /*
     * Strictly `true`, not truthy. A checkbox nobody has ticked reads as null
     * off the row, and null is "not checked" — which is what "is not checked"
     * has to hold for, or a rule about untouched tasks would never fire.
     */
    case CONDITION_OPERATOR.IS_CHECKED:
      return actual === true;
    case CONDITION_OPERATOR.IS_NOT_CHECKED:
      return actual !== true;

    // Inclusive at both ends, and either way round: "between 10 and 5" is the
    // same range as "between 5 and 10", not an empty one.
    case CONDITION_OPERATOR.BETWEEN: {
      if (!Array.isArray(expected) || expected.length < 2) return false;

      const value = asNumber(actual);
      const low = asNumber(expected[0]);
      const high = asNumber(expected[1]);
      if (value === null || low === null || high === null) return false;

      return value >= Math.min(low, high) && value <= Math.max(low, high);
    }

    /*
     * Dates, compared as UTC calendar days.
     *
     * That is the shape every date column holds (`toCalendarDate`), and the
     * shape a person means: a task due "today" is due today whatever hour the
     * rule happens to run at. "Overdue" is a day already gone, and "within the
     * next N days" runs from today through the Nth day after it, inclusive —
     * so "within the next 0 days" is "today", and the count cannot be negative.
     */
    case CONDITION_OPERATOR.IS_TODAY:
    case CONDITION_OPERATOR.IS_OVERDUE:
    case CONDITION_OPERATOR.IS_WITHIN_NEXT: {
      const day = calendarDay(actual);
      if (day === null) return false;

      const today = calendarDay(now) as number;

      if (operator === CONDITION_OPERATOR.IS_TODAY) return day === today;
      if (operator === CONDITION_OPERATOR.IS_OVERDUE) return day < today;

      const days = Number(expected);
      if (!Number.isFinite(days) || days < 0) return false;

      return day >= today && day <= today + Math.floor(days) * DAY_MS;
    }

    // Text, matched the way "contains" is: case-insensitively, both sides as
    // strings, and never against a value nobody has typed.
    case CONDITION_OPERATOR.STARTS_WITH:
    case CONDITION_OPERATOR.ENDS_WITH: {
      if (actual === null || actual === undefined) return false;

      const left = String(actual).toLowerCase();
      const right = String(expected ?? '').toLowerCase();
      if (right === '') return false;

      return operator === CONDITION_OPERATOR.STARTS_WITH
        ? left.startsWith(right)
        : left.endsWith(right);
    }

    default:
      return false;
  }
}

/** The four comparisons a number makes against one value. */
export type NumberComparison =
  'GREATER_THAN' | 'LESS_THAN' | 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN_OR_EQUAL';

/**
 * A number against a number, and false when either side is empty.
 *
 * `Number(null)` is 0, so "Estimate is less than 3" used to hold for a task
 * with no estimate, and an empty formula counted as no days at all. A view
 * filter never matched an empty field (SQL compares nothing with NULL), and
 * `BETWEEN` here already refused one, so a rule now reads the same way. "Is
 * empty" is the question for an empty field.
 */
export function numberComparison(
  operator: NumberComparison,
  actual: unknown,
  expected: unknown,
): boolean {
  const left = asNumber(actual);
  const right = asNumber(expected);
  if (left === null || right === null) return false;

  switch (operator) {
    case 'GREATER_THAN':
      return left > right;
    case 'LESS_THAN':
      return left < right;
    case 'GREATER_THAN_OR_EQUAL':
      return left >= right;
    case 'LESS_THAN_OR_EQUAL':
      return left <= right;
  }
}

/**
 * A value as a number, or null when there is none: empty, blank, a flag, a
 * list, or text that is not a number. Never 0 for nothing.
 */
function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || Array.isArray(value)) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC midnight of the day this value falls on, or null when it is no date. */
function calendarDay(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  const at = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(at.getTime())) return null;

  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}
