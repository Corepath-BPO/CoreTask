import { CustomFieldType } from '@coretask/contracts';
import type { CustomField } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import {
  allowsManyPeople,
  checkboxLabel,
  formatNumber,
  fromInputValue,
  isLongText,
  numberFormat,
  placeholderFor,
  toInputValue,
  wantsTime,
} from './field-settings';

const field = (settings: Record<string, unknown>, type = CustomFieldType.TEXT): CustomField =>
  ({ id: 'f-1', name: 'F', type, settings, options: [] }) as unknown as CustomField;

describe('reading a field’s settings', () => {
  it('falls back to the default when a key is missing', () => {
    // A field created before a setting existed still has to render.
    expect(isLongText(field({}))).toBe(false);
    expect(wantsTime(field({}))).toBe(false);
    expect(allowsManyPeople(field({}))).toBe(false);
  });

  it('survives a field with no settings document at all', () => {
    expect(isLongText({ settings: undefined } as unknown as CustomField)).toBe(false);
  });

  it('reads the configured mode', () => {
    expect(isLongText(field({ textMode: 'LONG' }))).toBe(true);
    expect(wantsTime(field({ dateMode: 'DATE_TIME' }))).toBe(true);
    expect(allowsManyPeople(field({ peopleMode: 'MULTIPLE' }))).toBe(true);
  });

  it('treats a blank placeholder as none', () => {
    // An empty string would render an input with a placeholder of nothing,
    // which is not the same as leaving the attribute off.
    expect(placeholderFor(field({ placeholder: '   ' }))).toBeUndefined();
    expect(placeholderFor(field({ placeholder: 'https://…' }))).toBe('https://…');
  });

  it('gives a checkbox its own wording, per state', () => {
    const f = field({ checkedLabel: 'Blocked', uncheckedLabel: 'Clear' });

    expect(checkboxLabel(f, true)).toBe('Blocked');
    expect(checkboxLabel(f, false)).toBe('Clear');
    expect(checkboxLabel(field({}), true)).toBeUndefined();
  });
});

describe('formatNumber', () => {
  it('honours the configured decimal places', () => {
    expect(formatNumber(12.5, numberFormat(field({ decimalPlaces: 2 })))).toBe('12.50');
    expect(formatNumber(12.5, numberFormat(field({ decimalPlaces: 0 })))).toBe('13');
  });

  it('marks a percentage as one', () => {
    expect(formatNumber(40, numberFormat(field({ numberFormat: 'PERCENTAGE' })))).toBe('40%');
  });

  it('carries the bounds through for the editor', () => {
    const format = numberFormat(field({ minValue: 0, maxValue: 100 }));

    expect(format.min).toBe(0);
    expect(format.max).toBe(100);
  });

  it('keeps a zero bound rather than treating it as absent', () => {
    // `0` is falsy, and a minimum of zero is a real constraint.
    expect(numberFormat(field({ minValue: 0 })).min).toBe(0);
  });
});

describe('date input conversion', () => {
  it('gives each input element the format it accepts', () => {
    const iso = '2026-05-20T14:30:00.000Z';

    expect(toInputValue(iso, false)).toBe('2026-05-20');
    expect(toInputValue(iso, true)).toBe('2026-05-20T14:30');
  });

  it('has nothing to show for an unset date', () => {
    expect(toInputValue(null, false)).toBe('');
    expect(toInputValue(undefined, true)).toBe('');
  });

  it('sends a date-only value back at midnight UTC', () => {
    expect(fromInputValue('2026-05-20', false)).toBe('2026-05-20T00:00:00.000Z');
  });

  it('round-trips a date carrying a time', () => {
    /*
     * The same time back, wherever this runs.
     *
     * The two helpers disagreed about the zone — one sliced UTC out of the
     * stored timestamp, the other read the input as local — so a field carrying
     * a time moved by the reader's offset on every edit. It passed anywhere
     * that happened to be at UTC and failed by exactly the offset everywhere
     * else, which is why it survived: the machine that wrote it was at UTC.
     */
    const iso = fromInputValue('2026-05-20T14:30', true);

    expect(iso).not.toBeNull();
    expect(toInputValue(iso, true)).toBe('2026-05-20T14:30');
  });

  it('stores the time as written rather than as the reader’s offset', () => {
    // The assertion the round-trip alone cannot make: two helpers that shifted
    // by the same amount in opposite directions would round-trip perfectly and
    // still store the wrong instant.
    expect(fromInputValue('2026-05-20T14:30', true)).toBe('2026-05-20T14:30:00.000Z');
  });

  it('keeps a date-only field and a timed one meaning the same instant', () => {
    // Midnight either way. If the two branches read different zones, switching
    // a field to carry a time would silently move every value it holds.
    expect(fromInputValue('2026-05-20T00:00', true)).toBe(fromInputValue('2026-05-20', false));
  });

  it('clears rather than inventing a date from an empty input', () => {
    expect(fromInputValue('', false)).toBeNull();
    expect(fromInputValue('', true)).toBeNull();
  });
});
