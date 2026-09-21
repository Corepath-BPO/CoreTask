import {
  RELATIVE_DATE_LABEL,
  RELATIVE_DATES,
  isRelativeDate,
  operatorTakesList,
  operatorTakesValue,
  type FilterOperator,
} from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/features/automations/builder/configuration/value-controls';

import { choicesFor } from '../../lib/filter-choices';
import type { QueryableField } from '../../lib/view-fields';

type FilterValue = string | number | boolean | string[] | null | undefined;

const CUSTOM_DATE = '__custom__';
const DEBOUNCE_MS = 400;

/**
 * The value half of a filter row, chosen by the field's kind.
 *
 * Text and numbers are typed and debounced, so the rows refetch when the
 * typing pauses rather than per keystroke. Dates offer Asana's relative
 * choices — "the end of this week" — as tokens the server resolves, so a
 * saved filter never goes stale, with a calendar date as the escape hatch.
 * Enums and people are the workspace's own lists, "Me" first.
 */
export function FilterValueControl({
  field,
  operator,
  value,
  metadata,
  meId,
  onChange,
}: {
  field: QueryableField;
  operator: FilterOperator;
  value: FilterValue;
  metadata: ProjectFieldMetadata | undefined;
  meId: string | undefined;
  onChange: (value: FilterValue) => void;
}) {
  if (!operatorTakesValue(operator)) return null;

  switch (field.kind) {
    case 'TEXT':
      return (
        <DebouncedInput
          type="text"
          value={typeof value === 'string' ? value : ''}
          onCommit={(text) => onChange(text || null)}
          ariaLabel={`${field.label} value`}
        />
      );
    case 'NUMBER':
      return (
        <DebouncedInput
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onCommit={(text) => onChange(text === '' ? null : Number(text))}
          ariaLabel={`${field.label} value`}
        />
      );
    case 'DATE':
      return <DateValue field={field} value={value} onChange={onChange} />;
    case 'BOOLEAN':
      return (
        <Select
          value={value === true ? 'true' : value === false ? 'false' : ''}
          onValueChange={(next) => onChange(next === 'true')}
        >
          <SelectTrigger aria-label={`${field.label} value`} className="h-8 text-xs">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Ticked</SelectItem>
            <SelectItem value="false">Clear</SelectItem>
          </SelectContent>
        </Select>
      );
    case 'ENUM':
    case 'PEOPLE': {
      const options = choicesFor(field, metadata, meId);
      if (operatorTakesList(operator)) {
        return (
          <MultiSelect
            id={`filter-${field.ref}`}
            options={options}
            values={Array.isArray(value) ? value : []}
            onChange={(next) => onChange(next)}
            placeholder="Choose…"
          />
        );
      }
      return (
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => onChange(next)}
        >
          <SelectTrigger aria-label={`${field.label} value`} className="h-8 text-xs">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
  }
}

function DateValue({
  field,
  value,
  onChange,
}: {
  field: QueryableField;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}) {
  const token = isRelativeDate(value) ? value : null;
  const [custom, setCustom] = useState(token === null && typeof value === 'string');
  const selected = token ?? (custom || typeof value === 'string' ? CUSTOM_DATE : '');

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Select
        value={selected}
        onValueChange={(next) => {
          if (next === CUSTOM_DATE) {
            setCustom(true);
            if (isRelativeDate(value)) onChange(null);
            return;
          }
          setCustom(false);
          onChange(next);
        }}
      >
        <SelectTrigger aria-label={`${field.label} value`} className="h-8 text-xs">
          <SelectValue placeholder="When" />
        </SelectTrigger>
        <SelectContent>
          {RELATIVE_DATES.map((entry) => (
            <SelectItem key={entry} value={entry}>
              {RELATIVE_DATE_LABEL[entry]}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_DATE}>a date…</SelectItem>
        </SelectContent>
      </Select>
      {selected === CUSTOM_DATE && (
        <Input
          type="date"
          aria-label={`${field.label} date`}
          className="h-8 w-36 text-xs"
          value={typeof value === 'string' && !isRelativeDate(value) ? value.slice(0, 10) : ''}
          onChange={(event) =>
            onChange(event.target.value ? `${event.target.value}T00:00:00.000Z` : null)
          }
        />
      )}
    </div>
  );
}

/**
 * An input that reports its value once typing pauses.
 *
 * The rows refetch on every change the filter makes, and a refetch per
 * keystroke is a request per letter of "onboarding".
 */
function DebouncedInput({
  type,
  value,
  onCommit,
  ariaLabel,
}: {
  type: 'text' | 'number';
  value: string;
  onCommit: (value: string) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  // A value from outside resets the draft during render — the way React
  // documents adjusting state to a prop change — rather than one render late.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;
    const handle = setTimeout(() => onCommit(draft), DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // `onCommit` is a fresh closure each render; the draft is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <Input
      type={type}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft);
      }}
      aria-label={ariaLabel}
      placeholder={type === 'number' ? '0' : 'Text'}
      className="h-8 text-xs"
    />
  );
}
