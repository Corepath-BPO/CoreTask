import { CustomFieldType } from '@coretask/contracts';
import type { CustomField, ProjectFieldMetadata, TaskCustomFieldValue } from '@coretask/types';
import { Check } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { cn, formatDate } from '@/lib/utils';

import { CellButton, EmptyCell } from './editable-cell';
import { useCellEditor } from './use-cell-editor';

/**
 * One cell for every custom field type.
 *
 * A single dispatching component rather than a table that knows about field
 * types. That is the difference between adding a field type being a change here
 * and a change in every view that renders a row — and it is why creating a field
 * needs no frontend work at all today.
 *
 * The dispatch is on the *definition's* type, never on the shape of the stored
 * value: a value written under an older definition still renders through the
 * editor its field currently declares.
 */
export function CustomFieldCell({
  field,
  value,
  metadata,
  canEdit,
  taskTitle,
  onSave,
}: {
  field: CustomField;
  value: TaskCustomFieldValue | undefined;
  metadata: ProjectFieldMetadata | undefined;
  canEdit: boolean;
  taskTitle: string;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const label = `${field.name} for "${taskTitle}"`;

  switch (field.type) {
    case CustomFieldType.CHECKBOX:
      // No open/commit cycle: a checkbox *is* its editor, and making someone
      // click twice to toggle one would be worse than the read-only table.
      return (
        <input
          type="checkbox"
          checked={value?.checkbox ?? false}
          disabled={!canEdit}
          onChange={(event) => onSave({ checkbox: event.target.checked })}
          aria-label={label}
          className="size-4 rounded border-input accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
      );

    case CustomFieldType.NUMBER:
      return (
        <ScalarCell
          initial={value?.number == null ? '' : String(value.number)}
          canEdit={canEdit}
          label={label}
          type="number"
          onCommit={(next) => onSave({ number: next === '' ? null : Number(next) })}
          render={(text) =>
            text === '' ? <EmptyCell /> : <span className="tabular-nums">{text}</span>
          }
        />
      );

    case CustomFieldType.DATE:
      return (
        <ScalarCell
          initial={value?.date ? value.date.slice(0, 10) : ''}
          canEdit={canEdit}
          label={label}
          type="date"
          onCommit={(next) =>
            onSave({ date: next ? new Date(`${next}T00:00:00.000Z`).toISOString() : null })
          }
          render={(text) => (text ? formatDate(text) : <EmptyCell />)}
        />
      );

    case CustomFieldType.URL:
      return (
        <ScalarCell
          initial={value?.text ?? ''}
          canEdit={canEdit}
          label={label}
          type="url"
          onCommit={(next) => onSave({ text: next || null })}
          render={(text) =>
            text ? (
              // Stops the click reaching the cell button behind it, which would
              // open an editor over the page the link just opened.
              <a
                href={text}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(event) => event.stopPropagation()}
                className="truncate text-primary underline-offset-2 hover:underline"
              >
                {text}
              </a>
            ) : (
              <EmptyCell />
            )
          }
        />
      );

    case CustomFieldType.EMAIL:
      return (
        <ScalarCell
          initial={value?.text ?? ''}
          canEdit={canEdit}
          label={label}
          type="email"
          onCommit={(next) => onSave({ text: next || null })}
          render={(text) => text || <EmptyCell />}
        />
      );

    case CustomFieldType.TEXT:
      return (
        <ScalarCell
          initial={value?.text ?? ''}
          canEdit={canEdit}
          label={label}
          type="text"
          onCommit={(next) => onSave({ text: next || null })}
          render={(text) => text || <EmptyCell />}
        />
      );

    case CustomFieldType.SINGLE_SELECT:
      return (
        <SelectCell
          field={field}
          selected={value?.optionIds ?? []}
          canEdit={canEdit}
          label={label}
          onCommit={(optionIds) => onSave({ optionIds })}
        />
      );

    case CustomFieldType.MULTI_SELECT:
      return (
        <MultiSelectCell
          field={field}
          selected={value?.optionIds ?? []}
          canEdit={canEdit}
          label={label}
          onCommit={(optionIds) => onSave({ optionIds })}
        />
      );

    case CustomFieldType.PEOPLE:
      return (
        <PeopleCell
          metadata={metadata}
          selected={value?.userIds ?? []}
          canEdit={canEdit}
          label={label}
          onCommit={(userIds) => onSave({ userIds })}
        />
      );

    default:
      // A field type the client does not know — a row written by a newer
      // version. Shown as read-only rather than crashing the whole row.
      return <span className="text-xs text-muted-foreground">Unsupported field</span>;
  }
}

/** Text, number, date, url and email differ only by input type and rendering. */
function ScalarCell({
  initial,
  canEdit,
  label,
  type,
  onCommit,
  render,
}: {
  initial: string;
  canEdit: boolean;
  label: string;
  type: 'text' | 'number' | 'date' | 'url' | 'email';
  onCommit: (value: string) => void;
  render: (value: string) => React.ReactNode;
}) {
  const editor = useCellEditor(initial, onCommit);

  if (editor.editing) {
    return (
      <Input
        type={type}
        autoFocus
        value={editor.draft}
        onChange={(event) => editor.setDraft(event.target.value)}
        onBlur={editor.commit}
        onKeyDown={editor.onKeyDown}
        aria-label={label}
        className="h-7 text-xs"
      />
    );
  }

  return (
    <CellButton onOpen={editor.open} disabled={!canEdit} ariaLabel={label} className="text-xs">
      {render(initial)}
    </CellButton>
  );
}

