import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SystemField, TaskStatus, parseCustomFieldRef } from '@coretask/contracts';
import type { ProjectFieldMetadata, Task } from '@coretask/types';
import { AlignLeft, CalendarClock, ListChecks, MessageSquare, Paperclip } from 'lucide-react';

import { TaskPriorityBadge } from '@/components/data-display/status-badge';
import { PersonAvatar } from '@/components/data-display/person-avatar';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { CustomFieldValue } from '@/features/projects/components/cells/custom-field-value';
import { WorkItemTypeIcon } from '@/features/work-items/components/work-item-type-icon';
import { isTicketRow, type WorkItemRow } from '@/features/work-items/lib/work-item-row';
import { cn, daysUntil, formatDate, formatDue, isOverdue } from '@/lib/utils';

interface TaskCardProps {
  task: Task;
  onOpen: (taskId: string) => void;
  draggable?: boolean;
  /** False while a sort or grouping owns the order; dragging still moves between columns. */
  manualOrder?: boolean;
  /** The view's chosen card fields, as `cardFields` names them. */
  cardFields?: string[];
  metadata?: ProjectFieldMetadata | undefined;
}

export function TaskCard({
  task,
  onOpen,
  draggable = true,
  cardFields = [],
  metadata,
}: TaskCardProps) {
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
  const days = task.dueDate !== null && !done ? daysUntil(task.dueDate) : null;
  // A time makes the deadline a moment: 3pm today is late at 3:01.
  const overdue = !done && isOverdue(task);
  // Today or tomorrow — the list's due-date cell draws the same green.
  const dueNow = !overdue && (days === 0 || days === 1);

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
        task.commentCount > 0 ||
        task.attachmentCount > 0 ||
        task.assignee ||
        task.description) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <TaskPriorityBadge priority={task.priority} />

          {task.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[11px]',
                overdue
                  ? 'font-medium text-destructive'
                  : dueNow
                    ? 'text-success'
                    : 'text-muted-foreground',
              )}
            >
              <CalendarClock className="size-3" aria-hidden="true" />
              {/* A finished task is never "3d overdue" — the deadline stopped
                  mattering when it was completed, so show the plain date. */}
              {formatDue(task, { done })}
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

          {/* Asana's card glyphs: lines for a description, a bubble with the
              number of comments, a clip with the number of files. The bubble
              used to stand for the description, which read as "has comments"
              to anyone who knows Asana. */}
          {task.description && (
            <AlignLeft className="size-3 text-muted-foreground" aria-label="Has a description" />
          )}

          {task.commentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"
              aria-label={`${task.commentCount} ${task.commentCount === 1 ? 'comment' : 'comments'}`}
            >
              <MessageSquare className="size-3" aria-hidden="true" />
              {task.commentCount}
            </span>
          )}

          {task.attachmentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"
              aria-label={`${task.attachmentCount} ${task.attachmentCount === 1 ? 'attachment' : 'attachments'}`}
            >
              <Paperclip className="size-3" aria-hidden="true" />
              {task.attachmentCount}
            </span>
          )}

          {task.assignee && (
            <PersonAvatar
              name={task.assignee.name}
              avatarUrl={task.assignee.avatarUrl}
              className="ml-auto size-5"
              fallbackClassName="text-[9px]"
              title={task.assignee.name}
            />
          )}
        </div>
      )}

      {/* The fields the view asked to see on a card, as Asana draws them:
          a label and a value per line. A ticket carries no custom-field
          values, so only its system fields appear. */}
      {cardFields.length > 0 && (
        <CardFields task={task} cardFields={cardFields} metadata={metadata} />
      )}
    </article>
  );
}

interface CardFieldLine {
  ref: string;
  label: string;
  value: React.ReactNode;
}

function CardFields({
  task,
  cardFields,
  metadata,
}: {
  task: Task;
  cardFields: string[];
  metadata: ProjectFieldMetadata | undefined;
}) {
  const row = task as Partial<WorkItemRow>;
  const rows = cardFields
    .map((ref): CardFieldLine | null => {
      const customId = parseCustomFieldRef(ref);
      if (customId) {
        if (isTicketRow(task)) return null;
        const field = metadata?.customFields.find((entry) => entry.id === customId);
        if (!field || field.isArchived) return null;
        const value = row.customFieldValues?.find((entry) => entry.customFieldId === customId);
        return {
          ref,
          label: field.name,
          value: <CustomFieldValue field={field} value={value} metadata={metadata} compact />,
        };
      }
      switch (ref) {
        case SystemField.STATUS: {
          const status = row.workItem?.status;
          return {
            ref,
            label: 'Status',
            value: status ? (
              <SemanticBadge color={{ colorToken: status.colorToken, customColor: null }}>
                {status.name}
              </SemanticBadge>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          };
        }
        case SystemField.START_DATE:
          return {
            ref,
            label: 'Start',
            value: task.startDate ? (
              formatDate(task.startDate)
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          };
        case SystemField.ESTIMATE:
          return {
            ref,
            label: 'Estimate',
            value: task.estimatedMinutes ? (
              `${task.estimatedMinutes}m`
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          };
        case SystemField.CREATED_AT:
          return { ref, label: 'Created', value: formatDate(task.createdAt) };
        default:
          return null;
      }
    })
    .filter((entry): entry is CardFieldLine => entry !== null);

  if (rows.length === 0) return null;

  return (
    <dl className="mt-2 space-y-0.5 border-t pt-1.5 text-[11px]">
      {rows.map((entry) => (
        <div key={entry.ref} className="flex items-center justify-between gap-2">
          <dt className="truncate text-muted-foreground">{entry.label}</dt>
          <dd className="min-w-0 truncate text-right">{entry.value}</dd>
        </div>
      ))}
    </dl>
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
