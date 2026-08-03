import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { BOARD_TASK_LIMIT, MAX_SECTIONS_PER_PROJECT } from '@coretask/contracts';
import type { Section, Task } from '@coretask/types';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

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
import { Input } from '@/components/ui/input';
import { TaskCardPreview } from '@/features/tasks/components/task-card';
import { groupTasksBySection, useCreateTask, useMoveTask } from '@/features/tasks/hooks/use-tasks';
import { resolveTaskDrop, type TaskDropTarget } from '@/features/tasks/lib/resolve-task-drop';
import { cn } from '@/lib/utils';

import {
  useCreateSection,
  useDeleteSection,
  useMoveSection,
  useRenameSection,
} from '../hooks/use-projects';
import { resolveDropPlan } from '../lib/resolve-drop';

import { SectionColumn } from './section-column';

interface SectionBoardProps {
  workspaceId: string | undefined;
  projectId: string;
  sections: Section[];
  tasks: Task[];
  totalTaskCount: number;
  canEdit: boolean;
  canDelete: boolean;
  onOpenTask: (taskId: string) => void;
}

export function SectionBoard({
  workspaceId,
  projectId,
  sections,
  tasks,
  totalTaskCount,
  canEdit,
  canDelete,
  onOpenTask,
}: SectionBoardProps) {
  const createSection = useCreateSection(workspaceId, projectId);
  const renameSection = useRenameSection(workspaceId, projectId);
  const moveSection = useMoveSection(workspaceId, projectId);
  const deleteSection = useDeleteSection(workspaceId, projectId);
  const createTask = useCreateTask(workspaceId);
  const moveTask = useMoveTask(workspaceId, projectId);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Section | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);

  const groups = useMemo(
    () =>
      groupTasksBySection(
        tasks,
        sections.map((section) => section.id),
      ),
    [tasks, sections],
  );

  const sensors = useSensors(
    // A small activation distance keeps a click on a card or the rename button
    // from being swallowed as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.['type'] !== 'task') return;
    setDragging(tasks.find((task) => task.id === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);

    const { active, over } = event;
    if (!over) return;

    // One DndContext drives both levels, so the payload says which is moving.
    const activeType = active.data.current?.['type'];

    if (activeType === 'section') {
      const plan = resolveDropPlan(sections, String(active.id), String(over.id));
      if (!plan) return;

      moveSection.mutate({
        sectionId: String(active.id),
        afterSectionId: plan.afterSectionId,
        optimistic: plan.reordered,
      });
      return;
    }

    if (activeType !== 'task') return;

    const overData = over.data.current;
    const target: TaskDropTarget =
      overData?.['type'] === 'column'
        ? { id: String(over.id), type: 'column', sectionId: String(overData['sectionId']) }
        : { id: String(over.id), type: 'task' };

    const plan = resolveTaskDrop(groups, String(active.id), target);
    if (!plan) return;

    moveTask.mutate({
      taskId: String(active.id),
      payload: { sectionId: plan.sectionId, afterTaskId: plan.afterTaskId },
      groups: plan.groups,
    });
  };

  const submitNewSection = () => {
    const name = newName.trim();
    if (name === '') {
      setAdding(false);
      return;
    }

    createSection.mutate({ name });
    setNewName('');
    setAdding(false);
  };

  const atLimit = sections.length >= MAX_SECTIONS_PER_PROJECT;
  const withheld = Math.max(0, totalTaskCount - tasks.length);

  return (
    <>
      <DndContext
        sensors={sensors}
        // closestCorners handles mixed vertical/horizontal lists far better than
        // closestCenter, which tends to pick the wrong column mid-drag.
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex items-start gap-4 overflow-x-auto pb-4">
          <SortableContext
            items={sections.map((section) => section.id)}
            strategy={horizontalListSortingStrategy}
          >
            {sections.map((section) => (
              <SectionColumn
                key={section.id}
                section={section}
                tasks={groups[section.id] ?? []}
                canEdit={canEdit}
                canDelete={canDelete}
                creatingTask={createTask.isPending}
                onRename={(sectionId, name) => renameSection.mutate({ sectionId, name })}
                onRequestDelete={setPendingDelete}
                onOpenTask={onOpenTask}
                onCreateTask={(sectionId, title) => createTask.mutate({ title, sectionId })}
              />
            ))}
          </SortableContext>

          {canEdit && (
            <div className="w-72 shrink-0">
              {adding ? (
                <div className="rounded-xl border border-dashed p-3">
                  <Input
                    autoFocus
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    onBlur={submitNewSection}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitNewSection();
                      if (event.key === 'Escape') {
                        setNewName('');
                        setAdding(false);
                      }
                    }}
                    placeholder="Section name"
                    aria-label="New section name"
                    className="h-8"
                  />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Enter to add · Escape to cancel
                  </p>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setAdding(true)}
                  disabled={atLimit || createSection.isPending}
                  className="h-11 w-full justify-start border-dashed text-muted-foreground"
                >
                  <Plus />
                  {atLimit ? `Limit of ${MAX_SECTIONS_PER_PROJECT} reached` : 'Add section'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Follows the cursor across columns; without it the card would be
            clipped by the column's own overflow. */}
        <DragOverlay dropAnimation={null}>
          {dragging ? <TaskCardPreview task={dragging} /> : null}
        </DragOverlay>
      </DndContext>

      {withheld > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing the first {BOARD_TASK_LIMIT} tasks · {withheld} more not displayed. Use My Tasks
          or the filters to reach them.
        </p>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && pendingDelete.taskCount > 0
                ? `Its ${pendingDelete.taskCount} task${pendingDelete.taskCount === 1 ? '' : 's'} will move to the first column rather than being deleted.`
                : 'This section is empty. Deleting it cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'destructive' }))}
              onClick={() => {
                if (pendingDelete) deleteSection.mutate(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete section
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
