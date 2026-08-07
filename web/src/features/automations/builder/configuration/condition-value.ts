import {
  CONDITION_OPERATOR,
  CONDITION_OPERATOR_LABEL,
  CONDITION_VALUE_TYPE,
  ConditionValueKind,
  OPERATORS_BY_VALUE_TYPE,
  operatorsForConditionField,
  operatorNeedsValue,
  operatorTakesMultipleValues,
  type ConditionOperator,
  type ConditionValueType,
} from '@coretask/contracts';
import type { AutomationMetadata, ConditionFieldDefinition } from '@coretask/types';

/**
 * What a condition is comparing, and how that reads.
 *
 * The inspector asks three things — which field, which comparison, which value
 * — and the second and third both follow from the first. Everything that knows
 * how they follow lives here, so the control that is rendered and the sentence
 * the panel shows above it cannot disagree about what the condition says.
 */

/**
 * Fields whose value is a person rather than a row of some other kind.
 *
 * The last resort, and named as one. `ConditionFieldDefinition` describes a
 * field by `ConditionValueKind`, which has a single `REFERENCE` for sections and
 * members alike — so on that alone nothing distinguishes "choose a section" from
 * "choose somebody". Only reached when the condition catalogue has no entry for
 * the field, which is where the endpoint states the type outright.
 */
const PEOPLE_FIELDS = new Set(['assigneeId', 'createdById', 'reporterId', 'collaboratorIds']);

/** Only these read as enum tokens; anything else is a value, not a shout. */
const ENUM_TOKEN = /^[A-Z][A-Z0-9_]*$/;

/**
 * The condition catalogue, which is the one place the endpoint names a type.
 *
 * `AutomationMetadata` does not declare it yet, so it is read through a narrow
 * cast rather than assumed: an entry keyed by the same field key the condition
 * fields use, carrying the `ConditionValueType` the operators follow from.
 */
interface CatalogueCondition {
  subtype: string;
  valueType?: string;
}

function suppliedValueType(
  field: string,
  metadata: AutomationMetadata | undefined,
): string | undefined {
  const catalogue = (metadata as { conditions?: CatalogueCondition[] } | undefined)?.conditions;

  return catalogue?.find((entry) => entry.subtype === field)?.valueType;
}

/**
 * The value type a field's operators follow from.
 *
 * `OPERATORS_BY_VALUE_TYPE` is keyed by `ConditionValueType`, and
 * `ConditionFieldDefinition` still describes a field by the older
 * `ConditionValueKind`. The two are different vocabularies rather than one
 * renamed — the kinds describe saved-view filters, the types describe what a
 * rule condition holds — so this takes the endpoint's own answer where there is
 * one and translates only where there is not.
 */
export function resolveValueType(
  definition: ConditionFieldDefinition,
  metadata: AutomationMetadata | undefined,
): ConditionValueType {
  const supplied =
    suppliedValueType(definition.field, metadata) ??
    (definition as { valueType?: string }).valueType;

  if (supplied && supplied in OPERATORS_BY_VALUE_TYPE) return supplied as ConditionValueType;

  switch (definition.valueKind) {
    case ConditionValueKind.TEXT:
      return CONDITION_VALUE_TYPE.TEXT;
    case ConditionValueKind.NUMBER:
      return CONDITION_VALUE_TYPE.NUMBER;
    case ConditionValueKind.DATE:
      return CONDITION_VALUE_TYPE.DATE;
    case ConditionValueKind.BOOLEAN:
      return CONDITION_VALUE_TYPE.CHECKBOX;
    default:
      return PEOPLE_FIELDS.has(definition.field)
        ? CONDITION_VALUE_TYPE.PEOPLE
        : CONDITION_VALUE_TYPE.SINGLE_SELECT;
  }
}

/**
 * The comparisons this field's type allows, plus whatever it already holds.
 *
 * The stored operator is always offered even when the type would not choose it
 * today: rules written against the older vocabulary hold `EQUALS` where a
 * single select now offers `IS`, and dropping it would leave the control blank
 * — so the next save would quietly change what the rule tests.
 */
export function operatorsFor(
  valueType: ConditionValueType,
  stored: string,
  field = '',
): readonly ConditionOperator[] {
  const allowed = operatorsForConditionField(field, valueType);
  const canonical = canonicalOperator(stored);

  return canonical !== '' && !allowed.includes(canonical as ConditionOperator)
    ? [...allowed, canonical as ConditionOperator]
    : allowed;
}

/**
 * The operator a stored one means today.
 *
 * `EQUALS` and `NOT_EQUALS` are what conditions were written with before the
 * type-aware lists existed, and they mean exactly what `IS` and `IS_NOT` mean.
 * Left alone they appeared as a seventh entry called "equals" beside "is",
 * which asks somebody to choose between two spellings of one thing — and the
 * one they pick then decides whether the rule reads properly ever again.
 */
export function canonicalOperator(operator: string): string {
  if (operator === 'EQUALS') return CONDITION_OPERATOR.IS;
  if (operator === 'NOT_EQUALS') return CONDITION_OPERATOR.IS_NOT;

  return operator;
}

/**
 * An option in "Choose an option", read as the sentence it will become.
 *
 * The reference offers "Section is…" rather than "is", because the field is
 * chosen elsewhere and an operator on its own is a fragment — a list reading
 * "is / is not / is one of" makes somebody hold the field in their head to know
 * what they are answering. With the field in the words, the option is the
 * condition.
 */
