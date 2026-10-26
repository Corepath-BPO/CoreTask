import {
  CONDITION_OPERATOR,
  CONDITION_VALUE_TYPE,
  operatorNeedsValue,
  operatorTakesMultipleValues,
  type ConditionOperator,
  type ConditionValueType,
} from '@coretask/contracts';
import type { AutomationMetadata, ConditionFieldDefinition } from '@coretask/types';

import { Field } from '@/components/forms/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';

import {
  canonicalOperator,
  operatorOptionLabel,
  operatorsFor,
  readConditionValues,
  resolveValueType,
  retargetValue,
  valueFieldLabel,
  valueForOperator,
} from './condition-value';
import { RadioItem } from './radio-item';
import { MultiSelect, OptionFace, type ChoiceOption } from './value-controls';

/* -------------------------------------------------------------------------- */
/* Check if                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Field, comparison, value — with the comparisons the field's type allows.
 *
 * "Due date contains High" and "Checkbox greater than 10" are combinations this
 * never offers, because the field says what kind of value it holds and both the
 * operator list and the control below it follow from that. The endpoint refuses
 * the same pairs, so the form is a convenience rather than the only thing
 * standing in the way.
 *
 * The field is *not* chosen here. References 08–11 pick it from a searchable
 * list before the inspector opens, and that list is now wired up: a row nobody
 * has answered opens the condition catalogue, which writes the field and its
 * first comparison, and this panel takes over from there. So this form asks the
 * second and third questions and assumes the first has been answered.
 */
