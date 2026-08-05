import { COLOR_TOKENS, CustomFieldType, type ColorToken } from '@coretask/contracts';

/**
 * What each field type needs before it can be created.
 *
 * One table rather than a switch in the builder, the picker and every cell: the
 * whole point of the field system is that adding a type is a change in one
 * place. A `switch` per component is how a type ends up offered in the picker
 * with no editor behind it.
 *
 * The settings shapes mirror the Zod schemas in `@coretask/validation`, which
 * remain the authority — this is what the form collects, not what the server
 * will accept.
 */
export interface FieldDraft {
  name: string;
  description: string;
  type: CustomFieldType;
  isRequired: boolean;
  options: DraftOption[];
  settings: Record<string, unknown>;
}

export interface DraftOption {
  /** Local to the form until the field is created. */
  key: string;
  label: string;
  colorToken: ColorToken;
}

export interface FieldTypeMeta {
  label: string;
  /** Whether a list of options must be built before the field can be created. */
  hasOptions: boolean;
  /** The settings this type starts with, matching the API's own defaults. */
  defaultSettings: Record<string, unknown>;
}

export const FIELD_TYPE_META: Record<CustomFieldType, FieldTypeMeta> = {
  [CustomFieldType.TEXT]: {
    label: 'Text',
    hasOptions: false,
    defaultSettings: { textMode: 'SHORT' },
  },
  [CustomFieldType.NUMBER]: {
    label: 'Number',
    hasOptions: false,
    defaultSettings: { numberFormat: 'PLAIN', decimalPlaces: 0 },
  },
  [CustomFieldType.DATE]: {
    label: 'Date',
    hasOptions: false,
    defaultSettings: { dateMode: 'DATE_ONLY' },
  },
  [CustomFieldType.CHECKBOX]: {
    label: 'Checkbox',
    hasOptions: false,
    defaultSettings: { defaultValue: false },
  },
  [CustomFieldType.SINGLE_SELECT]: {
    label: 'Single-select',
    hasOptions: true,
    defaultSettings: {},
  },
  [CustomFieldType.MULTI_SELECT]: {
    label: 'Multi-select',
    hasOptions: true,
    defaultSettings: {},
  },
  [CustomFieldType.PEOPLE]: {
    label: 'People',
    hasOptions: false,
    defaultSettings: { peopleMode: 'SINGLE' },
  },
  [CustomFieldType.URL]: {
    label: 'URL',
    hasOptions: false,
    defaultSettings: {},
  },
  [CustomFieldType.EMAIL]: {
    label: 'Email',
    hasOptions: false,
    defaultSettings: {},
  },
};

/*
 * Where the option colours start.
 *
 * Rotated through the palette rather than all one colour: a select whose
 * options are four identical grey chips communicates nothing, and picking four
 * colours by hand is work nobody should have to do to get a usable field. Reds
 * and greens are left out of the rotation because they read as bad and good,
 * and a "Low / Medium / High" list should not imply a judgement before somebody
 * chooses one.
 */
const STARTING_COLORS: ColorToken[] = ['blue', 'violet', 'amber', 'teal', 'pink', 'cyan', 'indigo'];

export function nextOptionColor(index: number): ColorToken {
  return STARTING_COLORS[index % STARTING_COLORS.length] ?? 'gray';
}

export function isColorToken(value: string): value is ColorToken {
  return (COLOR_TOKENS as readonly string[]).includes(value);
}

let optionCounter = 0;

/** A blank option row. The key only has to be unique within one form. */
export function newOption(index: number, label = ''): DraftOption {
  optionCounter += 1;
  return { key: `option-${optionCounter}`, label, colorToken: nextOptionColor(index) };
}

/** The draft a builder starts from for a given type. */
export function emptyDraft(type: CustomFieldType, name: string): FieldDraft {
  const meta = FIELD_TYPE_META[type];

  return {
    name,
    description: '',
    type,
    isRequired: false,
    // Two rows to begin with: a select needs at least two choices to be worth
    // having, and starting from an empty list makes the form look broken.
    options: meta.hasOptions ? [newOption(0), newOption(1)] : [],
    settings: { ...meta.defaultSettings },
  };
}

/**
 * Changes a draft's type, keeping what still applies.
 *
 * The name and description survive; the settings do not, because they belong to
 * the type that is being left behind. Options are kept only when moving between
 * two select types, where they still mean something.
 */
export function retype(draft: FieldDraft, type: CustomFieldType): FieldDraft {
  const meta = FIELD_TYPE_META[type];
  const keepOptions = meta.hasOptions && FIELD_TYPE_META[draft.type].hasOptions;

  return {
    ...draft,
    type,
    settings: { ...meta.defaultSettings },
    options: keepOptions ? draft.options : meta.hasOptions ? [newOption(0), newOption(1)] : [],
  };
}

/** Everything wrong with a draft, in the order the form presents it. */
export function draftProblems(draft: FieldDraft): string[] {
  const problems: string[] = [];
  const name = draft.name.trim();

  if (!name) problems.push('Give the field a name.');
  if (name.length > 80) problems.push('The name is too long.');

  if (FIELD_TYPE_META[draft.type].hasOptions) {
    const labels = draft.options.map((option) => option.label.trim()).filter(Boolean);

    // A select with no options is a column nobody can put a value in, and the
    // failure only shows up when someone tries to use it.
    if (labels.length === 0) problems.push('Add at least one option.');

    const duplicates = labels.filter(
      (label, index) => labels.findIndex((other) => other.toLowerCase() === label.toLowerCase()) !== index,
    );
    if (duplicates.length > 0) {
      problems.push(`Two options are both called “${duplicates[0]}”.`);
    }
  }

  const settings = draft.settings;

  if (draft.type === CustomFieldType.NUMBER) {
    const min = settings['minValue'];
    const max = settings['maxValue'];

    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      problems.push('The minimum cannot be greater than the maximum.');
    }
  }

  return problems;
}
