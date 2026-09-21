import type { CreatableWorkItemType, WorkItemType } from '@coretask/contracts';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ProjectFieldMetadata } from '@coretask/types';

import { Badge } from '@/components/ui/badge';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { TaskCard } from '@/features/tasks/components/task-card';
import { QuickCreateWorkItemRow } from '@/features/work-items/components/quick-create-work-item-row';
import { cn } from '@/lib/utils';

import type { RowGroup } from '../lib/group-rows';

/**
 * A board column standing for a value rather than a section.
 *
 * Its droppable id is `column:<groupId>` like a section column's, so the
 * board's drop handling does not care which kind it landed on; the group id
 * is never a bare option or user id, which keeps it apart from the card ids
 * that share the same DndContext. There is nothing to rename and no rule to
 * attach, so the header is the value's own chip and a count.
 */
export function GroupColumn({
  group,
  metadata,
  cardFields,
  canEdit,
  manualOrder,
  defaultType,
  creating,
  onCreateWorkItem,
  onOpenTask,
}: {
  group: RowGroup;
  metadata: ProjectFieldMetadata | undefined;
  cardFields: string[];
  canEdit: boolean;
  manualOrder: boolean;
  defaultType: CreatableWorkItemType;
  creating: boolean;
  onCreateWorkItem: (group: RowGroup, type: WorkItemType, title: string) => Promise<unknown>;
  onOpenTask: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${group.id}`,
    data: { type: 'column', sectionId: group.id },
  });

  return (
    <section
      aria-label={group.name}
      className={cn(
        'flex max-h-full w-72 shrink-0 flex-col rounded-xl border bg-muted/30',
        isOver && 'ring-2 ring-primary/40',
      )}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        {group.color ? (
          <SemanticBadge color={group.color}>{group.name}</SemanticBadge>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
        )}
        <span className="flex-1" />
        <Badge variant="muted" className="shrink-0 tabular-nums">
          {group.tasks.length}
        </Badge>
      </header>

      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        <SortableContext
          items={group.tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {group.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={onOpenTask}
              draggable={canEdit}
              manualOrder={manualOrder}
              cardFields={cardFields}
              metadata={metadata}
            />
          ))}
        </SortableContext>

        {group.tasks.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {canEdit ? 'Drop a card here to set this value' : 'Nothing here'}
          </p>
        )}
      </div>

      {canEdit && (
        <footer className="border-t p-2">
          <QuickCreateWorkItemRow
            defaultType={defaultType}
            sectionName={group.name}
            pending={creating}
            onCreate={({ type, title }) => onCreateWorkItem(group, type, title)}
          />
        </footer>
      )}
    </section>
  );
}
