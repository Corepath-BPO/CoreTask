import { type CreatableWorkItemType, type WorkItemType } from '@coretask/contracts';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Section, Task } from '@coretask/types';
import { GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { TaskCard } from '@/features/tasks/components/task-card';
import { QuickCreateWorkItemRow } from '@/features/work-items/components/quick-create-work-item-row';
import { SectionAutomationPopover } from '@/features/automations/components/section-automation-popover';
import { cn } from '@/lib/utils';

/**
 * Droppable id for a column body, so an empty column is still a drop target.
 * The board reads `over.data.current.type` rather than parsing this back.
 */
const columnDroppableId = (sectionId: string) => `column:${sectionId}`;

interface SectionColumnProps {
  section: Section;
  tasks: Task[];
  canEdit: boolean;
  canDelete: boolean;
  onRename: (sectionId: string, name: string) => void;
  onRequestDelete: (section: Section) => void;
  defaultType: CreatableWorkItemType;
  onCreateWorkItem: (sectionId: string, type: WorkItemType, title: string) => Promise<unknown>;
  onOpenTask: (taskId: string) => void;
  creating?: boolean;
}

export function SectionColumn({
  section,
  tasks,
  canEdit,
  canDelete,
  onRename,
  onRequestDelete,
  defaultType,
  onCreateWorkItem,
  onOpenTask,
  creating = false,
}: SectionColumnProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: !canEdit,
    data: { type: 'section' },
  });

  // Separate droppable for the body: without it, dropping a task into an empty
  // column has nothing to register against.
  const { setNodeRef: setBodyRef, isOver } = useDroppable({
    id: columnDroppableId(section.id),
    data: { type: 'column', sectionId: section.id },
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  /**
   * Seeds the draft as editing begins rather than syncing it from props in an
   * effect: the draft only exists while the input is open, so a rename arriving
   * from elsewhere cannot clobber what the user is typing.
   */
  const startEditing = () => {
    setDraft(section.name);
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    setEditing(false);

    if (next === '' || next === section.name) {
      setDraft(section.name);
      return;
    }

    onRename(section.id, next);
  };

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={section.name}
      className={cn(
        'flex max-h-full w-72 shrink-0 flex-col rounded-xl border bg-muted/30',
        isDragging && 'z-10 opacity-80 shadow-lg',
        isOver && 'ring-2 ring-primary/40',
      )}
    >
      <header className="flex items-center gap-1 border-b px-3 py-2.5">
        {/* What runs when a task lands here. Placed in the header because that
            is where someone asks the question. */}
        <SectionAutomationPopover
          projectId={section.projectId}
          sectionId={section.id}
          sectionName={section.name}
        />

        {canEdit && (
          <button
            type="button"
            className="cursor-grab touch-none rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none active:cursor-grabbing"
            aria-label={`Reorder ${section.name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}

        {editing ? (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft(section.name);
                setEditing(false);
              }
            }}
            aria-label={`Rename ${section.name}`}
            className="h-7 flex-1 text-sm font-medium"
          />
        ) : (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => canEdit && startEditing()}
            className={cn(
              'min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm font-medium',
              canEdit &&
                'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
            )}
            title={canEdit ? 'Click to rename' : section.name}
          >
            {section.name}
          </button>
        )}

        <Badge variant="muted" className="shrink-0 tabular-nums">
          {tasks.length}
        </Badge>

        {canDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${section.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={startEditing}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onRequestDelete(section)}>
                <Trash2 />
                Delete section
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div ref={setBodyRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpenTask} draggable={canEdit} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {canEdit ? 'Drop a task here, or add one below' : 'No tasks'}
          </p>
        )}
      </div>

      {canEdit && (
        <footer className="border-t p-2">
          {/*
            The same control the List puts at the foot of every section, so a
            column and a section card offer the same thing in the same words.
            The board-only composer it replaces could create tasks and nothing
            else, which is how the Board and List came to disagree about what a
            project can hold.
          */}
          <QuickCreateWorkItemRow
            defaultType={defaultType}
            sectionName={section.name}
            pending={creating}
            onCreate={({ type, title }) => onCreateWorkItem(section.id, type, title)}
          />
        </footer>
      )}
    </section>
  );
}
