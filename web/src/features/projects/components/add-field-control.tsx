import { CUSTOM_FIELD_TYPES, CustomFieldType, SystemField } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewColumn } from '@coretask/types';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCreateCustomField } from '../hooks/use-project-views';
import { COLUMN_LABEL } from '../lib/column-labels';

/** Every system column a List view can show, in the order they are offered. */
const ADDABLE_SYSTEM_FIELDS = [
  SystemField.ASSIGNEE,
  SystemField.PRIORITY,
  SystemField.STATUS,
  SystemField.DUE_DATE,
  SystemField.SECTION,
  SystemField.START_DATE,
  SystemField.COMPLETED_AT,
  SystemField.CREATED_AT,
  SystemField.ESTIMATE,
];

/** The types whose values come from a list somebody has to write down first. */
const NEEDS_OPTIONS: CustomFieldType[] = [
  CustomFieldType.SINGLE_SELECT,
  CustomFieldType.MULTI_SELECT,
];

const TYPE_LABEL: Record<string, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  CHECKBOX: 'Checkbox',
  SINGLE_SELECT: 'Select',
  MULTI_SELECT: 'Multi-select',
  PEOPLE: 'People',
  URL: 'URL',
  EMAIL: 'Email',
};

/**
 * The `+` at the end of the header row: add a column, or make one.
 *
 * Two things a reader wants at the same moment and would otherwise have to
 * guess apart. Showing a field that already exists is a view change and takes
 * effect immediately; creating one changes the project for everybody, so it
 * asks for a name and a type first. Both end the same way — the new column is
 * appended to this view, which is what the person clicking `+` was after.
 */
export function AddFieldControl({
  columns,
  metadata,
  workspaceId,
  projectId,
  onChange,
}: {
  columns: ViewColumn[];
  metadata: ProjectFieldMetadata | undefined;
  workspaceId: string | undefined;
  projectId: string;
  onChange: (columns: ViewColumn[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const createField = useCreateCustomField(workspaceId, projectId);

  const shown = new Set(columns.map((column) => column.field));

  const addColumn = (field: string) => {
    if (shown.has(field)) return;
    onChange([...columns, { field }]);
  };

  const close = () => {
    setOpen(false);
    setCreating(false);
  };

  const hiddenSystem = ADDABLE_SYSTEM_FIELDS.filter((field) => !shown.has(field));
  const hiddenCustom = (metadata?.customFields ?? []).filter(
    (field) => !shown.has(`custom:${field.id}`),
  );
  const nothingLeft = hiddenSystem.length === 0 && hiddenCustom.length === 0;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCreating(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add a column"
          className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-0">
        {creating ? (
          <CreateFieldForm
            pending={createField.isPending}
            onCancel={() => setCreating(false)}
            onCreate={(payload) =>
              createField.mutate(payload, {
                // The column is added only once the field exists. Adding it
                // first would leave a column referring to nothing if the
                // request failed.
                onSuccess: (field) => {
                  addColumn(`custom:${field.id}`);
                  close();
                },
              })
            }
          />
        ) : (
          <div className="max-h-80 overflow-y-auto py-1">
            {nothingLeft ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Every field is already a column.
              </p>
            ) : (
              <>
                {hiddenSystem.length > 0 && (
                  <>
                    <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      Task fields
                    </p>
                    {hiddenSystem.map((field) => (
                      <MenuButton
                        key={field}
                        onClick={() => {
                          addColumn(field);
                          close();
                        }}
                      >
                        {COLUMN_LABEL[field] ?? field}
                      </MenuButton>
                    ))}
                  </>
                )}

                {hiddenCustom.length > 0 && (
                  <>
                    <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      Custom fields
                    </p>
                    {hiddenCustom.map((field) => (
                      <MenuButton
                        key={field.id}
                        onClick={() => {
                          addColumn(`custom:${field.id}`);
                          close();
                        }}
                      >
                        <span className="flex-1 truncate">{field.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {TYPE_LABEL[field.type] ?? field.type}
                        </span>
                      </MenuButton>
                    ))}
                  </>
                )}
              </>
            )}

            <div className="mt-1 border-t border-border pt-1">
              <MenuButton onClick={() => setCreating(true)}>
                <Plus className="size-3.5" aria-hidden="true" />
                Create field
              </MenuButton>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

function CreateFieldForm({
  pending,
  onCancel,
  onCreate,
}: {
  pending: boolean;
  onCancel: () => void;
  onCreate: (payload: {
    name: string;
    type: CustomFieldType;
    options?: { label: string }[];
  }) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>(CustomFieldType.TEXT);
  const [options, setOptions] = useState('');

  const needsOptions = NEEDS_OPTIONS.includes(type);

  const parsedOptions = options
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);

  // A select with no options is a column nobody can put a value in, so the
  // form asks for them rather than creating one and leaving it unusable.
  const valid = name.trim().length > 0 && (!needsOptions || parsedOptions.length > 0);

  return (
    <form
      className="space-y-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || pending) return;

        onCreate({
          name: name.trim(),
          type,
          ...(needsOptions ? { options: parsedOptions.map((label) => ({ label })) } : {}),
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="new-field-name">Name</Label>
        <Input
          id="new-field-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Estimate, Team, Risk…"
          className="h-8"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-field-type">Type</Label>
        <Select value={type} onValueChange={(value) => setType(value as CustomFieldType)}>
          <SelectTrigger id="new-field-type" className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CUSTOM_FIELD_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {TYPE_LABEL[value] ?? value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {needsOptions && (
        <div className="space-y-1.5">
          <Label htmlFor="new-field-options">Options</Label>
          <Input
            id="new-field-options"
            value={options}
            onChange={(event) => setOptions(event.target.value)}
            placeholder="Low, Medium, High"
            className="h-8"
          />
          <p className="text-xs text-muted-foreground">Separated by commas.</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid} loading={pending}>
          Create
        </Button>
      </div>
    </form>
  );
}
