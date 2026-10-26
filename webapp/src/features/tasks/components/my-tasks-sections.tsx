import {
  DEFAULT_MY_TASKS_RULES,
  MY_TASKS_BUCKETS,
  MY_TASKS_BUCKET_LABEL,
  MyTasksBucket,
  TaskStatus,
  myTasksBucketFor,
} from '@coretask/contracts';
import type { Task } from '@coretask/types';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ChevronDown, ChevronRight, CircleCheck, MoreHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { TagChips } from '@/features/tags/components/tag-chip';
import { cn, formatDue, isOverdue, ymd } from '@/lib/utils';

import {
  useMyTaskPlacements,
  useMyTasksRules,
  usePlaceMyTask,
} from '../hooks/use-my-task-placements';
import { useUpdateTask } from '../hooks/use-tasks';

/**
 * My Tasks in Asana's four sections. Where a task sits is the reader's own
 * choice — drag it, or use its menu — and is stored per person, so it never
 * moves the task in anyone else's list or in its project.
 */
export function MyTasksSections({
  workspaceId,
  tasks,
  canEdit,
  onOpen,
  layout = 'list',
}: {
  workspaceId: string | undefined;
  tasks: Task[];
  canEdit: boolean;
  onOpen: (taskId: string) => void;
  /** Stacked sections (Asana's List), or the same sections as Board columns. */
  layout?: 'list' | 'board';
}) {
  const { data: placements } = useMyTaskPlacements(workspaceId);
  const { data: rules } = useMyTasksRules(workspaceId);
  const place = usePlaceMyTask(workspaceId);
  const { data: projects } = useProjects(workspaceId, { limit: 100 });
  const [collapsed, setCollapsed] = useState<Set<MyTasksBucket>>(new Set());
  const [dragging, setDragging] = useState<Task | null>(null);

  const projectById = useMemo(
    () => new Map((projects?.items ?? []).map((project) => [project.id, project])),
    [projects],
  );

  // Where each task shows: its owner's placement, unless an auto-sort rule
  // moves it — and a move its owner made today always stands.
  const bucketOf = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const today = ymd(now);
    const where = new Map((placements ?? []).map((entry) => [entry.taskId, entry]));
    return (task: Task): MyTasksBucket => {
      const placement = where.get(task.id);
      return myTasksBucketFor({
        placed: placement?.bucket ?? null,
        placedToday: Boolean(placement?.placedAt && Date.parse(placement.placedAt) >= startOfToday),
        dueDate: task.dueDate,
        completed: task.status === TaskStatus.DONE,
        rules: rules ?? DEFAULT_MY_TASKS_RULES,
        today,
      });
    };
  }, [placements, rules]);

  const buckets = useMemo(() => {
    const grouped = new Map<MyTasksBucket, Task[]>(MY_TASKS_BUCKETS.map((bucket) => [bucket, []]));
    for (const task of tasks) grouped.get(bucketOf(task))?.push(task);
    // Soonest due first within a section, undated last — Asana's default sort.
    for (const list of grouped.values()) {
      list.sort((a, b) => {
        if (a.dueDate === b.dueDate) return a.title.localeCompare(b.title);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    }
    return grouped;
  }, [tasks, bucketOf]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const bucket = event.over?.data.current?.['bucket'] as MyTasksBucket | undefined;
    const taskId = String(event.active.id);
    if (!bucket) return;
    const task = tasks.find((entry) => entry.id === taskId);
    if (task && bucket !== bucketOf(task)) place.mutate({ taskId, bucket });
  };

  const toggle = (bucket: MyTasksBucket) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(event) =>
        setDragging(tasks.find((task) => task.id === String(event.active.id)) ?? null)
      }
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {layout === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-2" aria-label="My tasks board">
          {MY_TASKS_BUCKETS.map((bucket) => (
            <BucketColumn
              key={bucket}
              bucket={bucket}
              tasks={buckets.get(bucket) ?? []}
              canEdit={canEdit}
              workspaceId={workspaceId}
              projectById={projectById}
              onOpen={onOpen}
              onMove={(taskId, next) => place.mutate({ taskId, bucket: next })}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {MY_TASKS_BUCKETS.map((bucket) => (
            <BucketSection
              key={bucket}
              bucket={bucket}
              tasks={buckets.get(bucket) ?? []}
              collapsed={collapsed.has(bucket)}
              canEdit={canEdit}
              workspaceId={workspaceId}
              projectById={projectById}
              onToggle={() => toggle(bucket)}
              onOpen={onOpen}
              onMove={(taskId, next) => place.mutate({ taskId, bucket: next })}
            />
          ))}
        </div>
      )}

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="max-w-80 truncate rounded-md border border-border bg-popover px-3 py-2 text-sm font-medium shadow-lg">
            {dragging.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** One section as a Board column: drop a card on it to move the task there. */
function BucketColumn({
  bucket,
  tasks,
  canEdit,
  workspaceId,
  projectById,
  onOpen,
  onMove,
}: {
  bucket: MyTasksBucket;
  tasks: Task[];
  canEdit: boolean;
  workspaceId: string | undefined;
  projectById: Map<string, { id: string; name: string; color: string }>;
  onOpen: (taskId: string) => void;
  onMove: (taskId: string, bucket: MyTasksBucket) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket:${bucket}`, data: { bucket } });

  return (
    <section
      ref={setNodeRef}
      aria-label={MY_TASKS_BUCKET_LABEL[bucket]}
      className={cn(
        'flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2 transition-colors',
        isOver && 'bg-primary/5 ring-1 ring-primary/30',
      )}
    >
      <h2 className="flex items-center gap-1.5 px-1 text-sm font-semibold">
        {MY_TASKS_BUCKET_LABEL[bucket]}
        <span className="rounded-full bg-background px-1.5 text-xs font-normal text-muted-foreground">
          {tasks.length}
        </span>
      </h2>
      <ul className="flex min-h-16 flex-col gap-2">
        {tasks.length === 0 ? (
          <li className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            {bucket === MyTasksBucket.RECENTLY_ASSIGNED ? 'Nothing new.' : 'Drag tasks here.'}
          </li>
        ) : (
          tasks.map((task) => (
            <TaskLine
              key={task.id}
              task={task}
              bucket={bucket}
              canEdit={canEdit}
              workspaceId={workspaceId}
              project={task.projectId ? projectById.get(task.projectId) : undefined}
              onOpen={onOpen}
              onMove={onMove}
              variant="card"
            />
          ))
        )}
      </ul>
    </section>
  );
}

function BucketSection({
  bucket,
  tasks,
  collapsed,
  canEdit,
  workspaceId,
  projectById,
  onToggle,
  onOpen,
  onMove,
}: {
  bucket: MyTasksBucket;
  tasks: Task[];
  collapsed: boolean;
  canEdit: boolean;
  workspaceId: string | undefined;
  projectById: Map<string, { id: string; name: string; color: string }>;
  onToggle: () => void;
  onOpen: (taskId: string) => void;
  onMove: (taskId: string, bucket: MyTasksBucket) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket:${bucket}`, data: { bucket } });

  return (
    <section
      ref={setNodeRef}
      aria-label={MY_TASKS_BUCKET_LABEL[bucket]}
      className={cn(
        'rounded-lg transition-colors',
        isOver && 'bg-primary/5 ring-1 ring-primary/30',
      )}
    >
      <h2 className="flex items-center gap-1.5 px-1 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex cursor-pointer items-center gap-1.5 rounded text-sm font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {collapsed ? (
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          {MY_TASKS_BUCKET_LABEL[bucket]}
        </button>
        <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
          {tasks.length}
        </span>
      </h2>

      {!collapsed && (
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {tasks.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              {bucket === MyTasksBucket.RECENTLY_ASSIGNED
                ? 'Nothing new. Tasks assigned to you land here first.'
                : 'Drag tasks here.'}
            </li>
          ) : (
            tasks.map((task) => (
              <TaskLine
                key={task.id}
                task={task}
                bucket={bucket}
                canEdit={canEdit}
                workspaceId={workspaceId}
                project={task.projectId ? projectById.get(task.projectId) : undefined}
                onOpen={onOpen}
                onMove={onMove}
              />
            ))
          )}
        </ul>
      )}
    </section>
  );
}

function TaskLine({
  task,
  bucket,
  canEdit,
  workspaceId,
  project,
  onOpen,
  onMove,
  variant = 'line',
}: {
  task: Task;
  bucket: MyTasksBucket;
  canEdit: boolean;
  workspaceId: string | undefined;
  project: { name: string; color: string } | undefined;
  onOpen: (taskId: string) => void;
  onMove: (taskId: string, bucket: MyTasksBucket) => void;
  /** A row in a section, or a card in a Board column. */
  variant?: 'line' | 'card';
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const updateTask = useUpdateTask(workspaceId);
  const done = task.status === TaskStatus.DONE;
  const overdue = !done && isOverdue(task);

  return (
    <li
      ref={setNodeRef}
      className={cn(
        'group flex items-center gap-2 bg-background px-2 py-1.5 hover:bg-muted/40',
        variant === 'card' &&
          'flex-wrap rounded-md border border-border px-2.5 py-2 shadow-xs hover:bg-background hover:shadow-sm',
        isDragging && 'opacity-40',
      )}
    >
      <button
        type="button"
        disabled={!canEdit || updateTask.isPending}
        aria-pressed={done}
        aria-label={`Mark "${task.title}" ${done ? 'incomplete' : 'complete'}`}
        onClick={() =>
          updateTask.mutate({
            taskId: task.id,
            payload: { status: done ? TaskStatus.TODO : TaskStatus.DONE },
          })
        }
        className={cn(
          'shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
          done ? 'text-success' : 'text-muted-foreground hover:text-success',
        )}
      >
        <CircleCheck className="size-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        {...listeners}
        {...attributes}
        onClick={() => onOpen(task.id)}
        className={cn(
          'min-w-0 flex-1 cursor-pointer py-0.5 text-left text-sm focus-visible:outline-none focus-visible:underline',
          variant === 'card' ? 'line-clamp-2 font-medium' : 'truncate',
        )}
      >
        {task.title}
      </button>
      {variant === 'card' && task.tags?.length > 0 && (
        <TagChips tags={task.tags} max={2} className="basis-full pl-7" />
      )}

      {project && (
        <span
          className={cn(
            'hidden max-w-[30%] shrink-0 items-center gap-1.5 truncate rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground sm:flex',
            variant === 'card' && 'ml-7 max-w-[60%]',
          )}
        >
          <span
            className="size-2 shrink-0 rounded-[3px]"
            style={{ backgroundColor: project.color }}
            aria-hidden="true"
          />
          <span className="truncate">{project.name}</span>
        </span>
      )}

      {task.dueDate && (
        <span
          className={cn(
            'w-24 shrink-0 text-right text-xs tabular-nums',
            overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
          )}
        >
          {formatDue(task, { done })}
        </span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label={`Move "${task.title}" to another section`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={bucket}
            onValueChange={(value) => onMove(task.id, value as MyTasksBucket)}
          >
            {MY_TASKS_BUCKETS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {MY_TASKS_BUCKET_LABEL[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
