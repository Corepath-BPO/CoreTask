import type { ProjectWorkItem } from '@coretask/types';
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
  type DragStartEvent,
} from '@dnd-kit/core';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Plus,
  Ticket,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskDetailPanel } from '@/features/tasks/components/task-detail-dialog';
import {
  useCreateProjectWorkItem,
  useProjectWorkItems,
  useUpdateProjectWorkItem,
} from '@/features/work-items/hooks/use-project-work-items';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import { calendarDateOf, fromYmd, toIsoCalendarDate, ymd } from '@/lib/utils/dates';

import { useProject } from '../hooks/use-projects';
import {
  dayDiff,
  layoutWeek,
  monthStart,
  monthWeeks,
  shiftSchedule,
  type CalendarSpan,
  type PlacedSpan,
} from '../lib/calendar-layout';
import { useProjectAccess } from '../lib/project-access';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Bars drawn per week before the rest fold into "+N more". */
const MAX_LANES = 3;
const LANE_HEIGHT = 24;
const DAY_HEADER = 28;

interface CalendarItem extends CalendarSpan {
  workItem: ProjectWorkItem;
  done: boolean;
}

/** The item's days on the calendar, or null when it has no due date to sit on. */
function toCalendarItem(item: ProjectWorkItem): CalendarItem | null {
  if (!item.dueDate) return null;
  const end = calendarDateOf(item.dueDate);
  const startKey = item.startDate ? calendarDateOf(item.startDate) : end;
  return {
    id: item.id,
    start: startKey <= end ? startKey : end,
    end,
    workItem: item,
    done: item.completedAt !== null,
  };
}

const formatMonth = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
const formatShortDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const formatLongDay = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

/** The item a drag carries — bars split across weeks share one. */
function draggedItemId(event: DragStartEvent | DragEndEvent): string {
  return String(event.active.data.current?.['itemId'] ?? event.active.id);
}

/**
 * The project's Calendar tab, as Asana draws it: a month of weeks, each task
 * a bar from its start date to its due date, dragged to reschedule.
 *
 * Reads the same work items as the List and the Board, so a date changed here
 * is the date the other views show, and the open task is the same `?task=`
 * the other tabs carry.
 */
