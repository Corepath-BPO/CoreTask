import { describe, expect, it } from 'vitest';

import { CustomFieldType } from './colors.js';
import {
  CUSTOM_FIELD_KIND,
  FilterOperator,
  GROUPABLE_SYSTEM_FIELDS,
  OPERATORS_BY_KIND,
  OPERATOR_LABEL,
  RelativeDate,
  SYSTEM_FIELDS,
  SYSTEM_FIELD_CATALOG,
  SYSTEM_FIELD_KIND,
  customFieldKind,
  isQueryableCustomField,
  isRelativeDate,
  resolveRelativeDate,
  systemFieldDefinition,
} from './query.js';

describe('relative dates', () => {
  // A Wednesday, so the week has days on both sides of it.
  const wednesday = new Date('2026-09-09T15:30:00.000Z');

  it('resolves to UTC midnight, so the answer does not depend on the reader’s clock', () => {
    expect(resolveRelativeDate(RelativeDate.TODAY, wednesday).toISOString()).toBe(
      '2026-09-09T00:00:00.000Z',
    );
  });

  it('starts the week on Monday', () => {
    expect(resolveRelativeDate(RelativeDate.START_OF_WEEK, wednesday).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
    expect(resolveRelativeDate(RelativeDate.END_OF_WEEK, wednesday).toISOString()).toBe(
      '2026-09-13T00:00:00.000Z',
    );
  });

  it('keeps a Sunday inside the week that began the previous Monday', () => {
    const sunday = new Date('2026-09-13T23:59:00.000Z');
    expect(resolveRelativeDate(RelativeDate.START_OF_WEEK, sunday).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });

  it('reaches next week from this one', () => {
    expect(resolveRelativeDate(RelativeDate.START_OF_NEXT_WEEK, wednesday).toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    );
    expect(resolveRelativeDate(RelativeDate.END_OF_NEXT_WEEK, wednesday).toISOString()).toBe(
      '2026-09-20T00:00:00.000Z',
    );
  });

  it('recognises a token and nothing else', () => {
    expect(isRelativeDate('@today')).toBe(true);
    expect(isRelativeDate('2026-09-09')).toBe(false);
    expect(isRelativeDate(null)).toBe(false);
  });
});

describe('field kinds', () => {
  it('reads a rating as a number and a formula as nothing a query can reach', () => {
    expect(customFieldKind(CustomFieldType.RATING)).toBe('NUMBER');
    expect(customFieldKind(CustomFieldType.FORMULA)).toBeNull();
    expect(isQueryableCustomField(CustomFieldType.FORMULA)).toBe(false);
    expect(isQueryableCustomField(CustomFieldType.TEXT)).toBe(true);
  });

  it('answers for every type', () => {
    for (const type of Object.values(CustomFieldType)) {
      expect(type in CUSTOM_FIELD_KIND).toBe(true);
    }
  });

  it('offers inclusive bounds on dates, so a week can be named without a fencepost', () => {
    expect(OPERATORS_BY_KIND.DATE).toContain(FilterOperator.GREATER_THAN_OR_EQUAL);
    expect(OPERATORS_BY_KIND.DATE).toContain(FilterOperator.LESS_THAN_OR_EQUAL);
  });

  it('words every operator', () => {
    for (const operator of Object.values(FilterOperator)) {
      expect(OPERATOR_LABEL[operator]).toBeTruthy();
    }
  });
});

describe('the system field catalog', () => {
  it('describes every system field exactly once', () => {
    const keys = SYSTEM_FIELD_CATALOG.map((field) => field.key);
    expect([...keys].sort()).toEqual([...SYSTEM_FIELDS].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('agrees with the kind table about what each field is', () => {
    // The catalog says PEOPLE, the compiler says PEOPLE; a disagreement here
    // is a filter the picker offers and the API refuses.
    const kindOf = {
      TEXT: 'TEXT',
      NUMBER: 'NUMBER',
      DATE: 'DATE',
      SINGLE_SELECT: 'ENUM',
      PEOPLE: 'PEOPLE',
    } as Record<string, string>;
    for (const field of SYSTEM_FIELD_CATALOG) {
      expect(kindOf[field.dataType]).toBe(SYSTEM_FIELD_KIND[field.key]);
    }
  });

  it('marks groupable fields the way the group menu expects', () => {
    const groupable = SYSTEM_FIELD_CATALOG.filter((field) => field.isGroupable).map(
      (field) => field.key,
    );
    for (const key of GROUPABLE_SYSTEM_FIELDS) expect(groupable).toContain(key);
  });

  it('keeps the title and the section out of the column picker but in the toolbar', () => {
    expect(systemFieldDefinition('title')).toMatchObject({ isColumn: false, isSortable: true });
    expect(systemFieldDefinition('sectionId')).toMatchObject({
      isColumn: false,
      isGroupable: true,
    });
    expect(systemFieldDefinition('assigneeId')?.isColumn).toBe(true);
    expect(systemFieldDefinition('nope')).toBeUndefined();
  });
});
