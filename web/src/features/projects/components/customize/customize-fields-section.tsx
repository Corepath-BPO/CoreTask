import { ProjectViewType } from '@coretask/contracts';
import type { CustomField, ProjectFieldMetadata } from '@coretask/types';
import { Library, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import {
  useAttachField,
  useProjectViews,
  useSaveViewSettings,
} from '../../hooks/use-project-views';
import { CreateCustomFieldDialog } from '../field-picker/create-custom-field-dialog';
import { EditCustomFieldDialog } from '../field-picker/edit-custom-field-dialog';
import { FieldLibraryDialog } from '../field-picker/field-library-dialog';
import { FieldTypeIcon } from '../field-picker/field-type-icon';
import { FIELD_TYPE_META } from '../field-picker/field-type-registry';

/**
 * The project's custom fields, managed from the Customize panel.
 *
 * The same dialogs the List's `+` picker opens, launched from here instead —
 * one definition of "edit a field" no matter which door somebody came through.
 * A field added here also lands as a List column, exactly as the picker would
 * add it, so the panel never grows a second, silent kind of "on the project".
 */
export function CustomizeFieldsSection({
  workspaceId,
  projectId,
  metadata,
  isLoading,
  canEdit,
}: {
  workspaceId: string | undefined;
  projectId: string;
  metadata: ProjectFieldMetadata | undefined;
  isLoading: boolean;
  canEdit: boolean;
}) {
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [creating, setCreating] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  /*
   * The List view's columns, because "add a field" has always meant "and show
   * it in the List" — the picker's contract, kept. Saved straight to the view;
   * this section renders no columns itself, so it needs no optimistic copy.
   */
  const { data: views } = useProjectViews(workspaceId, projectId);
  const listView = views?.find((view) => view.type === ProjectViewType.LIST);
  const saveSettings = useSaveViewSettings(workspaceId, projectId);
  const attachField = useAttachField(workspaceId, projectId);

  const columns = listView?.settings.columns ?? [];
  const addColumn = (field: string) => {
    if (!listView || columns.some((column) => column.field === field)) return;
    saveSettings(listView.id, { ...listView.settings, columns: [...columns, { field }] });
  };

  const fields = (metadata?.customFields ?? []).filter((field) => !field.isArchived);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Fields this project asks about on every task. Editing one here changes it everywhere it
        appears.
      </p>

      {isLoading &&
        Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}

      {!isLoading && fields.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No custom fields yet.
        </p>
      )}

      {fields.map((field) => (
        <button
          key={field.id}
          type="button"
          disabled={!canEdit}
          title={canEdit ? undefined : 'Editing fields needs project membership'}
          onClick={() => setEditingField(field)}
          className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <FieldTypeIcon type={field.type} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{field.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {FIELD_TYPE_META[field.type].label}
            </span>
          </span>
          {canEdit && (
            <Pencil
              className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            />
          )}
        </button>
      ))}

      {canEdit && (
        <div className="space-y-2 pt-1">
          <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)}>
            <Plus />
            Create a field
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setLibraryOpen(true)}
          >
            <Library />
            Choose from field library
          </Button>
        </div>
      )}

      {/* Keyed by mounting, as everywhere else: form state initialises from
          what opened it and from nothing older. */}
      {editingField && (
        <EditCustomFieldDialog
          workspaceId={workspaceId}
          projectId={projectId}
          field={editingField}
          onOpenChange={(open) => !open && setEditingField(null)}
        />
      )}

      {creating && (
        <CreateCustomFieldDialog
          initialName=""
          workspaceId={workspaceId}
          projectId={projectId}
          // No catalog search ran here, so no duplicate candidates to offer.
          libraryMatches={[]}
          onOpenChange={(open) => !open && setCreating(false)}
          onCreated={(fieldId) => {
            setCreating(false);
            addColumn(`custom:${fieldId}`);
          }}
          onUseExisting={(field) => {
            setCreating(false);
            if (field.isInProject) {
              addColumn(`custom:${field.id}`);
              return;
            }
            attachField.mutate(field.id, {
              onSuccess: () => addColumn(`custom:${field.id}`),
            });
          }}
        />
      )}

      {libraryOpen && (
        <FieldLibraryDialog
          columns={columns}
          workspaceId={workspaceId}
          projectId={projectId}
          onOpenChange={(open) => !open && setLibraryOpen(false)}
          onAddColumn={(field) => {
            addColumn(field);
            setLibraryOpen(false);
          }}
          onCreateNew={() => {
            setLibraryOpen(false);
            setCreating(true);
          }}
        />
      )}
    </div>
  );
}
