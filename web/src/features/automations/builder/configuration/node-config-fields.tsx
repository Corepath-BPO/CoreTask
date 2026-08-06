import { OPERATORS_BY_VALUE_KIND, operatorTakesValue } from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';

import type { CanvasNode } from '../lib/graph-edits';

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
  const config = node.configuration;

  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  const read = (key: string): string => {
    const value = config[key];
    return typeof value === 'string' ? value : '';
  };

  /* A branch holds the comparison that chooses its arm, so it is configured
     exactly as a condition is — one decision, one node. */
  return node.type === 'CONDITION' || node.type === 'BRANCH' ? (
    <ConditionFields
      config={config}
      metadata={metadata}
      set={set}
      read={read}
      onChange={onChange}
    />
  ) : (
    <StepFields
      subtype={node.subtype}
      isTrigger={node.type === 'TRIGGER'}
      metadata={metadata}
      set={set}
      read={read}
    />
  );
}

/**
 * Field, operator, value — with the operators the field's type allows.
 *
 * "Date contains High" and "Checkbox greater than 10" are combinations this
 * never offers, because the field says what kind of value it holds and the
 * operator list follows from that. The endpoint refuses the same pairs, so the
 * form is a convenience rather than the only thing standing in the way.
 */
function ConditionFields({
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
  const fields = metadata?.conditionFields ?? [];
  const definition = fields.find((entry) => entry.field === read('field'));
  const operators = definition ? OPERATORS_BY_VALUE_KIND[definition.valueKind] : [];
  const operator = read('operator');

  return (
    <>
      <Field label="Field" htmlFor="condition-field">
        <Select
          value={read('field') || NONE}
          onValueChange={(value) =>
            /*
             * One write, not three.
             *
             * The operator and value belong to the old field — keeping them
             * leaves "Due date contains High" sitting in the form. They have to
             * be cleared in the same object as the new field, because each call
             * builds on the configuration this render was given and three of
             * them in a row would keep only the last.
             */
            onChange({ ...config, field: value, operator: '', value: undefined })
          }
        >
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

      <Field label="Comparison" htmlFor="condition-operator">
        <Select
          value={operator || NONE}
          onValueChange={(value) => set('operator', value)}
          disabled={!definition}
        >
          <SelectTrigger id="condition-operator" className="w-full">
            <SelectValue placeholder="Choose a comparison" />
          </SelectTrigger>
          <SelectContent>
            {operators.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {entry.replace(/_/g, ' ').toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* An emptiness check compares against nothing, so there is nothing to
          ask for — an input here would be a field that is ignored. */}
      {definition && operator && operatorTakesValue(operator as never) && (
        <Field label="Value" htmlFor="condition-value">
          {definition.options ? (
            <Select
              value={typeof config['value'] === 'string' ? (config['value'] as string) : NONE}
              onValueChange={(value) => set('value', value)}
            >
              <SelectTrigger id="condition-value" className="w-full">
                <SelectValue placeholder="Choose a value" />
              </SelectTrigger>
              <SelectContent>
                {definition.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="condition-value"
              type={definition.valueKind === 'DATE' ? 'date' : 'text'}
              value={typeof config['value'] === 'string' ? (config['value'] as string) : ''}
              onChange={(event) => set('value', event.target.value)}
            />
          )}
        </Field>
      )}
    </>
  );
}

/**
 * What a trigger or an action needs, chosen by its subtype.
 *
 * Only the fields that subtype actually uses. A form showing every possible
 * setting and disabling most of them makes somebody read the whole thing to
 * find the two that matter.
 */
function StepFields({
  subtype,
  isTrigger,
  metadata,
  set,
  read,
}: {
  subtype: string;
  isTrigger: boolean;
  metadata: AutomationMetadata | undefined;
  set: (key: string, value: unknown) => void;
  read: (key: string) => string;
}) {
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

  if (isTrigger) {
    // Only the section-scoped triggers need anything; the rest fire on the
    // whole project and have nothing to configure.
    if (subtype === 'TASK_MOVED_TO_SECTION') {
      return picker('sectionId', 'Section', metadata?.sections, 'Any section');
    }

    return (
      <p className="text-sm text-muted-foreground">
        This trigger fires for the whole project, so there is nothing to set.
      </p>
    );
  }

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
