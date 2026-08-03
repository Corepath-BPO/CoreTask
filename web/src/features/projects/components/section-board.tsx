import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { MAX_SECTIONS_PER_PROJECT } from '@coretask/contracts';
import type { Section } from '@coretask/types';
import { Plus } from 'lucide-react';
import { useState } from 'react';

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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button';
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
  canEdit: boolean;
  canDelete: boolean;
}

export function SectionBoard({
  workspaceId,
  projectId,
  sections,
  canEdit,
  canDelete,
}: SectionBoardProps) {
  const createSection = useCreateSection(workspaceId, projectId);
  const renameSection = useRenameSection(workspaceId, projectId);
  const moveSection = useMoveSection(workspaceId, projectId);
  const deleteSection = useDeleteSection(workspaceId, projectId);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Section | null>(null);

  const sensors = useSensors(
    // A small activation distance keeps a click on the rename button from being
    // swallowed as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    // The index-to-anchor conversion lives in a pure, unit-tested helper: it is
    // an off-by-one that only misbehaves when dragging in one direction.
    const plan = resolveDropPlan(sections, String(active.id), String(over.id));
    if (!plan) return;

    moveSection.mutate({
      sectionId: String(active.id),
      afterSectionId: plan.afterSectionId,
      optimistic: plan.reordered,
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

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          <SortableContext
            items={sections.map((section) => section.id)}
            strategy={horizontalListSortingStrategy}
          >
            {sections.map((section) => (
              <SectionColumn
                key={section.id}
                section={section}
                canEdit={canEdit}
                canDelete={canDelete}
                onRename={(sectionId, name) => renameSection.mutate({ sectionId, name })}
                onRequestDelete={setPendingDelete}
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
      </DndContext>

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
