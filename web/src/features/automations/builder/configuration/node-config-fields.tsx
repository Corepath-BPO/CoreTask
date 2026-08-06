import {
  CONDITION_VALUE_TYPE,
  operatorNeedsValue,
  operatorTakesMultipleValues,
  type ConditionOperator,
  type ConditionValueType,
} from '@coretask/contracts';
import type { AutomationMetadata, ConditionFieldDefinition } from '@coretask/types';

import { Field } from '@/components/forms/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import type { CanvasNode } from '../lib/graph-edits';

import {
  operatorLabel,
  operatorsFor,
  readConditionValues,
  resolveValueType,
  retargetValue,
  valueFieldLabel,
  valueForOperator,
} from './condition-value';
import {
  applyTriggerForm,
  applyTriggerSections,
  formsForTrigger,
  readTriggerForm,
  readTriggerSections,
} from './trigger-forms';
import { MultiSelect, OptionFace, type ChoiceOption } from './value-controls';

/** Radix `Select` treats `''` as "no value", so absence needs a real token. */
const NONE = '__none__';

/**
 * The settings one step needs, and nothing else.
 *
 * No save button: every change is applied as it is made, the same way moving a
 * node on the canvas is. Nothing here reaches the database until the rule is
 * saved, so a second commit step would only be a chance to lose an edit by
 * clicking away — and the card behind the panel updating as you type is what
 * tells you the change landed.
 */
