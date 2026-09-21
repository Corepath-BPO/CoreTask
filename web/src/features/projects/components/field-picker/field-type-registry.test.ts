import { CustomFieldType } from '@coretask/contracts';
import type { CustomField } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import {
  FIELD_TYPE_META,
  draftFromField,
  draftProblems,
  emptyDraft,
  nextOptionColor,
  retype,
} from './field-type-registry';

const storedField = (overrides: Partial<CustomField> = {}): CustomField => ({
  id: 'f-1',
  projectId: 'p-1',
  name: 'Severity',
  description: null,
  type: CustomFieldType.SINGLE_SELECT,
  isRequired: false,
  notifyOnChange: true,
  isArchived: false,
  position: 1,
  settings: {},
  options: [
    {
      id: 'o-2',
      label: 'High',
      colorToken: 'red',
      customColor: null,
      position: 2,
      isArchived: false,
    },
    {
      id: 'o-1',
      label: 'Low',
      colorToken: 'blue',
      customColor: null,
      position: 1,
      isArchived: true,
    },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const EFFORT = '11111111-1111-4111-8111-111111111111';
const NOTES = '22222222-2222-4222-8222-222222222222';
const referenceFields = [
  { id: EFFORT, name: 'Effort', type: CustomFieldType.NUMBER, settings: {} },
  { id: NOTES, name: 'Notes', type: CustomFieldType.TEXT, settings: {} },
];

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
    const number = {
      ...emptyDraft(CustomFieldType.NUMBER, 'Points'),
      settings: { decimalPlaces: 4 },
    };

    expect(retype(number, CustomFieldType.DATE).settings).toEqual({ dateMode: 'DATE_ONLY' });
  });

  it('keeps the name and description across a type change', () => {
    const draft = { ...emptyDraft(CustomFieldType.TEXT, 'Risk'), description: 'How risky' };
    const changed = retype(draft, CustomFieldType.SINGLE_SELECT);

    expect(changed.name).toBe('Risk');
    expect(changed.description).toBe('How risky');
  });

  it('gives a select somewhere to start when arriving from a plain type', () => {
    expect(
      retype(emptyDraft(CustomFieldType.TEXT, 'Risk'), CustomFieldType.SINGLE_SELECT).options,
    ).toHaveLength(2);
  });
});

describe('draftProblems', () => {
  it('wants a name', () => {
    expect(draftProblems(emptyDraft(CustomFieldType.TEXT, '  '))).toContain(
      'Give the field a name.',
    );
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

  it('wants a currency code for a currency and a label for a unit', () => {
    const currency = emptyDraft(CustomFieldType.NUMBER, 'Budget');
    currency.settings = { ...currency.settings, numberFormat: 'CURRENCY' };
    expect(draftProblems(currency)).toContain('Choose a currency.');

    const unit = emptyDraft(CustomFieldType.NUMBER, 'Effort');
    unit.settings = { ...unit.settings, numberFormat: 'CUSTOM_UNIT' };
    expect(draftProblems(unit)).toContain('Give the unit a label.');
  });

  it('keeps a rating between three and ten stars', () => {
    const draft = emptyDraft(CustomFieldType.RATING, 'Confidence');
    expect(draftProblems(draft)).toEqual([]);

    draft.settings = { maxRating: 11 };
    expect(draftProblems(draft).join(' ')).toContain('between 3 and 10');
  });

  it('checks a formula against the project’s fields', () => {
    const draft = emptyDraft(CustomFieldType.FORMULA, 'Doubled');

    // Empty: refused, so nobody creates a formula that says nothing.
    expect(draftProblems(draft, referenceFields).length).toBeGreaterThan(0);

    draft.settings = { ...draft.settings, expression: `{field:${EFFORT}} * 2` };
    expect(draftProblems(draft, referenceFields)).toEqual([]);

    draft.settings = { ...draft.settings, expression: `{field:${NOTES}} * 2` };
    expect(draftProblems(draft, referenceFields).join(' ')).toMatch(/Notes/);

    // Naming itself is a loop of one.
    draft.settings = { ...draft.settings, expression: `{field:${EFFORT}} + 1` };
    expect(draftProblems(draft, referenceFields, EFFORT).length).toBeGreaterThan(0);
  });

  it('refuses a required formula', () => {
    const draft = { ...emptyDraft(CustomFieldType.FORMULA, 'Doubled'), isRequired: true };
    draft.settings = { ...draft.settings, expression: '1' };

    expect(draftProblems(draft).join(' ')).toContain('cannot be required');
  });
});

describe('draftFromField', () => {
  it('starts an edit from the stored field, options in order and hidden ones flagged', () => {
    const draft = draftFromField(storedField());

    expect(draft.name).toBe('Severity');
    expect(draft.notifyOnChange).toBe(true);
    expect(draft.options.map((option) => option.label)).toEqual(['Low', 'High']);
    expect(draft.options.map((option) => option.isArchived)).toEqual([true, false]);
    // The stored id is the row key: how the save tells an edit from an add.
    expect(draft.options[0]?.key).toBe('o-1');
  });

  it('fills in defaults a field written before a setting existed lacks', () => {
    const draft = draftFromField(
      storedField({ type: CustomFieldType.NUMBER, options: [], settings: { decimalPlaces: 2 } }),
    );

    expect(draft.settings).toEqual({ numberFormat: 'PLAIN', decimalPlaces: 2 });
  });
});

describe('the meta table', () => {
  it('marks a formula as computed and nothing else', () => {
    const computed = Object.entries(FIELD_TYPE_META)
      .filter(([, meta]) => meta.isComputed)
      .map(([type]) => type);

    expect(computed).toEqual([CustomFieldType.FORMULA]);
  });

  it('gives a checkbox no defaults, because Asana’s fields have none', () => {
    expect(emptyDraft(CustomFieldType.CHECKBOX, 'Done').settings).toEqual({});
  });

  it('drops "required" when a draft becomes a formula', () => {
    const draft = { ...emptyDraft(CustomFieldType.NUMBER, 'Points'), isRequired: true };

    expect(retype(draft, CustomFieldType.FORMULA).isRequired).toBe(false);
  });
});
