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
    expect(parseFieldSettings(CustomFieldType.TEXT, { textMode: 'LONG', futureThing: 42 })).toEqual(
      {
        textMode: 'LONG',
      },
    );
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

  it('gives a checkbox no default value, because Asana’s fields have none', () => {
    expect(defaultFieldSettings(CustomFieldType.CHECKBOX)).toEqual({});
    // A document that still carries the old key reads back without it.
    expect(parseFieldSettings(CustomFieldType.CHECKBOX, { defaultValue: true })).toEqual({});
  });

  it('starts a rating at five stars and a formula at a placeholder expression', () => {
    expect(defaultFieldSettings(CustomFieldType.RATING)).toEqual({ maxRating: 5 });
    expect(defaultFieldSettings(CustomFieldType.FORMULA)).toMatchObject({
      expression: '0',
      numberFormat: 'PLAIN',
      decimalPlaces: 0,
    });
  });
});

describe('number display formats', () => {
  it('stores a currency with its code, and refuses one without', () => {
    expect(
      parseFieldSettings(CustomFieldType.NUMBER, {
        numberFormat: 'CURRENCY',
        currencyCode: 'EUR',
        decimalPlaces: 2,
      }),
    ).toEqual({ numberFormat: 'CURRENCY', currencyCode: 'EUR', decimalPlaces: 2 });

    const missing = safeParseFieldSettings(CustomFieldType.NUMBER, { numberFormat: 'CURRENCY' });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0]?.path).toEqual(['currencyCode']);

    expect(
      safeParseFieldSettings(CustomFieldType.NUMBER, {
        numberFormat: 'CURRENCY',
        currencyCode: 'euro',
      }).success,
    ).toBe(false);
  });

  it('stores a custom unit with its label, and refuses one without', () => {
    expect(
      parseFieldSettings(CustomFieldType.NUMBER, {
        numberFormat: 'CUSTOM_UNIT',
        unitLabel: 'pts',
        unitPosition: 'SUFFIX',
      }),
    ).toMatchObject({ unitLabel: 'pts', unitPosition: 'SUFFIX' });

    const missing = safeParseFieldSettings(CustomFieldType.NUMBER, {
      numberFormat: 'CUSTOM_UNIT',
    });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0]?.path).toEqual(['unitLabel']);
  });

  it('adds no display keys to a plain number, so old documents read back unchanged', () => {
    expect(parseFieldSettings(CustomFieldType.NUMBER, {})).toEqual({
      numberFormat: 'PLAIN',
      decimalPlaces: 0,
    });
  });
});

describe('rating settings', () => {
  it('keeps the stars between three and ten', () => {
    expect(parseFieldSettings(CustomFieldType.RATING, { maxRating: 7 })).toEqual({ maxRating: 7 });
    expect(safeParseFieldSettings(CustomFieldType.RATING, { maxRating: 2 }).success).toBe(false);
    expect(safeParseFieldSettings(CustomFieldType.RATING, { maxRating: 11 }).success).toBe(false);
    expect(safeParseFieldSettings(CustomFieldType.RATING, { maxRating: 4.5 }).success).toBe(false);
  });
});

describe('formula settings', () => {
  const ref = '{field:11111111-1111-4111-8111-111111111111}';

  it('accepts an expression that parses, with the number display keys', () => {
    expect(
      parseFieldSettings(CustomFieldType.FORMULA, {
        expression: `${ref} * 2`,
        numberFormat: 'CURRENCY',
        currencyCode: 'USD',
        decimalPlaces: 2,
      }),
    ).toEqual({
      expression: `${ref} * 2`,
      numberFormat: 'CURRENCY',
      currencyCode: 'USD',
      decimalPlaces: 2,
    });
  });

  it('checks the syntax here, and leaves the references to the service', () => {
    // Only the service holds the project, so only it can say whether the
    // field a formula names exists. Syntax needs nothing but the text.
    const broken = safeParseFieldSettings(CustomFieldType.FORMULA, { expression: '1 +' });
    expect(broken.success).toBe(false);
    if (!broken.success) expect(broken.error.issues[0]?.path).toEqual(['expression']);

    expect(safeParseFieldSettings(CustomFieldType.FORMULA, { expression: '' }).success).toBe(false);
    expect(safeParseFieldSettings(CustomFieldType.FORMULA, {}).success).toBe(false);
  });
});
