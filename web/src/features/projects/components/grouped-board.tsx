import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { CreatableWorkItemType } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewSettings } from '@coretask/types';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { TaskCardPreview } from '@/features/tasks/components/task-card';
import { useMoveTaskToSection } from '@/features/tasks/hooks/use-tasks';
import {
  useCreateProjectWorkItem,
  useUpdateProjectWorkItem,
} from '@/features/work-items/hooks/use-project-work-items';
import { toWorkItemRow, type WorkItemRow } from '@/features/work-items/lib/work-item-row';

import { useSetCustomFieldValue } from '../hooks/use-project-views';
import { useProject } from '../hooks/use-projects';
import { groupRows, type RowGroup } from '../lib/group-rows';
import { groupValueChange, isManualOrder } from '../lib/group-value';

import { GroupColumn } from './group-column';

/**
 * The Board grouped by something other than section: one column per status,
 * priority, assignee or select option, plus "No value".
 *
 * Dragging a card across columns sets the value the column stands for.
 * Dragging within a column does nothing while a sort or a grouping owns the
 * order — there is no position to write to. `SectionBoard` stays for the
 * section grouping, where the columns are real and dragging within one
 * reorders.
 */
export function GroupedBoard({
  workspaceId,
  projectId,
  tasks,
  settings,
  metadata,
  canEdit,
  onOpenTask,
}: {
  workspaceId: string | undefined;
  projectId: string;
  tasks: WorkItemRow[];
  settings: ViewSettings;
  metadata: ProjectFieldMetadata | undefined;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const groups = useMemo(
    () => groupRows(tasks, settings.groupBy, metadata),
    [tasks, settings.groupBy, metadata],
  );
  const manualOrder = isManualOrder(settings);
  const cardFields = settings.cardFields ?? [];

  const { data: project } = useProject(workspaceId, projectId);
  const defaultType: CreatableWorkItemType = project?.defaultWorkItemType ?? 'TASK';
  const createWorkItem = useCreateProjectWorkItem(workspaceId, projectId);
  const updateWorkItem = useUpdateProjectWorkItem(workspaceId, projectId);
  const setFieldValue = useSetCustomFieldValue(workspaceId, projectId);
  const moveTask = useMoveTaskToSection(workspaceId);

  const [dragging, setDragging] = useState<WorkItemRow | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const apply = (group: RowGroup, row: WorkItemRow) => {
    const change = groupValueChange(settings.groupBy, group, row, metadata);
    if (!change) return;
    switch (change.kind) {
      case 'move':
        moveTask.mutate({
          taskId: row.id,
          payload: { sectionId: change.sectionId, afterTaskId: null },
        });
        return;
      case 'update':
        updateWorkItem.mutate({ workItemId: row.id, payload: change.payload });
        return;
      case 'field':
        setFieldValue.mutate({ taskId: row.id, fieldId: change.fieldId, value: change.payload });
        return;
      case 'refused':
        toast.error(change.reason);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over || active.data.current?.['type'] !== 'task') return;

    const row = tasks.find((task) => task.id === active.id);
    const overData = over.data.current;
    const destination =
      overData?.['type'] === 'column'
        ? groups.find((group) => group.id === overData['sectionId'])
        : groups.find((group) => group.tasks.some((task) => task.id === over.id));
    if (!row || !destination) return;
    // Landing in the column it came from means nothing: the order is not ours.
    if (destination.tasks.some((task) => task.id === row.id)) return;

    apply(destination, row);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event: DragStartEvent) =>
        setDragging(tasks.find((task) => task.id === event.active.id) ?? null)
      }
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex items-start gap-4 overflow-x-auto pb-4">
        {groups.map((group) => (
          <GroupColumn
            key={group.id}
            group={group}
            metadata={metadata}
            cardFields={cardFields}
            canEdit={canEdit}
            manualOrder={manualOrder}
            defaultType={defaultType}
            creating={createWorkItem.isPending}
            onCreateWorkItem={async (target, type, title) => {
              // Filed in the first section, then given the column's value, so
              // it lands where it was typed.
              const created = await createWorkItem.mutateAsync({
                type,
                title,
                ...(metadata?.sections[0] ? { sectionId: metadata.sections[0].id } : {}),
              });
              apply(target, toWorkItemRow(created));
            }}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? <TaskCardPreview task={dragging} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
