import {
  COLOR_TOKENS,
  CustomFieldType,
  RATING_DEFAULT_STARS,
  RATING_MAX_STARS,
  RATING_MIN_STARS,
  isComputedFieldType,
  validateFormula,
  type ColorToken,
  type FormulaFieldRef,
} from '@coretask/contracts';
import type { CustomField } from '@coretask/types';

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
  /** Asana's "notify task collaborators when this field changes". */
  notifyOnChange: boolean;
  options: DraftOption[];
  settings: Record<string, unknown>;
}

export interface DraftOption {
  /** Local to the form until the field is created. */
  key: string;
  label: string;
  colorToken: ColorToken;
  /** Hidden from the pickers; cells holding it keep their label. */
  isArchived?: boolean;
}

export interface FieldTypeMeta {
  label: string;
  /** Whether a list of options must be built before the field can be created. */
  hasOptions: boolean;
  /** Worked out on read and never typed in: no cell editor, no bulk edit, no rule. */
  isComputed: boolean;
  /** The settings this type starts with, matching the API's own defaults. */
  defaultSettings: Record<string, unknown>;
}

export const FIELD_TYPE_META: Record<CustomFieldType, FieldTypeMeta> = {
  [CustomFieldType.TEXT]: {
    label: 'Text',
    hasOptions: false,
    isComputed: false,
    defaultSettings: { textMode: 'SHORT' },
  },
  [CustomFieldType.NUMBER]: {
    label: 'Number',
    hasOptions: false,
    isComputed: false,
    defaultSettings: { numberFormat: 'PLAIN', decimalPlaces: 0 },
  },
  [CustomFieldType.RATING]: {
    label: 'Rating',
    hasOptions: false,
    isComputed: false,
    defaultSettings: { maxRating: RATING_DEFAULT_STARS },
  },
  [CustomFieldType.FORMULA]: {
    label: 'Formula',
    hasOptions: false,
    isComputed: true,
    // A blank expression: the editor starts empty and the draft is refused
    // until one is written, so nobody creates a formula that says nothing.
    defaultSettings: { expression: '', numberFormat: 'PLAIN', decimalPlaces: 0 },
  },
  [CustomFieldType.DATE]: {
    label: 'Date',
    hasOptions: false,
    isComputed: false,
    defaultSettings: { dateMode: 'DATE_ONLY' },
  },
  [CustomFieldType.CHECKBOX]: {
    label: 'Checkbox',
    hasOptions: false,
    isComputed: false,
    defaultSettings: {},
  },
  [CustomFieldType.SINGLE_SELECT]: {
    label: 'Single-select',
    hasOptions: true,
    isComputed: false,
    defaultSettings: {},
  },
  [CustomFieldType.MULTI_SELECT]: {
    label: 'Multi-select',
    hasOptions: true,
    isComputed: false,
    defaultSettings: {},
  },
  [CustomFieldType.PEOPLE]: {
    label: 'People',
    hasOptions: false,
    isComputed: false,
    defaultSettings: { peopleMode: 'SINGLE' },
  },
  [CustomFieldType.URL]: {
    label: 'URL',
    hasOptions: false,
    isComputed: false,
    defaultSettings: {},
  },
  [CustomFieldType.EMAIL]: {
    label: 'Email',
    hasOptions: false,
    isComputed: false,
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
    notifyOnChange: false,
    // Two rows to begin with: a select needs at least two choices to be worth
    // having, and starting from an empty list makes the form look broken.
    options: meta.hasOptions ? [newOption(0), newOption(1)] : [],
    settings: { ...meta.defaultSettings },
  };
}

/**
 * The draft an edit form starts from: the stored field, as the builder shapes
 * it. Archived options come too, flagged, so the form can offer to unhide
 * them; the stored id doubles as the row key, which is how the save tells an
 * edited option from one added in the form.
 */
