import { ProjectViewType, SYSTEM_FIELD_CATALOG, SystemField } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewSettings } from '@coretask/types';
import { ArrowDown, ArrowUp, Check, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { columnLabel } from '../../lib/column-labels';
import { moveColumnBy, toggleColumn } from '../../lib/column-layout';
import { queryableFields } from '../../lib/view-fields';

/**
 * Asana's Options menu.
 *
 * On the List: which fields are columns and in what order (the old Fields
 * button, folded in here where Asana keeps it), the row density, and whether
 * completed rows show. On the Board: which fields a card carries as chips,
 * and the same completed toggle.
 */
export function OptionsPopover({
  viewType,
  settings,
  metadata,
  onChange,
}: {
  viewType: ProjectViewType;
  settings: ViewSettings;
  metadata: ProjectFieldMetadata | undefined;
  onChange: (patch: Partial<ViewSettings>) => void;
}) {
  const isList = viewType === ProjectViewType.LIST;
  const active = settings.showCompleted === false || (isList && settings.density === 'COMPACT');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={active ? 'secondary' : 'ghost'} size="sm" aria-label="Options">
          <Settings2 />
          Options
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-72 space-y-4 overflow-y-auto">
        {isList ? (
          <ColumnsSection settings={settings} metadata={metadata} onChange={onChange} />
        ) : (
          <CardFieldsSection settings={settings} metadata={metadata} onChange={onChange} />
        )}

        {isList && (
          <section className="space-y-1.5" aria-label="Row density">
            <p className="text-xs font-medium text-muted-foreground">Row density</p>
            <div
              role="radiogroup"
              aria-label="Row density"
              className="flex rounded-md border p-0.5"
            >
              {(['COMFORTABLE', 'COMPACT'] as const).map((density) => (
                <button
                  key={density}
                  type="button"
                  role="radio"
                  aria-checked={settings.density === density}
                  onClick={() => onChange({ density })}
                  className={cn(
                    'flex-1 cursor-pointer rounded px-2 py-1 text-xs capitalize',
                    settings.density === density ? 'bg-muted font-medium' : 'text-muted-foreground',
                  )}
                >
                  {density.toLowerCase()}
                </button>
              ))}
            </div>
          </section>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.showCompleted}
            onChange={(event) => onChange({ showCompleted: event.target.checked })}
            className="size-4 cursor-pointer rounded border-input accent-primary"
          />
          Show completed tasks
        </label>
      </PopoverContent>
    </Popover>
  );
}

/** The List's columns: the old Fields menu, now under Options. */
function ColumnsSection({
  settings,
  metadata,
  onChange,
}: {
  settings: ViewSettings;
  metadata: ProjectFieldMetadata | undefined;
  onChange: (patch: Partial<ViewSettings>) => void;
}) {
  const columns = settings.columns;
  const visible = new Set(columns.map((column) => column.field));
  const offered = [
    ...SYSTEM_FIELD_CATALOG.filter((field) => field.isColumn).map((field) => field.key as string),
    ...(metadata?.customFields ?? [])
      .filter((field) => !field.isArchived)
      .map((field) => `custom:${field.id}`),
  ];

  return (
    <section className="space-y-1.5" aria-label="Fields">
      <p className="text-xs font-medium text-muted-foreground">Fields</p>
      <ul className="space-y-0.5">
        {columns.map((column, index) => (
          <li key={column.field} className="flex items-center gap-1 text-sm">
            <span className="flex-1 truncate">{columnLabel(column.field, metadata)}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Move ${columnLabel(column.field, metadata)} up`}
              disabled={index === 0}
              onClick={() => onChange({ columns: moveColumnBy(columns, column.field, -1) })}
            >
              <ArrowUp className="size-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={`Move ${columnLabel(column.field, metadata)} down`}
              disabled={index === columns.length - 1}
              onClick={() => onChange({ columns: moveColumnBy(columns, column.field, 1) })}
            >
              <ArrowDown className="size-3" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <ul className="space-y-0.5 border-t pt-1.5">
        {offered.map((field) => (
          <li key={field}>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={visible.has(field)}
              disabled={field === SystemField.TITLE}
              onClick={() => onChange({ columns: toggleColumn(columns, field) })}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-muted disabled:cursor-default disabled:opacity-60"
            >
              <Check
                className={cn('size-3.5', visible.has(field) ? 'opacity-100' : 'opacity-0')}
                aria-hidden="true"
              />
              {columnLabel(field, metadata) || field}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Which fields a board card carries as compact chips. */
function CardFieldsSection({
  settings,
  metadata,
  onChange,
}: {
  settings: ViewSettings;
  metadata: ProjectFieldMetadata | undefined;
  onChange: (patch: Partial<ViewSettings>) => void;
}) {
  const chosen = new Set(settings.cardFields ?? []);
  const offered = [
    { ref: SystemField.STATUS, label: 'Status' },
    { ref: SystemField.START_DATE, label: 'Start date' },
    { ref: SystemField.ESTIMATE, label: 'Estimate' },
    { ref: SystemField.CREATED_AT, label: 'Created' },
    ...queryableFields(metadata)
      .filter((field) => field.origin === 'custom')
      .map((field) => ({ ref: field.ref, label: field.label })),
  ];

  const toggle = (ref: string) => {
    const next = new Set(chosen);
    if (next.has(ref)) next.delete(ref);
    else next.add(ref);
    onChange({ cardFields: [...next] });
  };

  return (
    <section className="space-y-1.5" aria-label="Card fields">
      <p className="text-xs font-medium text-muted-foreground">Card fields</p>
      <ul className="space-y-0.5">
        {offered.map((field) => (
          <li key={field.ref}>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={chosen.has(field.ref)}
              onClick={() => toggle(field.ref)}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-muted"
            >
              <Check
                className={cn('size-3.5', chosen.has(field.ref) ? 'opacity-100' : 'opacity-0')}
                aria-hidden="true"
              />
              {field.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
