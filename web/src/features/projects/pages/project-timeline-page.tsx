import type { ProjectWorkItem } from '@coretask/types';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Ticket } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { PersonAvatar } from '@/components/data-display/person-avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskDetailPanel } from '@/features/tasks/components/task-detail-dialog';
import {
  useProjectWorkItems,
  useUpdateProjectWorkItem,
} from '@/features/work-items/hooks/use-project-work-items';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatDate } from '@/lib/utils';
import { calendarDateOf, fromYmd, toIsoCalendarDate, ymd } from '@/lib/utils/dates';

import { useLinkTasks, useProjectDependencies } from '../hooks/use-project-dependencies';
import { dependencyPaths, type BarBox } from '../lib/timeline-dependencies';
import { useProject } from '../hooks/use-projects';
import { dayDiff, shiftSchedule } from '../lib/calendar-layout';
import { useProjectAccess } from '../lib/project-access';
import {
  barSpan,
  buildDayRange,
  dayAt,
  dragEnds,
  monthSegments,
  weekSegments,
  type DayRange,
} from '../lib/timeline-scale';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Asana's zoom steps: day numbers, week columns, month bands. */
const ZOOMS = [
  { key: 'days', label: 'Days', px: 36 },
  { key: 'weeks', label: 'Weeks', px: 14 },
  { key: 'months', label: 'Months', px: 5 },
] as const;
type Zoom = (typeof ZOOMS)[number]['key'];

const NAME_WIDTH = 280;
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 52;
/** A section's band across the timeline (`h-9`). */
const SECTION_HEIGHT = 36;
const NO_SECTION = '__none__';

interface Row {
  item: ProjectWorkItem;
  /** Null for an item with no dates — an empty lane, clickable to schedule. */
  start: string | null;
  end: string | null;
}

interface Group {
  id: string;
  name: string;
  rows: Row[];
}

interface DragState {
  itemId: string;
  mode: 'move' | 'start' | 'end';
  originX: number;
  deltaDays: number;
  moved: boolean;
}

function toRow(item: ProjectWorkItem): Row {
  if (!item.dueDate) return { item, start: null, end: null };
  const end = calendarDateOf(item.dueDate);
  const start = item.startDate ? calendarDateOf(item.startDate) : end;
  return { item, start: start <= end ? start : end, end };
}

/**
 * The project's Timeline tab — Asana's Gantt for one project.
 *
 * Tasks in section order, each a bar from start date to due date on a day
 * scale. Drag a bar to move it, drag an end to change one date, click an
 * empty lane to give a task a due date there. The same work items and the
 * same `?task=` panel as every other tab.
 */