function OptionBadge({ field, optionId }: { field: CustomField; optionId: string }) {
  const option = field.options.find((entry) => entry.id === optionId);

  // An archived option still renders its label. That is the whole reason
  // options archive rather than delete — a cell showing a bare uuid tells the
  // reader nothing about what they chose.
  if (!option) return <span className="text-xs text-muted-foreground">Unknown</span>;

  return (
    <SemanticBadge color={{ colorToken: option.colorToken, customColor: option.customColor }}>
      {option.label}
    </SemanticBadge>
  );
}

function SelectCell({
  field,
  selected,
  canEdit,
  label,
  onCommit,
}: {
  field: CustomField;
  selected: string[];
  canEdit: boolean;
  label: string;
  onCommit: (optionIds: string[]) => void;
}) {
  const current = selected[0] ?? '';
  const editor = useCellEditor(current, (value) => onCommit(value ? [value] : []));

  if (editor.editing) {
    return (
      <Select
        open
        value={editor.draft}
        onValueChange={(value) => {
          const next = value === '__none__' ? '' : value;
          if (next !== current) onCommit(next ? [next] : []);
          editor.cancel();
        }}
        onOpenChange={(open) => !open && editor.cancel()}
      >
        <SelectTrigger className="h-7 text-xs" aria-label={label}>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Clear</SelectItem>
          {field.options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              <SemanticBadge
                color={{ colorToken: option.colorToken, customColor: option.customColor }}
              >
                {option.label}
              </SemanticBadge>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <CellButton onOpen={editor.open} disabled={!canEdit} ariaLabel={label}>
      {current ? <OptionBadge field={field} optionId={current} /> : <EmptyCell />}
    </CellButton>
  );
}

/**
 * Several options at once.
 *
 * Each option is a toggle rather than a replace, and the menu stays open — the
 * point of a multi-select is choosing more than one, and closing after each
 * pick would make that four clicks instead of one.
 */
function MultiSelectCell({
  field,
  selected,
  canEdit,
  label,
  onCommit,
}: {
  field: CustomField;
  selected: string[];
  canEdit: boolean;
  label: string;
  onCommit: (optionIds: string[]) => void;
}) {
  const editor = useCellEditor('', () => undefined);

  if (editor.editing) {
    return (
      <div
        role="group"
        aria-label={label}
        onKeyDown={editor.onKeyDown}
        className="flex flex-wrap gap-1 rounded-md border border-input bg-background p-1"
      >
        {field.options.map((option) => {
          const isOn = selected.includes(option.id);

          return (
            <button
              key={option.id}
              type="button"
              role="checkbox"
              aria-checked={isOn}
              onClick={() =>
                onCommit(
                  isOn ? selected.filter((id) => id !== option.id) : [...selected, option.id],
                )
              }
              className={cn('rounded', isOn && 'ring-1 ring-ring')}
            >
              <SemanticBadge
                color={{ colorToken: option.colorToken, customColor: option.customColor }}
                icon={isOn ? <Check className="size-3" aria-hidden="true" /> : undefined}
              >
                {option.label}
              </SemanticBadge>
            </button>
          );
        })}
        <button
          type="button"
          onClick={editor.cancel}
          className="rounded px-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <CellButton onOpen={editor.open} disabled={!canEdit} ariaLabel={label}>
      {selected.length === 0 ? (
        <EmptyCell />
      ) : (
        <span className="flex flex-wrap gap-1">
          {selected.map((id) => (
            <OptionBadge key={id} field={field} optionId={id} />
          ))}
        </span>
      )}
    </CellButton>
  );
}

function PeopleCell({
  metadata,
  selected,
  canEdit,
  label,
  onCommit,
}: {
  metadata: ProjectFieldMetadata | undefined;
  selected: string[];
  canEdit: boolean;
  label: string;
  onCommit: (userIds: string[]) => void;
}) {
  const current = selected[0] ?? '';
  const editor = useCellEditor(current, (value) => onCommit(value ? [value] : []));
  const people = metadata?.members ?? [];

  if (editor.editing) {
    return (
      <Select
        open
        value={editor.draft}
        onValueChange={(value) => {
          const next = value === '__none__' ? '' : value;
          if (next !== current) onCommit(next ? [next] : []);
          editor.cancel();
        }}
        onOpenChange={(open) => !open && editor.cancel()}
      >
        <SelectTrigger className="h-7 text-xs" aria-label={label}>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Clear</SelectItem>
          {people.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const names = selected
    .map((id) => people.find((member) => member.id === id)?.name)
    .filter(Boolean);

  return (
    <CellButton onOpen={editor.open} disabled={!canEdit} ariaLabel={label} className="text-xs">
      {names.length > 0 ? names.join(', ') : <EmptyCell />}
    </CellButton>
  );
}
