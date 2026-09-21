import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TaskStatus,
} from '@coretask/contracts';
import type { ProjectFieldMetadata, Task } from '@coretask/types';
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  MessageSquare,
  Paperclip,
  Pencil,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TicketPriorityBadge,
  TicketStatusBadge,
} from '@/components/data-display/status-badge';
import { isTicketRow } from '@/features/work-items/lib/work-item-row';
import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TaskDatePopover } from '@/features/tasks/components/task-date-popover';
import { cn, daysUntil, formatDate, formatDue, formatTime, isOverdue } from '@/lib/utils';

import { CellButton, EmptyCell } from './editable-cell';
import { useCellEditor } from './use-cell-editor';

/** What every system cell needs to render and save itself. */
export interface CellProps {
  task: Task;
  metadata: ProjectFieldMetadata | undefined;
  canEdit: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onOpenTask: () => void;
}

/**
 * The task name: editable in place, and the way into the full task.
 *
 * Two affordances in one cell, split deliberately — the title text opens the
 * task, a separate pencil edits it. Making the whole cell an editor would take
 * away the only route to the detail view; making it only a link would mean
 * renaming required opening the task, which is what this view exists to avoid.
 */
export function TitleCell({
  task,
  canEdit,
  onSave,
  onOpenTask,
  depth = 0,
  expanded,
  onToggleExpand,
  dragHandle,
  selected,
  onToggleSelect,
}: CellProps & {
  /** 0 for a top-level task, 1 for a subtask. Nesting goes no deeper. */
  depth?: number;
  expanded?: boolean;
  /** Absent when the task has no subtasks — there is nothing to expand. */
  onToggleExpand?: () => void;
  /** The grip that starts a row drag; absent for subtasks and read-only views. */
  dragHandle?: React.ReactNode;
  /** Part of the List's multi-select; absent where rows cannot be selected. */
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const editor = useCellEditor(task.title, (title) => {
    const trimmed = title.trim();
    // An empty title would leave a row nobody can identify, so it reverts
    // rather than saving. Silent, because the reader can see it snap back.
    if (trimmed) onSave({ title: trimmed });
  });

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editor.editing) inputRef.current?.select();
  }, [editor.editing]);

  if (editor.editing) {
    return (
      <Input
        ref={inputRef}
        value={editor.draft}
        onChange={(event) => editor.setDraft(event.target.value)}
        onBlur={editor.commit}
        onKeyDown={editor.onKeyDown}
        aria-label={`Rename "${task.title}"`}
        className="h-7 text-sm"
      />
    );
  }

  return (
    // Indented by depth so a subtask reads as belonging to the row above it.
    <span className={cn('flex min-w-0 items-center gap-1', depth > 0 && 'pl-6')}>
      {/* The keyboard's way into multi-select. Asana selects on a row click,
          which a keyboard cannot make; the box surfaces on hover and focus like
          the grip beside it, and stays once it is ticked. */}
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={onToggleSelect}
          aria-label={`Select "${task.title}"`}
          className={cn(
            'size-3.5 shrink-0 cursor-pointer accent-primary transition-opacity',
            'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        />
      )}

      {dragHandle}

      {onToggleExpand ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded ?? false}
          aria-label={`${expanded ? 'Hide' : 'Show'} subtasks of "${task.title}"`}
          className="shrink-0 cursor-pointer rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {expanded ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
        </button>
      ) : (
        // A spacer, so titles line up whether or not a row has children.
        <span className="size-4 shrink-0" aria-hidden="true" />
      )}

      {/* Asana's completion circle, on tasks and subtasks alike. Tickets sit
          this out — "complete" is a different word in their vocabulary. */}
      {!isTicketRow(task) && (
        <button
          type="button"
          disabled={!canEdit}
          aria-pressed={task.status === TaskStatus.DONE}
          aria-label={`Mark "${task.title}" ${task.status === TaskStatus.DONE ? 'incomplete' : 'complete'}`}
          onClick={() =>
            onSave({ status: task.status === TaskStatus.DONE ? TaskStatus.TODO : TaskStatus.DONE })
          }
          className={cn(
            'shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
            task.status === TaskStatus.DONE
              ? 'text-success'
              : 'text-muted-foreground hover:text-success',
          )}
        >
          <CircleCheck className="size-4" aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        onClick={onOpenTask}
        aria-label={`Open "${task.title}"`}
        className={cn(
          'min-w-0 flex-1 cursor-pointer truncate rounded px-1 py-0.5 text-left text-sm font-medium',
          'hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          task.status === TaskStatus.DONE && 'text-muted-foreground line-through',
        )}
      >
        {task.title}
      </button>

      {/* How much of the work under this row is done, without opening it. */}
      {task.subtaskCount > 0 && (
        <span
          className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground"
          title={`${task.completedSubtaskCount} of ${task.subtaskCount} subtasks complete`}
        >
          {task.completedSubtaskCount}/{task.subtaskCount}
        </span>
      )}

      {/* Asana's bubble and clip beside the name: how much conversation and
          how many files sit behind this row. */}
      {task.commentCount > 0 && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground"
          aria-label={`${task.commentCount} ${task.commentCount === 1 ? 'comment' : 'comments'}`}
        >
          <MessageSquare className="size-3" aria-hidden="true" />
          {task.commentCount}
        </span>
      )}
      {task.attachmentCount > 0 && (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground"
          aria-label={`${task.attachmentCount} ${task.attachmentCount === 1 ? 'attachment' : 'attachments'}`}
        >
          <Paperclip className="size-3" aria-hidden="true" />
          {task.attachmentCount}
        </span>
      )}

      {/* Asana's hover tail: quick actions surface at the right edge of the
          Name cell while the row is hovered, and stay reachable by keyboard.
          The rename pencil is ours; the chevron opens the details, as
          Asana's does. */}
      {canEdit && (
        <button
          type="button"
          onClick={editor.open}
          aria-label={`Rename "${task.title}"`}
          className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 group-hover:opacity-100"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        onClick={onOpenTask}
        aria-label={`Open details for "${task.title}"`}
        className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 group-hover:opacity-100"
      >
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

export function AssigneeCell({ task, metadata, canEdit, onSave }: CellProps) {
  const editor = useCellEditor(task.assignee?.id ?? '', (assigneeId) =>
    // Empty means unassigned, which the API expresses as null rather than "".
    onSave({ assigneeId: assigneeId || null }),
  );

  if (editor.editing) {
    return (
      <Select
        open
        value={editor.draft}
        onValueChange={(value) => {
          editor.setDraft(value === '__none__' ? '' : value);
          // Committed on selection: a dropdown has no Enter to press, and
          // waiting for a blur leaves the change looking unsaved.
          const next = value === '__none__' ? '' : value;
          if (next !== (task.assignee?.id ?? '')) onSave({ assigneeId: next || null });
          editor.cancel();
        }}
        onOpenChange={(open) => !open && editor.cancel()}
      >
        <SelectTrigger className="h-7 text-xs" aria-label={`Assignee for "${task.title}"`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Unassigned</SelectItem>
          {(metadata?.members ?? []).map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <CellButton onOpen={editor.open} disabled={!canEdit} ariaLabel={`Assignee for "${task.title}"`}>
      {task.assignee ? (
        <span className="inline-flex items-center gap-1.5">
          <PersonAvatar
            name={task.assignee.name}
            avatarUrl={task.assignee.avatarUrl}
            className="size-5"
            fallbackClassName="text-[9px]"
          />
          <span className="truncate text-xs">{task.assignee.name}</span>
        </span>
      ) : (
        <EmptyCell />
      )}
    </CellButton>
  );
}

/** Status and priority share a shape: a fixed set rendered as a badge. */
function EnumCell({
  task,
  canEdit,
  onSave,
  field,
  values,
  current,
  render,
}: CellProps & {
  field: 'status' | 'priority';
  values: readonly string[];
  current: string;
  render: (value: string) => React.ReactNode;
}) {
  const editor = useCellEditor(current, (value) => onSave({ [field]: value }));

  if (editor.editing) {
    return (
      <Select
        open
        value={editor.draft}
        onValueChange={(value) => {
          if (value !== current) onSave({ [field]: value });
          editor.cancel();
        }}
        onOpenChange={(open) => !open && editor.cancel()}
      >
        <SelectTrigger className="h-7 text-xs" aria-label={`${field} for "${task.title}"`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((value) => (
            <SelectItem key={value} value={value}>
              {render(value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <CellButton onOpen={editor.open} disabled={!canEdit} ariaLabel={`${field} for "${task.title}"`}>
      {render(current)}
    </CellButton>
  );
}

/*
 * Two vocabularies, chosen by what the row actually is.
 *
 * A ticket's statuses are OPEN, TRIAGED, RESOLVED, CLOSED — not a task's
 * BACKLOG, TODO, DONE. Offering a task's list on a ticket would present choices
 * the API refuses, and render its current status as a badge that has no colour
 * for it. Reading the row's type is what keeps the shared grid from flattening
 * a real difference.
 */
export function StatusCell(props: CellProps) {
  const ticket = isTicketRow(props.task);

  return (
    <EnumCell
      {...props}
      field="status"
      values={ticket ? TICKET_STATUSES : TASK_STATUSES}
      current={props.task.status}
      render={(value) =>
        ticket ? (
          <TicketStatusBadge status={value as never} />
        ) : (
          <TaskStatusBadge status={value as never} />
        )
      }
    />
  );
}

export function PriorityCell(props: CellProps) {
  const ticket = isTicketRow(props.task);

  return (
    <EnumCell
      {...props}
      field="priority"
      values={ticket ? TICKET_PRIORITIES : TASK_PRIORITIES}
      current={props.task.priority}
      render={(value) =>
        ticket ? (
          <TicketPriorityBadge priority={value as never} />
        ) : (
          <TaskPriorityBadge priority={value as never} />
        )
      }
    />
  );
}

/**
 * The due date, edited through the same picker the task panel uses.
 *
 * The picker hangs from the cell rather than replacing it, so the grid never
 * reflows while a date is being chosen — and every change lands as soon as it
 * is made, which is what the cells around it do.
 */
export function DueDateCell({ task, canEdit, onSave }: CellProps) {
  const [open, setOpen] = useState(false);

  const done = task.status === TaskStatus.DONE;
  // Calendar-day arithmetic, as the board and dashboard count it. A plain
  // Date comparison read a task due today as overdue from a minute past
  // midnight.
  const days = task.dueDate && !done ? daysUntil(task.dueDate) : null;
  const late = !done && isOverdue(task);

  return (
    <TaskDatePopover
      schedule={task}
      onSave={(changes) => onSave(changes)}
      open={open}
      onOpenChange={setOpen}
      // A ticket's deadline is a day: no start, no time.
      dateOnly={isTicketRow(task)}
    >
      <CellButton
        onOpen={() => setOpen(true)}
        disabled={!canEdit}
        ariaLabel={`Due date for "${task.title}"`}
        className={cn(
          'text-xs',
          late && 'text-destructive',
          // Asana's green "Today": due now is a nudge; only late is an alarm.
          !late && (days === 0 || days === 1) && 'text-success',
        )}
      >
        {/* A finished task is never "3d overdue" — the deadline stopped
            mattering when it was completed, so show the plain date. */}
        {task.dueDate ? formatDue(task, { done }) : <EmptyCell />}
      </CellButton>
    </TaskDatePopover>
  );
}

/** The start date: the same picker, opened on its start field. */
export function StartDateCell({ task, canEdit, onSave }: CellProps) {
  const [open, setOpen] = useState(false);

  // Tickets have no start date — nothing to edit, nothing to pretend.
  if (isTicketRow(task)) {
    return (
      <span className="block px-1 py-0.5 text-xs">
        <EmptyCell />
      </span>
    );
  }

  return (
    <TaskDatePopover
      schedule={task}
      onSave={(changes) => onSave(changes)}
      open={open}
      onOpenChange={setOpen}
      initialField="start"
    >
      <CellButton
        onOpen={() => setOpen(true)}
        disabled={!canEdit}
        ariaLabel={`Start date for "${task.title}"`}
        className="text-xs"
      >
        {task.startDate ? (
          task.startAt ? (
            `${formatDate(task.startDate)}, ${formatTime(task.startAt)}`
          ) : (
            formatDate(task.startDate)
          )
        ) : (
          <EmptyCell />
        )}
      </CellButton>
    </TaskDatePopover>
  );
}
