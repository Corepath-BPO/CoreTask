import { CustomFieldType, SystemField } from '@coretask/contracts';

/**
 * What the application knows about each built-in task property.
 *
 * The frontend used to carry two hand-written lists — a label map and a
 * "fields you may add" array — with nothing keeping them in step with the query
 * compiler that decides what can actually be filtered or sorted. A column could
 * be offered in the picker and then rejected by the API, and nothing but a bug
 * report would say so.
 *
 * This is the single answer. The picker, the column header, the filter builder
 * and the group-by menu all read it, so a field that cannot be sorted is never
 * offered a sort.
 */
export interface SystemFieldDefinition {
  key: SystemField;
  label: string;
  description: string;
  /** Which editor and which filter operators apply. */
  dataType: CustomFieldType;
  isSortable: boolean;
  isFilterable: boolean;
  isGroupable: boolean;
  /** False for anything the server derives; the List view renders it read-only. */
  isEditable: boolean;
}

/**
 * Ordered as the picker offers them: the ones people reach for first.
 *
 * `TITLE` is absent on purpose. It is the row's identity and its link to the
 * task, it can never be hidden, and offering it in a menu of columns to add
 * would be offering something that is always already there.
 *
 * `SECTION` is absent for the same reason in a different shape: the List view
 * groups its rows under a section heading, so a Section column repeats on every
 * row what the card it sits in already says. It stays a real field for
 * filtering and grouping — it is simply not a column worth offering.
 */
export const SYSTEM_FIELD_CATALOG: readonly SystemFieldDefinition[] = [
  {
    key: SystemField.ASSIGNEE,
    label: 'Assignee',
    description: 'Who is doing the work',
    dataType: CustomFieldType.PEOPLE,
    isSortable: true,
    isFilterable: true,
    isGroupable: true,
    isEditable: true,
  },
  {
    key: SystemField.STATUS,
    label: 'Status',
    description: 'Where the task has got to',
    dataType: CustomFieldType.SINGLE_SELECT,
    isSortable: true,
    isFilterable: true,
    isGroupable: true,
    isEditable: true,
  },
  {
    key: SystemField.PRIORITY,
    label: 'Priority',
    description: 'How urgent the task is',
    dataType: CustomFieldType.SINGLE_SELECT,
    isSortable: true,
    isFilterable: true,
    isGroupable: true,
    isEditable: true,
  },
  {
    key: SystemField.DUE_DATE,
    label: 'Due date',
    description: 'When the task is expected to be finished',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: true,
  },
  {
    key: SystemField.START_DATE,
    label: 'Start date',
    description: 'When work is meant to begin',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: true,
  },
  {
    key: SystemField.ESTIMATE,
    label: 'Estimate',
    description: 'Expected effort, in minutes',
    dataType: CustomFieldType.NUMBER,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: true,
  },
  {
    key: SystemField.COMPLETED_AT,
    label: 'Completed',
    description: 'When the task was finished',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: false,
  },
  {
    key: SystemField.CREATED_BY,
    label: 'Created by',
    description: 'Who opened the task',
    dataType: CustomFieldType.PEOPLE,
    isSortable: true,
    isFilterable: true,
    isGroupable: true,
    isEditable: false,
  },
  {
    key: SystemField.CREATED_AT,
    label: 'Created',
    description: 'When the task was opened',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: false,
  },
  {
    key: SystemField.UPDATED_AT,
    label: 'Last modified',
    description: 'When the task last changed',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: false,
  },
] as const;

const BY_KEY = new Map(SYSTEM_FIELD_CATALOG.map((field) => [field.key as string, field]));

export function systemField(key: string): SystemFieldDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * Every field type a custom field can be, with what it is for.
 *
 * Only the nine that are implemented end to end. The contract enum has room for
 * more, but a type listed here is one the picker will let somebody choose, and
 * choosing a type whose cells cannot hold a value is worse than not seeing it.
 */
export interface FieldTypeDefinition {
  type: CustomFieldType;
  label: string;
  description: string;
  /** Whether creating it requires a list of options first. */
  hasOptions: boolean;
}

export const FIELD_TYPE_CATALOG: readonly FieldTypeDefinition[] = [
  {
    type: CustomFieldType.SINGLE_SELECT,
    label: 'Single-select',
    description: 'Choose one coloured option',
    hasOptions: true,
  },
  {
    type: CustomFieldType.MULTI_SELECT,
    label: 'Multi-select',
    description: 'Choose several coloured options',
    hasOptions: true,
  },
  {
    type: CustomFieldType.DATE,
    label: 'Date',
    description: 'Store a date, or a date and time',
    hasOptions: false,
  },
  {
    type: CustomFieldType.PEOPLE,
    label: 'People',
    description: 'Select a workspace member',
    hasOptions: false,
  },
  {
    type: CustomFieldType.TEXT,
    label: 'Text',
    description: 'Store short or long text',
    hasOptions: false,
  },
  {
    type: CustomFieldType.NUMBER,
    label: 'Number',
    description: 'Store a numeric value',
    hasOptions: false,
  },
  {
    type: CustomFieldType.CHECKBOX,
    label: 'Checkbox',
    description: 'True or false',
    hasOptions: false,
  },
  {
    type: CustomFieldType.URL,
    label: 'URL',
    description: 'Store and validate a web address',
    hasOptions: false,
  },
  {
    type: CustomFieldType.EMAIL,
    label: 'Email',
    description: 'Store and validate an email address',
    hasOptions: false,
  },
] as const;
