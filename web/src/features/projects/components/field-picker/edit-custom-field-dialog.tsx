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

import { useEditCustomField } from '../../hooks/use-project-views';

import { CustomFieldOptionEditor } from './custom-field-option-editor';
import { FieldTypeIcon } from './field-type-icon';
import { FIELD_TYPE_META, isColorToken, type DraftOption } from './field-type-registry';

/**
 * Edits an existing field in place: rename it, and for select types rename,
 * recolour, reorder, add or remove its options.
 *
 * The type is shown but not editable — the API refuses a type change because it
 * would strand every value already stored — and everything else reuses the same
 * option editor the create dialog uses, so the two forms feel like one.
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

  const [name, setName] = useState(field.name);
  const [description, setDescription] = useState(field.description ?? '');
  const [isRequired, setIsRequired] = useState(field.isRequired);
  const [options, setOptions] = useState<DraftOption[]>(() =>
    [...field.options]
      .filter((option) => !option.isArchived)
      .sort((a, b) => a.position - b.position)
      // The stored id doubles as the row key, which is how the save can tell
      // an edited option from one added here (whose key `newOption` invents).
      .map((option) => ({
        key: option.id,
        label: option.label,
        colorToken: isColorToken(option.colorToken) ? option.colorToken : 'gray',
      })),
  );

  const storedIds = useMemo(
    () => new Set(field.options.map((option) => option.id)),
    [field.options],
  );

  const edit = useEditCustomField(workspaceId, projectId);

  const problems: string[] = [];
  if (!name.trim()) problems.push('Give the field a name.');
  if (name.trim().length > 80) problems.push('The name is too long.');
  if (meta.hasOptions) {
    const labels = options.map((option) => option.label.trim()).filter(Boolean);
    if (labels.length === 0) problems.push('Keep at least one option.');
    const duplicate = labels.find(
      (label, index) =>
        labels.findIndex((other) => other.toLowerCase() === label.toLowerCase()) !== index,
    );
    if (duplicate) problems.push(`Two options are both called “${duplicate}”.`);
  }
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
                name: name.trim(),
                description: description.trim(),
                isRequired,
                options: meta.hasOptions
                  ? options
                      .filter((option) => option.label.trim())
                      .map((option) => ({
                        id: storedIds.has(option.key) ? option.key : null,
                        label: option.label.trim(),
                        colorToken: option.colorToken,
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
                value={name}
                onChange={(event) => setName(event.target.value)}
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

          {meta.hasOptions && (
            <>
              <Separator />
              <CustomFieldOptionEditor options={options} onChange={setOptions} />
            </>
          )}

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="edit-field-description">Description</Label>
            <Textarea
              id="edit-field-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this field is for"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(event) => setIsRequired(event.target.checked)}
              className="size-4 cursor-pointer rounded border-input accent-primary"
            />
            Required on this project
          </label>

          {problems.length > 0 && name.trim() !== '' && (
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
