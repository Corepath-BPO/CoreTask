import { CUSTOM_FIELD_TYPES, CustomFieldType, SELECT_FIELD_TYPES } from '@coretask/contracts';
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
import { Textarea } from '@/components/ui/textarea';

import { useCreateCustomField } from '../../hooks/use-project-views';

import { FieldTypeIcon } from './field-type-icon';

const TYPE_LABEL: Record<string, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  CHECKBOX: 'Checkbox',
  SINGLE_SELECT: 'Single-select',
  MULTI_SELECT: 'Multi-select',
  PEOPLE: 'People',
  URL: 'URL',
  EMAIL: 'Email',
};

/**
 * Creates a field, then hands its id back so the caller can add the column.
 *
 * A dialog rather than a form inside the picker: creating a field changes the
 * project for everybody, which deserves more room and more deliberation than
 * ticking a column on. The picker prefills the name from whatever was typed, so
 * "search, find nothing, create it" is one continuous motion.
 *
 * Option editing, per-type configuration and the duplicate-name warning arrive
 * with the type-aware builder; this keeps the flow working end to end until
 * then, and refuses anything it cannot honestly create.
 *
 * Mounted only while it is open, so its fields initialise from the props once
 * and never need an effect to re-seed them. An effect writing state on open is
 * the cascading-render trap this codebase has hit twice already.
 */
export function CreateCustomFieldDialog({
  initialName,
  initialType,
  workspaceId,
  projectId,
  existingNames,
  onOpenChange,
  onCreated,
}: {
  initialName: string;
  initialType?: CustomFieldType;
  workspaceId: string | undefined;
  projectId: string;
  existingNames: string[];
  onOpenChange: (open: boolean) => void;
  onCreated: (fieldId: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState('');
  const [type, setType] = useState<CustomFieldType>(initialType ?? CustomFieldType.TEXT);
  const [options, setOptions] = useState('');

  const createField = useCreateCustomField(workspaceId, projectId);

  const needsOptions = SELECT_FIELD_TYPES.includes(type);
  const parsedOptions = options
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);

  const trimmed = name.trim();
  const duplicate = existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase());

  // A select with no options is a column nobody can put a value in.
  const valid = trimmed.length > 0 && (!needsOptions || parsedOptions.length > 0);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
                name: trimmed,
                type,
                ...(description.trim() ? { description: description.trim() } : {}),
                ...(needsOptions ? { options: parsedOptions.map((label) => ({ label })) } : {}),
              },
              // The dialog stays open on failure, so nothing typed is lost.
              { onSuccess: (field) => onCreated(field.id) },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="field-name">Name</Label>
            <Input
              id="field-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Risk, Team, Estimate…"
            />
            {duplicate && (
              // A warning, not a rejection: two projects may legitimately want
              // their own field of the same name, and the API allows it.
              <p className="text-xs text-muted-foreground">
                This project already has a field called “{trimmed}”.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="field-type">Type</Label>
            <Select value={type} onValueChange={(value) => setType(value as CustomFieldType)}>
              <SelectTrigger id="field-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_FIELD_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    <span className="flex items-center gap-2">
                      <FieldTypeIcon type={value} />
                      {TYPE_LABEL[value] ?? value}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsOptions && (
            <div className="space-y-1.5">
              <Label htmlFor="field-options">Options</Label>
              <Input
                id="field-options"
                value={options}
                onChange={(event) => setOptions(event.target.value)}
                placeholder="Low, Medium, High, Critical"
              />
              <p className="text-xs text-muted-foreground">
                Separated by commas. Colours and ordering can be set afterwards.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="field-description">Description</Label>
            <Textarea
              id="field-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this field is for"
            />
          </div>
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