export function draftFromField(field: CustomField): FieldDraft {
  const meta = FIELD_TYPE_META[field.type];

  return {
    name: field.name,
    description: field.description ?? '',
    type: field.type,
    isRequired: field.isRequired,
    notifyOnChange: field.notifyOnChange,
    options: meta.hasOptions
      ? [...field.options]
          .sort((a, b) => a.position - b.position)
          .map((option) => ({
            key: option.id,
            label: option.label,
            colorToken: isColorToken(option.colorToken) ? option.colorToken : 'gray',
            isArchived: option.isArchived,
          }))
      : [],
    settings: { ...meta.defaultSettings, ...(field.settings ?? {}) },
  };
}

/**
 * Changes a draft's type, keeping what still applies.
 *
 * The name and description survive; the settings do not, because they belong to
 * the type that is being left behind. Options are kept only when moving between
 * two select types, where they still mean something. A formula cannot be
 * required, so arriving at one clears the flag.
 */
export function retype(draft: FieldDraft, type: CustomFieldType): FieldDraft {
  const meta = FIELD_TYPE_META[type];
  const keepOptions = meta.hasOptions && FIELD_TYPE_META[draft.type].hasOptions;

  return {
    ...draft,
    type,
    isRequired: meta.isComputed ? false : draft.isRequired,
    settings: { ...meta.defaultSettings },
    options: keepOptions ? draft.options : meta.hasOptions ? [newOption(0), newOption(1)] : [],
  };
}

/** A field a formula on this project may name: id, name and type suffice. */
export type FormulaReferenceField = Pick<CustomField, 'id' | 'name' | 'type' | 'settings'>;

/**
 * Everything wrong with a draft, in the order the form presents it.
 *
 * `referenceFields` is the project's fields, needed only to check a formula:
 * which fields it may name, and that it names none of the wrong type. `selfId`
 * is the field being edited, so a formula cannot name itself.
 */
export function draftProblems(
  draft: FieldDraft,
  referenceFields: readonly FormulaReferenceField[] = [],
  selfId?: string,
): string[] {
  const problems: string[] = [];
  const name = draft.name.trim();

  if (!name) problems.push('Give the field a name.');
  if (name.length > 80) problems.push('The name is too long.');

  if (FIELD_TYPE_META[draft.type].hasOptions) {
    const live = draft.options.filter((option) => !option.isArchived);
    const labels = live.map((option) => option.label.trim()).filter(Boolean);

    // A select with no options is a column nobody can put a value in, and the
    // failure only shows up when someone tries to use it.
    if (labels.length === 0) problems.push('Add at least one option.');

    const duplicates = labels.filter(
      (label, index) =>
        labels.findIndex((other) => other.toLowerCase() === label.toLowerCase()) !== index,
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

  if (draft.type === CustomFieldType.NUMBER || draft.type === CustomFieldType.FORMULA) {
    const format = settings['numberFormat'];
    if (format === 'CURRENCY' && !settings['currencyCode']) {
      problems.push('Choose a currency.');
    }
    if (format === 'CUSTOM_UNIT' && !String(settings['unitLabel'] ?? '').trim()) {
      problems.push('Give the unit a label.');
    }
  }

  if (draft.type === CustomFieldType.RATING) {
    const stars = settings['maxRating'];
    if (
      typeof stars !== 'number' ||
      !Number.isInteger(stars) ||
      stars < RATING_MIN_STARS ||
      stars > RATING_MAX_STARS
    ) {
      problems.push(`A rating has between ${RATING_MIN_STARS} and ${RATING_MAX_STARS} stars.`);
    }
  }

  if (draft.type === CustomFieldType.FORMULA) {
    const expression = String(settings['expression'] ?? '');
    const fields = new Map<string, FormulaFieldRef>(
      referenceFields.map((field) => [
        field.id,
        {
          id: field.id,
          name: field.name,
          type: field.type,
          expression:
            typeof field.settings?.['expression'] === 'string'
              ? (field.settings['expression'] as string)
              : undefined,
        },
      ]),
    );
    const result = validateFormula(expression, { fields, ...(selfId ? { selfId } : {}) });
    if (!result.ok) problems.push(result.error.message);
    if (draft.isRequired)
      problems.push('A formula is worked out, not filled in, so it cannot be required.');
  }

  return problems;
}

/** Whether a field type is chosen like any other but never typed into. */
export function isComputedField(field: Pick<CustomField, 'type'>): boolean {
  return isComputedFieldType(field.type);
}
