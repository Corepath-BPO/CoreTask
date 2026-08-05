import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TaskStatus,
} from '@coretask/contracts';
import type { ProjectFieldMetadata, Task } from '@coretask/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';

import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TicketPriorityBadge,
  TicketStatusBadge,
} from '@/components/data-display/status-badge';
import { isTicketRow } from '@/features/work-items/lib/work-item-row';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn, formatDate, initials } from '@/lib/utils';

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
}: CellProps & {
  /** 0 for a top-level task, 1 for a subtask. Nesting goes no deeper. */
  depth?: number;
  expanded?: boolean;
  /** Absent when the task has no subtasks — there is nothing to expand. */
  onToggleExpand?: () => void;
  /** The grip that starts a row drag; absent for subtasks and read-only views. */
  dragHandle?: React.ReactNode;
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

      {canEdit && (
        <button
          type="button"
          onClick={editor.open}
          aria-label={`Rename "${task.title}"`}
          // Revealed on hover or focus so the row stays quiet at rest, but
          // never hidden from the keyboard.
          className="shrink-0 cursor-pointer rounded px-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 group-hover:opacity-100"
        >
          ✎
        </button>
      )}
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
          <Avatar className="size-5">
            {task.assignee.avatarUrl && <AvatarImage src={task.assignee.avatarUrl} alt="" />}
            <AvatarFallback className="text-[9px]">{initials(task.assignee.name)}</AvatarFallback>
          </Avatar>
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

export function DueDateCell({ task, canEdit, onSave }: CellProps) {
  // `<input type="date">` speaks `yyyy-mm-dd`; the API speaks ISO. Converting
  // at the boundary keeps the rest of the cell unaware of either.
  const asInput = task.dueDate ? task.dueDate.slice(0, 10) : '';

  const editor = useCellEditor(asInput, (value) =>
    onSave({ dueDate: value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null }),
  );

  if (editor.editing) {
    return (
      <Input
        type="date"
        autoFocus
        value={editor.draft}
        onChange={(event) => editor.setDraft(event.target.value)}
        onBlur={editor.commit}
        onKeyDown={editor.onKeyDown}
        aria-label={`Due date for "${task.title}"`}
        className="h-7 text-xs"
      />
    );
  }

  const overdue =
    task.dueDate && task.status !== TaskStatus.DONE && new Date(task.dueDate) < new Date();

  return (
    <CellButton
      onOpen={editor.open}
      disabled={!canEdit}
      ariaLabel={`Due date for "${task.title}"`}
      className={cn('text-xs', overdue && 'text-destructive')}
    >
      {task.dueDate ? formatDate(task.dueDate) : <EmptyCell />}
    </CellButton>
  );
}