export function ProjectTimelinePage({ projectId }: { projectId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: project, isLoading: projectLoading } = useProject(workspaceId, projectId);
  const access = useProjectAccess(project);
  const canEdit = access.canEdit && !project?.archivedAt;

  const navigate = useNavigate();
  const routeSearch: Partial<{ task: string }> = useSearch({ strict: false });
  const openTaskId =
    routeSearch.task && UUID_PATTERN.test(routeSearch.task) ? routeSearch.task : null;

  const { data, isLoading } = useProjectWorkItems(workspaceId, projectId, {});
  const update = useUpdateProjectWorkItem(workspaceId, projectId);

  const [zoom, setZoom] = useState<Zoom>('weeks');
  const pxPerDay = ZOOMS.find((entry) => entry.key === zoom)?.px ?? 14;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<{ itemId: string; day: string } | null>(null);
  /** A link being dragged out of a bar: from which task, to where the pointer is. */
  const [linking, setLinking] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dependencies = useProjectDependencies(workspaceId, projectId);
  const link = useLinkTasks(workspaceId);
  const today = ymd(new Date());

  const groups = useMemo<Group[]>(() => {
    const rows = (data?.items ?? []).filter((item) => !item.parentId).map(toRow);
    const bySection = new Map<string, Row[]>();
    for (const row of rows) {
      const key = row.item.sectionId ?? NO_SECTION;
      bySection.set(key, [...(bySection.get(key) ?? []), row]);
    }
    const sections = project?.sections ?? [];
    const result: Group[] = sections.map((section) => ({
      id: section.id,
      name: section.name,
      rows: bySection.get(section.id) ?? [],
    }));
    const orphans = bySection.get(NO_SECTION);
    if (orphans?.length) result.push({ id: NO_SECTION, name: 'No section', rows: orphans });
    return result;
  }, [data, project?.sections]);

  const range = useMemo<DayRange>(() => {
    const keys = groups.flatMap((group) =>
      group.rows.flatMap((row) => (row.start && row.end ? [row.start, row.end] : [])),
    );
    return buildDayRange(keys, today, zoom === 'months' ? 182 : zoom === 'weeks' ? 84 : 42);
  }, [groups, today, zoom]);

  const canvasWidth = range.days * pxPerDay;
  const todayX = dayDiff(range.start, today) * pxPerDay + pxPerDay / 2;

  /*
   * Where each scheduled bar sits on the canvas — the rows are a fixed height,
   * so walking the groups in order places them — for the dependency arrows.
   */
  const layout = useMemo(() => {
    const boxes = new Map<string, BarBox>();
    let y = HEADER_HEIGHT;
    for (const group of groups) {
      y += SECTION_HEIGHT;
      if (collapsed.has(group.id)) continue;
      for (const row of group.rows) {
        if (row.start && row.end) {
          const span = barSpan(range, row.start, row.end, pxPerDay);
          const milestone =
            row.item.details.kind === 'TASK' && row.item.details.taskKind === 'MILESTONE';
          const centre = NAME_WIDTH + span.left + span.width - pxPerDay / 2;
          boxes.set(row.item.id, {
            left: milestone ? centre - 7 : NAME_WIDTH + span.left + 1,
            right: milestone ? centre + 7 : NAME_WIDTH + span.left + span.width - 1,
            y: y + ROW_HEIGHT / 2,
          });
        }
        y += ROW_HEIGHT;
      }
    }
    return { boxes, height: y };
  }, [groups, collapsed, range, pxPerDay]);

  const arrows = useMemo(
    () => dependencyPaths(dependencies.data ?? [], layout.boxes, ROW_HEIGHT),
    [dependencies.data, layout.boxes],
  );

  /** Pointer position on the canvas, from the client coordinates an event carries. */
  const onCanvas = (clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return bounds ? { x: clientX - bounds.left, y: clientY - bounds.top } : { x: 0, y: 0 };
  };

  /** A link dropped on a row: the task there now waits on the one it came from. */
  const finishLink = (clientX: number, clientY: number) => {
    const from = linking?.fromId;
    setLinking(null);
    if (!from) return;
    const target = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-timeline-task]');
    const to = target?.dataset['timelineTask'];
    if (!to || to === from || target?.dataset['timelineTicket'] === 'true') return;
    link.mutate({ blocked: to, blocking: from });
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const centerToday = (smooth: boolean) => {
    const element = scrollRef.current;
    if (!element) return;
    const left = Math.max(0, NAME_WIDTH + todayX - element.clientWidth / 2);
    element.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Today in view on first paint and whenever the zoom rescales the axis.
  useEffect(() => {
    centerToday(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on rescale
  }, [pxPerDay, isLoading]);

  const openTask = (taskId: string) =>
    void navigate({
      to: '/projects/$projectId/timeline',
      params: { projectId },
      search: { task: taskId },
      replace: openTaskId !== null,
      resetScroll: false,
    });
  const closeTask = () =>
    void navigate({
      to: '/projects/$projectId/timeline',
      params: { projectId },
      search: {},
      replace: true,
      resetScroll: false,
    });

  /** Writes a finished drag as the dates it implies. */
  const commitDrag = (row: Row, state: DragState) => {
    if (!row.start || !row.end || state.deltaDays === 0) return;
    const { item } = row;
    const ticket = item.type === 'TICKET';

    if (state.mode === 'move') {
      const moved = shiftSchedule(item, state.deltaDays);
      update.mutate({
        workItemId: item.id,
        payload: ticket
          ? { dueDate: moved.dueDate }
          : {
              dueDate: moved.dueDate,
              dueAt: moved.dueAt,
              startDate: moved.startDate,
              startAt: moved.startAt,
            },
      });
      return;
    }

    // Stretching an end: a ticket has no start date, so only its due moves.
    const next = dragEnds(state.mode, row.start, row.end, state.deltaDays);
    if (ticket) {
      update.mutate({ workItemId: item.id, payload: { dueDate: toIsoCalendarDate(next.end) } });
      return;
    }

    const startDelta = dayDiff(row.start, next.start);
    const endDelta = dayDiff(row.end, next.end);
    const startShift = shiftSchedule({ ...item, dueDate: null, dueAt: null }, startDelta);
    const endShift = shiftSchedule({ ...item, startDate: null, startAt: null }, endDelta);

    update.mutate({
      workItemId: item.id,
      payload: {
        // A due-only task gains a start the moment its bar is stretched.
        startDate: next.start === next.end ? null : toIsoCalendarDate(next.start),
        startAt: next.start === next.end ? null : startShift.startAt,
        dueDate: toIsoCalendarDate(next.end),
        dueAt: endShift.dueAt,
      },
    });
  };

  const scheduleOn = (item: ProjectWorkItem, day: string) =>
    update.mutate({ workItemId: item.id, payload: { dueDate: toIsoCalendarDate(day) } });

  if (projectLoading || !project) return <Skeleton className="h-96 w-full" />;

  const months = monthSegments(range);
  const lower = zoom === 'days' ? null : weekSegments(range);
  const days = zoom === 'days' ? Array.from({ length: range.days }, (_, index) => index) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => centerToday(true)}>
          Today
        </Button>
        <div className="flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Zoom">
          {ZOOMS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="radio"
              aria-checked={zoom === entry.key}
              onClick={() => setZoom(entry.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                zoom === entry.key
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {canEdit && (
          <p className="ml-auto hidden text-xs text-muted-foreground lg:block">
            Drag a bar to move it · drag an end to change a date · drag a bar’s dot onto another
            task to make it wait · click an empty lane to schedule
          </p>
        )}
      </div>

      <div
        ref={scrollRef}
        className="relative max-h-[calc(100vh-15rem)] overflow-auto rounded-lg border border-border"
      >
        <div ref={canvasRef} style={{ width: NAME_WIDTH + canvasWidth }} className="relative">
          {/* Header: frozen on top, its name cell frozen on the left too. */}
          <div
            className="sticky top-0 z-30 flex border-b border-border bg-background"
            style={{ height: HEADER_HEIGHT }}
          >
            <div
              className="sticky left-0 z-10 flex shrink-0 items-end border-r border-border bg-background px-3 pb-1.5 text-xs font-medium text-muted-foreground"
              style={{ width: NAME_WIDTH }}
            >
              Task name
            </div>
            <div className="relative" style={{ width: canvasWidth }}>
              {months.map((month) => (
                <div
                  key={month.key}
                  className="absolute top-0 h-6 border-l border-border/70 pt-1 text-xs font-semibold"
                  style={{ left: month.offset * pxPerDay, width: month.length * pxPerDay }}
                >
                  {/* Sticks just past the frozen names while its month is on
                      screen, so the band is never unlabelled mid-scroll. */}
                  <span
                    className="sticky inline-block max-w-full truncate px-2"
                    style={{ left: NAME_WIDTH }}
                  >
                    {month.label}
                  </span>
                </div>
              ))}
              {lower?.map((week) => (
                <div
                  key={week.key}
                  className="absolute top-6 h-[26px] truncate border-l border-border/50 px-1.5 pt-1 text-[11px] text-muted-foreground"
                  style={{ left: week.offset * pxPerDay, width: week.length * pxPerDay }}
                >
                  {zoom === 'weeks' ? week.label : ''}
                </div>
              ))}
              {days?.map((index) => {
                const date = fromYmd(range.start);
                date.setDate(date.getDate() + index);
                const weekend = date.getDay() === 0 || date.getDay() === 6;
                const isToday = ymd(date) === today;
                return (
                  <div
                    key={index}
                    className={cn(
                      'absolute top-6 flex h-[26px] items-center justify-center text-[11px] tabular-nums',
                      weekend ? 'text-muted-foreground/60' : 'text-muted-foreground',
                      isToday && 'font-semibold text-primary-strong',
                    )}
                    style={{ left: index * pxPerDay, width: pxPerDay }}
                  >
                    {date.getDate()}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Weekend shading and the today line, behind the rows. */}
          <div
            className="pointer-events-none absolute bottom-0 z-0"
            style={{ left: NAME_WIDTH, top: HEADER_HEIGHT, width: canvasWidth }}
            aria-hidden="true"
          >
            {zoom === 'days' &&
              days?.map((index) => {
                const date = fromYmd(range.start);
                date.setDate(date.getDate() + index);
                if (date.getDay() !== 0 && date.getDay() !== 6) return null;
                return (
                  <div
                    key={index}
                    className="absolute inset-y-0 bg-muted/40"
                    style={{ left: index * pxPerDay, width: pxPerDay }}
                  />
                );
              })}
            {lower?.map((week) => (
              <div
                key={week.key}
                className="absolute inset-y-0 w-px bg-border/40"
                style={{ left: week.offset * pxPerDay }}
              />
            ))}
            <div className="absolute inset-y-0 w-0.5 bg-primary/70" style={{ left: todayX - 1 }} />
          </div>

          <svg
            className="pointer-events-none absolute left-0 top-0 z-[5]"
            width={NAME_WIDTH + canvasWidth}
            height={layout.height}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="timeline-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground" />
              </marker>
              <marker
                id="timeline-arrow-conflict"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" className="fill-destructive" />
              </marker>
            </defs>
            {arrows.map((arrow) => (
              <path
                key={arrow.id}
                d={arrow.d}
                fill="none"
                strokeWidth={1.5}
                className={arrow.conflict ? 'stroke-destructive' : 'stroke-muted-foreground/70'}
                markerEnd={`url(#${arrow.conflict ? 'timeline-arrow-conflict' : 'timeline-arrow'})`}
              />
            ))}
          </svg>

          {/* The link being dragged, over everything so it can be seen. */}
          {linking && layout.boxes.get(linking.fromId) && (
            <svg
              className="pointer-events-none absolute left-0 top-0 z-40"
              width={NAME_WIDTH + canvasWidth}
              height={layout.height}
              aria-hidden="true"
            >
              <line
                x1={layout.boxes.get(linking.fromId)?.right}
                y1={layout.boxes.get(linking.fromId)?.y}
                x2={linking.x}
                y2={linking.y}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                className="stroke-primary"
              />
            </svg>
          )}

          {isLoading ? (
            <div className="space-y-px p-2">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            groups.map((group) => {
              const isCollapsed = collapsed.has(group.id);
              return (
                <section key={group.id} aria-label={group.name}>
                  <div className="relative z-10 flex h-9 items-center border-b border-border bg-muted/30">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          if (next.has(group.id)) next.delete(group.id);
                          else next.add(group.id);
                          return next;
                        })
                      }
                      aria-expanded={!isCollapsed}
                      className="sticky left-0 flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-border bg-inherit px-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                      style={{ width: NAME_WIDTH }}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                      )}
                      <span className="truncate">{group.name}</span>
                      <span className="ml-auto rounded-full bg-muted px-1.5 text-xs font-normal text-muted-foreground">
                        {group.rows.length}
                      </span>
                    </button>
                    <SectionSpan group={group} range={range} pxPerDay={pxPerDay} />
                  </div>

                  {!isCollapsed &&
                    group.rows.map((row) => (
                      <TimelineRow
                        key={row.item.id}
                        row={row}
                        range={range}
                        pxPerDay={pxPerDay}
                        canEdit={canEdit}
                        drag={drag?.itemId === row.item.id ? drag : null}
                        ghostDay={ghost?.itemId === row.item.id ? ghost.day : null}
                        onOpen={() => openTask(row.item.id)}
                        onDragStart={(mode, x) =>
                          setDrag({
                            itemId: row.item.id,
                            mode,
                            originX: x,
                            deltaDays: 0,
                            moved: false,
                          })
                        }
                        onDragMove={(x) =>
                          setDrag((current) =>
                            current && current.itemId === row.item.id
                              ? {
                                  ...current,
                                  deltaDays: Math.round((x - current.originX) / pxPerDay),
                                  moved: current.moved || Math.abs(x - current.originX) > 3,
                                }
                              : current,
                          )
                        }
                        onDragEnd={() => {
                          if (drag && drag.itemId === row.item.id) {
                            if (drag.moved) commitDrag(row, drag);
                            else openTask(row.item.id);
                          }
                          setDrag(null);
                        }}
                        onHoverDay={(day) => setGhost(day ? { itemId: row.item.id, day } : null)}
                        onSchedule={(day) => scheduleOn(row.item, day)}
                        onLinkStart={(x, y) =>
                          setLinking({ fromId: row.item.id, ...onCanvas(x, y) })
                        }
                        onLinkMove={(x, y) =>
                          setLinking((current) =>
                            current ? { ...current, ...onCanvas(x, y) } : current,
                          )
                        }
                        onLinkEnd={finishLink}
                      />
                    ))}
                </section>
              );
            })
          )}
        </div>
      </div>

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

/** A section's own band: from its earliest start to its latest due, as Asana draws it. */
function SectionSpan({
  group,
  range,
  pxPerDay,
}: {
  group: Group;
  range: DayRange;
  pxPerDay: number;
}) {
  const dated = group.rows.filter((row) => row.start && row.end);
  if (dated.length === 0) return null;
  const start = dated.reduce(
    (min, row) => ((row.start as string) < min ? (row.start as string) : min),
    dated[0]?.start as string,
  );
  const end = dated.reduce(
    (max, row) => ((row.end as string) > max ? (row.end as string) : max),
    dated[0]?.end as string,
  );
  const { left, width } = barSpan(range, start, end, pxPerDay);

  return (
    <div className="relative h-full" style={{ width: range.days * pxPerDay }} aria-hidden="true">
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/25"
        style={{ left, width }}
      />
    </div>
  );
}

function TimelineRow({
  row,
  range,
  pxPerDay,
  canEdit,
  drag,
  ghostDay,
  onOpen,
  onDragStart,
  onDragMove,
  onDragEnd,
  onHoverDay,
  onSchedule,
  onLinkStart,
  onLinkMove,
  onLinkEnd,
}: {
  row: Row;
  range: DayRange;
  pxPerDay: number;
  canEdit: boolean;
  drag: DragState | null;
  ghostDay: string | null;
  onOpen: () => void;
  onDragStart: (mode: DragState['mode'], x: number) => void;
  onDragMove: (x: number) => void;
  onDragEnd: () => void;
  onHoverDay: (day: string | null) => void;
  onSchedule: (day: string) => void;
  onLinkStart: (clientX: number, clientY: number) => void;
  onLinkMove: (clientX: number, clientY: number) => void;
  onLinkEnd: (clientX: number, clientY: number) => void;
}) {
  const { item } = row;
  const done = item.completedAt !== null;
  const ticket = item.type === 'TICKET';
  // A milestone is a moment, so it draws as Asana's diamond on its due day.
  const milestone = item.details.kind === 'TASK' && item.details.taskKind === 'MILESTONE';
  const assignee = item.assignees[0] ?? null;

  // The bar as it stands mid-drag, so the reader sees where it will land.
  const preview =
    row.start && row.end
      ? drag
        ? dragEnds(drag.mode, row.start, row.end, drag.deltaDays)
        : { start: row.start, end: row.end }
      : null;
  const span = preview ? barSpan(range, preview.start, preview.end, pxPerDay) : null;

  const pointer = (mode: DragState['mode']) => ({
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (!canEdit || event.button !== 0) {
        if (!canEdit && mode === 'move') onOpen();
        return;
      }
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      onDragStart(mode, event.clientX);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) onDragMove(event.clientX);
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      onDragEnd();
    },
  });

  const label = preview
    ? preview.start === preview.end
      ? formatDate(preview.end)
      : `${formatDate(preview.start)} – ${formatDate(preview.end)}`
    : 'No dates';

  return (
    <div
      className="group relative z-10 flex border-b border-border/60"
      style={{ height: ROW_HEIGHT }}
      data-timeline-task={item.id}
      data-timeline-ticket={ticket ? 'true' : undefined}
    >
      <button
        type="button"
        onClick={onOpen}
        className="sticky left-0 flex shrink-0 cursor-pointer items-center gap-2 border-r border-border bg-background px-3 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        style={{ width: NAME_WIDTH }}
      >
        {ticket ? (
          <Ticket className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : done ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Completed" />
        ) : (
          <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span
          className={cn('min-w-0 flex-1 truncate', done && 'text-muted-foreground line-through')}
        >
          {item.title}
        </span>
        {assignee && (
          <PersonAvatar
            name={assignee.name}
            avatarUrl={assignee.avatarUrl}
            className="size-5"
            fallbackClassName="text-[9px]"
            title={assignee.name}
          />
        )}
      </button>

      <div
        className="relative"
        style={{ width: range.days * pxPerDay }}
        onPointerMove={(event) => {
          if (span || !canEdit) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          onHoverDay(dayAt(range, event.clientX - bounds.left, pxPerDay));
        }}
        onPointerLeave={() => onHoverDay(null)}
        onClick={() => {
          if (!span && ghostDay) onSchedule(ghostDay);
        }}
      >
        {span && milestone ? (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Milestone ${item.title}: ${label}`}
            title={`${item.title} · ${label}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }}
            {...pointer('move')}
            className={cn(
              'absolute top-1.5 flex h-6 select-none items-center gap-1.5 touch-none focus-visible:outline-none',
              canEdit && (drag ? 'cursor-grabbing' : 'cursor-grab'),
            )}
            style={{ left: span.left + span.width - pxPerDay / 2 - 8 }}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-3.5 rotate-45 rounded-[2px] shadow-xs',
                done ? 'bg-success' : 'bg-warning',
                drag?.moved && 'ring-2 ring-primary/60',
              )}
            />
            <span className={cn('whitespace-nowrap text-xs font-medium', done && 'line-through')}>
              {item.title}
            </span>
          </div>
        ) : span ? (
          <div
            role="button"
            tabIndex={0}
            aria-label={`${item.title}: ${label}`}
            title={`${item.title} · ${label}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }}
            {...pointer('move')}
            className={cn(
              'absolute top-1.5 flex h-6 select-none items-center overflow-hidden rounded-md px-2 text-xs font-medium shadow-xs touch-none',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              done
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
              canEdit && (drag ? 'cursor-grabbing' : 'cursor-grab'),
              drag?.moved && 'ring-2 ring-primary/60',
            )}
            style={{ left: span.left + 1, width: Math.max(span.width - 2, 8) }}
          >
            {/* Grab strips on either end; a ticket's deadline has no start to drag. */}
            {canEdit && !ticket && (
              <span
                {...pointer('start')}
                className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-md hover:bg-black/20"
                aria-hidden="true"
              />
            )}
            <span className={cn('truncate', done && 'line-through')}>
              {span.width > 60 ? item.title : ''}
            </span>
            {canEdit && (
              <span
                {...pointer('end')}
                className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md hover:bg-black/20"
                aria-hidden="true"
              />
            )}
          </div>
        ) : (
          ghostDay && (
            <div
              className="pointer-events-none absolute top-1.5 flex h-6 items-center justify-center rounded-md border border-dashed border-primary/60 bg-primary/10 text-[10px] text-primary-strong"
              style={{
                left: dayDiff(range.start, ghostDay) * pxPerDay + 1,
                width: Math.max(pxPerDay - 2, 18),
              }}
              aria-hidden="true"
            >
              {pxPerDay >= 30 ? '+' : ''}
            </div>
          )
        )}

        {/* The dot a dependency is dragged out of: drop it on the task that should wait. */}
        {span && canEdit && !ticket && !drag && (
          <span
            role="presentation"
            title="Drag onto another task to make it wait on this one"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              onLinkStart(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                onLinkMove(event.clientX, event.clientY);
              }
            }}
            onPointerUp={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              event.currentTarget.releasePointerCapture(event.pointerId);
              onLinkEnd(event.clientX, event.clientY);
            }}
            className="absolute top-1/2 z-20 size-2.5 -translate-y-1/2 cursor-crosshair touch-none rounded-full border-2 border-primary bg-background opacity-0 transition-opacity group-hover:opacity-100"
            style={{
              left: milestone
                ? span.left + span.width - pxPerDay / 2 + 10
                : span.left + span.width + 2,
            }}
          />
        )}

        {/* The dates beside a bar while it is being dragged. */}
        {drag?.moved && span && (
          <span
            className="pointer-events-none absolute top-2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background"
            style={{ left: span.left + span.width + 6 }}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
