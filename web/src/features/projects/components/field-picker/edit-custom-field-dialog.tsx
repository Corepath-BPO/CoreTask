import type { CustomField } from '@coretask/types';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

import { useEditCustomField, useFieldMetadata } from '../../hooks/use-project-views';

import { CustomFieldOptionEditor } from './custom-field-option-editor';
import { FieldConfigPanel } from './field-config-panel';
import { FieldTypeIcon } from './field-type-icon';
import { FIELD_TYPE_META, draftFromField, draftProblems } from './field-type-registry';

/**
 * Edits an existing field in place: rename it, change its settings, and for
 * select types rename, recolour, reorder, hide, add or remove its options.
 *
 * The type is shown but not editable — the API refuses a type change because it
 * would strand every value already stored — and everything else reuses the same
 * panel and option editor the create dialog uses, so the two forms feel like
 * one.
 *
 * Mounted only while open, so its state initialises from the field once and
 * never needs an effect to re-seed it.
 */
export function EditCustomFieldDialog({
  workspaceId,
  projectId,
  field,
  onOpenChange,
}: {
  workspaceId: string | undefined;
  projectId: string;
  field: CustomField;
  onOpenChange: (open: boolean) => void;
}) {
  const meta = FIELD_TYPE_META[field.type];
  const [draft, setDraft] = useState(() => draftFromField(field));

  const storedIds = useMemo(
    () => new Set(field.options.map((option) => option.id)),
    [field.options],
  );

  // The project's other fields, which a formula may name.
  const { data: metadata } = useFieldMetadata(workspaceId, projectId);
  const referenceFields = metadata?.customFields ?? [];

  const edit = useEditCustomField(workspaceId, projectId);

  const problems = draftProblems(draft, referenceFields, field.id);
  const valid = problems.length === 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit field</DialogTitle>
          <DialogDescription>
            Changes apply everywhere this field is used, in every project sharing it.
          </DialogDescription>
        </DialogHeader>

        <form
          id="edit-field"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || edit.isPending) return;

            edit.mutate(
              {
                field,
                name: draft.name.trim(),
                description: draft.description.trim(),
                isRequired: draft.isRequired,
                notifyOnChange: draft.notifyOnChange,
                settings: draft.settings,
                options: meta.hasOptions
                  ? draft.options
                      .filter((option) => option.label.trim())
                      .map((option) => ({
                        id: storedIds.has(option.key) ? option.key : null,
                        label: option.label.trim(),
                        colorToken: option.colorToken,
                        isArchived: option.isArchived ?? false,
                      }))
                  : null,
              },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-field-name">Name</Label>
              <Input
                id="edit-field-name"
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              {/* Read-only on purpose: a changed type would strand every value
                  already written into the old one, so the API refuses it. */}
              <p className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                <FieldTypeIcon type={field.type} />
                {meta.label}
              </p>
            </div>
          </div>

          <Separator />

          {meta.hasOptions ? (
            <div className="space-y-1.5">
              <Label>Options</Label>
              <CustomFieldOptionEditor
                options={draft.options}
                onChange={(options) => setDraft({ ...draft, options })}
                canHide
              />
            </div>
          ) : (
            <FieldConfigPanel
              draft={draft}
              onChange={setDraft}
              referenceFields={referenceFields}
              selfId={field.id}
            />
          )}

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="edit-field-description">Description</Label>
            <Textarea
              id="edit-field-description"
              rows={2}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="What this field is for"
            />
          </div>

          {!meta.isComputed && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isRequired}
                onChange={(event) => setDraft({ ...draft, isRequired: event.target.checked })}
                className="size-4 cursor-pointer rounded border-input accent-primary"
              />
              Required on this project
            </label>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.notifyOnChange}
              onChange={(event) => setDraft({ ...draft, notifyOnChange: event.target.checked })}
              className="size-4 cursor-pointer rounded border-input accent-primary"
            />
            Notify task collaborators when this field&apos;s value changes
          </label>

          {problems.length > 0 && draft.name.trim() !== '' && (
            <ul className="space-y-0.5 text-xs text-destructive">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </form>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="edit-field" disabled={!valid} loading={edit.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
