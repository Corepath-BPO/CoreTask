import type { CreateSectionPayload, ProjectFieldMetadata } from '@coretask/types';
import { useState } from 'react';

import { Field } from '@/components/forms/field';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Radix `Select` treats `''` as "no value", so absence needs a real token. */
const NONE = '__none__';

/** Appending is the common case, so it gets a token rather than a sentinel id. */
const APPEND = '__append__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metadata: ProjectFieldMetadata | undefined;
  pending?: boolean;
  onSubmit: (payload: CreateSectionPayload) => Promise<unknown>;
}

/**
 * Adding a section, from either view.
 *
 * Reached from the same split-button menu in the List and the Board, so a
 * section means the same thing and lands in the same place wherever it was
 * asked for. The Board used to grow one through an inline field of its own and
 * the List could not create one at all.
 *
 * There is deliberately no colour field. `Section` has no colour column, and a
 * picker that stores nothing is worse than no picker — it looks like a setting
 * and behaves like a decoration that vanishes on reload.
 */
export function CreateSectionDialog({ open, onOpenChange, metadata, pending, onSubmit }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a section</DialogTitle>
          <DialogDescription>
            A column on the Board and a group in the List, with the same section shown twice.
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, so its fields are initialised rather than
            reset by an effect that exists to undo the render before it. */}
        {open && (
          <SectionForm
            metadata={metadata}
            pending={pending ?? false}
            onSubmit={onSubmit}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SectionForm({
  metadata,
  pending,
  onSubmit,
  onClose,
}: Omit<Props, 'open' | 'onOpenChange'> & { pending: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [defaultStatusId, setDefaultStatusId] = useState(NONE);
  const [afterSectionId, setAfterSectionId] = useState(APPEND);

  const sections = metadata?.sections ?? [];
  const statuses = metadata?.statuses ?? [];

  const canSubmit = name.trim().length > 0 && !pending;

  const submit = async () => {
    if (!canSubmit) return;

    await onSubmit({
      name: name.trim(),
      ...(defaultStatusId === NONE ? {} : { defaultStatusId }),
      // Omitted appends; `null` would place it first, which is a different
      // request and not one this form offers.
      ...(afterSectionId === APPEND ? {} : { afterSectionId }),
    });

    onClose();
  };

  return (
    <>
      <div className="grid gap-4">
        <Field label="Name" htmlFor="section-name" required>
          <Input
            id="section-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Ready for QA"
            autoFocus
          />
        </Field>

        <Field
          label="Default status"
          htmlFor="section-default-status"
          hint="Applied to a task moved into this section. Tickets keep their own status."
        >
          <Select value={defaultStatusId} onValueChange={setDefaultStatusId}>
            <SelectTrigger id="section-default-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/*
                "Leave unchanged" first and by default. A section is a workflow
                column and a status is task state; coupling them silently is how
                dragging a card becomes an unexplained status change.
              */}
              <SelectItem value={NONE}>Leave the status unchanged</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Position" htmlFor="section-position">
          <Select value={afterSectionId} onValueChange={setAfterSectionId}>
            <SelectTrigger id="section-position" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={APPEND}>At the end</SelectItem>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  After “{section.name}”
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} className="cursor-pointer">
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="cursor-pointer"
        >
          {pending ? 'Adding…' : 'Add section'}
        </Button>
      </DialogFooter>
    </>
  );
}