export function NodeConfigFields({
  node,
  metadata,
  onChange,
}: {
  node: CanvasNode;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  if (node.type === 'TRIGGER') {
    return (
      <TriggerFields
        subtype={node.subtype}
        configuration={node.configuration}
        metadata={metadata}
        onChange={onChange}
      />
    );
  }

  /* A branch holds the comparison that chooses its arm, so it is configured
     exactly as a condition is — one decision, one node. */
  if (node.type === 'CONDITION' || node.type === 'BRANCH') {
    return (
      <ConditionFields configuration={node.configuration} metadata={metadata} onChange={onChange} />
    );
  }

  return (
    <ActionFields
      subtype={node.subtype}
      configuration={node.configuration}
      metadata={metadata}
      onChange={onChange}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* When                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How the event that starts a rule is narrowed.
 *
 * One question — "Choose an option" — and a second only when the answer needs
 * one. A move can be watched four ways and the difference between them is the
 * whole point of the panel: "any move", "into this one", "into anything but
 * this one", "into any of these". Offering a bare section picker, as this used
 * to, could express exactly the second of the four.
 */
function TriggerFields({
  subtype,
  configuration,
  metadata,
  onChange,
}: {
  subtype: string;
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const forms = formsForTrigger(subtype, metadata);
  const form = readTriggerForm(configuration, forms);

  // Most triggers fire on the whole project. A form of disabled controls would
  // make somebody read it before finding out there was nothing to answer.
  if (forms.length === 0 || !form) {
    return (
      <p className="text-sm text-muted-foreground">
        This trigger fires for the whole project, so there is nothing to set.
      </p>
    );
  }

  const options: ChoiceOption[] = (metadata?.sections ?? []).map((section) => ({
    value: section.id,
    label: section.name,
  }));
  const chosen = readTriggerSections(configuration);

  const choose = (next: string) => {
    const picked = forms.find((entry) => entry.form === next);
    if (picked) onChange(applyTriggerForm(configuration, picked));
  };

  return (
    <>
      {/*
        All four are offered, and the unavailable ones say so once chosen.

        The convention everywhere else in this panel is disabled-with-a-reason,
        and here it would empty the panel of the thing it exists for: three of
        these four are the difference between "moved anywhere" and "moved out of
        review", and greying half of them leaves a control that can express only
        what a bare section picker already could. The reason is shown under the
        field instead, so nobody publishes a rule expecting the engine to run a
        form it cannot yet.
      */}
      <Field
        label="Choose an option"
        htmlFor="trigger-form"
        hint={form.available ? undefined : (form.reason ?? undefined)}
      >
        <Select value={form.form} onValueChange={choose}>
          <SelectTrigger id="trigger-form" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {forms.map((entry) => (
              <SelectItem key={entry.form} value={entry.form}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Only the forms that name a section ask for one; "Section is changed"
          watches every move and has nothing left to answer. */}
      {form.needsValue &&
        (form.multiple ? (
          <Field label="Choose sections" htmlFor="trigger-sections">
            <MultiSelect
              id="trigger-sections"
              options={options}
              values={chosen}
              onChange={(next) => onChange(applyTriggerSections(configuration, form, next))}
              placeholder="Choose sections"
            />
          </Field>
        ) : (
          <Field label="Choose a section" htmlFor="trigger-section">
            <Select
              value={chosen[0] || NONE}
              onValueChange={(next) => onChange(applyTriggerSections(configuration, form, [next]))}
            >
              <SelectTrigger id="trigger-section" className="w-full">
                <SelectValue placeholder="Choose a section" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ))}
    </>
  );
}

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
 * The field is chosen here rather than in a catalogue of its own. References
 * 08–11 pick it from a searchable list before the inspector opens, and that
 * list is not built — so without this control a condition added on the canvas
 * could never be told what it is about.
 */
function ConditionFields({
  configuration,
  metadata,
  onChange,
}: {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const fields = metadata?.conditionFields ?? [];

  const field = typeof configuration['field'] === 'string' ? configuration['field'] : '';
  const operator = typeof configuration['operator'] === 'string' ? configuration['operator'] : '';

  const definition = fields.find((entry) => entry.field === field);
  const valueType = definition ? resolveValueType(definition, metadata) : null;
  const operators = valueType ? operatorsFor(valueType, operator) : [];

  const multiple = operatorTakesMultipleValues(operator as ConditionOperator);
  const values = readConditionValues(configuration);

  /*
   * One write, not three.
   *
   * The operator and value belong to the old field — keeping them leaves "Due
   * date contains High" sitting in the form. They have to be cleared in the same
   * object as the new field, because each call builds on the configuration this
   * render was given and three of them in a row would keep only the last.
   *
   * The new field's commonest comparison is filled in rather than left blank:
   * `OPERATORS_BY_VALUE_TYPE` is ordered so the first is the one almost every
   * condition wants, and an empty second field is a question whose answer the
   * panel already knows.
   */
  const chooseField = (next: string) => {
    const chosen = fields.find((entry) => entry.field === next);

    onChange({
      ...configuration,
      field: next,
      operator: chosen ? (operatorsFor(resolveValueType(chosen, metadata), '')[0] ?? '') : '',
      value: undefined,
    });
  };

  return (
    <>
      <Field label="Field" htmlFor="condition-field">
        <Select value={field || NONE} onValueChange={chooseField}>
          <SelectTrigger id="condition-field" className="w-full">
            <SelectValue placeholder="Choose what to check" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((entry) => (
              <SelectItem key={entry.field} value={entry.field}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Choose an option" htmlFor="condition-operator">
        <Select
          value={operator || NONE}
          onValueChange={(next) =>
            /* The value follows the operator's shape: "is" holds one section,
               "is one of" holds a list, "is empty" holds nothing at all. */
            onChange({
              ...configuration,
              operator: next,
              value: retargetValue(configuration, next),
            })
          }
          disabled={!definition}
        >
          <SelectTrigger id="condition-operator" className="w-full">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            {operators.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {operatorLabel(entry)}
              </SelectItem>
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
          <Field label={valueFieldLabel(definition, valueType, multiple)} htmlFor="condition-value">
            <ConditionValue
              definition={definition}
              valueType={valueType}
              multiple={multiple}
              values={values}
              metadata={metadata}
              onChange={(next) =>
                onChange({ ...configuration, value: valueForOperator(next, operator) })
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
  definition,
  valueType,
  multiple,
  values,
  metadata,
  onChange,
}: {
  definition: ConditionFieldDefinition;
  valueType: ConditionValueType;
  multiple: boolean;
  values: string[];
  metadata: AutomationMetadata | undefined;
  onChange: (values: string[]) => void;
}) {
  const options = choiceOptions(definition, valueType, metadata);

  if (options) {
    return multiple ? (
      <MultiSelect
        id="condition-value"
        options={options}
        values={values}
        onChange={onChange}
        placeholder="Choose values"
      />
    ) : (
      <Select value={values[0] || NONE} onValueChange={(next) => onChange([next])}>
        <SelectTrigger id="condition-value" className="w-full">
          <SelectValue placeholder="Choose a value" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <OptionFace option={option} />
            </SelectItem>
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
          id="condition-value"
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
      id="condition-value"
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
    return definition.options.map((option) => ({ value: option.value, label: option.label }));
  }

  const faces = new Map((metadata?.members ?? []).map((member) => [member.id, member.avatarUrl]));

  return definition.options.map((option) => ({
    value: option.value,
    label: option.label,
    avatarUrl: faces.get(option.value) ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Do this                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What an action needs, chosen by its subtype.
 *
 * Only the fields that subtype actually uses. A form showing every possible
 * setting and disabling most of them makes somebody read the whole thing to
 * find the two that matter.
 */
function ActionFields({
  subtype,
  configuration,
  metadata,
  onChange,
}: {
  subtype: string;
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const read = (key: string): string => {
    const value = configuration[key];
    return typeof value === 'string' ? value : '';
  };

  const set = (key: string, value: unknown) => onChange({ ...configuration, [key]: value });

  const picker = (
    key: string,
    label: string,
    options: { id: string; name: string }[] | undefined,
    placeholder: string,
  ) => (
    <Field label={label} htmlFor={`step-${key}`}>
      <Select value={read(key) || NONE} onValueChange={(value) => set(key, value)}>
        <SelectTrigger id={`step-${key}`} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {(options ?? []).map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  switch (subtype) {
    case 'ASSIGN_USER':
      return picker(
        'userId',
        'Assign to',
        metadata?.members.map((member) => ({ id: member.id, name: member.name })),
        'Choose somebody',
      );

    case 'MOVE_TO_SECTION':
      return picker('sectionId', 'Section', metadata?.sections, 'Choose a section');

    case 'UPDATE_STATUS':
      return picker('statusDefinitionId', 'Status', metadata?.statuses, 'Choose a status');

    case 'UPDATE_PRIORITY':
      return picker('priorityDefinitionId', 'Priority', metadata?.priorities, 'Choose a priority');

    case 'ADD_COMMENT':
      return (
        <Field label="Comment" htmlFor="step-body">
          <Textarea
            id="step-body"
            rows={4}
            value={read('body')}
            onChange={(event) => set('body', event.target.value)}
            placeholder="What should it say?"
          />
        </Field>
      );

    default:
      return <p className="text-sm text-muted-foreground">This step has nothing to configure.</p>;
  }
}
