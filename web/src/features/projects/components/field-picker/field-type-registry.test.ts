import { CustomFieldType } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import {
  FIELD_TYPE_META,
  draftProblems,
  emptyDraft,
  nextOptionColor,
  retype,
} from './field-type-registry';

describe('emptyDraft', () => {
  it('starts a select with rows to fill in', () => {
    // An empty option list makes the form look broken, and a select needs at
    // least two choices to be worth having.
    const draft = emptyDraft(CustomFieldType.SINGLE_SELECT, 'Risk');

    expect(draft.options).toHaveLength(2);
    expect(draft.name).toBe('Risk');
  });

  it('gives a non-select no options at all', () => {
    expect(emptyDraft(CustomFieldType.TEXT, 'Notes').options).toEqual([]);
  });

  it('starts from the same defaults the API would apply', () => {
    expect(emptyDraft(CustomFieldType.NUMBER, 'Points').settings).toEqual({
      numberFormat: 'PLAIN',
      decimalPlaces: 0,
    });
    expect(emptyDraft(CustomFieldType.TEXT, 'Notes').settings).toEqual({ textMode: 'SHORT' });
  });

  it('gives every type a definition', () => {
    // A type with no entry would be offered by the picker and then crash the
    // builder, so the gap has to fail here instead.
    for (const type of Object.values(CustomFieldType)) {
      expect(FIELD_TYPE_META[type]).toBeDefined();
      expect(() => emptyDraft(type, 'x')).not.toThrow();
    }
  });
});

describe('nextOptionColor', () => {
  it('rotates rather than repeating one colour', () => {
    expect(nextOptionColor(0)).not.toBe(nextOptionColor(1));
  });

  it('keeps going past the end of the palette', () => {
    expect(nextOptionColor(99)).toBeTruthy();
  });

  it('avoids red and green, which read as a verdict', () => {
    // "Low / Medium / High" should not imply a judgement before anyone picks.
    const first = Array.from({ length: 7 }, (_, index) => nextOptionColor(index));
    expect(first).not.toContain('red');
    expect(first).not.toContain('green');
  });
});

describe('retype', () => {
  it('keeps the options when moving between two select types', () => {
    const draft = emptyDraft(CustomFieldType.SINGLE_SELECT, 'Risk');
    draft.options[0]!.label = 'Low';

    const multi = retype(draft, CustomFieldType.MULTI_SELECT);

    expect(multi.options[0]?.label).toBe('Low');
  });

  it('drops settings that belonged to the type being left', () => {
    const number = { ...emptyDraft(CustomFieldType.NUMBER, 'Points'), settings: { decimalPlaces: 4 } };

    expect(retype(number, CustomFieldType.DATE).settings).toEqual({ dateMode: 'DATE_ONLY' });
  });

  it('keeps the name and description across a type change', () => {
    const draft = { ...emptyDraft(CustomFieldType.TEXT, 'Risk'), description: 'How risky' };
    const changed = retype(draft, CustomFieldType.SINGLE_SELECT);

    expect(changed.name).toBe('Risk');
    expect(changed.description).toBe('How risky');
  });

  it('gives a select somewhere to start when arriving from a plain type', () => {
    expect(retype(emptyDraft(CustomFieldType.TEXT, 'Risk'), CustomFieldType.SINGLE_SELECT).options)
      .toHaveLength(2);
  });
});

describe('draftProblems', () => {
  it('wants a name', () => {
    expect(draftProblems(emptyDraft(CustomFieldType.TEXT, '  '))).toContain('Give the field a name.');
  });

  it('wants at least one option on a select', () => {
    const draft = emptyDraft(CustomFieldType.SINGLE_SELECT, 'Risk');
    draft.options.forEach((option) => (option.label = ''));

    expect(draftProblems(draft)).toContain('Add at least one option.');
  });

  it('refuses two options with the same label', () => {
    const draft = emptyDraft(CustomFieldType.SINGLE_SELECT, 'Risk');
    draft.options[0]!.label = 'High';
    draft.options[1]!.label = 'high';

    // Case-insensitively: two chips reading High and high in one cell is a
    // mistake, not a distinction.
    expect(draftProblems(draft).join(' ')).toContain('are both called');
  });

  it('refuses a number range that cannot contain anything', () => {
    const draft = emptyDraft(CustomFieldType.NUMBER, 'Points');
    draft.settings = { ...draft.settings, minValue: 10, maxValue: 1 };

    expect(draftProblems(draft)).toContain('The minimum cannot be greater than the maximum.');
  });

  it('accepts a range where the ends are equal', () => {
    const draft = emptyDraft(CustomFieldType.NUMBER, 'Points');
    draft.settings = { ...draft.settings, minValue: 5, maxValue: 5 };

    expect(draftProblems(draft)).toEqual([]);
  });

  it('is happy with a filled-in select', () => {
    const draft = emptyDraft(CustomFieldType.SINGLE_SELECT, 'Risk');
    draft.options[0]!.label = 'Low';
    draft.options[1]!.label = 'High';

    expect(draftProblems(draft)).toEqual([]);
  });
});