export function ComparisonFields({
  configuration,
  metadata,
  onChange,
  idPrefix = '',
}: {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
  /**
   * Prefixes the form's ids. A group shows one of these per comparison, and
   * two labels pointing at one id would label only the first control.
   */
  idPrefix?: string;
}) {
  const fields = metadata?.conditionFields ?? [];

  /*
   * The field a condition checks, taken from the condition rather than assumed.
   *
   * It used to fall back to `sectionId` when nothing had been chosen, from when
   * this panel was the only way to reach a condition at all. With the catalogue
   * wired up that default would answer the question before it was asked: every
   * new branch would arrive already reading "Section is", the picker would
   * never open, and the six other groups of checks would stay unreachable.
   *
   * Empty is a real state and the form says so rather than inventing an answer
   * — no definition means no comparisons, so the select below is disabled. It
   * is reached by a condition naming a field the project no longer offers, not
   * by a new one, which goes to the catalogue instead.
   */
  const field = typeof configuration['field'] === 'string' ? configuration['field'] : '';
  const operator = typeof configuration['operator'] === 'string' ? configuration['operator'] : '';

  const definition = fields.find((entry) => entry.field === field);
  const valueType = definition ? resolveValueType(definition, metadata) : null;
  const operators = valueType ? operatorsFor(valueType, operator, field) : [];

  const multiple = operatorTakesMultipleValues(operator as ConditionOperator);
  const values = readConditionValues(configuration);

  return (
    <>
      <Field label="Choose an option" htmlFor={`${idPrefix}condition-operator`}>
        <Select
          value={canonicalOperator(operator ?? '')}
          onValueChange={(next) =>
            /* The value follows the operator's shape: "is" holds one section,
               "is one of" holds a list, "is empty" holds nothing at all. */
            onChange({
              ...configuration,
              // Written alongside the operator, because the picker that used to
              // write it is gone — a condition saved without one compares
              // against its subtype and matches nothing.
              field,
              operator: next,
              value: retargetValue(configuration, next),
            })
          }
          disabled={!definition}
        >
          <SelectTrigger id={`${idPrefix}condition-operator`} className="w-full">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            {operators.map((entry) => (
              <RadioItem key={entry} value={entry}>
                {operatorOptionLabel(definition, entry)}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* An emptiness check compares against nothing, so there is nothing to
          ask for — a control here would be one that is quietly ignored. */}
      {definition &&
        valueType &&
        operator !== '' &&
        operatorNeedsValue(operator as ConditionOperator) && (
          <Field
            label={valueFieldLabel(definition, valueType, multiple, operator)}
            htmlFor={`${idPrefix}condition-value`}
          >
            <ConditionValue
              id={`${idPrefix}condition-value`}
              definition={definition}
              valueType={valueType}
              operator={operator}
              multiple={multiple}
              values={values}
              metadata={metadata}
              onChange={(next) =>
                onChange({ ...configuration, field, value: valueForOperator(next, operator) })
              }
            />
          </Field>
        )}
    </>
  );
}

/**
 * The control a condition's value is chosen with, decided by what it holds.
 *
 * A section is a list of the project's own sections, a person is a member
 * picker, a date is a date field. A text box for all of them would accept a
 * section name that never matches the id the runner compares against — a rule
 * that saves, publishes and silently never fires.
 */
function ConditionValue({
  id,
  definition,
  valueType,
  operator,
  multiple,
  values,
  metadata,
  onChange,
}: {
  /** The control's id, which the field label above points at. */
  id: string;
  definition: ConditionFieldDefinition;
  valueType: ConditionValueType;
  operator: string;
  multiple: boolean;
  values: string[];
  metadata: AutomationMetadata | undefined;
  onChange: (values: string[]) => void;
}) {
  const options = choiceOptions(definition, valueType, metadata);

  /*
   * "Within the next…" is a count of days, whatever the field holds: the date
   * is the thing compared and today is the other side, so how far ahead to
   * look is the only value to ask for — and a date box here would take a date
   * the runner then read as a number.
   */
  if (operator === CONDITION_OPERATOR.IS_WITHIN_NEXT) {
    return (
      <Input
        id={id}
        type="number"
        min={0}
        step={1}
        value={values[0] ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? [] : [event.target.value])}
      />
    );
  }

  if (options) {
    return multiple ? (
      <MultiSelect
        id={id}
        options={options}
        values={values}
        onChange={onChange}
        placeholder="Choose values"
      />
    ) : (
      <Select value={values[0] ?? ''} onValueChange={(next) => onChange([next])}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose a value" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <RadioItem key={option.value} value={option.value}>
              <OptionFace option={option} />
            </RadioItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  /*
   * Two boxes for a range, because `BETWEEN` holds two numbers.
   *
   * One box would take the first and drop the second without saying so, which
   * is a condition that reads as answered and tests half of what it says.
   */
  if (multiple && valueType === CONDITION_VALUE_TYPE.NUMBER) {
    const at = (index: number, next: string) => {
      const pair = [values[0] ?? '', values[1] ?? ''];
      pair[index] = next;

      onChange(pair.filter((entry) => entry !== ''));
    };

    return (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          aria-label="From"
          value={values[0] ?? ''}
          onChange={(event) => at(0, event.target.value)}
        />
        <span className="text-sm text-muted-foreground">and</span>
        <Input
          type="number"
          aria-label="To"
          value={values[1] ?? ''}
          onChange={(event) => at(1, event.target.value)}
        />
      </div>
    );
  }

  return (
    <Input
      id={id}
      type={INPUT_TYPE[valueType] ?? 'text'}
      value={values[0] ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? [] : [event.target.value])}
    />
  );
}

/** Which value types are typed into a box, and what kind of box. */
const INPUT_TYPE: Partial<Record<ConditionValueType, string>> = {
  [CONDITION_VALUE_TYPE.DATE]: 'date',
  [CONDITION_VALUE_TYPE.NUMBER]: 'number',
  [CONDITION_VALUE_TYPE.TEXT]: 'text',
};

/**
 * The real choices for a field, or null when it has none to offer.
 *
 * People carry their face: the metadata gives `assigneeId` a list of names, and
 * matching those back to the members it also returns is what turns a dropdown of
 * strings into a member picker.
 */
function choiceOptions(
  definition: ConditionFieldDefinition,
  valueType: ConditionValueType,
  metadata: AutomationMetadata | undefined,
): ChoiceOption[] | null {
  if (!definition.options) return null;

  if (valueType !== CONDITION_VALUE_TYPE.PEOPLE) {
    // The colour comes along where the option has one, so the list offers the
    // same tinted chip the board shows the value as.
    return definition.options.map((option) => ({
      value: option.value,
      label: option.label,
      ...(option.colorToken ? { colorToken: option.colorToken } : {}),
    }));
  }

  const faces = new Map((metadata?.members ?? []).map((member) => [member.id, member.avatarUrl]));

  return definition.options.map((option) => ({
    value: option.value,
    label: option.label,
    avatarUrl: faces.get(option.value) ?? null,
  }));
}
