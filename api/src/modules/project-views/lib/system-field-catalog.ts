import {
  CustomFieldType,
  SYSTEM_FIELD_CATALOG,
  systemFieldDefinition,
  type SystemFieldDefinition,
} from '@coretask/contracts';

/*
 * The system field catalog lives in `@coretask/contracts` now, so the toolbar
 * on the client reads the same table the API filters and sorts by. Re-exported
 * here for the callers that always imported it from this module.
 */
export { SYSTEM_FIELD_CATALOG, type SystemFieldDefinition };

export function systemField(key: string): SystemFieldDefinition | undefined {
  return systemFieldDefinition(key);
}

/**
 * Every field type a custom field can be, with what it is for.
 *
 * Only the eleven that are implemented end to end. The contract enum has room
 * for more, but a type listed here is one the picker will let somebody choose,
 * and choosing a type whose cells cannot hold a value is worse than not seeing
 * it.
 */
export interface FieldTypeDefinition {
  type: CustomFieldType;
  label: string;
  description: string;
  /** Whether creating it requires a list of options first. */
  hasOptions: boolean;
  /**
   * Worked out on read, never typed in. The toolbar, the bulk bar, the import
   * and the rule builder all hide a computed field with this one flag.
   */
  isComputed: boolean;
}

export const FIELD_TYPE_CATALOG: readonly FieldTypeDefinition[] = [
  {
    type: CustomFieldType.SINGLE_SELECT,
    label: 'Single-select',
    description: 'Choose one coloured option',
    hasOptions: true,
    isComputed: false,
  },
  {
    type: CustomFieldType.MULTI_SELECT,
    label: 'Multi-select',
    description: 'Choose several coloured options',
    hasOptions: true,
    isComputed: false,
  },
  {
    type: CustomFieldType.DATE,
    label: 'Date',
    description: 'Store a date, or a date and time',
    hasOptions: false,
    isComputed: false,
  },
  {
    type: CustomFieldType.PEOPLE,
    label: 'People',
    description: 'Select a workspace member',
    hasOptions: false,
    isComputed: false,
  },
  {
    type: CustomFieldType.TEXT,
    label: 'Text',
    description: 'Store short or long text',
    hasOptions: false,
    isComputed: false,
  },
  {
    type: CustomFieldType.NUMBER,
    label: 'Number',
    description: 'Store a numeric value',
    hasOptions: false,
    isComputed: false,
  },
  {
    type: CustomFieldType.RATING,
    label: 'Rating',
    description: 'Score from one to N stars',
    hasOptions: false,
    isComputed: false,
  },
  {
    type: CustomFieldType.FORMULA,
    label: 'Formula',
    description: "Calculate from this project's number and date fields",
    hasOptions: false,
    isComputed: true,
  },
  {
    type: CustomFieldType.CHECKBOX,
    label: 'Checkbox',
    description: 'True or false',
    hasOptions: false,
    isComputed: false,
  },
  {
    type: CustomFieldType.URL,
    label: 'URL',
    description: 'Store and validate a web address',
    hasOptions: false,
    isComputed: false,
  },
  {
    type: CustomFieldType.EMAIL,
    label: 'Email',
    description: 'Store and validate an email address',
    hasOptions: false,
    isComputed: false,
  },
] as const;
