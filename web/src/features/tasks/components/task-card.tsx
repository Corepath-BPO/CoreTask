import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskStatus } from '@coretask/contracts';
import type { Task } from '@coretask/types';
import { CalendarClock, ListChecks, MessageSquareText } from 'lucide-react';

import { TaskPriorityBadge } from '@/components/data-display/status-badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { WorkItemTypeIcon } from '@/features/work-items/components/work-item-type-icon';
import { isTicketRow } from '@/features/work-items/lib/work-item-row';
import { cn, daysUntil, formatDate, formatDueDate, initials } from '@/lib/utils';

interface TaskCardProps {
  task: Task;
  onOpen: (taskId: string) => void;
  draggable?: boolean;
}

export function TaskCard({ task, onOpen, draggable = true }: TaskCardProps) {
  // `attributes` is deliberately not spread. It sets role="button" and tabindex
  // on this element, which — with the real <button> below — produces nested
  // interactive controls: invalid semantics, and a confusing double stop for
  // screen readers and keyboard users.
  //
  // So the card is a pointer drag surface only, and the inner button owns
  // focus, Enter/Space and the click. Keyboard users move a task between
  // columns from the detail dialog's Section control rather than by dragging.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
    data: { type: 'task', sectionId: task.sectionId },
  });

  const done = task.status === TaskStatus.DONE;
  const overdue = task.dueDate !== null && !done && daysUntil(task.dueDate) < 0;

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group rounded-lg border bg-card p-2.5 shadow-xs transition-shadow',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
        done && 'opacity-70',
      )}
      {...listeners}
    >
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="w-full rounded text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <p
          className={cn(
            'flex items-start gap-1.5 text-sm leading-snug',
            done && 'text-muted-foreground line-through decoration-muted-foreground/50',
          )}
        >
          {/*
            A board column now holds both kinds, so the card has to say which it
            is. The key comes with it for a ticket: `CORE-1042` is what somebody
            quotes in an email, and a card that hides it makes the board useless
            for finding the thing they were sent.
          */}
          {isTicketRow(task) && (
            <>
              <WorkItemTypeIcon type="TICKET" className="mt-0.5" />
              {task.workItem.details.kind === 'TICKET' && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {task.workItem.details.key}
                </span>
              )}
            </>
          )}
          <span className="min-w-0 flex-1">{task.title}</span>
        </p>
      </button>

      {(task.priority !== 'NONE' ||
        task.dueDate ||
        task.subtaskCount > 0 ||
        task.assignee ||
        task.description) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <TaskPriorityBadge priority={task.priority} />

          {task.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[11px]',
                overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              <CalendarClock className="size-3" aria-hidden="true" />
              {/* A finished task is never "3d overdue" — the deadline stopped
                  mattering when it was completed, so show the plain date. */}
              {done ? formatDate(task.dueDate) : formatDueDate(task.dueDate)}
            </span>
          )}

          {task.subtaskCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
              title={`${task.completedSubtaskCount} of ${task.subtaskCount} subtasks done`}
            >
              <ListChecks className="size-3" aria-hidden="true" />
              {task.completedSubtaskCount}/{task.subtaskCount}
            </span>
          )}

          {task.description && (
            <MessageSquareText
              className="size-3 text-muted-foreground"
              aria-label="Has a description"
            />
          )}

          {task.assignee && (
            <Avatar className="ml-auto size-5" title={task.assignee.name}>
              {task.assignee.avatarUrl && <AvatarImage src={task.assignee.avatarUrl} alt="" />}
              <AvatarFallback className="text-[9px]">{initials(task.assignee.name)}</AvatarFallback>
            </Avatar>
          )}
        </div>
      )}
    </article>
  );
}

/** Static rendering used inside the drag overlay, where sortable context is absent. */
export function TaskCardPreview({ task }: { task: Task }) {
  return (
    <article className="w-64 rotate-2 rounded-lg border bg-card p-2.5 shadow-lg">
      <p className="text-sm leading-snug">{task.title}</p>
    </article>
  );
}
