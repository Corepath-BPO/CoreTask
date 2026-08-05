import { CustomFieldType } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import {
  defaultFieldSettings,
  parseFieldSettings,
  safeParseFieldSettings,
} from './custom-field-settings.js';

describe('parseFieldSettings', () => {
  it('fills in defaults for a document that says nothing', () => {
    // Every field created before settings meant anything has `{}` stored, and
    // those fields have to keep working without a data migration.
    expect(parseFieldSettings(CustomFieldType.TEXT, {})).toEqual({ textMode: 'SHORT' });
    expect(parseFieldSettings(CustomFieldType.NUMBER, {})).toEqual({
      numberFormat: 'PLAIN',
      decimalPlaces: 0,
    });
    expect(parseFieldSettings(CustomFieldType.DATE, {})).toEqual({ dateMode: 'DATE_ONLY' });
    expect(parseFieldSettings(CustomFieldType.PEOPLE, {})).toEqual({ peopleMode: 'SINGLE' });
  });

  it('treats a null settings column as an empty document', () => {
    expect(parseFieldSettings(CustomFieldType.TEXT, null)).toEqual({ textMode: 'SHORT' });
  });

  it('keeps the values that were set', () => {
    expect(
      parseFieldSettings(CustomFieldType.NUMBER, {
        numberFormat: 'PERCENTAGE',
        decimalPlaces: 2,
        minValue: 0,
        maxValue: 100,
      }),
    ).toEqual({ numberFormat: 'PERCENTAGE', decimalPlaces: 2, minValue: 0, maxValue: 100 });
  });

  it('drops a setting this version does not know', () => {
    // A client one release ahead should not have its field creation refused
    // over a key this server has never heard of.
    expect(parseFieldSettings(CustomFieldType.TEXT, { textMode: 'LONG', futureThing: 42 })).toEqual({
      textMode: 'LONG',
    });
  });

  it('rejects a mode that is not one of the allowed ones', () => {
    expect(() => parseFieldSettings(CustomFieldType.TEXT, { textMode: 'MEDIUM' })).toThrow();
    expect(() => parseFieldSettings(CustomFieldType.DATE, { dateMode: 'WHENEVER' })).toThrow();
  });

  it('rejects a number range that cannot contain anything', () => {
    const result = safeParseFieldSettings(CustomFieldType.NUMBER, { minValue: 10, maxValue: 1 });

    expect(result.success).toBe(false);
  });

  it('holds decimal places to something a Decimal(20,6) can store', () => {
    expect(() => parseFieldSettings(CustomFieldType.NUMBER, { decimalPlaces: 7 })).toThrow();
    expect(parseFieldSettings(CustomFieldType.NUMBER, { decimalPlaces: 6 }).decimalPlaces).toBe(6);
  });

  it('reports the reason rather than throwing when asked safely', () => {
    const result = safeParseFieldSettings(CustomFieldType.PEOPLE, { peopleMode: 'CROWD' });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.length).toBeGreaterThan(0);
  });
});

describe('defaultFieldSettings', () => {
  it('produces a valid document for every field type', () => {
    // A type with no schema entry would throw here, which is the point: adding
    // a field type without deciding its settings should not be possible.
    for (const type of Object.values(CustomFieldType)) {
      expect(() => defaultFieldSettings(type)).not.toThrow();
    }
  });

  it('gives a multi-select no selection limit until one is chosen', () => {
    expect(defaultFieldSettings(CustomFieldType.MULTI_SELECT)).toEqual({});
  });
});
