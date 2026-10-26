import {
  OPERATORS_BY_KIND,
  OPERATOR_LABEL,
  operatorTakesList,
  operatorTakesValue,
  type FilterOperator,
} from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewFilterCondition } from '@coretask/types';
import { ChevronDown, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { filterableFields, type QueryableField } from '../../lib/view-fields';
import { FieldTypeIcon } from '../field-picker/field-type-icon';

import { FilterValueControl } from './filter-value-control';

/**
 * One condition: field, operator, value.
 *
 * Changing the field resets the operator to the first its kind offers and
 * clears the value, because an operator that fitted a date does not fit a
 * person and a value typed for one field means nothing to the next.
 */
export function FilterRow({
  condition,
  metadata,
  meId,
  onChange,
  onRemove,
}: {
  condition: ViewFilterCondition;
  metadata: ProjectFieldMetadata | undefined;
  meId: string | undefined;
  onChange: (condition: ViewFilterCondition) => void;
  onRemove: () => void;
}) {
  const fields = filterableFields(metadata);
  const field = fields.find((entry) => entry.ref === condition.field);
  const operators = field ? OPERATORS_BY_KIND[field.kind] : [];

  const chooseField = (next: QueryableField) => {
    const operator = OPERATORS_BY_KIND[next.kind][0] as FilterOperator;
    onChange({ field: next.ref, operator });
  };

  const chooseOperator = (operator: FilterOperator) => {
    // A value survives between two operators of the same shape; it does not
    // survive a change of shape (one to many, or to none).
    const keep =
      operatorTakesValue(operator) &&
      operatorTakesValue(condition.operator) &&
      operatorTakesList(operator) === operatorTakesList(condition.operator);
    onChange({
      field: condition.field,
      operator,
      ...(keep && condition.value !== undefined ? { value: condition.value } : {}),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter">
      <FieldPicker fields={fields} current={field} onChoose={chooseField} />

      <Select
        value={condition.operator}
        onValueChange={(next) => chooseOperator(next as FilterOperator)}
        disabled={!field}
      >
        <SelectTrigger aria-label="Operator" className="h-8 w-auto min-w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((operator) => (
            <SelectItem key={operator} value={operator}>
              {OPERATOR_LABEL[operator]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {field && (
        <div className="min-w-40 flex-1">
          <FilterValueControl
            field={field}
            operator={condition.operator}
            value={condition.value}
            metadata={metadata}
            meId={meId}
            onChange={(value) =>
              onChange({
                field: condition.field,
                operator: condition.operator,
                ...(value === undefined || value === null ? {} : { value }),
              })
            }
          />
        </div>
      )}

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Remove filter"
        onClick={onRemove}
        className="shrink-0"
      >
        <X />
      </Button>
    </div>
  );
}

/** Grouped as Asana groups them: the built-in fields, then this project's. */
export function FieldPicker({
  fields,
  current,
  onChoose,
  label = 'Field',
}: {
  fields: QueryableField[];
  current: QueryableField | undefined;
  onChoose: (field: QueryableField) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const system = fields.filter((field) => field.origin === 'system');
  const custom = fields.filter((field) => field.origin === 'custom');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={label}
          className="h-8 min-w-32 justify-between text-xs"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {current && <FieldTypeIcon type={current.dataType} className="size-3.5" />}
            <span className="truncate">{current?.label ?? 'Choose a field'}</span>
          </span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Find a field…" />
          <CommandList>
            <CommandEmpty>No field by that name.</CommandEmpty>
            <CommandGroup heading="Fields">
              {system.map((field) => (
                <CommandItem
                  key={field.ref}
                  value={`${field.label} ${field.ref}`}
                  onSelect={() => {
                    onChoose(field);
                    setOpen(false);
                  }}
                >
                  <FieldTypeIcon type={field.dataType} />
                  {field.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {custom.length > 0 && (
              <CommandGroup heading="Custom fields">
                {custom.map((field) => (
                  <CommandItem
                    key={field.ref}
                    value={`${field.label} ${field.ref}`}
                    onSelect={() => {
                      onChoose(field);
                      setOpen(false);
                    }}
                  >
                    <FieldTypeIcon type={field.dataType} />
                    {field.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
