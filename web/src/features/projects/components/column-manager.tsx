import { SystemField } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewColumn } from '@coretask/types';
import { Check, GripVertical } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { COLUMN_LABEL, columnLabel as label } from '../lib/column-labels';

/** Every system column a List view can show, in the order they are offered. */
const AVAILABLE_SYSTEM_FIELDS = [
  SystemField.TITLE,
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

/**
 * Chooses which columns a view shows, and in what order.
 *
 * Custom fields are listed from the project's own metadata rather than a
 * hard-coded list, which is what makes a newly created field appear here
 * without a frontend change.
 */
export function ColumnManager({
  columns,
  metadata,
  onChange,
  trigger,
}: {
  columns: ViewColumn[];
  metadata: ProjectFieldMetadata | undefined;
  onChange: (columns: ViewColumn[]) => void;
  trigger: React.ReactNode;
}) {
  const visible = new Set(columns.map((column) => column.field));

  const toggle = (field: string) => {
    // The task name is the row's identity and its link to the detail dialog;
    // hiding it would leave a table of attributes belonging to nothing.
    if (field === SystemField.TITLE) return;

    onChange(
      visible.has(field)
        ? columns.filter((column) => column.field !== field)
        : [...columns, { field }],
    );
  };

  const move = (field: string, direction: -1 | 1) => {
    const index = columns.findIndex((column) => column.field === field);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= columns.length) return;

    const next = [...columns];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    onChange(next);
  };

  const customFields = metadata?.customFields ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-64 overflow-y-auto">
        <DropdownMenuLabel>Shown</DropdownMenuLabel>
        {columns.map((column, index) => (
          <div
            key={column.field}
            className="flex items-center gap-1 px-2 py-1 text-sm"
          >
            <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1 truncate">{label(column.field, metadata)}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Move ${label(column.field, metadata)} up`}
              disabled={index === 0}
              onClick={() => move(column.field, -1)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Move ${label(column.field, metadata)} down`}
              disabled={index === columns.length - 1}
              onClick={() => move(column.field, 1)}
            >
              ↓
            </Button>
          </div>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Fields</DropdownMenuLabel>

        {AVAILABLE_SYSTEM_FIELDS.map((field) => (
          <DropdownMenuItem
            key={field}
            onSelect={(event) => {
              // Kept open so several columns can be toggled in one visit.
              event.preventDefault();
              toggle(field);
            }}
            disabled={field === SystemField.TITLE}
            className="gap-2"
          >
            <Check
              className={cn('size-3.5', visible.has(field) ? 'opacity-100' : 'opacity-0')}
              aria-hidden="true"
            />
            {COLUMN_LABEL[field] ?? field}
          </DropdownMenuItem>
        ))}

        {customFields.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Custom fields</DropdownMenuLabel>
            {customFields.map((field) => {
              const ref = `custom:${field.id}`;
              return (
                <DropdownMenuItem
                  key={field.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    toggle(ref);
                  }}
                  className="gap-2"
                >
                  <Check
                    className={cn('size-3.5', visible.has(ref) ? 'opacity-100' : 'opacity-0')}
                    aria-hidden="true"
                  />
                  {field.name}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