export function operatorOptionLabel(fieldLabel: string, operator: string): string {
  const verb = operatorLabel(operator);

  // The ellipsis promises a second question; the emptiness checks ask nothing
  // further, so promising one would be a lie.
  const asks = operatorNeedsValue(operator as ConditionOperator);

  return `${fieldLabel} ${verb}${asks ? '…' : ''}`;
}

/** How an operator reads. Humanised rather than shouted when it is a stranger. */
export function operatorLabel(operator: string): string {
  const known: Partial<Record<string, string>> = CONDITION_OPERATOR_LABEL;

  return known[operator] ?? humaniseToken(operator);
}

/**
 * What the value control asks for, in the words of the thing it is asking about.
 *
 * "Choose a value" for a section is the panel refusing to say what it wants.
 * The section wording is the reference's own — a board column and a list section
 * are the same row under two names, and somebody looking at a board is looking
 * for the first.
 */
export function valueFieldLabel(
  definition: ConditionFieldDefinition,
  valueType: ConditionValueType,
  multiple: boolean,
): string {
  if (definition.field === 'sectionId') {
    // "is one of" takes a set, and asking for "a column/section" beside a list
    // of checkboxes tells somebody they may pick one when they may pick several.
    return multiple ? 'Choose one or more options for column/section' : 'Choose a column/section';
  }

  switch (valueType) {
    case CONDITION_VALUE_TYPE.PEOPLE:
      return multiple ? 'Choose people' : 'Choose a person';
    case CONDITION_VALUE_TYPE.DATE:
      return 'Choose a date';
    case CONDITION_VALUE_TYPE.NUMBER:
      return multiple ? 'Enter a range' : 'Enter a number';
    case CONDITION_VALUE_TYPE.TEXT:
      return 'Enter text';
    default:
      return multiple ? 'Choose values' : 'Choose a value';
  }
}

/** Whatever the condition holds, as a list, whichever shape it was written in. */
export function readConditionValues(configuration: Record<string, unknown>): string[] {
  const raw = configuration['value'];

  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
  }

  if (typeof raw === 'number') return [String(raw)];

  return typeof raw === 'string' && raw !== '' ? [raw] : [];
}

/**
 * The value in the shape the operator expects.
 *
 * `undefined` rather than `''` or `[]` for nothing chosen, because that is what
 * the rest of the builder reads as "not answered yet" — an empty string here
 * would mark an unfinished condition complete and let it be published.
 */
export function valueForOperator(values: string[], operator: string): unknown {
  if (!operatorNeedsValue(operator as ConditionOperator)) return undefined;
  if (operatorTakesMultipleValues(operator as ConditionOperator)) {
    return values.length > 0 ? values : undefined;
  }

  return values.length > 0 ? values[0] : undefined;
}

/**
 * What survives a change of operator.
 *
 * Moving from "is" to "is one of" keeps the section already chosen and only
 * changes the shape it is held in; moving to "is empty" drops it, because the
 * comparison no longer has a right-hand side to hold.
 */
export function retargetValue(configuration: Record<string, unknown>, operator: string): unknown {
  return valueForOperator(readConditionValues(configuration), operator);
}

/**
 * The condition as a sentence — "Section is one of To Do, In Progress".
 *
 * Never an id. A card or a heading reading `019fce6b-…` looks like data rather
 * than like a mistake, so a reference that no longer resolves says so in words
 * and the thing that needs to happen — somebody noticing the section was
 * deleted — is the thing the sentence prompts.
 */
export function summariseCondition(
  configuration: Record<string, unknown>,
  metadata: AutomationMetadata | undefined,
  /**
   * Whether to name the value as well as the question.
   *
   * A card is read at a distance and has to say what the rule does, so it needs
   * the value. The panel's heading sits directly above the control holding that
   * value — repeating it there says the same thing twice and leaves a heading
   * that changes as somebody types into the field beneath it.
   */
  withValue = true,
): string {
  const field = configuration['field'];
  if (typeof field !== 'string' || field === '') return 'Choose what to check';

  const definition = metadata?.conditionFields.find((entry) => entry.field === field);
  const label = definition?.label ?? field;

  const operator = configuration['operator'];
  if (typeof operator !== 'string' || operator === '') return `${label} …`;

  const words = operatorLabel(canonicalOperator(operator));

  if (!withValue) return `${label} ${words}`;

  // An emptiness check carries its whole question in the operator, so there is
  // no value to name after it.
  if (!operatorNeedsValue(operator as ConditionOperator)) return `${label} ${words}`;

  const values = readConditionValues(configuration).map((value) =>
    resolveValueLabel(definition, value),
  );

  return values.length > 0 ? `${label} ${words} ${values.join(', ')}` : `${label} ${words} …`;
}

/** One value, in the project's own words rather than in the database's. */
function resolveValueLabel(
  definition: ConditionFieldDefinition | undefined,
  value: string,
): string {
  // A field with no options holds a literal — a date, a number, some text — and
  // the value typed is the value read.
  if (!definition?.options) return value;

  const option = definition.options.find((entry) => entry.value === value);
  if (option) return option.label;

  /*
   * An unmatched value is one of two things and neither is an id worth showing.
   *
   * A legacy enum token is legitimate — it is what the runner still compares
   * against for any task the definition backfill has not reached — so it is
   * humanised. Anything else named a row that has since gone.
   */
  return ENUM_TOKEN.test(value) ? humaniseToken(value) : 'something that no longer exists';
}

/** `IN_PROGRESS` -> `In progress`. Left alone when it is not a token. */
function humaniseToken(value: string): string {
  if (!ENUM_TOKEN.test(value)) return value;

  const words = value.toLowerCase().replace(/_/g, ' ');

  return words.charAt(0).toUpperCase() + words.slice(1);
}
