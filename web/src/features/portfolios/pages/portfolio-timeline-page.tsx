import type { ProjectSummary } from '@coretask/types';
import { Link } from '@tanstack/react-router';
import {
  ArrowUpDown,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Minus,
  Plus,
  Rows3,
  Search,
  Settings2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/feedback/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { cn, formatDate, initials } from '@/lib/utils';
import { usePortfolio } from '@/stores/portfolio.store';

import { AddProjectsDialog } from '../components/add-projects-dialog';
import { ProjectStatusUpdateChip } from '../components/status-update';
import { usePortfolioProjectIndex } from '../hooks/use-portfolio-projects';
import { rollupPortfolio } from '../lib/rollup';
import {
  barGeometry,
  buildAxis,
  buildTimelineRange,
  daysInMonth,
  monthOffset,
} from '../lib/timeline';

/**
 * Each zoom step swaps the axis unit, Asana-style: − / + walks from years
 * over quarters down to day numbers. `px` is pixels per month; coarse zooms
 * ask for a longer minimum range so the canvas doesn't run dry.
 */
const ZOOM_LEVELS = [
  { unit: 'years', px: 30, label: 'Years', minMonths: 36 },
  { unit: 'quarters', px: 112, label: 'Quarters', minMonths: 12 },
  { unit: 'months', px: 360, label: 'Months', minMonths: 12 },
  { unit: 'days', px: 1200, label: 'Days', minMonths: 12 },
] as const;

const ROW_HEIGHT = 40;

/**
 * The Timeline tab: Asana's portfolio Gantt. Name, owner and status stay
 * frozen on the left; each project draws as a bar from its start date to its
 * due date on a quarter/month axis, with a marker on today. Projects without
 * dates keep an empty lane, exactly as Asana leaves them.
 */
export function PortfolioTimelinePage({ portfolioId }: { portfolioId: string }) {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;

  const portfolio = usePortfolio(workspaceId, portfolioId);
  const { projectsById, isLoading } = usePortfolioProjectIndex(workspaceId);

  const [adding, setAdding] = useState(false);
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const leftRowsRef = useRef<HTMLDivElement>(null);

  // The split between the frozen columns and the timeline is draggable,
  // like Asana's pane handle.
  const [leftWidth, setLeftWidth] = useState(380);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const projects = useMemo(
    () => (portfolio ? rollupPortfolio(portfolio, projectsById).projects : []),
    [portfolio, projectsById],
  );

  const level = ZOOM_LEVELS[zoom] ?? ZOOM_LEVELS[1];
  const pxPerMonth = level.px;

  const range = useMemo(
    () => buildTimelineRange(projects, new Date(), level.minMonths),
    [projects, level.minMonths],
  );
  const axis = useMemo(() => buildAxis(range, level.unit, pxPerMonth), [range, level, pxPerMonth]);

  const totalWidth = range.months.length * pxPerMonth;
  // At the Days zoom the line runs through the middle of today's cell rather
  // than its left edge, the way Asana pins it under the date.
  const today = new Date();
  const todayX =
    (monthOffset(range.start, today) + (level.unit === 'days' ? 0.5 / daysInMonth(today) : 0)) *
    pxPerMonth;

  // Keep today in view — on first paint and again when the zoom rescales x.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = Math.max(0, todayX - element.clientWidth / 2);
  }, [todayX]);

  if (!workspaceId || !portfolio) return null;

  const scrollToToday = () => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTo({ left: Math.max(0, todayX - element.clientWidth / 2), behavior: 'smooth' });
    }
  };

  const nudge = (direction: -1 | 1) => {
    const element = scrollRef.current;
    // Most of a viewport per click, whatever the zoom unit.
    if (element)
      element.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: 'smooth' });
  };

  /** The timeline pane owns both axes; the frozen rows follow its scrollTop. */
  const syncRows = (event: React.UIEvent<HTMLDivElement>) => {
    if (leftRowsRef.current) leftRowsRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  const MIN_PANE = 240;
  const MAX_PANE = 640;
  const clampPane = (value: number) => Math.min(MAX_PANE, Math.max(MIN_PANE, value));

  const onDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = { startX: event.clientX, startWidth: leftWidth };
    setDragging(true);
  };

  const onDividerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    setLeftWidth(
      clampPane(dragState.current.startWidth + event.clientX - dragState.current.startX),
    );
  };

  const onDividerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onDividerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') setLeftWidth((current) => clampPane(current - 16));
    if (event.key === 'ArrowRight') setLeftWidth((current) => clampPane(current + 16));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3 pb-4 sm:px-6">
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus />
          Add projects
        </Button>

        <div className="ml-2 flex items-center">
          <Button variant="ghost" size="icon-sm" aria-label="Scroll back" onClick={() => nudge(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="sm" onClick={scrollToToday}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Scroll forward"
            onClick={() => nudge(1)}
          >
            <ChevronRight />
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{level.label}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={zoom === 0}
            onClick={() => setZoom((current) => Math.max(0, current - 1))}
          >
            <Minus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={zoom === ZOOM_LEVELS.length - 1}
            onClick={() => setZoom((current) => Math.min(ZOOM_LEVELS.length - 1, current + 1))}
          >
            <Plus />
          </Button>

          {/* Asana's toolbar tail — visually present, honestly inert until
              filtering and saved views exist. */}
          <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-border lg:block" />
          <Button variant="ghost" size="sm" disabled className="hidden lg:inline-flex">
            <ListFilter />
            Filter
          </Button>
          <Button variant="ghost" size="sm" disabled className="hidden lg:inline-flex">
            <ArrowUpDown />
            Sort
          </Button>
          <Button variant="ghost" size="sm" disabled className="hidden lg:inline-flex">
            <Rows3 />
            Group
          </Button>
          <Button variant="ghost" size="sm" disabled className="hidden lg:inline-flex">
            <Settings2 />
            Options
          </Button>
          <Button variant="outline" size="sm" disabled className="hidden lg:inline-flex">
            Save view
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Search timeline" disabled>
            <Search />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 px-4 sm:px-6" role="status" aria-live="polite">
          <span className="sr-only">Loading timeline</span>
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="px-4 sm:px-6">
          <EmptyState
            icon={CalendarRange}
            title="Nothing to place on the timeline"
            description="Add projects with start and due dates to see them sequenced here."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Add projects
              </Button>
            }
          />
        </div>
      ) : (
        /*
         * The timeline pane is fixed in place — the same real estate the
         * List's slide-in panel takes, but always open. Headers never scroll
         * away: the pane owns both scroll axes internally, so its horizontal
         * bar stays pinned at the bottom edge, and the frozen rows follow its
         * vertical scroll.
         */
        <div className={cn('flex min-h-0 flex-1 border-t', dragging && 'select-none')}>
          {/* Frozen columns, like Asana's Name / Owner / Status. */}
          <div className="flex shrink-0 flex-col" style={{ width: leftWidth }}>
            <div className="shrink-0">
              <div className="h-6 border-b bg-muted/40" />
              <div className="flex h-7 items-stretch border-b bg-muted/40 text-xs text-muted-foreground">
                <span className="flex w-[180px] items-center border-r border-border/40 px-3 font-medium">
                  Name
                </span>
                <span className="flex w-[90px] items-center border-r border-border/40 px-3 font-medium">
                  Owner
                </span>
                <span className="flex flex-1 items-center px-3 font-medium">Status</span>
              </div>
            </div>

            <div
              ref={leftRowsRef}
              className="min-h-0 flex-1 overflow-hidden"
              onWheel={(event) => scrollRef.current?.scrollBy({ top: event.deltaY })}
            >
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-stretch border-b border-border/40"
                  style={{ height: ROW_HEIGHT }}
                >
                  <div className="flex w-[180px] min-w-0 items-center gap-2 border-r border-border/40 px-3">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: project.color }}
                    />
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {project.name}
                    </Link>
                  </div>
                  <div className="flex w-[90px] min-w-0 items-center border-r border-border/40 px-3">
                    {project.lead ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Avatar className="size-5 shrink-0" title={project.lead.name}>
                          {project.lead.avatarUrl && (
                            <AvatarImage src={project.lead.avatarUrl} alt="" />
                          )}
                          <AvatarFallback className="text-[9px]">
                            {initials(project.lead.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate">{project.lead.name}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center px-3">
                    <ProjectStatusUpdateChip projectId={project.id} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Asana's pane handle: drag (or arrow-key) to trade columns for
              timeline. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the project columns"
            aria-valuemin={MIN_PANE}
            aria-valuemax={MAX_PANE}
            aria-valuenow={leftWidth}
            tabIndex={0}
            onPointerDown={onDividerPointerDown}
            onPointerMove={onDividerPointerMove}
            onPointerUp={onDividerPointerUp}
            onKeyDown={onDividerKeyDown}
            className={cn(
              'z-20 w-1 shrink-0 cursor-col-resize touch-none bg-border/60 transition-colors',
              'hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none',
              dragging && 'bg-primary',
            )}
          />

          {/* The axis and lanes — one scroller for both axes. A slightly
              different wash than the frozen columns, so the canvas reads as
              its own surface. */}
          <div
            ref={scrollRef}
            onScroll={syncRows}
            className="min-w-0 flex-1 overflow-auto bg-muted/20"
          >
            {/* `min-h-full` so the grid and today line run to the bottom of
                the pane, not just past the last row — as Asana draws it. */}
            <div className="relative min-h-full" style={{ width: totalWidth }}>
              {/* Weekend shading first, so the gridlines draw over it. */}
              {axis.bands.map((band) => (
                <span
                  key={band.key}
                  aria-hidden="true"
                  className="absolute inset-y-0 bg-muted/50"
                  style={{ left: band.x, width: band.width }}
                />
              ))}

              {/* Gridlines; period boundaries draw stronger. */}
              {axis.lines.map((line) => (
                <span
                  key={line.x}
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-y-0 border-l',
                    line.strong ? 'border-border/70' : 'border-border/30',
                  )}
                  style={{ left: line.x }}
                />
              ))}

              {/* Today's line; its dot lives in the sticky header so it stays
                  on the axis while the lanes scroll beneath. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 z-10 w-px bg-primary/70"
                style={{ left: todayX }}
              />

              <div className="sticky top-0 z-20 bg-background">
                <div className="relative">
                  <div className="relative h-6 border-b bg-muted/40">
                    {axis.top.map((cell) => (
                      <span
                        key={cell.key}
                        className={cn(
                          'absolute inset-y-0 flex items-center truncate px-2 text-xs font-medium text-muted-foreground',
                          cell.x > 0 && 'border-l border-border/70',
                        )}
                        style={{ left: cell.x, width: cell.width }}
                      >
                        {cell.label}
                      </span>
                    ))}
                  </div>
                  <div className="relative h-7 border-b bg-muted/40">
                    {axis.bottom.map((cell) => (
                      <span
                        key={cell.key}
                        className={cn(
                          'absolute inset-y-0 flex items-center justify-center truncate text-xs text-muted-foreground',
                          cell.x > 0 && 'border-l border-border/40',
                        )}
                        style={{ left: cell.x, width: cell.width }}
                      >
                        {cell.label}
                      </span>
                    ))}
                  </div>
                  <span
                    aria-hidden="true"
                    className="absolute bottom-[3px] z-30 size-[7px] -translate-x-1/2 rounded-full bg-primary"
                    style={{ left: todayX }}
                  />
                </div>
              </div>

              {projects.map((project) => (
                <TimelineLane
                  key={project.id}
                  project={project}
                  rangeStart={range.start}
                  pxPerMonth={pxPerMonth}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <AddProjectsDialog
        open={adding}
        onOpenChange={setAdding}
        workspaceId={workspaceId}
        portfolio={portfolio}
      />
    </div>
  );
}

function TimelineLane({
  project,
  rangeStart,
  pxPerMonth,
}: {
  project: ProjectSummary;
  rangeStart: Date;
  pxPerMonth: number;
}) {
  const geometry = barGeometry(project, rangeStart);

  return (
    <div className="relative border-b border-border/40" style={{ height: ROW_HEIGHT }}>
      {geometry && (
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          aria-label={`${project.name}: ${project.startDate ? formatDate(project.startDate) : 'no start'} – ${project.dueDate ? formatDate(project.dueDate) : 'no due date'}`}
          className="absolute top-1/2 flex h-7 -translate-y-1/2 items-center overflow-hidden rounded-md px-2 text-xs font-medium whitespace-nowrap text-white shadow-sm transition-transform hover:scale-y-105 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          style={{
            left: geometry.offset * pxPerMonth,
            width: Math.max(geometry.span * pxPerMonth, 12),
            backgroundColor: project.color,
          }}
        >
          {project.name}
        </Link>
      )}
    </div>
  );
}
