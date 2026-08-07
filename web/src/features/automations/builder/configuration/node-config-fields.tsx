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
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import type { CanvasNode } from '../lib/graph-edits';

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
import {
  applyTriggerForm,
  applyTriggerSections,
  formsForTrigger,
  readTriggerForm,
  readTriggerSections,
} from './trigger-forms';
import { RadioItem } from './radio-item';
import { MultiSelect, OptionFace, type ChoiceOption } from './value-controls';

/*
 * Nothing chosen is an empty string, not a token.
 *
 * A sentinel like `__none__` matches no item, and a controlled Radix select
 * holding a value it cannot find renders blank — so every one of these showed
 * an empty box where its placeholder should have been, and a form that has not
 * been filled in looked like one that had been filled in with nothing.
 *
 * An empty string is what Radix reads as "no selection", which is exactly the
 * state being described, and it shows the placeholder.
 */

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
              <RadioItem key={entry.form} value={entry.form}>
                {entry.label}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Only the forms that name a section ask for one; "Section is changed"
          watches every move and has nothing left to answer. */}
      {form.needsValue &&
        (form.multiple ? (
          /* The wording is the specification's, and it says "column/section"
             because a section is a board column and a list group depending on
             which view somebody came from — naming only one of them makes the
             field look like it belongs to the other view. */
          <Field label="Choose one or more options for column/section" htmlFor="trigger-sections">
            <MultiSelect
              id="trigger-sections"
              options={options}
              values={chosen}
              onChange={(next) => onChange(applyTriggerSections(configuration, form, next))}
              placeholder="Choose sections"
            />
          </Field>
        ) : (
          <Field label="Choose a column/section" htmlFor="trigger-section">
            <Select
              value={chosen[0] ?? ''}
              onValueChange={(next) => onChange(applyTriggerSections(configuration, form, [next]))}
            >
              <SelectTrigger id="trigger-section" className="w-full">
                <SelectValue placeholder="Choose a column/section" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <RadioItem key={option.value} value={option.value}>
                    {option.label}
                  </RadioItem>
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
 * The field is *not* chosen here. References 08–11 pick it from a searchable
 * list before the inspector opens, and that list is now wired up: a row nobody
 * has answered opens the condition catalogue, which writes the field and its
 * first comparison, and this panel takes over from there. So this form asks the
 * second and third questions and assumes the first has been answered.
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
      <Field label="Choose an option" htmlFor="condition-operator">
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
          <SelectTrigger id="condition-operator" className="w-full">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            {operators.map((entry) => (
              <RadioItem key={entry} value={entry}>
                {operatorOptionLabel(definition?.label ?? '', entry)}
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
          <Field label={valueFieldLabel(definition, valueType, multiple)} htmlFor="condition-value">
            <ConditionValue
              definition={definition}
              valueType={valueType}
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
      <Select value={values[0] ?? ''} onValueChange={(next) => onChange([next])}>
        <SelectTrigger id="condition-value" className="w-full">
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
      <Select value={read(key)} onValueChange={(value) => set(key, value)}>
        <SelectTrigger id={`step-${key}`} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {(options ?? []).map((option) => (
            <RadioItem key={option.id} value={option.id}>
              {option.name}
            </RadioItem>
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

    /*
     * `status`, not `statusDefinitionId`.
     *
     * The runner reads `status`, so a rule built here wrote a key nothing read
     * and set the status to an empty string on every run. The short name is the
     * canonical one because the value is a status *id* — a definition's uuid
     * where a workspace has defined its own, and a legacy enum name where it
     * has not — so the longer name would be wrong for half of them.
     */
    case 'UPDATE_STATUS':
      return picker('status', 'Status', metadata?.statuses, 'Choose a status');

    case 'UPDATE_PRIORITY':
      return picker('priority', 'Priority', metadata?.priorities, 'Choose a priority');

    case 'SET_CUSTOM_FIELD':
      return (
        <CustomFieldAction
          config={configuration}
          metadata={metadata}
          set={set}
          read={read}
          onChange={onChange}
        />
      );

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

/**
 * Setting a custom field: which one, and what to.
 *
 * Two questions rather than one, because a rule may be built from the catalogue
 * — where the row already names the field — or from a step somebody inserted,
 * where nothing has been chosen yet. The picker is shown either way rather than
 * hidden once filled, so the field is visible on the form that sets it and can
 * be corrected without deleting the step.
 *
 * The value control follows the field's type, and each one produces exactly the
 * shape the runner stores for that type. A control that produced a string for a
 * number field would write `NaN` and report success.
 */
function CustomFieldAction({
  config,
  metadata,
  set,
  read,
  onChange,
}: {
  config: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  set: (key: string, value: unknown) => void;
  read: (key: string) => string;
  onChange: (configuration: Record<string, unknown>) => void;
}) {
  const fields = metadata?.customFields ?? [];
  // Canonical name first, then the one this was written under before the
  // builder and the runner agreed — see `LEGACY_ACTION_KEYS` on the API side.
  const fieldId = read('fieldId') || read('customFieldId');
  const field = fields.find((entry) => entry.id === fieldId);

  const options: ChoiceOption[] = (field?.options ?? []).map((option) => ({
    value: option.id,
    label: option.label,
  }));

  const raw = config['value'];
  const asList = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw ? [raw] : [];

  return (
    <>
      <Field label="Field" htmlFor="step-custom-field">
        <Select
          value={fieldId}
          onValueChange={(value) =>
            /*
             * One write, and the old value goes with it.
             *
             * A value belongs to the field it was chosen from — an option id
             * from one select field means nothing in another, and a date is not
             * a number. Keeping it would leave the form looking answered while
             * storing something the runner cannot use.
             */
            onChange({ ...config, fieldId: value, customFieldId: undefined, value: undefined })
          }
        >
          <SelectTrigger id="step-custom-field" className="w-full">
            <SelectValue placeholder="Choose a field" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((entry) => (
              <RadioItem key={entry.id} value={entry.id}>
                {entry.name}
              </RadioItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {field && (
        <Field label="Value" htmlFor="step-custom-value">
          {field.type === 'CHECKBOX' ? (
            <Select
              value={raw === true ? 'true' : raw === false ? 'false' : ''}
              onValueChange={(value) => set('value', value === 'true')}
            >
              <SelectTrigger id="step-custom-value" className="w-full">
                <SelectValue placeholder="Checked or not" />
              </SelectTrigger>
              <SelectContent>
                <RadioItem value="true">Checked</RadioItem>
                <RadioItem value="false">Not checked</RadioItem>
              </SelectContent>
            </Select>
          ) : field.type === 'MULTI_SELECT' ? (
            <MultiSelect
              id="step-custom-value"
              options={options}
              values={asList}
              onChange={(next) => set('value', next)}
              placeholder="Choose options"
            />
          ) : field.type === 'SINGLE_SELECT' ? (
            <Select value={read('value')} onValueChange={(value) => set('value', value)}>
              <SelectTrigger id="step-custom-value" className="w-full">
                <SelectValue placeholder="Choose an option" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <RadioItem key={option.value} value={option.value}>
                    <OptionFace option={option} />
                  </RadioItem>
                ))}
              </SelectContent>
            </Select>
          ) : field.type === 'PEOPLE' ? (
            <MultiSelect
              id="step-custom-value"
              options={(metadata?.members ?? []).map((member) => ({
                value: member.id,
                label: member.name,
              }))}
              values={asList}
              onChange={(next) => set('value', next)}
              placeholder="Choose people"
            />
          ) : (
            <Input
              id="step-custom-value"
              // The runner coerces by type, so the control has to produce what
              // that coercion expects — a date string, a number, or text.
              type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'}
              value={typeof raw === 'number' ? String(raw) : read('value')}
              onChange={(event) =>
                set(
                  'value',
                  field.type === 'NUMBER'
                    ? event.target.value === ''
                      ? undefined
                      : Number(event.target.value)
                    : event.target.value,
                )
              }
            />
          )}
        </Field>
      )}
    </>
  );
}