export function ProjectCalendarPage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: project, isLoading: projectLoading } = useProject(workspaceId, projectId);
  const access = useProjectAccess(project);
  const canEdit = access.canEdit && !project?.archivedAt;

  const navigate = useNavigate();
  const routeSearch: Partial<{ task: string }> = useSearch({ strict: false });
  const openTaskId =
    routeSearch.task && UUID_PATTERN.test(routeSearch.task) ? routeSearch.task : null;

  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const today = ymd(new Date());

  const { data, isLoading } = useProjectWorkItems(workspaceId, projectId, {});
  const update = useUpdateProjectWorkItem(workspaceId, projectId);
  const create = useCreateProjectWorkItem(workspaceId, projectId);

  const { scheduled, unscheduled } = useMemo(() => {
    const placed: CalendarItem[] = [];
    const loose: ProjectWorkItem[] = [];
    for (const item of data?.items ?? []) {
      if (item.parentId) continue;
      const entry = toCalendarItem(item);
      if (entry) placed.push(entry);
      else if (item.completedAt === null) loose.push(item);
    }
    return { scheduled: placed, unscheduled: loose };
  }, [data]);

  const openTask = (taskId: string) =>
    void navigate({
      to: '/projects/$projectId/calendar',
      params: { projectId },
      search: { task: taskId },
      replace: openTaskId !== null,
      resetScroll: false,
    });
  const closeTask = () =>
    void navigate({
      to: '/projects/$projectId/calendar',
      params: { projectId },
      search: {},
      replace: true,
      resetScroll: false,
    });

  /** Dropping a bar on a day puts its due date there and carries the start along. */
  const reschedule = (itemId: string, day: string) => {
    if (!canEdit) return;
    const item = data?.items.find((entry) => entry.id === itemId);
    if (!item) return;

    if (!item.dueDate) {
      // From the Unscheduled list: it simply gets a due date.
      update.mutate({ workItemId: item.id, payload: { dueDate: toIsoCalendarDate(day) } });
      return;
    }

    const days = dayDiff(calendarDateOf(item.dueDate), day);
    if (days === 0) return;
    const moved = shiftSchedule(item, days);
    update.mutate({
      workItemId: item.id,
      // A ticket's deadline is a day — no start, no time of day.
      payload:
        item.type === 'TICKET'
          ? { dueDate: moved.dueDate }
          : {
              dueDate: moved.dueDate,
              dueAt: moved.dueAt,
              startDate: moved.startDate,
              startAt: moved.startAt,
            },
    });
  };

  /*
   * dnd-kit rather than the browser's own drag and drop: native HTML5
   * dragging does nothing on a touch screen, and the Board and List already
   * move work with dnd-kit — one drag model across the views. The travel
   * threshold keeps a click on a bar a click.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const [dragging, setDragging] = useState<ProjectWorkItem | null>(null);

  const onDragStart = (event: DragStartEvent) =>
    setDragging(data?.items.find((entry) => entry.id === draggedItemId(event)) ?? null);

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const day = event.over?.data.current?.['day'];
    if (typeof day === 'string') reschedule(draggedItemId(event), day);
  };

  const addOn = (day: string, title: string) =>
    create.mutateAsync({
      type: project?.defaultWorkItemType ?? 'TASK',
      title,
      dueDate: toIsoCalendarDate(day),
    });

  if (projectLoading || !project) return <Skeleton className="h-96 w-full" />;

  const monthDate = fromYmd(month);
  const stepMonth = (delta: number) =>
    setMonth(monthStart(new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setMonth(monthStart(new Date()))}>
          Today
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => stepMonth(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => stepMonth(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <h2 className="text-base font-semibold" aria-live="polite">
          {formatMonth.format(monthDate)}
        </h2>

        <Button
          variant={showUnscheduled ? 'secondary' : 'ghost'}
          size="sm"
          className="ml-auto"
          aria-pressed={showUnscheduled}
          onClick={() => setShowUnscheduled((value) => !value)}
        >
          <CalendarClock />
          Unscheduled
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
            {unscheduled.length}
          </span>
        </Button>
      </div>

      {canEdit && (
        <p className="text-xs text-muted-foreground">
          Drag a task to another day to reschedule it
          {showUnscheduled ? ', or from Unscheduled onto a day to give it one' : ''} · hover a day
          to add a task due then
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex gap-3">
          <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-7 border-b border-border bg-muted/30">
              {WEEKDAYS.map((day) => (
                <div key={day} className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {day}
                </div>
              ))}
            </div>

            {isLoading ? (
              <div className="space-y-px">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-28 w-full rounded-none" />
                ))}
              </div>
            ) : (
              weeks.map((week) => (
                <WeekRow
                  key={week[0]}
                  week={week}
                  month={month}
                  today={today}
                  items={scheduled}
                  canEdit={canEdit}
                  onOpen={openTask}
                  onAdd={addOn}
                />
              ))
            )}
          </div>

          {showUnscheduled && (
            <aside
              aria-label="Unscheduled tasks"
              className="hidden w-64 shrink-0 space-y-1 rounded-lg border border-border p-2 md:block"
            >
              <h3 className="px-1 pb-1 text-xs font-semibold text-muted-foreground">No due date</h3>
              {unscheduled.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  Every open task has a date.
                </p>
              ) : (
                <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
                  {unscheduled.map((item) => (
                    <li key={item.id}>
                      <UnscheduledItem item={item} canEdit={canEdit} onOpen={openTask} />
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="flex h-[22px] max-w-56 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground shadow-lg">
              <Circle className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{dragging.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <TaskDetailPanel
        workspaceId={workspaceId}
        taskId={openTaskId}
        role={access.effectiveRole}
        projectId={projectId}
        onOpenTask={openTask}
        onClose={closeTask}
      />
    </div>
  );
}

function WeekRow({
  week,
  month,
  today,
  items,
  canEdit,
  onOpen,
  onAdd,
}: {
  week: string[];
  month: string;
  today: string;
  items: CalendarItem[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  onAdd: (day: string, title: string) => Promise<unknown>;
}) {
  const { placed, hidden } = useMemo(() => layoutWeek(week, items, MAX_LANES), [week, items]);
  const monthPrefix = month.slice(0, 7);
  const weekKey = week[0] as string;
  const lanes = Math.max(1, ...placed.map((entry) => entry.lane + 1));
  const minHeight = DAY_HEADER + Math.max(lanes, MAX_LANES) * LANE_HEIGHT + 22;

  return (
    <div className="relative border-b border-border last:border-b-0" style={{ minHeight }}>
      {/* The day cells: background, number, drop target, add button. */}
      <div className="absolute inset-0 grid grid-cols-7">
        {week.map((day, column) => (
          <DayCell
            key={day}
            day={day}
            inMonth={day.startsWith(monthPrefix)}
            isToday={day === today}
            canEdit={canEdit}
            hidden={hidden[column] ?? 0}
            items={items}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        ))}
      </div>

      {/* The bars, laid over the cells. */}
      <div className="pointer-events-none absolute inset-x-0" style={{ top: DAY_HEADER }}>
        {placed.map((entry) => (
          <CalendarBar
            key={entry.item.id}
            weekKey={weekKey}
            entry={entry}
            canEdit={canEdit}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  day,
  inMonth,
  isToday,
  canEdit,
  hidden,
  items,
  onOpen,
  onAdd,
}: {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  canEdit: boolean;
  hidden: number;
  items: CalendarItem[];
  onOpen: (id: string) => void;
  onAdd: (day: string, title: string) => Promise<unknown>;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${day}`,
    data: { day },
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group/day relative border-r border-border/70 last:border-r-0',
        !inMonth && 'bg-muted/25',
        isOver && 'bg-primary/10',
      )}
    >
      <div className="flex h-7 items-center justify-between px-1.5">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
            isToday && 'bg-primary font-semibold text-primary-foreground',
            !isToday && (inMonth ? 'text-foreground' : 'text-muted-foreground'),
          )}
        >
          {fromYmd(day).getDate()}
        </span>
        {canEdit && <AddOnDay day={day} onAdd={onAdd} />}
      </div>

      {hidden > 0 && (
        <MoreOnDay
          day={day}
          count={hidden}
          items={items.filter((item) => item.start <= day && item.end >= day)}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}

function CalendarBar({
  weekKey,
  entry,
  canEdit,
  onOpen,
}: {
  weekKey: string;
  entry: PlacedSpan<CalendarItem>;
  canEdit: boolean;
  onOpen: (id: string) => void;
}) {
  const { item } = entry;
  const ticket = item.workItem.type === 'TICKET';
  // A bar split across two weeks is two bars for one item; either end drags it.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${weekKey}:${item.id}`,
    data: { itemId: item.id },
    disabled: !canEdit,
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(item.id)}
      title={item.workItem.title}
      className={cn(
        'pointer-events-auto absolute flex h-[22px] items-center gap-1 overflow-hidden px-1.5 text-left text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        item.done
          ? 'bg-muted text-muted-foreground'
          : 'bg-primary/15 text-foreground hover:bg-primary/25',
        entry.continuesBefore ? 'rounded-l-none' : 'rounded-l-md',
        entry.continuesAfter ? 'rounded-r-none' : 'rounded-r-md',
        canEdit && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
      style={{
        left: `calc(${(entry.column / 7) * 100}% + 3px)`,
        width: `calc(${(entry.span / 7) * 100}% - 6px)`,
        top: entry.lane * LANE_HEIGHT,
      }}
    >
      {ticket ? (
        <Ticket className="size-3 shrink-0" aria-hidden="true" />
      ) : item.done ? (
        <CheckCircle2 className="size-3 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Circle className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className={cn('truncate', item.done && 'line-through')}>{item.workItem.title}</span>
    </button>
  );
}

function UnscheduledItem({
  item,
  canEdit,
  onOpen,
}: {
  item: ProjectWorkItem;
  canEdit: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { itemId: item.id },
    disabled: !canEdit,
  });

  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(item.id)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
        canEdit && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      {item.type === 'TICKET' ? (
        <Ticket className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

function MoreOnDay({
  day,
  count,
  items,
  onOpen,
}: {
  day: string;
  count: number;
  items: CalendarItem[];
  onOpen: (id: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="absolute bottom-1 left-1.5 cursor-pointer rounded px-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          +{count} more
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <p className="px-1 pb-1.5 text-xs font-semibold">{formatLongDay.format(fromYmd(day))}</p>
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted"
              >
                {item.done ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className={cn('truncate', item.done && 'text-muted-foreground line-through')}>
                  {item.workItem.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function AddOnDay({
  day,
  onAdd,
}: {
  day: string;
  onAdd: (day: string, title: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const label = formatShortDay.format(fromYmd(day));

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onAdd(day, trimmed);
      setTitle('');
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Add a task due ${label}`}
          className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 group-hover/day:opacity-100 data-[state=open]:opacity-100"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2 p-2.5">
        <p className="text-xs text-muted-foreground">New task due {label}</p>
        <Input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
          placeholder="Write a task name"
          aria-label={`Task due ${label}`}
          className="h-8 text-sm"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            className="h-7 px-3 text-xs"
            loading={saving}
            onClick={() => void submit()}
          >
            Add task
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
