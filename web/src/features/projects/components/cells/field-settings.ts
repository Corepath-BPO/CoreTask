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
  const value = read<string | undefined>(field, checked ? 'checkedLabel' : 'uncheckedLabel', undefined);
  return value?.trim() ? value : undefined;
}

export interface NumberFormat {
  decimalPlaces: number;
  isPercentage: boolean;
  min: number | undefined;
  max: number | undefined;
}

export function numberFormat(field: CustomField): NumberFormat {
  return {
    decimalPlaces: read(field, 'decimalPlaces', 0),
    isPercentage: read<string>(field, 'numberFormat', 'PLAIN') === 'PERCENTAGE',
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
 */
export function formatNumber(value: number, format: NumberFormat): string {
  const text = value.toFixed(format.decimalPlaces);
  return format.isPercentage ? `${text}%` : text;
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

/** The reverse: what the input gives back, as something the API will store. */
export function fromInputValue(raw: string, withTime: boolean): string | null {
  if (!raw) return null;
  return withTime ? new Date(raw).toISOString() : new Date(`${raw}T00:00:00.000Z`).toISOString();
}

/** The types whose cells are a plain input plus a rendering. */
export const SCALAR_INPUT_TYPE: Partial<Record<CustomFieldType, 'text' | 'number' | 'url' | 'email'>> =
  {
    [CustomFieldType.TEXT]: 'text',
    [CustomFieldType.NUMBER]: 'number',
    [CustomFieldType.URL]: 'url',
    [CustomFieldType.EMAIL]: 'email',
  };
