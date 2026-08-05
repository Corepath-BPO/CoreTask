import { CUSTOM_FIELD_TYPES, CustomFieldType } from '@coretask/contracts';
import type { CatalogCustomField } from '@coretask/types';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

import { useCreateCustomField } from '../../hooks/use-project-views';

import { FieldConfigPanel } from './field-config-panel';
import { FieldTypeIcon } from './field-type-icon';
import { FIELD_TYPE_META, draftProblems, emptyDraft, retype } from './field-type-registry';

/**
 * Builds a field of any type, then hands its id back so the caller can add the
 * column.
 *
 * Type-aware throughout: choosing Single-select gets an option editor with
 * colours, Number gets a format and a range, Date gets a precision. The
 * alternative — one name box and a type dropdown — creates fields that are
 * technically the right type and useless in practice, because everything that
 * makes a select worth having lives in its options.
 *
 * Mounted only while open, so its state initialises from the props once and
 * never needs an effect to re-seed it.
 */
export function CreateCustomFieldDialog({
  initialName,
  initialType,
  workspaceId,
  projectId,
  libraryMatches,
  onOpenChange,
  onCreated,
  onUseExisting,
}: {
  initialName: string;
  initialType?: CustomFieldType;
  workspaceId: string | undefined;
  projectId: string;
  /** Workspace fields with this name, so a duplicate can be reused instead. */
  libraryMatches: CatalogCustomField[];
  onOpenChange: (open: boolean) => void;
  onCreated: (fieldId: string) => void;
  onUseExisting: (field: CatalogCustomField) => void;
}) {
  const [draft, setDraft] = useState(() =>
    emptyDraft(initialType ?? CustomFieldType.TEXT, initialName),
  );

  const createField = useCreateCustomField(workspaceId, projectId);

  const problems = draftProblems(draft);
  const valid = problems.length === 0;
  const meta = FIELD_TYPE_META[draft.type];

  /*
   * A field of this name already exists in the workspace.
   *
   * Offered as a choice rather than a rejection: two projects may legitimately
   * want their own "Status" with different options, and the API allows it. But
   * silently creating a second definition is how a library fills with
   * near-duplicates nobody meant to make.
   */
  const duplicate = libraryMatches.find(
    (field) => field.name.toLowerCase() === draft.name.trim().toLowerCase(),
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a field</DialogTitle>
          <DialogDescription>
            It joins the workspace library, so other projects can reuse it.
          </DialogDescription>
        </DialogHeader>

        <form
          id="create-field"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || createField.isPending) return;

            createField.mutate(
              {
                name: draft.name.trim(),
                type: draft.type,
                isRequired: draft.isRequired,
                settings: draft.settings,
                ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
                ...(meta.hasOptions
                  ? {
                      options: draft.options
                        .filter((option) => option.label.trim())
                        .map((option) => ({
                          label: option.label.trim(),
                          colorToken: option.colorToken,
                        })),
                    }
                  : {}),
              },
              // The dialog stays open on failure, so nothing typed is lost.
              { onSuccess: (field) => onCreated(field.id) },
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="field-name">Name</Label>
              <Input
                id="field-name"
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Risk, Team, Estimate…"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="field-type">Type</Label>
              <Select
                value={draft.type}
                onValueChange={(value) => setDraft(retype(draft, value as CustomFieldType))}
              >
                <SelectTrigger id="field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      <span className="flex items-center gap-2">
                        <FieldTypeIcon type={value} />
                        {FIELD_TYPE_META[value].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {duplicate && (
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
              <p className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  A field named “{duplicate.name}” already exists in this workspace, used by{' '}
                  {duplicate.usageCount === 1 ? '1 project' : `${duplicate.usageCount} projects`}.
                </span>
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => onUseExisting(duplicate)}>
                Use the existing field
              </Button>
            </div>
          )}

          <Separator />

          <FieldConfigPanel draft={draft} onChange={setDraft} />

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="field-description">Description</Label>
            <Textarea
              id="field-description"
              rows={2}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="What this field is for"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isRequired}
              onChange={(event) => setDraft({ ...draft, isRequired: event.target.checked })}
              className="size-4 cursor-pointer rounded border-input accent-primary"
            />
            Required on this project
          </label>

          {/* Listed rather than only disabling the button: "Create is greyed
              out" is not a reason somebody can act on. */}
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
          <Button type="submit" form="create-field" disabled={!valid} loading={createField.isPending}>
            Create field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
