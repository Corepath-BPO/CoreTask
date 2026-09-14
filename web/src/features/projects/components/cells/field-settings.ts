import { CustomFieldType } from '@coretask/contracts';
import type { CustomField } from '@coretask/types';

/**
 * Reads a field's settings for the cell that renders it.
 *
 * The settings document has been validated and defaulted by the API, so every
 * key it should have is present — but a cell must still survive a field created
 * before a setting existed, or by a client one version ahead. Each reader takes
 * a fallback and never throws, because a settings key nobody recognises should
 * cost a default, not a blank column.
 */
function read<T>(field: CustomField, key: string, fallback: T): T {
  const value = (field.settings as Record<string, unknown> | undefined)?.[key];
  return (value as T) ?? fallback;
}

/** Long text needs somewhere to expand; short text belongs inline. */
export function isLongText(field: CustomField): boolean {
  return read<string>(field, 'textMode', 'SHORT') === 'LONG';
}

/** A date carrying a time needs a different input and a different format. */
export function wantsTime(field: CustomField): boolean {
  return read<string>(field, 'dateMode', 'DATE_ONLY') === 'DATE_TIME';
}

/** Whether a people field holds one person or several. */
export function allowsManyPeople(field: CustomField): boolean {
  return read<string>(field, 'peopleMode', 'SINGLE') === 'MULTIPLE';
}

export function placeholderFor(field: CustomField): string | undefined {
  const value = read<string | undefined>(field, 'placeholder', undefined);
  return value?.trim() ? value : undefined;
}

export function maxLengthFor(field: CustomField): number | undefined {
  return read<number | undefined>(field, 'maxLength', undefined);
}

export function checkboxLabel(field: CustomField, checked: boolean): string | undefined {
  const value = read<string | undefined>(
    field,
    checked ? 'checkedLabel' : 'uncheckedLabel',
    undefined,
  );
  return value?.trim() ? value : undefined;
}

export type NumberFormatKind = 'PLAIN' | 'PERCENTAGE' | 'CURRENCY' | 'CUSTOM_UNIT';

export interface NumberFormat {
  kind: NumberFormatKind;
  decimalPlaces: number;
  /** Kept for the cells that only ask this one question. */
  isPercentage: boolean;
  /** ISO 4217, present when `kind` is CURRENCY. */
  currencyCode: string | undefined;
  /** "pts", "hrs" — present when `kind` is CUSTOM_UNIT. */
  unitLabel: string | undefined;
  unitPosition: 'PREFIX' | 'SUFFIX';
  min: number | undefined;
  max: number | undefined;
}

/** NUMBER and FORMULA share the display half of their settings. */
export function numberFormat(field: CustomField): NumberFormat {
  const kind = read<NumberFormatKind>(field, 'numberFormat', 'PLAIN');

  return {
    kind,
    decimalPlaces: read(field, 'decimalPlaces', 0),
    isPercentage: kind === 'PERCENTAGE',
    currencyCode: read<string | undefined>(field, 'currencyCode', undefined),
    unitLabel: read<string | undefined>(field, 'unitLabel', undefined),
    unitPosition: read<'PREFIX' | 'SUFFIX'>(field, 'unitPosition', 'SUFFIX'),
    min: read<number | undefined>(field, 'minValue', undefined),
    max: read<number | undefined>(field, 'maxValue', undefined),
  };
}

/**
 * How a stored number reads in a cell.
 *
 * Formatted only for display. The editor still shows the raw value, because
 * rounding what somebody typed the moment they stop looking at it is how a
 * "12.5" becomes "13" without anyone deciding it should.
 *
 * A currency goes through `Intl`, which knows the symbol, the grouping and
 * the side the symbol sits on for the reader's locale — nothing here has to.
 * A code the runtime does not know falls back to "EUR 1.50" rather than to
 * a blank cell.
 */
export function formatNumber(value: number, format: NumberFormat): string {
  const text = value.toFixed(format.decimalPlaces);

  switch (format.kind) {
    case 'PERCENTAGE':
      return `${text}%`;
    case 'CURRENCY': {
      const code = format.currencyCode ?? '';
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: code,
          minimumFractionDigits: format.decimalPlaces,
          maximumFractionDigits: format.decimalPlaces,
        }).format(value);
      } catch {
        return code ? `${code} ${text}` : text;
      }
    }
    case 'CUSTOM_UNIT': {
      const unit = format.unitLabel?.trim();
      if (!unit) return text;
      return format.unitPosition === 'PREFIX' ? `${unit} ${text}` : `${text} ${unit}`;
    }
    default:
      return text;
  }
}

/** How many stars a rating field offers; the API's default when unset. */
export function maxRating(field: CustomField): number {
  const stars = read<number>(field, 'maxRating', 5);
  return Number.isInteger(stars) && stars >= 1 ? stars : 5;
}

/** A formula's stored expression, referencing fields by `{field:<id>}`. */
export function formulaExpression(field: CustomField): string {
  return read<string>(field, 'expression', '');
}

/**
 * Splits an ISO timestamp into what the matching input element expects.
 *
 * `<input type="date">` wants `yyyy-mm-dd` and `datetime-local` wants
 * `yyyy-mm-ddThh:mm`, and neither accepts the other's format — a date field
 * switched to carry a time would otherwise open an editor with nothing in it.
 */
export function toInputValue(iso: string | null | undefined, withTime: boolean): string {
  if (!iso) return '';
  return withTime ? iso.slice(0, 16) : iso.slice(0, 10);
}

/**
 * The reverse: what the input gives back, as something the API will store.
 *
 * Both branches read the input as UTC, because `toInputValue` writes UTC.
 *
 * The time branch used to hand `new Date` a bare `yyyy-mm-ddThh:mm`, which the
 * language parses as *local* time — while the value it was parsing had been
 * sliced out of a UTC timestamp. So every edit moved the field by the reader's
 * offset: a 14:30 deadline opened as 14:30, saved as 06:30, and opened as 06:30
 * the next time. Nothing rejected it, and eight hours is a plausible enough
 * time that the drift only reads as wrong once it has happened twice.
 *
 * UTC on both sides rather than local on both, so this agrees with the
 * date-only branch below, which has always pinned to UTC midnight. The two must
 * mean the same thing by the stored instant or switching a field between them
 * would move it.
 */
export function fromInputValue(raw: string, withTime: boolean): string | null {
  if (!raw) return null;
  if (!withTime) return new Date(`${raw}T00:00:00.000Z`).toISOString();

  // Some browsers include seconds once they have been set; most give minutes.
  const seconds = raw.length > 16 ? '' : ':00';

  return new Date(`${raw}${seconds}.000Z`).toISOString();
}

/** The types whose cells are a plain input plus a rendering. */
export const SCALAR_INPUT_TYPE: Partial<
  Record<CustomFieldType, 'text' | 'number' | 'url' | 'email'>
> = {
  [CustomFieldType.TEXT]: 'text',
  [CustomFieldType.NUMBER]: 'number',
  [CustomFieldType.URL]: 'url',
  [CustomFieldType.EMAIL]: 'email',
};
