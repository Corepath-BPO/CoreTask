import {
  CREATABLE_WORK_ITEM_TYPES,
  WORK_ITEM_TYPE_LABEL,
  type CreatableWorkItemType,
  type WorkItemType,
} from '@coretask/contracts';
import type { CreateWorkItemPayload, ProjectFieldMetadata } from '@coretask/types';
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
import { Textarea } from '@/components/ui/textarea';

import { WorkItemTypeIcon } from './work-item-type-icon';

/** Radix `Select` treats `''` as "no value", so absence needs a real token. */
const NONE = '__none__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which type the dialog opens on — the project default, or a menu choice. */
  initialType: CreatableWorkItemType;
  /** Preselected when opened from a section rather than the toolbar. */
  initialSectionId?: string | undefined;
  metadata: ProjectFieldMetadata | undefined;
  pending?: boolean;
  onSubmit: (payload: CreateWorkItemPayload) => Promise<unknown>;
}

/**
 * The fuller create form, for when a title is not enough.
 *
 * Quick create covers most of it; this is the escape hatch for the item that
 * needs an assignee and a due date the moment it exists. Both write through the
 * same mutation and the same endpoint — the difference is how much is asked
 * for, not what happens afterwards.
 *
 * Status and priority come from the project's own metadata rather than a
 * hard-coded list, so a workspace that renamed its statuses sees its own words.
 * They are offered for tasks only: a ticket's status is a different vocabulary
 * with different consequences, and picking "Resolved" at creation would be an
 * odd thing to offer and an odder thing to mean.
 */
export function CreateWorkItemDialog({
  open,
  onOpenChange,
  initialType,
  initialSectionId,
  metadata,
  pending = false,
  onSubmit,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to this project</DialogTitle>
          <DialogDescription>
            A title is enough. Everything else can be filled in later.
          </DialogDescription>
        </DialogHeader>

        {/*
          Mounted only while open, and keyed by what it starts from.
          
          The fields used to be reset by an effect, which is a render that
          exists only to undo the one before it. A key means the state is simply
          initialised — reopening for a different type or section builds a fresh
          form rather than editing a stale one back into shape.
        */}
        {open && (
          <CreateWorkItemForm
            key={`${initialType}:${initialSectionId ?? ''}`}
            initialType={initialType}
            initialSectionId={initialSectionId}
            metadata={metadata}
            pending={pending}
            onSubmit={onSubmit}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateWorkItemForm({
  initialType,
  initialSectionId,
  metadata,
  pending,
  onSubmit,
  onClose,
}: Omit<Props, 'open' | 'onOpenChange'> & { pending: boolean; onClose: () => void }) {
  const [type, setType] = useState<WorkItemType>(initialType);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sectionId, setSectionId] = useState(initialSectionId ?? NONE);
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [priorityId, setPriorityId] = useState(NONE);
  const [dueDate, setDueDate] = useState('');

  const sections = metadata?.sections ?? [];
  const members = metadata?.members ?? [];
  const priorities = metadata?.priorities ?? [];

  const canSubmit = title.trim().length > 0 && !pending;

  const submit = async () => {
    if (!canSubmit) return;

    await onSubmit({
      type,
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(sectionId === NONE ? {} : { sectionId }),
      ...(assigneeId === NONE ? {} : { assigneeIds: [assigneeId] }),
      ...(priorityId === NONE ? {} : { priorityId }),
      // A date input gives `2026-05-20`; the API wants an instant.
      ...(dueDate ? { dueDate: new Date(`${dueDate}T00:00:00.000Z`).toISOString() } : {}),
    });

    onClose();
  };

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="work-item-type">
            <Select value={type} onValueChange={(value) => setType(value as WorkItemType)}>
              <SelectTrigger id="work-item-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREATABLE_WORK_ITEM_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    <span className="flex items-center gap-2">
                      <WorkItemTypeIcon type={option} />
                      {WORK_ITEM_TYPE_LABEL[option]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Section" htmlFor="work-item-section">
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger id="work-item-section" className="w-full">
                <SelectValue placeholder="First section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>First section</SelectItem>
                {sections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Title" htmlFor="work-item-title" required>
          <Input
            id="work-item-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              // Enter submits from the title, which is where somebody who only
              // wants a title already is.
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="What needs doing?"
            autoFocus
          />
        </Field>

        <Field label="Description" htmlFor="work-item-description">
          <Textarea
            id="work-item-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Assignee" htmlFor="work-item-assignee">
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger id="work-item-assignee" className="w-full">
                <SelectValue placeholder="Nobody" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Nobody</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Priority" htmlFor="work-item-priority">
            <Select value={priorityId} onValueChange={setPriorityId}>
              <SelectTrigger id="work-item-priority" className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {priorities.map((priority) => (
                  <SelectItem key={priority.id} value={priority.id}>
                    {priority.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Due date" htmlFor="work-item-due">
            <Input
              id="work-item-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
        </div>
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
          {pending ? 'Adding…' : `Add ${WORK_ITEM_TYPE_LABEL[type].toLowerCase()}`}
        </Button>
      </DialogFooter>
    </>
  );
}
