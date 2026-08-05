import type { CustomFieldType } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewColumn } from '@coretask/types';
import { Check, Library, Loader2, Plus, RotateCw } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { cn } from '@/lib/utils';

import { useAttachField, useFieldCatalog } from '../../hooks/use-project-views';

import { CreateCustomFieldDialog } from './create-custom-field-dialog';
import { FieldTypeIcon } from './field-type-icon';

/**
 * The `+` at the end of the header row, and everything behind it.
 *
 * One searchable list rather than a menu of menus: somebody who wants a Risk
 * column does not know or care whether Risk is a field type they must create, a
 * task property that already exists, or a field another project made last week.
 * Typing "risk" should surface all three and let them pick.
 *
 * Search runs on the server so it can reach the workspace library, which the
 * client has never loaded. Entries already in the view come back marked rather
 * than missing — "already added" and "no such field" look identical otherwise.
 */
export function FieldPickerPopover({
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
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState<{ name: string; type?: CustomFieldType } | null>(null);
  const [highlighted, setHighlighted] = useState('');

  // So focus can go back where it came from when the popover closes.
  const triggerRef = useRef<HTMLButtonElement>(null);

  useDebouncedValue(search, setDebounced);

  const visible = columns.map((column) => column.field);
  const catalog = useFieldCatalog(workspaceId, projectId, debounced, visible, open);
  const attachField = useAttachField(workspaceId, projectId);

  const close = () => {
    setOpen(false);
    setSearch('');
    setDebounced('');
  };

  const addColumn = (field: string) => {
    if (visible.includes(field)) return;
    onChange([...columns, { field }]);
    close();
  };

  const data = catalog.data;
  const term = search.trim();

  /*
   * Offered whenever the term is not already a field by that exact name.
   *
   * Not "when there are no results": searching "risk" can match a Risk *type*
   * description and still be a perfectly good name for a new field, and hiding
   * the option because something else matched would be the picker deciding it
   * knows better.
   */
  const exactMatch = [...(data?.projectFields ?? []), ...(data?.libraryFields ?? [])].some(
    (field) => field.name.toLowerCase() === term.toLowerCase(),
  );
  const offerCreate = term.length > 0 && !exactMatch;

  const nothingFound =
    data !== undefined &&
    data.fieldTypes.length === 0 &&
    data.systemFields.length === 0 &&
    data.projectFields.length === 0 &&
    data.libraryFields.length === 0;

  /*
   * Selection is controlled, because filtering is off.
   *
   * cmdk highlights the first item as part of its scoring pass, and turning
   * filtering off skips that pass — so nothing was selected, and Enter did
   * nothing until somebody moused over a row. Feeding it a value keeps the
   * arrow keys and Enter working.
   *
   * Derived rather than stored: the item set changes on every keystroke, and an
   * effect resetting the highlight to the top would be the cascading-render
   * trap again. Falling back to the first value when the highlighted one is no
   * longer on screen does the same job during render.
   */
  const itemValues = [
    ...(data?.fieldTypes ?? []).map((type) => `type:${type.type}`),
    ...(data?.projectFields ?? []).map((field) => `project:${field.id}`),
    ...(data?.systemFields ?? []).map((field) => `system:${field.key}`),
    ...(data?.libraryFields ?? []).map((field) => `library:${field.id}`),
    ...(offerCreate ? ['create-field'] : []),
  ];
  const activeValue = itemValues.includes(highlighted) ? highlighted : (itemValues[0] ?? '');

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setSearch('');
            setDebounced('');
            // Returned to the launcher, so tabbing carries on from where it was
            // rather than restarting at the top of the page.
            triggerRef.current?.focus();
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                aria-label="Add field"
                className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Add field</TooltipContent>
        </Tooltip>

        <PopoverContent align="end" className="w-[360px] p-0" collisionPadding={12}>
          {/*
            `shouldFilter={false}`: the catalog already decided what matches, and
            filtering the response again would drop rows it deliberately
            returned — an already-visible field, for one.
          */}
          <Command
            shouldFilter={false}
            value={activeValue}
            onValueChange={setHighlighted}
            className="max-h-[560px]"
          >
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search or create a field…"
              aria-label="Search or create a field"
            />

            <CommandList>
              {catalog.isLoading && (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading fields…
                </div>
              )}

              {catalog.isError && (
                <div className="space-y-2 px-3 py-6 text-center">
                  <p className="text-sm text-muted-foreground">Could not load the fields.</p>
                  <button
                    type="button"
                    onClick={() => void catalog.refetch()}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    <RotateCw className="size-3.5" aria-hidden="true" />
                    Try again
                  </button>
                </div>
              )}

              {nothingFound && !offerCreate && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No fields match “{term}”.
                </p>
              )}

              {data && data.fieldTypes.length > 0 && (
                <CommandGroup heading="Field types">
                  {data.fieldTypes.map((type) => (
                    <CommandItem
                      key={type.type}
                      value={`type:${type.type}`}
                      onSelect={() => setCreating({ name: term, type: type.type })}
                    >
                      <FieldTypeIcon type={type.type} />
                      <span className="flex-1 truncate">{type.label}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {type.description}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {data && (data.systemFields.length > 0 || data.projectFields.length > 0) && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Available fields">
                    {data.projectFields.map((field) => (
                      <CommandItem
                        key={field.id}
                        value={`project:${field.id}`}
                        onSelect={() => addColumn(`custom:${field.id}`)}
                      >
                        <FieldTypeIcon type={field.type} />
                        <span className="flex-1 truncate">{field.name}</span>
                        {field.usageCount > 1 && (
                          <span className="text-xs text-muted-foreground">
                            {field.usageCount} projects
                          </span>
                        )}
                      </CommandItem>
                    ))}

                    {data.systemFields.map((field) => (
                      <CommandItem
                        key={field.key}
                        value={`system:${field.key}`}
                        disabled={field.isInView}
                        onSelect={() => addColumn(field.key)}
                      >
                        <FieldTypeIcon type={field.dataType} />
                        <span className="flex-1 truncate">{field.label}</span>
                        {field.isInView ? (
                          // Ticked and unpickable, never hidden: a reader who
                          // searched for it deserves to see it is already here.
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Check className="size-3" aria-hidden="true" />
                            In this view
                          </span>
                        ) : (
                          <span className="truncate text-xs text-muted-foreground">
                            {field.description}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {data && data.libraryFields.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="From the workspace library">
                    {data.libraryFields.map((field) => (
                      <CommandItem
                        key={field.id}
                        value={`library:${field.id}`}
                        onSelect={() =>
                          attachField.mutate(field.id, {
                            // The column is added only once the field is really
                            // on the project; adding it first would leave a
                            // column pointing at nothing if the request failed.
                            onSuccess: () => addColumn(`custom:${field.id}`),
                          })
                        }
                      >
                        <Library className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="flex-1 truncate">{field.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {field.usageCount === 1 ? '1 project' : `${field.usageCount} projects`}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {offerCreate && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="create-field"
                      onSelect={() => setCreating({ name: term })}
                      className="text-foreground"
                    >
                      <Plus className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        Create custom field “<span className="font-medium">{term}</span>”
                      </span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>

            <div className="shrink-0 border-t border-border p-1">
              <button
                type="button"
                onClick={() => setCreating({ name: '' })}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                  'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                )}
              >
                <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                Create a new field
              </button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      {/*
        Mounted only while creating, and keyed by what it was opened with, so
        opening it again starts from the new prefill rather than from whatever
        the last attempt left behind.
      */}
      {creating && (
        <CreateCustomFieldDialog
          key={`${creating.name}:${creating.type ?? ''}`}
          initialName={creating.name}
          initialType={creating.type}
          workspaceId={workspaceId}
          projectId={projectId}
          existingNames={(metadata?.customFields ?? []).map((field) => field.name)}
          onOpenChange={(next) => {
            if (!next) setCreating(null);
          }}
          onCreated={(fieldId) => {
            setCreating(null);
            addColumn(`custom:${fieldId}`);
          }}
        />
      )}
    </>
  );
}
