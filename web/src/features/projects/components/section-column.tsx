import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Section } from '@coretask/types';
import { GripVertical, ListTodo, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';

interface SectionColumnProps {
  section: Section;
  canEdit: boolean;
  canDelete: boolean;
  onRename: (sectionId: string, name: string) => void;
  onRequestDelete: (section: Section) => void;
}

export function SectionColumn({
  section,
  canEdit,
  canDelete,
  onRename,
  onRequestDelete,
}: SectionColumnProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: !canEdit,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  /**
   * Seeds the draft as editing begins rather than syncing it from props in an
   * effect. The draft only exists while the input is open, so there is nothing
   * to keep in sync — and a rename arriving from elsewhere cannot clobber what
   * the user is currently typing.
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
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30',
        isDragging && 'z-10 opacity-80 shadow-lg',
      )}
    >
      <div className="flex items-center gap-1 border-b px-3 py-2.5">
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
          {section.taskCount}
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
      </div>

      {/* Tasks arrive in the next phase; the column still shows its real count. */}
      <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-1.5 p-4 text-center">
        <ListTodo className="size-5 text-muted-foreground/60" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">
          {section.taskCount === 0
            ? 'No tasks yet'
            : `${section.taskCount} task${section.taskCount === 1 ? '' : 's'}`}
        </p>
        <p className="text-[11px] text-muted-foreground/70">Task cards arrive in the next phase</p>
      </div>
    </div>
  );
}
