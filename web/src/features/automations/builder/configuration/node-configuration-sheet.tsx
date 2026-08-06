import type { AutomationNodeType } from '@coretask/contracts';
import {
  NODE_CATEGORY_LABEL,
  OPERATORS_BY_VALUE_KIND,
  operatorTakesValue,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';

import type { CanvasNode } from '../lib/graph-edits';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';

/** Radix `Select` treats `''` as "no value", so absence needs a real token. */
const NONE = '__none__';

interface Props {
  node: CanvasNode | null;
  metadata: AutomationMetadata | undefined;
  onClose: () => void;
  onSave: (nodeId: string, configuration: Record<string, unknown>) => void;
}

/**
 * Editing one step, beside the rule rather than instead of it.
 *
 * A sheet, not a full-screen form: the point of a canvas is seeing the shape,
 * and replacing it while somebody configures a step takes away the context that
 * makes the step make sense.
 *
 * Mounted only while a node is selected and keyed by its id, so its fields are
 * initialised from that node rather than reset by an effect that exists to undo
 * the render before it.
 */
export function NodeConfigurationSheet({ node, metadata, onClose, onSave }: Props) {
  return (
    <Sheet open={node !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent aria-describedby={undefined}>
        {node && (
          <NodeForm
            key={node.id}
            node={node}
            metadata={metadata}
            onClose={onClose}
            onSave={onSave}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function NodeForm({
  node,
  metadata,
  onClose,
  onSave,
}: {
  node: CanvasNode;
  metadata: AutomationMetadata | undefined;
  onClose: () => void;
  onSave: (nodeId: string, configuration: Record<string, unknown>) => void;
}) {
  const [config, setConfig] = useState<Record<string, unknown>>(node.configuration);

  const set = (key: string, value: unknown) =>
    setConfig((previous) => ({ ...previous, [key]: value }));

  const read = (key: string): string => {
    const value = config[key];
    return typeof value === 'string' ? value : '';
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>{NODE_CATEGORY_LABEL[node.type as AutomationNodeType] ?? 'Step'}</SheetTitle>
        <SheetDescription>{node.subtype.replace(/_/g, ' ').toLowerCase()}</SheetDescription>
      </SheetHeader>

      <div className="grid gap-4">
        {node.type === 'CONDITION' ? (
          <ConditionFields config={config} metadata={metadata} set={set} read={read} />
        ) : (
          <StepFields
            subtype={node.subtype}
            isTrigger={node.type === 'TRIGGER'}
            metadata={metadata}
            set={set}
            read={read}
          />
        )}
      </div>

      <SheetFooter>
        <Button variant="outline" className="cursor-pointer" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="cursor-pointer"
          onClick={() => {
            onSave(node.id, config);
            onClose();
          }}
        >
          Save step
        </Button>
      </SheetFooter>
    </>
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
}: {
  config: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  set: (key: string, value: unknown) => void;
  read: (key: string) => string;
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
          onValueChange={(value) => {
            set('field', value);
            // The operator and value belong to the old field. Keeping them
            // would leave "Due date contains High" sitting in the form.
            set('operator', '');
            set('value', undefined);
          }}
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
