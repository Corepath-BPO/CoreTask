import type { CatalogCustomField, ViewColumn } from '@coretask/types';
import { Check, Library, Loader2, Plus, RotateCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';

import { useAttachField, useFieldCatalog } from '../../hooks/use-project-views';

import { FIELD_TYPE_META } from './field-type-registry';
import { FieldTypeIcon } from './field-type-icon';

/** Where a field stands relative to this project and this view. */
type FieldState = 'IN_VIEW' | 'IN_PROJECT' | 'AVAILABLE' | 'ARCHIVED';

function stateOf(field: CatalogCustomField, visible: Set<string>): FieldState {
  if (field.isArchived) return 'ARCHIVED';
  if (visible.has(`custom:${field.id}`)) return 'IN_VIEW';
  return field.isInProject ? 'IN_PROJECT' : 'AVAILABLE';
}

/**
 * Every reusable field in the workspace, and what to do with each.
 *
 * The picker already offers library fields inline, which is right for "I know
 * what I want". This is for the other case: seeing what the workspace has
 * already agreed on before inventing a fifth field that means the same thing as
 * four existing ones.
 *
 * Every row says where it stands — already a column here, on the project but
 * hidden, available, archived — because the same field means a different action
 * in each of those states, and an action whose effect you cannot predict is
 * worse than no action.
 */
export function FieldLibraryDialog({
  columns,
  workspaceId,
  projectId,
  onOpenChange,
  onAddColumn,
  onCreateNew,
}: {
  columns: ViewColumn[];
  workspaceId: string | undefined;
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onAddColumn: (field: string) => void;
  onCreateNew: () => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useDebouncedValue(search, setDebounced);

  const visible = useMemo(() => new Set(columns.map((column) => column.field)), [columns]);

  // Archived fields included: this is the one place they should be visible, so
  // somebody can see why a name is "taken" by something no longer in use.
  const catalog = useFieldCatalog(workspaceId, projectId, debounced, [], true, true);
  const attachField = useAttachField(workspaceId, projectId);

  const fields = useMemo(() => {
    const all = [...(catalog.data?.projectFields ?? []), ...(catalog.data?.libraryFields ?? [])];

    // Deduplicated by id: a field can only be in one group, but the two arrays
    // are built separately and a future change could overlap them.
    return [...new Map(all.map((field) => [field.id, field])).values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [catalog.data]);

  const groups: { title: string; hint: string; fields: CatalogCustomField[] }[] = [
    {
      title: 'Used by this project',
      hint: 'Already available on every task here',
      fields: fields.filter((field) => !field.isArchived && field.isInProject),
    },
    {
      title: 'Elsewhere in the workspace',
      hint: 'Add one to reuse its options and reporting',
      fields: fields.filter((field) => !field.isArchived && !field.isInProject),
    },
    {
      title: 'Archived',
      hint: 'Kept so the values recorded against them stay readable',
      fields: fields.filter((field) => field.isArchived),
    },
  ].filter((group) => group.fields.length > 0);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-1.5 border-b border-border p-4">
          <DialogTitle className="flex items-center gap-2">
            <Library className="size-4" aria-hidden="true" />
            Field library
          </DialogTitle>
          <DialogDescription>
            Fields any project in this workspace can use. Reusing one keeps its options and lets you
            report across every project that has it.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the library…"
              aria-label="Search the library"
              className="pl-9"
            />
          </div>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-3">
          {catalog.isLoading && (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading the library…
            </p>
          )}

          {catalog.isError && (
            <div className="space-y-2 py-10 text-center">
              <p className="text-sm text-muted-foreground">Could not load the library.</p>
              <Button variant="outline" size="sm" onClick={() => void catalog.refetch()}>
                <RotateCw className="size-3.5" aria-hidden="true" />
                Try again
              </Button>
            </div>
          )}

          {catalog.data && groups.length === 0 && (
            <div className="space-y-3 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                {debounced
                  ? `Nothing in the library matches “${debounced}”.`
                  : 'The workspace has no reusable fields yet.'}
              </p>
              <Button variant="outline" size="sm" onClick={onCreateNew}>
                <Plus className="size-3.5" aria-hidden="true" />
                Create the first one
              </Button>
            </div>
          )}

          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3 className="px-1 text-xs font-medium text-muted-foreground">{group.title}</h3>
                <p className="px-1 pb-1.5 text-xs text-muted-foreground/80">{group.hint}</p>

                <ul className="space-y-1">
                  {group.fields.map((field) => (
                    <LibraryRow
                      key={field.id}
                      field={field}
                      state={stateOf(field, visible)}
                      pending={attachField.isPending}
                      onAddColumn={() => onAddColumn(`custom:${field.id}`)}
                      onAttach={() =>
                        attachField.mutate(field.id, {
                          // The column waits for the attach, or it points at a
                          // field this project does not have.
                          onSuccess: () => onAddColumn(`custom:${field.id}`),
                        })
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border p-3">
          <Button variant="outline" size="sm" onClick={onCreateNew}>
            <Plus className="size-3.5" aria-hidden="true" />
            Create new field
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LibraryRow({
  field,
  state,
  pending,
  onAddColumn,
  onAttach,
}: {
  field: CatalogCustomField;
  state: FieldState;
  pending: boolean;
  onAddColumn: () => void;
  onAttach: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-border p-2.5">
      <FieldTypeIcon type={field.type} />

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {field.name}
          <span className="text-xs font-normal text-muted-foreground">
            {FIELD_TYPE_META[field.type]?.label ?? field.type}
          </span>
        </p>

        {field.description && (
          <p className="truncate text-xs text-muted-foreground">{field.description}</p>
        )}

        {/* A preview of the options, because "Risk" tells you far less than
            Low / Medium / High does about whether it is the field you mean. */}
        {field.optionPreview.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {field.optionPreview.map((option) => (
              <SemanticBadge
                key={option.id}
                color={{ colorToken: option.colorToken, customColor: null }}
              >
                {option.label}
              </SemanticBadge>
            ))}
          </span>
        )}
      </div>

      <Badge variant="muted" className="shrink-0">
        {field.usageCount === 1 ? '1 project' : `${field.usageCount} projects`}
      </Badge>

      <div className="w-36 shrink-0 text-right">
        {state === 'IN_VIEW' && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" aria-hidden="true" />
            In this view
          </span>
        )}

        {state === 'IN_PROJECT' && (
          <Button variant="outline" size="sm" onClick={onAddColumn}>
            Add to view
          </Button>
        )}

        {state === 'AVAILABLE' && (
          <Button variant="outline" size="sm" loading={pending} onClick={onAttach}>
            Add to project
          </Button>
        )}

        {state === 'ARCHIVED' && (
          // No action: restoring is a field-management decision, not something
          // to do by accident while choosing a column.
          <span className="text-xs text-muted-foreground">Archived</span>
        )}
      </div>
    </li>
  );
}
