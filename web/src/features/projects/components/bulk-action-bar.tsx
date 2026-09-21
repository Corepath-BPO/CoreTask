import { TASK_PRIORITIES, TASK_STATUSES, isComputedFieldType } from '@coretask/contracts';
import type { CustomField, ProjectFieldMetadata } from '@coretask/types';
import { Archive, Calendar, ChevronLeft, SlidersHorizontal, UserRound, X } from 'lucide-react';
import { useImperativeHandle, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { TaskPriorityBadge, TaskStatusBadge } from '@/components/data-display/status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TaskDatePopover } from '@/features/tasks/components/task-date-popover';
import { cn, type Schedule } from '@/lib/utils';

import { CustomFieldCell } from './cells/custom-field-cell';
import { FieldTypeIcon } from './field-picker/field-type-icon';

const UNASSIGNED = '__none__';

/** Nothing scheduled: the picker starts blank, whatever the rows hold. */
const EMPTY_SCHEDULE: Schedule = { startDate: null, startAt: null, dueDate: null, dueAt: null };

const PILL_TRIGGER =
  'h-8 gap-1.5 rounded-full border-0 bg-transparent px-2.5 text-sm shadow-none hover:bg-muted';

/** What the keyboard shortcuts reach for — the same pickers the buttons open. */
export interface BulkActionBarHandle {
  openAssignee(): void;
  openDueDate(): void;
  /** Opens the confirmation — a chord must not archive without one. */
  openArchive(): void;
  openFields(): void;
}

interface BulkActionBarProps {
  count: number;
  members: { id: string; name: string; avatarUrl?: string | null }[];
  sections: { id: string; name: string }[];
  /** A ticket in the selection: no task status, no task priority, no archive. */
  hasTicket: boolean;
  /** How many of the selection are tasks — the rows a field value can land on. */
  taskCount: number;
  /** The project's custom fields; computed and archived ones are left out. */
  fields: CustomField[];
  metadata: ProjectFieldMetadata | undefined;
  canArchive: boolean;
  pending: boolean;
  onAssign: (assigneeId: string | null) => void;
  onSchedule: (changes: Partial<Schedule>) => void;
  onStatus: (status: string) => void;
  onPriority: (priority: string) => void;
  onMove: (sectionId: string) => void;
  onFieldValue: (field: CustomField, payload: Record<string, unknown>) => void;
  onArchive: () => void;
  onClear: () => void;
  ref?: Ref<BulkActionBarHandle>;
}

/**
 * Asana's selection bar: a pill at the foot of the window that appears once
 * rows are selected and offers the changes a selection can share.
 *
 * Portalled to the body rather than drawn in the list: the list is a scrolling
 * pane, and a bar inside it would scroll away from the rows it acts on. Each
 * control is a picker that fires once and resets, so the bar never shows a
 * value — a selection of five rows has no single assignee to show.
 */
export function BulkActionBar({
  count,
  members,
  sections,
  hasTicket,
  taskCount,
  fields,
  metadata,
  canArchive,
  pending,
  onAssign,
  onSchedule,
  onStatus,
  onPriority,
  onMove,
  onFieldValue,
  onArchive,
  onClear,
  ref,
}: BulkActionBarProps) {
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [chosenField, setChosenField] = useState<CustomField | null>(null);

  useImperativeHandle(ref, () => ({
    openAssignee: () => setAssigneeOpen(true),
    openDueDate: () => setDateOpen(true),
    openArchive: () => setConfirmingArchive(true),
    openFields: () => setFieldsOpen(true),
  }));

  const noun = hasTicket ? 'items' : count === 1 ? 'task' : 'tasks';

  // A formula is worked out, never set; an archived field is not on the
  // project any more. Neither is something a selection can be given.
  const settableFields = fields.filter(
    (field) => !field.isArchived && !isComputedFieldType(field.type),
  );
  const fieldsReason =
    taskCount === 0
      ? 'Fields belong to tasks; the selection holds only tickets'
      : settableFields.length === 0
        ? 'This project has no custom fields yet'
        : undefined;

  const closeFields = () => {
    setFieldsOpen(false);
    setChosenField(null);
  };

  return createPortal(
    <>
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className={cn(
          'fixed bottom-6 left-1/2 z-[35] flex -translate-x-1/2 items-center gap-1 rounded-full border bg-popover px-3 py-1.5 text-popover-foreground shadow-lg',
          pending && 'pointer-events-none opacity-70',
        )}
      >
        <span className="mr-1 whitespace-nowrap text-sm font-medium tabular-nums">
          {count} selected
        </span>

        {/* Controlled and always empty: a pick fires the change and the
            trigger goes back to its label, ready for the next selection. */}
        <Select
          value=""
          open={assigneeOpen}
          onOpenChange={setAssigneeOpen}
          onValueChange={(value) => onAssign(value === UNASSIGNED ? null : value)}
        >
          <SelectTrigger aria-label="Assignee" className={PILL_TRIGGER}>
            <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>
              <span className="text-muted-foreground">Unassigned</span>
            </SelectItem>
            {members.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                <span className="flex items-center gap-2">
                  <PersonAvatar
                    name={member.name}
                    avatarUrl={member.avatarUrl ?? null}
                    className="size-5"
                    fallbackClassName="text-[9px]"
                  />
                  {member.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <TaskDatePopover
          schedule={EMPTY_SCHEDULE}
          onSave={(changes) => {
            setDateOpen(false);
            onSchedule(changes);
          }}
          open={dateOpen}
          onOpenChange={setDateOpen}
          dateOnly={hasTicket}
          side="top"
        >
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            aria-label="Due date"
            onClick={() => setDateOpen(true)}
          >
            <Calendar className="text-muted-foreground" />
            Due date
          </Button>
        </TaskDatePopover>

        {/* A ticket speaks a different status list; offering a task's would
            offer choices the API refuses. The control stays, greyed, with
            the reason on hover. */}
        <span title={hasTicket ? 'Tickets use a different status list' : undefined}>
          <Select value="" onValueChange={onStatus} disabled={hasTicket}>
            <SelectTrigger aria-label="Status" className={PILL_TRIGGER}>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  <TaskStatusBadge status={status} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>

        <span title={hasTicket ? 'Tickets use a different priority list' : undefined}>
          <Select value="" onValueChange={onPriority} disabled={hasTicket}>
            <SelectTrigger aria-label="Priority" className={PILL_TRIGGER}>
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  <TaskPriorityBadge priority={priority} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>

        <Select value="" onValueChange={onMove}>
          <SelectTrigger aria-label="Move to section" className={PILL_TRIGGER}>
            <SelectValue placeholder="Move to" />
          </SelectTrigger>
          <SelectContent>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Two steps: pick the field, then its value in the same editor the
            grid uses — so a bulk "Severity → High" is the cell edit, done
            once for the whole selection. */}
        <Popover
          open={fieldsOpen}
          onOpenChange={(open) => (open ? setFieldsOpen(true) : closeFields())}
        >
          <span title={fieldsReason}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                aria-label="Fields"
                disabled={fieldsReason !== undefined}
              >
                <SlidersHorizontal className="text-muted-foreground" />
                Fields
              </Button>
            </PopoverTrigger>
          </span>
          <PopoverContent side="top" align="start" className="w-72 p-0">
            {chosenField === null ? (
              <Command>
                <CommandInput placeholder="Which field?" />
                <CommandList>
                  <CommandEmpty>No field by that name.</CommandEmpty>
                  <CommandGroup>
                    {settableFields.map((field) => (
                      <CommandItem
                        key={field.id}
                        value={field.name}
                        onSelect={() => setChosenField(field)}
                      >
                        <FieldTypeIcon type={field.type} />
                        <span className="truncate">{field.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            ) : (
              <div className="space-y-2 p-2">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Choose another field"
                    onClick={() => setChosenField(null)}
                  >
                    <ChevronLeft />
                  </Button>
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <FieldTypeIcon type={chosenField.type} />
                    {chosenField.name}
                  </span>
                </div>
                <p className="px-1 text-xs text-muted-foreground">
                  Set for {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
                  {hasTicket ? '; tickets are skipped' : ''}.
                </p>
                <div className="rounded-md border px-2 py-1.5">
                  <CustomFieldCell
                    field={chosenField}
                    value={undefined}
                    metadata={metadata}
                    canEdit
                    taskTitle={`${taskCount} selected`}
                    autoOpen
                    onSave={(payload) => {
                      onFieldValue(chosenField, payload);
                      closeFields();
                    }}
                  />
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {canArchive && (
          <span title={hasTicket ? 'Tickets cannot be archived from here' : undefined}>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-destructive hover:text-destructive"
              disabled={hasTicket}
              onClick={() => setConfirmingArchive(true)}
            >
              <Archive />
              Archive
            </Button>
          </span>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-1 rounded-full"
          aria-label="Clear selection"
          onClick={onClear}
        >
          <X />
        </Button>
      </div>

      <AlertDialog open={confirmingArchive} onOpenChange={setConfirmingArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive {count} {noun}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They leave every list and board, subtasks included. A manager can restore them from
              the task later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'destructive' }))}
              onClick={() => {
                setConfirmingArchive(false);
                onArchive();
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>,
    document.body,
  );
}
